-- Fingerprint readout and incremental catalogue cursor for the source journal.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_catalog_item_readiness(p_kind text,p_catalog_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE source_value jsonb; data_value jsonb; dependencies jsonb:='[]'::jsonb; fingerprint text; status_value text; archived_at timestamptz;
BEGIN
  IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('chapter','competence','flashcard') OR p_catalog_id IS NULL THEN
    RAISE EXCEPTION 'invalid catalogue identity' USING ERRCODE='22023'; END IF;
  IF p_kind='chapter' THEN
    SELECT (to_jsonb(c)-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[]),
      jsonb_build_object('catalogId',c.catalog_id,'id',c.id,'name',c.name,'aliases',c.aliases,'emoji',c.emoji,'orderIndex',c.order_index),
      c.editorial_status,c.admin_archived_at INTO source_value,data_value,status_value,archived_at
      FROM public.chapters c WHERE c.catalog_id=p_catalog_id;
  ELSIF p_kind='competence' THEN
    SELECT (to_jsonb(c)||jsonb_build_object('chapter_catalog_id',ch.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[],
      jsonb_build_object('catalogId',c.catalog_id,'id',c.id,'name',c.name,'chapterCatalogId',ch.catalog_id,'maxPoints',c.max_points),
      c.editorial_status,c.admin_archived_at INTO source_value,data_value,status_value,archived_at
      FROM public.competences c JOIN public.chapters ch ON ch.id=c.chapter_id WHERE c.catalog_id=p_catalog_id;
    IF data_value IS NOT NULL THEN dependencies:=jsonb_build_array(jsonb_build_object('kind','chapter','catalogId',data_value->'chapterCatalogId','sourceId',source_value->>'chapter_id')); END IF;
  ELSE
    SELECT (to_jsonb(f)||jsonb_build_object('chapter_catalog_id',ch.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[],
      jsonb_build_object('catalogId',f.catalog_id,'id',f.id,'question',f.question,'answer',f.answer,'chapterCatalogId',ch.catalog_id),
      f.editorial_status,f.admin_archived_at INTO source_value,data_value,status_value,archived_at
      FROM public.flashcards f JOIN public.chapters ch ON lower(ch.name)=lower(f.chapter) OR f.chapter=ANY(ch.aliases) WHERE f.catalog_id=p_catalog_id;
    IF (SELECT count(*) FROM public.chapters ch JOIN public.flashcards f ON lower(ch.name)=lower(f.chapter) OR f.chapter=ANY(ch.aliases) WHERE f.catalog_id=p_catalog_id)<>1 THEN
      RAISE EXCEPTION 'flashcard chapter reference is missing or ambiguous' USING ERRCODE='23503'; END IF;
    IF data_value IS NOT NULL THEN dependencies:=jsonb_build_array(jsonb_build_object('kind','chapter','catalogId',data_value->'chapterCatalogId','sourceRef',source_value->>'chapter')); END IF;
  END IF;
  IF data_value IS NULL THEN RAISE EXCEPTION 'catalogue item not found' USING ERRCODE='P0002'; END IF;
  fingerprint:=encode(extensions.digest(convert_to(source_value::text,'UTF8'),'sha256'),'hex');
  RETURN jsonb_build_object('kind',p_kind,'catalogId',p_catalog_id,'status',CASE WHEN archived_at IS NULL THEN status_value ELSE 'archived' END,
    'archived',archived_at IS NOT NULL,'fingerprint',fingerprint,'data',data_value,'dependencies',dependencies);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_get_catalog_item_readiness(text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_catalog_item_readiness(text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_catalogue_sync_ready(p_after text DEFAULT '',p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501'; END IF;
  IF p_after IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid page' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('sortKey',sort_key)||item ORDER BY sort_key),'[]'::jsonb) INTO result FROM (
    SELECT 'exercise:'||e.catalog_id::text||':'||v.revision::text sort_key,
      jsonb_build_object('kind','exercise','catalogId',e.catalog_id,'id',e.id::text,'versionId',v.id,'revision',v.revision,'status',v.editorial_status,'fingerprint',v.approval_fingerprint_sha256) item
    FROM public.exercises e JOIN public.exercise_versions v ON v.exercise_id=e.id
    WHERE e.admin_archived_at IS NULL AND v.editorial_status='ready' AND v.ready_fingerprint_sha256=v.approval_fingerprint_sha256
      AND e.synced_fingerprint_sha256 IS DISTINCT FROM v.approval_fingerprint_sha256
    UNION ALL
    SELECT 'exercise:'||e.catalog_id::text||':'||v.revision::text,
      jsonb_build_object('kind','exercise','catalogId',e.catalog_id,'id',e.id::text,'versionId',v.id,'revision',v.revision,'status','published','fingerprint',v.approval_fingerprint_sha256)
    FROM public.exercises e JOIN public.exercise_versions v ON v.exercise_id=e.id AND v.id=e.active_version_id
    WHERE e.admin_archived_at IS NULL AND v.editorial_status='published' AND e.synced_fingerprint_sha256 IS DISTINCT FROM v.approval_fingerprint_sha256
      AND NOT EXISTS(SELECT 1 FROM public.exercise_versions draft WHERE draft.exercise_id=e.id AND draft.editorial_status='ready')
    UNION ALL
    SELECT 'exercise:'||e.catalog_id::text||':archive',jsonb_build_object('kind','exercise','catalogId',e.catalog_id,'id',e.id::text,'versionId',NULL,'revision',NULL,'status','archived',
      'fingerprint',encode(extensions.digest(convert_to((to_jsonb(e)-ARRAY['id','created_at','publication_epoch','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex'))
    FROM public.exercises e WHERE e.admin_archived_at IS NOT NULL AND e.synced_fingerprint_sha256 IS DISTINCT FROM
      encode(extensions.digest(convert_to((to_jsonb(e)-ARRAY['id','created_at','publication_epoch','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex')
    UNION ALL
    SELECT 'chapter:'||c.catalog_id::text,jsonb_build_object('kind','chapter','catalogId',c.catalog_id,'status',r->>'status','fingerprint',r->>'fingerprint')
    FROM public.chapters c CROSS JOIN LATERAL public.admin_get_catalog_item_readiness('chapter',c.catalog_id) r
    WHERE (r->>'status'='ready' OR r->>'status'='archived') AND c.synced_fingerprint_sha256 IS DISTINCT FROM r->>'fingerprint'
    UNION ALL
    SELECT 'competence:'||c.catalog_id::text,jsonb_build_object('kind','competence','catalogId',c.catalog_id,'status',r->>'status','fingerprint',r->>'fingerprint')
    FROM public.competences c CROSS JOIN LATERAL public.admin_get_catalog_item_readiness('competence',c.catalog_id) r
    WHERE (r->>'status'='ready' OR r->>'status'='archived') AND c.synced_fingerprint_sha256 IS DISTINCT FROM r->>'fingerprint'
    UNION ALL
    SELECT 'flashcard:'||f.catalog_id::text,jsonb_build_object('kind','flashcard','catalogId',f.catalog_id,'status',r->>'status','fingerprint',r->>'fingerprint')
    FROM public.flashcards f CROSS JOIN LATERAL public.admin_get_catalog_item_readiness('flashcard',f.catalog_id) r
    WHERE (r->>'status'='ready' OR r->>'status'='archived') AND f.synced_fingerprint_sha256 IS DISTINCT FROM r->>'fingerprint'
  ) items WHERE sort_key>p_after ORDER BY sort_key LIMIT p_limit;
  RETURN jsonb_build_object('items',result,'limit',p_limit,'next',CASE WHEN jsonb_array_length(result)=p_limit THEN result->-1->>'sortKey' END);
END;
$function$;
NOTIFY pgrst,'reload schema';
COMMIT;
