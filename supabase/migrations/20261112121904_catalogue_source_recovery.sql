BEGIN;
SET LOCAL lock_timeout='5s';

-- The dependency projections contain only stable identities. A source draft is never selected for transfer; it may be named as a reference so the target can reuse its existing compatible identity.
CREATE OR REPLACE FUNCTION public.admin_export_catalogue_sync_item(p_kind text,p_catalog_id uuid,p_expected_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE data_value jsonb; source_value jsonb; dependencies jsonb:='[]'::jsonb; fingerprint text; action_value text:='upsert';
  e public.exercises; v public.exercise_versions; f public.flashcards; chapter_row public.chapters; skill text; dependency_catalog_id uuid; chapter_name text; n integer;
  status_value text; archived_at timestamptz;
BEGIN
  IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('exercise','chapter','competence','flashcard') OR p_catalog_id IS NULL OR
     p_expected_fingerprint IS NULL OR p_expected_fingerprint !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid sync identity' USING ERRCODE='22023'; END IF;
  IF p_kind='exercise' THEN
    SELECT * INTO e FROM public.exercises WHERE catalog_id=p_catalog_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'exercise not found' USING ERRCODE='P0002'; END IF;
    IF e.admin_archived_at IS NOT NULL THEN
      fingerprint:=encode(extensions.digest(convert_to((to_jsonb(e)-ARRAY['id','created_at','publication_epoch','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex');
      IF fingerprint IS DISTINCT FROM p_expected_fingerprint THEN RAISE EXCEPTION 'archive changed since review' USING ERRCODE='40001'; END IF;
      SELECT * INTO v FROM public.exercise_versions WHERE exercise_id=e.id AND id=e.active_version_id;
      RETURN jsonb_build_object('kind','exercise','catalogId',p_catalog_id,'action','archive','fingerprint',fingerprint,
        'versionId',v.id,'revision',v.revision,'definition',v.definition,'dependencies','[]'::jsonb);
    END IF;
    SELECT * INTO v FROM public.exercise_versions WHERE exercise_id=e.id AND editorial_status='ready' ORDER BY revision DESC LIMIT 1 FOR SHARE;
    IF NOT FOUND THEN
      SELECT * INTO v FROM public.exercise_versions WHERE exercise_id=e.id AND id=e.active_version_id AND editorial_status='published' FOR SHARE;
    END IF;
    IF NOT FOUND OR (v.editorial_status='ready' AND v.ready_fingerprint_sha256 IS DISTINCT FROM p_expected_fingerprint) OR
       (v.editorial_status='published' AND e.active_version_id IS DISTINCT FROM v.id) OR
       v.approval_fingerprint_sha256 IS DISTINCT FROM p_expected_fingerprint THEN
      RAISE EXCEPTION 'ready or restored revision changed or missing' USING ERRCODE='40001'; END IF;
    chapter_name:=v.definition->'catalogue'->>'chapter';
    IF chapter_name IS NOT NULL AND chapter_name<>'' THEN
      SELECT count(*) INTO n FROM public.chapters ch WHERE ch.id::text=chapter_name OR lower(ch.name)=lower(chapter_name) OR chapter_name=ANY(ch.aliases);
      SELECT ch.catalog_id INTO dependency_catalog_id FROM public.chapters ch WHERE ch.id::text=chapter_name OR lower(ch.name)=lower(chapter_name) OR chapter_name=ANY(ch.aliases) LIMIT 1;
      IF n<>1 OR NOT EXISTS(SELECT 1 FROM public.chapters WHERE catalog_id=dependency_catalog_id AND editorial_status IN ('draft','ready','published') AND admin_archived_at IS NULL) THEN
        RAISE EXCEPTION 'chapter dependency is absent, ambiguous, or not ready' USING ERRCODE='23503'; END IF;
      dependencies:=dependencies||jsonb_build_array(jsonb_build_object('kind','chapter','catalogId',dependency_catalog_id,'sourceRef',chapter_name));
    END IF;
    FOR skill IN SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(v.definition->'catalogue'->'skills')='array' THEN v.definition->'catalogue'->'skills' ELSE '[]'::jsonb END) LOOP
      SELECT count(*) INTO n FROM public.competences c WHERE c.id=skill OR lower(c.name)=lower(skill);
      SELECT c.catalog_id INTO dependency_catalog_id FROM public.competences c WHERE c.id=skill OR lower(c.name)=lower(skill) LIMIT 1;
      IF n<>1 OR NOT EXISTS(SELECT 1 FROM public.competences co WHERE co.catalog_id=dependency_catalog_id AND co.editorial_status IN ('draft','ready','published') AND co.admin_archived_at IS NULL) THEN
        RAISE EXCEPTION 'competence dependency is absent, ambiguous, or not ready' USING ERRCODE='23503'; END IF;
      dependencies:=dependencies||jsonb_build_array(jsonb_build_object('kind','competence','catalogId',dependency_catalog_id,'sourceId',skill));
    END LOOP;
    data_value:=jsonb_build_object('catalogId',e.catalog_id,'revision',v.revision,'definition',v.definition,
      'header',jsonb_build_object('title',e.title,'chapter',e.chapter,'difficulty',e.difficulty,'competences',e.competences,
        'appTitle',e.app_title,'isFlash',e."Is_Flash",'needCalculator',e."Need_Calculator"));
    fingerprint:=v.approval_fingerprint_sha256;
  ELSIF p_kind='chapter' THEN
    SELECT * INTO chapter_row FROM public.chapters WHERE catalog_id=p_catalog_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'chapter not found' USING ERRCODE='P0002'; END IF;
    action_value:=CASE WHEN c.admin_archived_at IS NULL THEN 'upsert' ELSE 'archive' END;
    data_value:=jsonb_build_object('catalogId',chapter_row.catalog_id,'name',chapter_row.name,'aliases',chapter_row.aliases,'emoji',chapter_row.emoji,'orderIndex',chapter_row.order_index);
    source_value:=to_jsonb(chapter_row)-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[];
    fingerprint:=encode(extensions.digest(convert_to(source_value::text,'UTF8'),'sha256'),'hex');
  ELSIF p_kind='competence' THEN
    SELECT (to_jsonb(co)||jsonb_build_object('chapter_catalog_id',ch.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[],
      jsonb_build_object('catalogId',co.catalog_id,'id',co.id,'name',co.name,'chapterCatalogId',ch.catalog_id,'maxPoints',co.max_points),co.editorial_status,ch.editorial_status,co.admin_archived_at
      INTO source_value,data_value,status_value,skill,archived_at FROM public.competences co JOIN public.chapters ch ON ch.id=co.chapter_id WHERE co.catalog_id=p_catalog_id FOR SHARE OF co;
    IF data_value IS NULL THEN RAISE EXCEPTION 'competence or chapter reference not found' USING ERRCODE='P0002'; END IF;
    action_value:=CASE WHEN archived_at IS NULL THEN 'upsert' ELSE 'archive' END;
    dependencies:=jsonb_build_array(jsonb_build_object('kind','chapter','catalogId',data_value->'chapterCatalogId','sourceId',source_value->>'chapter_id'));
    fingerprint:=encode(extensions.digest(convert_to(source_value::text,'UTF8'),'sha256'),'hex');
    IF action_value='upsert' AND skill NOT IN ('draft','ready','published') THEN RAISE EXCEPTION 'chapter dependency is not ready' USING ERRCODE='23503'; END IF;
  ELSE
    SELECT * INTO f FROM public.flashcards WHERE catalog_id=p_catalog_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'flashcard not found' USING ERRCODE='P0002'; END IF;
    SELECT count(*) INTO n FROM public.chapters ch WHERE lower(ch.name)=lower(f.chapter) OR f.chapter=ANY(ch.aliases);
    SELECT ch.catalog_id INTO dependency_catalog_id FROM public.chapters ch WHERE lower(ch.name)=lower(f.chapter) OR f.chapter=ANY(ch.aliases) LIMIT 1;
    IF n<>1 THEN RAISE EXCEPTION 'flashcard chapter is missing or ambiguous' USING ERRCODE='23503'; END IF;
    action_value:=CASE WHEN f.admin_archived_at IS NULL THEN 'upsert' ELSE 'archive' END;
    data_value:=jsonb_build_object('catalogId',f.catalog_id,'question',f.question,'answer',f.answer,'chapterCatalogId',dependency_catalog_id);
    source_value:=(to_jsonb(f)||jsonb_build_object('chapter_catalog_id',dependency_catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[];
    dependencies:=jsonb_build_array(jsonb_build_object('kind','chapter','catalogId',dependency_catalog_id,'sourceRef',f.chapter));
    fingerprint:=encode(extensions.digest(convert_to(source_value::text,'UTF8'),'sha256'),'hex');
    IF action_value='upsert' AND NOT EXISTS(SELECT 1 FROM public.chapters WHERE catalog_id=dependency_catalog_id AND editorial_status IN ('draft','ready','published') AND admin_archived_at IS NULL) THEN
      RAISE EXCEPTION 'flashcard chapter dependency is not ready' USING ERRCODE='23503'; END IF;
  END IF;
  IF fingerprint IS DISTINCT FROM p_expected_fingerprint THEN RAISE EXCEPTION 'catalogue item changed since review' USING ERRCODE='40001'; END IF;
  IF action_value='upsert' AND p_kind<>'exercise' AND NOT EXISTS(
    SELECT 1 FROM (SELECT editorial_status,ready_at,ready_by FROM public.chapters WHERE p_kind='chapter' AND catalog_id=p_catalog_id
      UNION ALL SELECT editorial_status,ready_at,ready_by FROM public.competences WHERE p_kind='competence' AND catalog_id=p_catalog_id
      UNION ALL SELECT editorial_status,ready_at,ready_by FROM public.flashcards WHERE p_kind='flashcard' AND catalog_id=p_catalog_id) s
    WHERE s.editorial_status='ready' AND s.ready_at IS NOT NULL AND s.ready_by IS NOT NULL) THEN
    RAISE EXCEPTION 'catalogue item is not ready' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('kind',p_kind,'catalogId',p_catalog_id,'action',action_value,'fingerprint',fingerprint,
    'versionId',CASE WHEN p_kind='exercise' THEN v.id END,'revision',CASE WHEN p_kind='exercise' THEN v.revision END,
    'data',data_value,'dependencies',dependencies);
END;
$function$;

-- Match the exporter: at most the highest ready revision is offered for each exercise catalog identity.
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
      AND v.revision=(SELECT max(v2.revision) FROM public.exercise_versions v2 WHERE v2.exercise_id=e.id AND v2.editorial_status='ready')
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

-- A server-side not_applied observation under the target lease is the sole evidence that can close an uncertain batch as failed.
CREATE OR REPLACE FUNCTION novlearn_admin_private.record_catalogue_sync_batch(
  p_actor uuid,p_batch_id uuid,p_batch_digest text,p_expected_state text,p_state text,p_receipt jsonb,p_error text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE operation record; receipt_item jsonb; total integer; seen integer:=0; result jsonb;
BEGIN
  PERFORM novlearn_admin_private.publication_journal_actor(p_actor);
  IF p_expected_state IS NULL OR p_expected_state NOT IN ('executing','uncertain') OR p_state IS NULL OR p_state NOT IN ('uncertain','committed','failed') OR
     p_batch_digest IS DISTINCT FROM novlearn_admin_private.catalogue_sync_batch_digest(p_batch_id) THEN
    RAISE EXCEPTION 'invalid catalogue batch confirmation' USING ERRCODE='40001'; END IF;
  SELECT count(*) INTO total FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync';
  IF total NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'catalogue batch not found' USING ERRCODE='P0002'; END IF;
  IF p_state='committed' THEN
    IF p_error IS NOT NULL OR jsonb_typeof(p_receipt) IS DISTINCT FROM 'object' OR
       (SELECT count(*) FROM jsonb_object_keys(p_receipt))<>3 OR NOT(p_receipt ?& ARRAY['batchId','stateToken','items']) OR
       p_receipt->>'batchId' IS DISTINCT FROM p_batch_id::text OR coalesce(p_receipt->>'stateToken','') !~ '^[0-9a-f]{64}$' OR
       jsonb_typeof(p_receipt->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_receipt->'items')<>total OR octet_length(p_receipt::text)>1048576 THEN
      RAISE EXCEPTION 'verified target batch receipt required' USING ERRCODE='22023'; END IF;
    FOR operation IN SELECT * FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync' ORDER BY catalog_kind,catalog_id FOR UPDATE LOOP
      SELECT x INTO receipt_item FROM jsonb_array_elements(p_receipt->'items') x
        WHERE x->>'kind'=operation.catalog_kind AND x->>'catalogId'=operation.catalog_id::text;
      IF receipt_item IS NULL OR (SELECT count(*) FROM jsonb_object_keys(receipt_item))<>5 OR
         NOT(receipt_item ?& ARRAY['kind','catalogId','fingerprint','targetId','result']) OR
         receipt_item->>'fingerprint' IS DISTINCT FROM operation.source_fingerprint OR
         jsonb_typeof(receipt_item->'targetId') IS DISTINCT FROM 'string' OR coalesce(receipt_item->>'targetId','')='' OR
         coalesce(receipt_item->>'result','') NOT IN ('applied','unchanged','archived') THEN
        RAISE EXCEPTION 'target receipt does not match the planned catalogue batch' USING ERRCODE='22023'; END IF;
      seen:=seen+1;
      IF operation.state='committed' AND operation.outcome IS DISTINCT FROM jsonb_build_object('batchId',p_batch_id,'stateToken',p_receipt->'stateToken','item',receipt_item) THEN
        RAISE EXCEPTION 'catalogue batch already reconciled with another receipt' USING ERRCODE='40001'; END IF;
    END LOOP;
    IF seen<>total THEN RAISE EXCEPTION 'target receipt contains unknown catalogue items' USING ERRCODE='22023'; END IF;
  ELSIF p_state='uncertain' THEN
    IF p_receipt IS NOT NULL OR p_error IS NOT NULL THEN RAISE EXCEPTION 'uncertain transfer cannot assert a result' USING ERRCODE='22023'; END IF;
  ELSIF p_error IS NULL OR p_error NOT IN ('not_applied','target_rejected') OR p_receipt IS NOT NULL THEN
    RAISE EXCEPTION 'failure requires verified non-commit evidence' USING ERRCODE='22023';
  END IF;
  IF p_expected_state='uncertain' AND p_state='uncertain' THEN
    SELECT jsonb_agg(novlearn_admin_private.publication_journal_item(id) ORDER BY catalog_kind,catalog_id) INTO result
      FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync'; RETURN result;
  END IF;
  IF EXISTS(SELECT 1 FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync' AND state NOT IN (p_expected_state,'committed')) THEN
    RAISE EXCEPTION 'catalogue batch state changed' USING ERRCODE='40001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync' AND state=p_expected_state) THEN
    SELECT jsonb_agg(novlearn_admin_private.publication_journal_item(id) ORDER BY catalog_kind,catalog_id) INTO result
      FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync'; RETURN result;
  END IF;
  IF p_expected_state='uncertain' AND p_state='failed' AND p_error IS DISTINCT FROM 'not_applied' THEN
    RAISE EXCEPTION 'an uncertain operation requires target not_applied evidence before failure' USING ERRCODE='40001'; END IF;
  WITH changed AS (
    UPDATE novlearn_admin_private.publication_operations o SET state=p_state,
      outcome=CASE WHEN p_state='committed' THEN jsonb_build_object('batchId',p_batch_id,'stateToken',p_receipt->'stateToken','item',(
        SELECT x FROM jsonb_array_elements(p_receipt->'items') x WHERE x->>'kind'=o.catalog_kind AND x->>'catalogId'=o.catalog_id::text)) ELSE NULL END,
      error_code=CASE WHEN p_state='failed' THEN p_error ELSE NULL END,updated_at=clock_timestamp()
    WHERE o.batch_id=p_batch_id AND o.mode='sync' AND o.state=p_expected_state RETURNING id
  ) INSERT INTO novlearn_admin_private.publication_operation_events(operation_id,actor_id,state,error_code)
      SELECT id,p_actor,p_state,p_error FROM changed;
  IF p_state='committed' THEN
    FOR operation IN SELECT * FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync' ORDER BY catalog_kind,catalog_id LOOP
      IF operation.catalog_kind='exercise' THEN
        IF operation.payload->>'action'='upsert' THEN
          IF EXISTS(SELECT 1 FROM public.exercise_versions WHERE id=operation.version_id AND editorial_status='ready' AND ready_fingerprint_sha256=operation.source_fingerprint) THEN
            UPDATE public.exercise_versions SET editorial_status='published',published_at=coalesce(published_at,clock_timestamp())
              WHERE id=operation.version_id AND editorial_status='ready' AND ready_fingerprint_sha256=operation.source_fingerprint;
          ELSIF NOT EXISTS(SELECT 1 FROM public.exercise_versions WHERE id=operation.version_id AND editorial_status='published' AND approval_fingerprint_sha256=operation.source_fingerprint) THEN
            RAISE EXCEPTION 'source exercise changed before sync finalization' USING ERRCODE='40001';
          END IF;
        END IF;
        UPDATE public.exercises SET synced_fingerprint_sha256=operation.source_fingerprint,synced_at=clock_timestamp()
          WHERE catalog_id=operation.catalog_id AND (operation.payload->>'action'='archive' OR active_version_id IS NULL OR EXISTS(
            SELECT 1 FROM public.exercise_versions v WHERE v.exercise_id=exercises.id AND v.id=active_version_id AND v.editorial_status='published'));
        IF NOT FOUND THEN RAISE EXCEPTION 'source exercise identity changed before sync finalization' USING ERRCODE='40001'; END IF;
        INSERT INTO public.admin_content_events(actor_id,exercise_id,version_id,action)
          SELECT p_actor,e.id,operation.version_id,'sync_confirmed' FROM public.exercises e WHERE e.catalog_id=operation.catalog_id;
      ELSIF operation.catalog_kind='chapter' THEN
        PERFORM set_config('novlearn_catalog_sync.sync_item',operation.catalog_id::text,true);
        UPDATE public.chapters SET editorial_status=CASE WHEN operation.payload->>'action'='archive' THEN 'archived' ELSE 'published' END,
          synced_fingerprint_sha256=operation.source_fingerprint,synced_at=clock_timestamp() WHERE catalog_id=operation.catalog_id;
        INSERT INTO public.admin_taxonomy_events(actor_id,entity_kind,entity_id,action) SELECT p_actor,'chapter',id::text,'sync_confirmed' FROM public.chapters WHERE catalog_id=operation.catalog_id;
      ELSIF operation.catalog_kind='competence' THEN
        PERFORM set_config('novlearn_catalog_sync.sync_item',operation.catalog_id::text,true);
        UPDATE public.competences SET editorial_status=CASE WHEN operation.payload->>'action'='archive' THEN 'archived' ELSE 'published' END,
          synced_fingerprint_sha256=operation.source_fingerprint,synced_at=clock_timestamp() WHERE catalog_id=operation.catalog_id;
        INSERT INTO public.admin_taxonomy_events(actor_id,entity_kind,entity_id,action) SELECT p_actor,'competence',id,'sync_confirmed' FROM public.competences WHERE catalog_id=operation.catalog_id;
      ELSE
        PERFORM set_config('novlearn_catalog_sync.sync_item',operation.catalog_id::text,true);
        UPDATE public.flashcards SET editorial_status=CASE WHEN operation.payload->>'action'='archive' THEN 'archived' ELSE 'published' END,
          synced_fingerprint_sha256=operation.source_fingerprint,synced_at=clock_timestamp() WHERE catalog_id=operation.catalog_id;
        INSERT INTO public.admin_flashcard_events(actor_id,flashcard_id,action) SELECT p_actor,id,'sync_confirmed' FROM public.flashcards WHERE catalog_id=operation.catalog_id;
      END IF;
    END LOOP;
  END IF;
  SELECT jsonb_agg(novlearn_admin_private.publication_journal_item(id) ORDER BY catalog_kind,catalog_id) INTO result
    FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync';
  RETURN result;
END;
$function$;

NOTIFY pgrst,'reload schema';
COMMIT;
