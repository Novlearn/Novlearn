-- Keep ambiguous legacy flashcard references visible as blocked catalogue rows.
BEGIN;
CREATE OR REPLACE FUNCTION public.admin_list_catalogue_sync_ready(p_after text DEFAULT '',p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501'; END IF;
  IF p_after IS NULL OR length(p_after)>200 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid page' USING ERRCODE='22023'; END IF;
  WITH candidates AS (
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
    SELECT 'flashcard:'||f.catalog_id::text,jsonb_build_object('kind','flashcard','catalogId',f.catalog_id,
      'status',CASE WHEN chapter_ref.n=1 THEN CASE WHEN f.admin_archived_at IS NULL THEN f.editorial_status ELSE 'archived' END ELSE 'blocked' END,
      'fingerprint',CASE WHEN chapter_ref.n=1 THEN encode(extensions.digest(convert_to(((to_jsonb(f)||jsonb_build_object('chapter_catalog_id',chapter_ref.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex') END,
      'blockedReason',CASE WHEN chapter_ref.n=1 THEN NULL ELSE 'chapter_reference_missing_or_ambiguous' END) item
    FROM public.flashcards f CROSS JOIN LATERAL (SELECT count(*) n,min(ch.catalog_id::text)::uuid catalog_id FROM public.chapters ch
      WHERE lower(ch.name)=lower(f.chapter) OR f.chapter=ANY(ch.aliases)) chapter_ref
    WHERE (f.editorial_status='ready' OR f.admin_archived_at IS NOT NULL) AND
      (chapter_ref.n<>1 OR f.synced_fingerprint_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(((to_jsonb(f)||jsonb_build_object('chapter_catalog_id',chapter_ref.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex'))
  ), page AS (
    SELECT sort_key,item FROM candidates WHERE sort_key>p_after ORDER BY sort_key LIMIT p_limit
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('sortKey',sort_key)||item ORDER BY sort_key),'[]'::jsonb) INTO result FROM page;
  RETURN jsonb_build_object('items',result,'limit',p_limit,'next',CASE WHEN jsonb_array_length(result)=p_limit THEN result->-1->>'sortKey' END);
END;
$function$;
NOTIFY pgrst,'reload schema';
COMMIT;
