-- Operator-only, explicit reviewed manifest. Never called by Admin/importer.
BEGIN;
CREATE FUNCTION novlearn_admin_private.bind_historical_catalogue(p_manifest jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE item jsonb; row_value jsonb; projection jsonb; table_name text; fingerprint text; saved uuid;
BEGIN
 IF p_manifest->'approved' IS DISTINCT FROM 'true'::jsonb OR nullif(p_manifest->>'reviewer','') IS NULL OR
    p_manifest->>'sourceProject' IS DISTINCT FROM 'tksvbkvfusrnxulpahky' OR
    p_manifest->>'targetProject' IS DISTINCT FROM 'abwipnppcrghdhwriyjp' OR
    jsonb_typeof(p_manifest->'items') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'explicit reviewed correspondence manifest required' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('novlearn-catalogue-sync-v1',0));
 IF (SELECT count(*) FROM jsonb_array_elements(p_manifest->'items')) IS DISTINCT FROM
    (SELECT count(DISTINCT (x->>'kind',x->>'productionId')) FROM jsonb_array_elements(p_manifest->'items') x) OR
    (SELECT count(*) FROM jsonb_array_elements(p_manifest->'items')) IS DISTINCT FROM
    (SELECT count(DISTINCT (x->>'kind',x->>'stagingCatalogId')) FROM jsonb_array_elements(p_manifest->'items') x) THEN
   RAISE EXCEPTION 'duplicate correspondence';
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_manifest->'items') LOOP
  IF item->'approved' IS DISTINCT FROM 'true'::jsonb OR nullif(item->>'evidence','') IS NULL OR
    item->>'historicalFingerprint' IS NULL OR item->>'stagingCatalogId' IS NULL THEN
   RAISE EXCEPTION 'unapproved or incomplete correspondence' USING ERRCODE='42501'; END IF;
  table_name:=CASE item->>'kind' WHEN 'exercise' THEN 'exercises' WHEN 'chapter' THEN 'chapters'
    WHEN 'competence' THEN 'competences' WHEN 'flashcard' THEN 'flashcards' ELSE NULL END;
  IF table_name IS NULL THEN RAISE EXCEPTION 'invalid correspondence kind'; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id::text=$1 FOR UPDATE',table_name)
   INTO row_value USING item->>'productionId';
  IF row_value IS NULL THEN RAISE EXCEPTION 'missing historical row'; END IF;
  saved:=(row_value->>'catalog_id')::uuid;
  IF saved IS NOT NULL AND saved IS DISTINCT FROM (item->>'stagingCatalogId')::uuid THEN
   RAISE EXCEPTION 'catalogue identity already bound' USING ERRCODE='40001'; END IF;
  IF item->>'kind'='exercise' THEN
   IF item->'sourceProvenanceVerified' IS DISTINCT FROM 'true'::jsonb OR
      item->>'originalId' IS DISTINCT FROM item->>'productionId' THEN
    RAISE EXCEPTION 'historical exercise provenance required'; END IF;
   projection:=novlearn_admin_private.historical_projection(row_value);
  ELSIF item->>'kind'='chapter' THEN
   projection:=jsonb_build_object('name',row_value->'name','aliases',row_value->'aliases','emoji',row_value->'emoji','order_index',row_value->'order_index');
  ELSIF item->>'kind'='competence' THEN
   projection:=jsonb_build_object('chapter_id',row_value->'chapter_id','name',row_value->'name','max_points',row_value->'max_points');
  ELSE
   projection:=jsonb_build_object('chapter',row_value->'chapter','question',row_value->'question','answer',row_value->'answer');
  END IF;
  fingerprint:=encode(extensions.digest(convert_to(projection::text,'UTF8'),'sha256'),'hex');
  IF fingerprint IS DISTINCT FROM item->>'historicalFingerprint' THEN
   RAISE EXCEPTION 'historical content changed since review' USING ERRCODE='40001'; END IF;
  PERFORM set_config('novlearn_catalog_sync.bind_item',item->>'stagingCatalogId',true);
  EXECUTE format('UPDATE public.%I SET catalog_id=$1 WHERE id::text=$2',table_name)
    USING (item->>'stagingCatalogId')::uuid,item->>'productionId';
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION novlearn_admin_private.bind_historical_catalogue(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Rev 0 is reserved for a reviewed adaptation of the frozen original. Source
-- revision 1 remains free even if its definition differs. No generation here.
CREATE FUNCTION novlearn_admin_private.prepare_historical_execution(p_exercise bigint,p_fingerprint text,p_definition jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE snapshot novlearn_admin_private.historical_exercise_snapshots; parent public.exercises; version_id uuid;
BEGIN
 SELECT * INTO parent FROM public.exercises WHERE id=p_exercise FOR UPDATE;
 SELECT * INTO snapshot FROM novlearn_admin_private.historical_exercise_snapshots WHERE exercise_id=p_exercise;
 IF parent.id IS NULL OR snapshot.fingerprint IS DISTINCT FROM p_fingerprint OR
   snapshot.fingerprint IS DISTINCT FROM encode(extensions.digest(convert_to(
    novlearn_admin_private.historical_projection(to_jsonb(parent))::text,'UTF8'),'sha256'),'hex') OR
   p_definition->'extensions'->'legacy'->>'adapterVersion' IS DISTINCT FROM 'staging-catalogue-reviewed-v1' OR
   novlearn_admin_private.historical_projection(p_definition->'extensions'->'legacy'->'original') IS DISTINCT FROM
   novlearn_admin_private.historical_projection(snapshot.original) OR
   p_definition->>'revision' IS DISTINCT FROM '1' OR p_definition->>'schemaVersion' IS DISTINCT FROM '5' THEN
  RAISE EXCEPTION 'reviewed original definition and unchanged historical evidence required' USING ERRCODE='40001'; END IF;
 SELECT id INTO version_id FROM public.exercise_versions WHERE exercise_id=p_exercise AND publication_origin='historical' AND definition=p_definition;
 IF version_id IS NOT NULL THEN RETURN version_id; END IF;
 INSERT INTO public.exercise_versions(exercise_id,revision,definition,engine_contract,generation_version,canonicalization_version,
 definition_sha256,approval_fingerprint_sha256,editorial_status,publication_origin,published_at)
 SELECT p_exercise,0,p_definition,engine_contract,generation_version,canonicalization_version,
 encode(extensions.digest(convert_to(p_definition::text,'UTF8'),'sha256'),'hex'),repeat('0',64),'published','historical',now()
 FROM novlearn_admin_private.publication_runtime WHERE singleton RETURNING id INTO version_id;
 UPDATE public.exercises SET legacy_version_id=version_id WHERE id=p_exercise;
 RETURN version_id;
END $$;
REVOKE ALL ON FUNCTION novlearn_admin_private.prepare_historical_execution(bigint,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
