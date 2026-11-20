-- Preserve the single primary chapter while allowing skill dependencies from
-- any chapter, and make restored exercise publications synchronizable again.
BEGIN;

CREATE OR REPLACE FUNCTION novlearn_admin_private.publication_header(p_definition jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE chapter_ref text:=p_definition->'catalogue'->>'chapter'; chapter_row public.chapters%ROWTYPE;
  skill_ref text; skill_row public.competences%ROWTYPE; count_matches integer; skill_ids text[]:='{}'; difficulty numeric;
BEGIN
  IF chapter_ref IS NULL OR btrim(chapter_ref)='' THEN RAISE EXCEPTION 'chapter required' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO count_matches FROM public.chapters WHERE id::text=chapter_ref OR name=chapter_ref OR chapter_ref=ANY(aliases);
  IF count_matches<>1 THEN RAISE EXCEPTION 'primary chapter missing or ambiguous' USING ERRCODE='22023'; END IF;
  SELECT * INTO chapter_row FROM public.chapters WHERE id::text=chapter_ref OR name=chapter_ref OR chapter_ref=ANY(aliases) FOR SHARE;
  IF jsonb_typeof(COALESCE(p_definition->'catalogue'->'skills','[]'::jsonb))<>'array' THEN RAISE EXCEPTION 'invalid skills' USING ERRCODE='22023'; END IF;
  FOR skill_ref IN SELECT value FROM jsonb_array_elements_text(COALESCE(p_definition->'catalogue'->'skills','[]'::jsonb)) LOOP
    SELECT count(*) INTO count_matches FROM public.competences WHERE id=skill_ref OR name=skill_ref;
    IF count_matches<>1 THEN RAISE EXCEPTION 'target skill missing or ambiguous' USING ERRCODE='22023'; END IF;
    SELECT * INTO skill_row FROM public.competences WHERE id=skill_ref OR name=skill_ref FOR SHARE;
    IF skill_row.id=ANY(skill_ids) THEN RAISE EXCEPTION 'duplicate resolved skill' USING ERRCODE='22023'; END IF;
    skill_ids:=array_append(skill_ids,skill_row.id);
  END LOOP;
  IF p_definition->'catalogue' ? 'difficulty' THEN
    IF jsonb_typeof(p_definition->'catalogue'->'difficulty')<>'number' THEN RAISE EXCEPTION 'invalid difficulty' USING ERRCODE='22023'; END IF;
    difficulty:=(p_definition->'catalogue'->>'difficulty')::numeric;
    IF difficulty NOT IN (1,2,3) THEN RAISE EXCEPTION 'legacy target supports difficulty 1 2 or 3 only' USING ERRCODE='22023'; END IF;
  END IF;
  RETURN jsonb_build_object('title',p_definition->>'title','chapter',chapter_row.name,'competences',to_jsonb(skill_ids),
    'difficulty',CASE difficulty WHEN 1 THEN 'easy' WHEN 2 THEN 'medium' WHEN 3 THEN 'hard' ELSE NULL END,
    'app_title',COALESCE(p_definition->'catalogue'->>'appTitle',p_definition->>'title'),
    'Is_Flash',COALESCE(p_definition->'catalogue'->>'exerciseType','classic')='flash',
    'Need_Calculator',COALESCE((p_definition->'catalogue'->>'needsCalculator')::boolean,false));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_export_catalogue_sync_item(p_kind text,p_catalog_id uuid,p_expected_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE data_value jsonb; source_value jsonb; dependencies jsonb:='[]'::jsonb; fingerprint text; action_value text:='upsert';
  e public.exercises; v public.exercise_versions; f public.flashcards; c public.chapters; skill text; chapter_id uuid; chapter_name text; n integer;
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
      SELECT ch.catalog_id INTO chapter_id FROM public.chapters ch WHERE ch.id::text=chapter_name OR lower(ch.name)=lower(chapter_name) OR chapter_name=ANY(ch.aliases) LIMIT 1;
      IF n<>1 OR NOT EXISTS(SELECT 1 FROM public.chapters WHERE catalog_id=chapter_id AND editorial_status IN ('ready','published') AND admin_archived_at IS NULL) THEN
        RAISE EXCEPTION 'chapter dependency is absent, ambiguous, or not ready' USING ERRCODE='23503'; END IF;
      dependencies:=dependencies||jsonb_build_array(jsonb_build_object('kind','chapter','catalogId',chapter_id,'sourceRef',chapter_name));
    END IF;
    FOR skill IN SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(v.definition->'catalogue'->'skills')='array' THEN v.definition->'catalogue'->'skills' ELSE '[]'::jsonb END) LOOP
      SELECT count(*) INTO n FROM public.competences c WHERE c.id=skill OR lower(c.name)=lower(skill);
      SELECT c.catalog_id INTO chapter_id FROM public.competences c WHERE c.id=skill OR lower(c.name)=lower(skill) LIMIT 1;
      IF n<>1 OR NOT EXISTS(SELECT 1 FROM public.competences WHERE catalog_id=chapter_id AND editorial_status IN ('ready','published') AND admin_archived_at IS NULL) THEN
        RAISE EXCEPTION 'competence dependency is absent, ambiguous, or not ready' USING ERRCODE='23503'; END IF;
      dependencies:=dependencies||jsonb_build_array(jsonb_build_object('kind','competence','catalogId',chapter_id,'sourceId',skill));
    END LOOP;
    data_value:=jsonb_build_object('catalogId',e.catalog_id,'revision',v.revision,'definition',v.definition,
      'header',jsonb_build_object('title',e.title,'chapter',e.chapter,'difficulty',e.difficulty,'competences',e.competences,
        'appTitle',e.app_title,'isFlash',e."Is_Flash",'needCalculator',e."Need_Calculator"));
    fingerprint:=v.approval_fingerprint_sha256;
  ELSIF p_kind='chapter' THEN
    SELECT * INTO c FROM public.chapters WHERE catalog_id=p_catalog_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'chapter not found' USING ERRCODE='P0002'; END IF;
    action_value:=CASE WHEN c.admin_archived_at IS NULL THEN 'upsert' ELSE 'archive' END;
    data_value:=jsonb_build_object('catalogId',c.catalog_id,'name',c.name,'aliases',c.aliases,'emoji',c.emoji,'orderIndex',c.order_index);
    source_value:=to_jsonb(c)-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[];
    fingerprint:=encode(extensions.digest(convert_to(source_value::text,'UTF8'),'sha256'),'hex');
  ELSIF p_kind='competence' THEN
    SELECT (to_jsonb(co)||jsonb_build_object('chapter_catalog_id',ch.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[],
      jsonb_build_object('catalogId',co.catalog_id,'id',co.id,'name',co.name,'chapterCatalogId',ch.catalog_id,'maxPoints',co.max_points),co.editorial_status,ch.editorial_status,co.admin_archived_at
      INTO source_value,data_value,status_value,skill,archived_at FROM public.competences co JOIN public.chapters ch ON ch.id=co.chapter_id WHERE co.catalog_id=p_catalog_id FOR SHARE OF co;
    IF data_value IS NULL THEN RAISE EXCEPTION 'competence or chapter reference not found' USING ERRCODE='P0002'; END IF;
    action_value:=CASE WHEN archived_at IS NULL THEN 'upsert' ELSE 'archive' END;
    dependencies:=jsonb_build_array(jsonb_build_object('kind','chapter','catalogId',data_value->'chapterCatalogId','sourceId',source_value->>'chapter_id'));
    fingerprint:=encode(extensions.digest(convert_to(source_value::text,'UTF8'),'sha256'),'hex');
    IF action_value='upsert' AND skill NOT IN ('ready','published') THEN RAISE EXCEPTION 'chapter dependency is not ready' USING ERRCODE='23503'; END IF;
  ELSE
    SELECT * INTO f FROM public.flashcards WHERE catalog_id=p_catalog_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'flashcard not found' USING ERRCODE='P0002'; END IF;
    SELECT count(*) INTO n FROM public.chapters ch WHERE lower(ch.name)=lower(f.chapter) OR f.chapter=ANY(ch.aliases);
    SELECT ch.catalog_id INTO chapter_id FROM public.chapters ch WHERE lower(ch.name)=lower(f.chapter) OR f.chapter=ANY(ch.aliases) LIMIT 1;
    IF n<>1 THEN RAISE EXCEPTION 'flashcard chapter is missing or ambiguous' USING ERRCODE='23503'; END IF;
    action_value:=CASE WHEN f.admin_archived_at IS NULL THEN 'upsert' ELSE 'archive' END;
    data_value:=jsonb_build_object('catalogId',f.catalog_id,'question',f.question,'answer',f.answer,'chapterCatalogId',chapter_id);
    source_value:=(to_jsonb(f)||jsonb_build_object('chapter_catalog_id',chapter_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[];
    dependencies:=jsonb_build_array(jsonb_build_object('kind','chapter','catalogId',chapter_id,'sourceRef',f.chapter));
    fingerprint:=encode(extensions.digest(convert_to(source_value::text,'UTF8'),'sha256'),'hex');
    IF action_value='upsert' AND NOT EXISTS(SELECT 1 FROM public.chapters WHERE catalog_id=chapter_id AND editorial_status IN ('ready','published') AND admin_archived_at IS NULL) THEN
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
  ELSIF p_error NOT IN ('not_applied','target_rejected') OR p_receipt IS NOT NULL THEN
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
  IF p_expected_state='uncertain' AND p_state='failed' THEN RAISE EXCEPTION 'an uncertain operation can fail only after target reconciliation' USING ERRCODE='40001'; END IF;
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
