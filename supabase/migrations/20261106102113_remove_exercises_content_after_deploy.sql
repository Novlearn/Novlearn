-- Apply ONLY after the Novlearn content-free readers have been deployed.
-- Abort rather than discard any legacy exercise content (especially in production).
DO $precondition$
BEGIN
 IF EXISTS(SELECT 1 FROM public.exercises WHERE content IS DISTINCT FROM '{}'::jsonb) THEN
  RAISE EXCEPTION 'nonempty legacy exercise content requires explicit migration';
 END IF;
END $precondition$;

CREATE OR REPLACE FUNCTION public.admin_save_exercise_draft(p_exercise_id bigint, p_version_id uuid, p_expected_fingerprint text, p_definition jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$-- novlearn-admin-rpc-http-conflict-v1
BEGIN

DECLARE parent public.exercises; candidate public.exercise_versions; next_revision integer;
  canonical jsonb; event_action text;
BEGIN
  IF NOT public.is_novlearn_admin() THEN
    RAISE EXCEPTION 'administrator access required' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.jsonb_typeof(p_definition) IS DISTINCT FROM 'object'
    OR p_definition->>'schemaVersion' IS DISTINCT FROM '5'
    OR p_definition->>'kind' IS DISTINCT FROM 'composed'
    OR pg_catalog.jsonb_typeof(p_definition->'title') IS DISTINCT FROM 'string'
    OR pg_catalog.length(pg_catalog.btrim(p_definition->>'title')) NOT BETWEEN 1 AND 160
    OR pg_catalog.octet_length(p_definition::text) > 262144
  THEN RAISE EXCEPTION 'invalid canonical draft envelope' USING ERRCODE = '22023'; END IF;

  IF p_exercise_id IS NULL THEN
    IF p_version_id IS NOT NULL OR p_expected_fingerprint IS NOT NULL THEN
      RAISE EXCEPTION 'new exercise cannot target a revision' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.exercises(catalog_id,title,chapter)
      VALUES(gen_random_uuid(),p_definition->>'title',COALESCE(p_definition->'catalogue'->>'chapter',''))
      RETURNING * INTO parent;
  ELSE
    SELECT * INTO parent FROM public.exercises WHERE id=p_exercise_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'exercise not found' USING ERRCODE = 'P0002'; END IF;
    IF parent.catalog_id IS NULL THEN
      RAISE EXCEPTION 'legacy content requires explicit migration' USING ERRCODE = '22023';
    END IF;
    IF parent.admin_archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'archived exercise is read only' USING ERRCODE = '40001';
    END IF;
  END IF;

  IF p_version_id IS NOT NULL THEN
    SELECT * INTO candidate FROM public.exercise_versions
      WHERE id=p_version_id AND exercise_id=parent.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'version not found' USING ERRCODE = 'P0002'; END IF;
    IF candidate.editorial_status <> 'draft' OR p_expected_fingerprint IS NULL
      OR candidate.approval_fingerprint_sha256 IS DISTINCT FROM p_expected_fingerprint THEN
      RAISE EXCEPTION 'draft changed or is no longer editable' USING ERRCODE = '40001';
    END IF;
    canonical := p_definition || pg_catalog.jsonb_build_object('id',parent.catalog_id::text,'revision',candidate.revision::text);
    UPDATE public.exercise_versions SET definition=canonical,updated_by=(SELECT auth.uid())
      WHERE id=candidate.id RETURNING * INTO candidate;
    event_action := 'draft_saved';
  ELSE
    IF p_expected_fingerprint IS NOT NULL THEN
      RAISE EXCEPTION 'new revision cannot carry an old fingerprint' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(max(revision),0)+1 INTO next_revision FROM public.exercise_versions WHERE exercise_id=parent.id;
    canonical := p_definition || pg_catalog.jsonb_build_object('id',parent.catalog_id::text,'revision',next_revision::text);
    INSERT INTO public.exercise_versions(exercise_id,revision,definition,engine_contract,generation_version,
      canonicalization_version,definition_sha256,approval_fingerprint_sha256,created_by,updated_by)
      VALUES(parent.id,next_revision,canonical,'schema-5;engine-0.1.0','mulberry32-rejection-v1',
        'pg-jsonb-text-v1',repeat('0',64),repeat('0',64),(SELECT auth.uid()),(SELECT auth.uid()))
      RETURNING * INTO candidate;
    event_action := 'draft_created';
  END IF;
  INSERT INTO public.admin_content_events(actor_id,exercise_id,version_id,action)
    VALUES((SELECT auth.uid()),parent.id,candidate.id,event_action);
  RETURN pg_catalog.jsonb_build_object('exerciseId',parent.id::text,'versionId',candidate.id,
    'revision',candidate.revision,'fingerprint',candidate.approval_fingerprint_sha256);
END;

EXCEPTION WHEN serialization_failure THEN
 RAISE SQLSTATE 'PT409' USING MESSAGE='Content changed; reload before retrying';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_exercise_publication(p_payload jsonb, p_expected_state text, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '10s'
 SET lock_timeout TO '3s'
AS $function$
DECLARE identity_uuid uuid; revision_number integer; definition_value jsonb; prepared jsonb; state jsonb; final_state jsonb;
  header jsonb; parent_id bigint; version_id uuid; actual_digest text; current_header jsonb;
BEGIN
  IF p_expected_state IS NULL OR p_expected_state!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'target precondition required' USING ERRCODE='22023'; END IF;
  prepared:=novlearn_admin_private.publication_input(p_payload,p_mode);
  identity_uuid:=(prepared->>'catalogId')::uuid; revision_number:=(prepared->>'revision')::integer;
  definition_value:=prepared->'definition'; header:=prepared->'header'; actual_digest:=prepared->>'digest';
  PERFORM pg_advisory_xact_lock(hashtextextended('novlearn-publication:'||identity_uuid::text,0));
  SELECT id INTO parent_id FROM public.exercises WHERE catalog_id=identity_uuid FOR UPDATE;
  state:=novlearn_admin_private.publication_target_state(identity_uuid,revision_number);
  IF state->'parent'->>'admin_archived_at' IS NOT NULL THEN RAISE EXCEPTION 'archived target cannot be published' USING ERRCODE='40001'; END IF;
  current_header:=CASE WHEN state->'parent'='null'::jsonb THEN NULL ELSE
    (state->'parent')-ARRAY['id','catalog_id','publication_epoch','admin_archived_at','activeVersionId']::text[] END;
  IF state->'candidate'->>'businessDigest'=actual_digest AND state->'candidate'->>'status'='published' AND
    state->'active'->>'id'=state->'candidate'->>'id' AND header=current_header THEN
    RETURN jsonb_build_object('result','unchanged','target',state,'businessDigest',actual_digest);
  END IF;
  IF state->>'stateToken' IS DISTINCT FROM p_expected_state THEN RAISE EXCEPTION 'target changed since confirmation' USING ERRCODE='40001'; END IF;
  IF state->'candidate'<>'null'::jsonb AND (state->'candidate'->>'businessDigest' IS DISTINCT FROM actual_digest OR state->'candidate'->>'status' IS DISTINCT FROM 'published') THEN
    RAISE EXCEPTION 'immutable revision conflict' USING ERRCODE='40001';
  END IF;
  IF p_mode='rollback' THEN
    IF state->'candidate'='null'::jsonb OR state->'active'='null'::jsonb OR revision_number>=(state->'active'->>'revision')::integer THEN
      RAISE EXCEPTION 'rollback requires an existing older published revision' USING ERRCODE='22023'; END IF;
  ELSIF revision_number<(state->>'latestRevision')::integer OR
    (state->'active'<>'null'::jsonb AND revision_number<(state->'active'->>'revision')::integer) THEN
    RAISE EXCEPTION 'older revision requires an explicit rollback' USING ERRCODE='40001';
  END IF;
  IF parent_id IS NULL THEN
    INSERT INTO public.exercises(catalog_id,title,chapter,difficulty,competences,app_title,"Is_Flash","Need_Calculator")
    VALUES(identity_uuid,header->>'title',header->>'chapter',header->>'difficulty',ARRAY(SELECT jsonb_array_elements_text(header->'competences')),
      header->>'app_title',(header->>'Is_Flash')::boolean,(header->>'Need_Calculator')::boolean) RETURNING id INTO parent_id;
  END IF;
  SELECT id INTO version_id FROM public.exercise_versions WHERE exercise_id=parent_id AND revision=revision_number;
  IF version_id IS NULL THEN
    INSERT INTO public.exercise_versions(exercise_id,revision,definition,engine_contract,generation_version,canonicalization_version,
      definition_sha256,approval_fingerprint_sha256,editorial_status,publication_origin,published_at)
    VALUES(parent_id,revision_number,definition_value,p_payload->>'engineContract',p_payload->>'generationVersion',p_payload->>'canonicalizationVersion',
      repeat('0',64),repeat('0',64),'published','transfer',clock_timestamp()) RETURNING id INTO version_id;
  END IF;
  UPDATE public.exercises SET title=header->>'title',chapter=header->>'chapter',difficulty=header->>'difficulty',
    competences=ARRAY(SELECT jsonb_array_elements_text(header->'competences')),app_title=header->>'app_title',
    "Is_Flash"=(header->>'Is_Flash')::boolean,"Need_Calculator"=(header->>'Need_Calculator')::boolean,active_version_id=version_id WHERE id=parent_id;
  final_state:=novlearn_admin_private.publication_target_state(identity_uuid,revision_number);
  IF final_state->'active'->>'businessDigest' IS DISTINCT FROM actual_digest OR final_state->'active'->>'id' IS DISTINCT FROM version_id::text THEN
    RAISE EXCEPTION 'publication verification failed' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('result',CASE WHEN p_mode='rollback' THEN 'rolled_back' ELSE 'published' END,'businessDigest',actual_digest,'target',final_state);
END; $function$
;

CREATE OR REPLACE FUNCTION novlearn_admin_private.taxonomy_usage(p_kind text, p_id text, p_tokens text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH exercise_refs AS (
 SELECT e.id FROM public.exercises e WHERE
 (p_kind='chapter' AND e.chapter=ANY(p_tokens)) OR
 (p_kind='competence' AND ((to_jsonb(e)->>'competence_id')=ANY(p_tokens) OR e.competences && p_tokens))
), version_refs AS (
 SELECT v.exercise_id FROM public.exercise_versions v WHERE
 (p_kind='chapter' AND v.definition->'catalogue'->>'chapter'=ANY(p_tokens)) OR
 (p_kind='competence' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v.definition->'catalogue'->'skills')='array' THEN v.definition->'catalogue'->'skills' ELSE '[]'::jsonb END) s WHERE s=ANY(p_tokens)))
), all_exercises AS (SELECT id FROM exercise_refs UNION SELECT exercise_id FROM version_refs)
SELECT jsonb_build_object(
 'exercises',(SELECT count(*) FROM all_exercises),'revisions',(SELECT count(*) FROM version_refs),
 'competences',(SELECT count(*) FROM public.competences WHERE p_kind='chapter' AND chapter_id::text=p_id),
 'flashcards',(SELECT count(*) FROM public.flashcards WHERE p_kind='chapter' AND chapter=ANY(p_tokens)),
 'scores',(SELECT count(*) FROM public.user_competence_scores WHERE p_kind='competence' AND competence_id=p_id)+(SELECT count(*) FROM public.ds_competence_scores WHERE p_kind='competence' AND competence_id=p_id),
 'exerciseIds',COALESCE((SELECT jsonb_agg(id::text ORDER BY id) FROM (SELECT id FROM all_exercises ORDER BY id LIMIT 25) sample),'[]'::jsonb));
$function$
;

ALTER POLICY novlearn_admin_insert_canonical_exercises ON public.exercises
 WITH CHECK ((SELECT public.is_novlearn_admin()) AND catalog_id IS NOT NULL);
ALTER POLICY publication_writer_exercises ON public.exercises
 USING (catalog_id IS NOT NULL) WITH CHECK (catalog_id IS NOT NULL);
-- RESTRICT is intentional: unexpected dependencies must abort the transaction.
ALTER TABLE public.exercises DROP COLUMN content RESTRICT;
