-- Local preparation only. No credentials, membership or remote activation.
BEGIN;
CREATE ROLE novlearn_publication_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE novlearn_publication_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER TABLE public.exercise_versions ADD COLUMN publication_origin text NOT NULL DEFAULT 'local'
  CHECK(publication_origin IN ('local','transfer'));
ALTER TABLE public.exercises ADD COLUMN publication_epoch bigint NOT NULL DEFAULT 0 CHECK(publication_epoch>=0);
ALTER TABLE public.exercise_versions DROP CONSTRAINT exercise_versions_approval_fields_check;
ALTER TABLE public.exercise_versions ADD CONSTRAINT exercise_versions_approval_fields_check CHECK (
  (publication_origin='local' AND (editorial_status NOT IN ('approved','published') OR
    (approved_at IS NOT NULL AND approved_by IS NOT NULL AND approved_fingerprint_sha256=approval_fingerprint_sha256))) OR
  (publication_origin='transfer' AND editorial_status='published' AND approved_at IS NULL AND approved_by IS NULL
    AND approved_fingerprint_sha256 IS NULL AND created_by IS NULL AND updated_by IS NULL)
);

CREATE FUNCTION public.manage_exercise_publication_epoch() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.publication_epoch<>0 THEN RAISE EXCEPTION 'publication epoch is server owned' USING ERRCODE='42501'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.publication_epoch IS DISTINCT FROM OLD.publication_epoch THEN
    RAISE EXCEPTION 'publication epoch is server owned' USING ERRCODE='42501';
  END IF;
  IF ROW(NEW.catalog_id,NEW.active_version_id,NEW.title,NEW.chapter,NEW.difficulty,NEW.competences,NEW.app_title,NEW."Is_Flash",NEW."Need_Calculator",NEW.admin_archived_at)
    IS DISTINCT FROM ROW(OLD.catalog_id,OLD.active_version_id,OLD.title,OLD.chapter,OLD.difficulty,OLD.competences,OLD.app_title,OLD."Is_Flash",OLD."Need_Calculator",OLD.admin_archived_at) THEN
    NEW.publication_epoch:=OLD.publication_epoch+1;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.manage_exercise_publication_epoch() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER exercise_publication_epoch_before_write BEFORE INSERT OR UPDATE ON public.exercises
  FOR EACH ROW EXECUTE FUNCTION public.manage_exercise_publication_epoch();

-- The complete existing manage_exercise_version definition, plus the bounded
-- transfer INSERT branch, is inserted here by the local preparation script.
CREATE OR REPLACE FUNCTION public.manage_exercise_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  content_changed boolean := false;
  approval_changed boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.editorial_status = 'published' THEN
      RAISE EXCEPTION 'published exercise versions are immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP='INSERT' AND NEW.publication_origin='transfer' THEN
    IF current_user<>'novlearn_publication_writer' OR NEW.editorial_status<>'published' OR
      NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.approved_fingerprint_sha256 IS NOT NULL OR
      NEW.created_by IS NOT NULL OR NEW.updated_by IS NOT NULL THEN
      RAISE EXCEPTION 'transfer insertion requires the bounded publication capability' USING ERRCODE='42501';
    END IF;
  NEW.definition_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(NEW.definition::text, 'UTF8'), 'sha256'), 'hex');
  NEW.approval_fingerprint_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'exercise_id', NEW.exercise_id,
        'revision', NEW.revision,
        'definition', NEW.definition,
        'engine_contract', NEW.engine_contract,
        'generation_version', NEW.generation_version,
        'canonicalization_version', NEW.canonicalization_version
      )::text, 'UTF8'), 'sha256'), 'hex');


    NEW.published_at:=clock_timestamp(); NEW.updated_at:=clock_timestamp(); RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND NEW.publication_origin IS DISTINCT FROM OLD.publication_origin THEN
    RAISE EXCEPTION 'publication origin is immutable' USING ERRCODE='42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.editorial_status = 'published' THEN
      RAISE EXCEPTION 'published exercise versions are immutable';
    END IF;
    content_changed := NEW.exercise_id IS DISTINCT FROM OLD.exercise_id OR
      NEW.revision IS DISTINCT FROM OLD.revision OR
      NEW.definition IS DISTINCT FROM OLD.definition OR
      NEW.engine_contract IS DISTINCT FROM OLD.engine_contract OR
      NEW.generation_version IS DISTINCT FROM OLD.generation_version OR
      NEW.canonicalization_version IS DISTINCT FROM OLD.canonicalization_version;
    approval_changed := NEW.approved_at IS DISTINCT FROM OLD.approved_at OR
      NEW.approved_by IS DISTINCT FROM OLD.approved_by OR
      NEW.approved_fingerprint_sha256 IS DISTINCT FROM OLD.approved_fingerprint_sha256;
    IF (content_changed OR approval_changed) AND OLD.editorial_status = 'approved' THEN
      NEW.editorial_status := 'draft';
      NEW.approved_at := NULL;
      NEW.approved_by := NULL;
      NEW.approved_fingerprint_sha256 := NULL;
      NEW.published_at := NULL;
    END IF;
    IF NEW.editorial_status = 'approved' AND OLD.editorial_status NOT IN ('draft', 'in_review') THEN
      RAISE EXCEPTION 'approval must be an explicit transition from draft or review';
    END IF;
    IF NEW.editorial_status = 'published' AND
       (OLD.editorial_status <> 'approved' OR content_changed OR approval_changed) THEN
      RAISE EXCEPTION 'only the unchanged approved version can be published';
    END IF;
  ELSIF NEW.editorial_status <> 'draft' THEN
    RAISE EXCEPTION 'insert a draft before review, approval, or publication';
  END IF;

  NEW.definition_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(NEW.definition::text, 'UTF8'), 'sha256'), 'hex');
  NEW.approval_fingerprint_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'exercise_id', NEW.exercise_id,
        'revision', NEW.revision,
        'definition', NEW.definition,
        'engine_contract', NEW.engine_contract,
        'generation_version', NEW.generation_version,
        'canonicalization_version', NEW.canonicalization_version
      )::text, 'UTF8'), 'sha256'), 'hex');

  IF NEW.editorial_status = 'approved' THEN
    IF NEW.approved_at IS NULL OR NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'approval metadata is required';
    END IF;
    NEW.approved_fingerprint_sha256 := NEW.approval_fingerprint_sha256;
  ELSIF NEW.editorial_status = 'draft' THEN
    NEW.approved_fingerprint_sha256 := NULL;
    NEW.approved_at := NULL;
    NEW.approved_by := NULL;
  END IF;
  IF NEW.editorial_status = 'published' THEN
    IF NEW.approved_fingerprint_sha256 IS DISTINCT FROM NEW.approval_fingerprint_sha256 THEN
      RAISE EXCEPTION 'published content must match its approval fingerprint';
    END IF;
    NEW.published_at := COALESCE(NEW.published_at, pg_catalog.now());
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$function$;

CREATE TABLE novlearn_admin_private.publication_runtime (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), enabled boolean NOT NULL DEFAULT false,
  engine_contract text NOT NULL, generation_version text NOT NULL, canonicalization_version text NOT NULL,
  engine_archive_sha256 text NOT NULL CHECK(engine_archive_sha256 ~ '^[0-9a-f]{64}$')
);
ALTER TABLE novlearn_admin_private.publication_runtime ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON novlearn_admin_private.publication_runtime FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO novlearn_admin_private.publication_runtime(singleton,engine_contract,generation_version,canonicalization_version,engine_archive_sha256)
VALUES(true,'schema-5;engine-0.1.0','mulberry32-rejection-v1','pg-jsonb-text-v1','650128cdeb1e798b952a09e91b038d018b9e7947d0a6ee4c247695f899190290');
GRANT SELECT ON novlearn_admin_private.publication_runtime TO novlearn_publication_writer;
CREATE POLICY publication_writer_runtime ON novlearn_admin_private.publication_runtime FOR SELECT TO novlearn_publication_writer USING(true);

CREATE FUNCTION public.exercise_publication_digest(p_definition jsonb,p_engine text,p_generation text,p_canonicalization text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
SELECT encode(extensions.digest(convert_to(jsonb_build_object('definition',p_definition,'engineContract',p_engine,
  'generationVersion',p_generation,'canonicalizationVersion',p_canonicalization)::text,'UTF8'),'sha256'),'hex'); $$;
REVOKE ALL ON FUNCTION public.exercise_publication_digest(jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.exercise_publication_digest(jsonb,text,text,text) TO authenticated,novlearn_publication_writer;

CREATE FUNCTION public.admin_export_exercise_publication(p_version_id uuid,p_fingerprint text,p_epoch bigint,p_roundtrip_definition jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent_row public.exercises%ROWTYPE; version_row public.exercise_versions%ROWTYPE;
  review_row public.admin_exercise_reviews%ROWTYPE; receipt_row public.admin_exercise_test_runs%ROWTYPE;
BEGIN
  IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501'; END IF;
  SELECT * INTO parent_row FROM public.exercises WHERE id=(SELECT exercise_id FROM public.exercise_versions WHERE id=p_version_id) FOR SHARE;
  IF NOT FOUND OR parent_row.admin_archived_at IS NOT NULL THEN RAISE EXCEPTION 'source unavailable' USING ERRCODE='40001'; END IF;
  SELECT * INTO version_row FROM public.exercise_versions WHERE id=p_version_id FOR SHARE;
  IF version_row.publication_origin<>'local' OR version_row.editorial_status NOT IN ('approved','published') OR
    version_row.approval_fingerprint_sha256 IS DISTINCT FROM p_fingerprint OR version_row.test_epoch IS DISTINCT FROM p_epoch OR
    version_row.approved_fingerprint_sha256 IS DISTINCT FROM p_fingerprint OR version_row.approved_by IS NULL THEN
    RAISE EXCEPTION 'source approval changed' USING ERRCODE='40001';
  END IF;
  IF p_roundtrip_definition IS NULL OR p_roundtrip_definition IS DISTINCT FROM version_row.definition THEN
    RAISE EXCEPTION 'canonical definition cannot round trip through the Engine JSON transport' USING ERRCODE='22023';
  END IF;
  SELECT * INTO review_row FROM public.admin_exercise_reviews WHERE version_id=p_version_id ORDER BY recorded_at DESC,id DESC LIMIT 1;
  SELECT * INTO receipt_row FROM public.admin_exercise_test_runs WHERE version_id=p_version_id
    AND fingerprint=p_fingerprint AND test_epoch=p_epoch ORDER BY recorded_at DESC,id DESC LIMIT 1;
  IF review_row.action IS DISTINCT FROM 'approve' OR review_row.fingerprint IS DISTINCT FROM p_fingerprint OR
    review_row.test_epoch IS DISTINCT FROM p_epoch OR review_row.receipt_id IS DISTINCT FROM receipt_row.id OR
    receipt_row.id IS NULL OR NOT receipt_row.passed OR NOT EXISTS(
      SELECT 1 FROM novlearn_admin_private.test_signing_keys WHERE id=receipt_row.key_id AND enabled) THEN
    RAISE EXCEPTION 'current reviewed test receipt required' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object('payload',jsonb_build_object('schemaVersion',1,'catalogId',parent_row.catalog_id,
    'revision',version_row.revision,'definitionJson',version_row.definition::text,'engineContract',version_row.engine_contract,
    'generationVersion',version_row.generation_version,'canonicalizationVersion',version_row.canonicalization_version,
    'engineArchiveSha256',receipt_row.payload::jsonb->>'engineArchiveSha256',
    'businessDigest',public.exercise_publication_digest(version_row.definition,version_row.engine_contract,version_row.generation_version,version_row.canonicalization_version)),
    'source',jsonb_build_object('versionId',version_row.id,'fingerprint',p_fingerprint,'epoch',p_epoch,
      'reviewId',review_row.id,'receiptId',receipt_row.id,'report',receipt_row.payload::jsonb->'report','cases',receipt_row.payload::jsonb->'cases'));
END; $$;
REVOKE ALL ON FUNCTION public.admin_export_exercise_publication(uuid,text,bigint,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_export_exercise_publication(uuid,text,bigint,jsonb) TO authenticated;

-- Narrow read/row-lock helper. No taxonomy or other excluded table is written.
CREATE FUNCTION novlearn_admin_private.publication_header(p_definition jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE chapter_ref text:=p_definition->'catalogue'->>'chapter'; chapter_row public.chapters%ROWTYPE;
  skill_ref text; skill_row public.competences%ROWTYPE; count_matches integer; skill_ids text[]:='{}'; difficulty numeric;
BEGIN
  IF chapter_ref IS NULL OR btrim(chapter_ref)='' THEN RAISE EXCEPTION 'chapter required' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO count_matches FROM public.chapters WHERE id::text=chapter_ref OR name=chapter_ref OR chapter_ref=ANY(aliases);
  IF count_matches<>1 THEN RAISE EXCEPTION 'target chapter missing or ambiguous' USING ERRCODE='22023'; END IF;
  SELECT * INTO chapter_row FROM public.chapters WHERE id::text=chapter_ref OR name=chapter_ref OR chapter_ref=ANY(aliases) FOR SHARE;
  IF jsonb_typeof(COALESCE(p_definition->'catalogue'->'skills','[]'::jsonb))<>'array' THEN RAISE EXCEPTION 'invalid skills' USING ERRCODE='22023'; END IF;
  FOR skill_ref IN SELECT value FROM jsonb_array_elements_text(COALESCE(p_definition->'catalogue'->'skills','[]'::jsonb)) LOOP
    SELECT count(*) INTO count_matches FROM public.competences WHERE chapter_id=chapter_row.id AND (id=skill_ref OR name=skill_ref);
    IF count_matches<>1 THEN RAISE EXCEPTION 'target skill missing ambiguous or outside chapter' USING ERRCODE='22023'; END IF;
    SELECT * INTO skill_row FROM public.competences WHERE chapter_id=chapter_row.id AND (id=skill_ref OR name=skill_ref) FOR SHARE;
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
REVOKE ALL ON FUNCTION novlearn_admin_private.publication_header(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION novlearn_admin_private.publication_header(jsonb) TO novlearn_publication_writer;

GRANT USAGE ON SCHEMA public,extensions,novlearn_admin_private TO novlearn_publication_writer;
GRANT USAGE ON SCHEMA public TO novlearn_publication_executor;
GRANT SELECT(id,catalog_id,active_version_id,publication_epoch,admin_archived_at,title,chapter,difficulty,competences,app_title,"Is_Flash","Need_Calculator",content)
  ON public.exercises TO novlearn_publication_writer;
GRANT INSERT(catalog_id,title,chapter,difficulty,competences,app_title,"Is_Flash","Need_Calculator",content)
  ON public.exercises TO novlearn_publication_writer;
GRANT UPDATE(title,chapter,difficulty,competences,app_title,"Is_Flash","Need_Calculator",active_version_id)
  ON public.exercises TO novlearn_publication_writer;
GRANT USAGE ON SEQUENCE public.exercises_id_seq TO novlearn_publication_writer;
CREATE POLICY publication_writer_exercises ON public.exercises FOR ALL TO novlearn_publication_writer
  USING(catalog_id IS NOT NULL) WITH CHECK(catalog_id IS NOT NULL AND content='{}'::jsonb);
GRANT SELECT(id,exercise_id,revision,definition,engine_contract,generation_version,canonicalization_version,editorial_status,publication_origin)
  ON public.exercise_versions TO novlearn_publication_writer;
GRANT INSERT(exercise_id,revision,definition,engine_contract,generation_version,canonicalization_version,definition_sha256,approval_fingerprint_sha256,editorial_status,publication_origin,published_at)
  ON public.exercise_versions TO novlearn_publication_writer;
CREATE POLICY publication_writer_read_versions ON public.exercise_versions FOR SELECT TO novlearn_publication_writer USING(true);
CREATE POLICY publication_writer_insert_versions ON public.exercise_versions FOR INSERT TO novlearn_publication_writer
  WITH CHECK(publication_origin='transfer' AND editorial_status='published');

CREATE FUNCTION novlearn_admin_private.publication_target_state(p_catalog_id uuid,p_revision integer) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE parent_row record; version_row record; active_row record; body jsonb; runtime_row record; maximum_revision integer;
BEGIN
  SELECT * INTO runtime_row FROM novlearn_admin_private.publication_runtime WHERE singleton;
  IF NOT FOUND OR NOT runtime_row.enabled THEN RAISE EXCEPTION 'publication capability disabled' USING ERRCODE='55000'; END IF;
  SELECT id,catalog_id,active_version_id,publication_epoch,admin_archived_at,title,chapter,difficulty,competences,app_title,"Is_Flash","Need_Calculator"
    INTO parent_row FROM public.exercises WHERE catalog_id=p_catalog_id;
  SELECT id,revision,definition,engine_contract,generation_version,canonicalization_version,editorial_status,publication_origin INTO version_row
    FROM public.exercise_versions WHERE exercise_id=parent_row.id AND revision=p_revision;
  SELECT id,revision,definition,engine_contract,generation_version,canonicalization_version,editorial_status INTO active_row
    FROM public.exercise_versions WHERE exercise_id=parent_row.id AND id=parent_row.active_version_id;
  SELECT COALESCE(max(revision),0) INTO maximum_revision FROM public.exercise_versions WHERE exercise_id=parent_row.id;
  body:=jsonb_build_object('catalogId',p_catalog_id,'requestedRevision',p_revision,'latestRevision',maximum_revision,
    'runtime',jsonb_build_object('engineContract',runtime_row.engine_contract,'generationVersion',runtime_row.generation_version,
      'canonicalizationVersion',runtime_row.canonicalization_version,'engineArchiveSha256',runtime_row.engine_archive_sha256),
    'parent',CASE WHEN parent_row.id IS NULL THEN NULL ELSE to_jsonb(parent_row)-'id'-'active_version_id'||jsonb_build_object('id',parent_row.id::text,'activeVersionId',parent_row.active_version_id) END,
    'candidate',CASE WHEN version_row.id IS NULL THEN NULL ELSE jsonb_build_object('id',version_row.id,'revision',version_row.revision,
      'status',version_row.editorial_status,'definitionJson',version_row.definition::text,'businessDigest',public.exercise_publication_digest(version_row.definition,version_row.engine_contract,version_row.generation_version,version_row.canonicalization_version)) END,
    'active',CASE WHEN active_row.id IS NULL THEN NULL ELSE jsonb_build_object('id',active_row.id,'revision',active_row.revision,'status',active_row.editorial_status,
      'definitionJson',active_row.definition::text,'businessDigest',public.exercise_publication_digest(active_row.definition,active_row.engine_contract,active_row.generation_version,active_row.canonicalization_version)) END);
  RETURN body||jsonb_build_object('stateToken',encode(extensions.digest(convert_to(body::text,'UTF8'),'sha256'),'hex'));
END; $$;
REVOKE ALL ON FUNCTION novlearn_admin_private.publication_target_state(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION novlearn_admin_private.publication_target_state(uuid,integer) TO novlearn_publication_writer;

CREATE FUNCTION novlearn_admin_private.publication_input(p_payload jsonb,p_mode text) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE identity_uuid uuid; revision_number integer; definition_value jsonb; runtime_row record; actual_digest text;
BEGIN
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>524288 OR
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k) IS DISTINCT FROM
    ARRAY['businessDigest','canonicalizationVersion','catalogId','definitionJson','engineArchiveSha256','engineContract','generationVersion','revision','schemaVersion']::text[] OR
    p_payload->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR p_mode IS NULL OR p_mode NOT IN ('publish','rollback') OR
    jsonb_typeof(p_payload->'definitionJson') IS DISTINCT FROM 'string' OR
    p_payload->>'catalogId' IS NULL OR p_payload->>'catalogId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
    p_payload->>'revision' IS NULL OR p_payload->>'revision'!~'^[1-9][0-9]{0,8}$' THEN
    RAISE EXCEPTION 'invalid publication payload' USING ERRCODE='22023';
  END IF;
  identity_uuid:=(p_payload->>'catalogId')::uuid; revision_number:=(p_payload->>'revision')::integer;
  definition_value:=(p_payload->>'definitionJson')::jsonb;
  IF jsonb_typeof(definition_value) IS DISTINCT FROM 'object' OR definition_value->>'id' IS DISTINCT FROM identity_uuid::text OR
    definition_value->>'revision' IS DISTINCT FROM revision_number::text OR definition_value->'schemaVersion' IS DISTINCT FROM '5'::jsonb OR
    definition_value->>'kind' IS DISTINCT FROM 'composed' OR jsonb_typeof(definition_value->'title') IS DISTINCT FROM 'string' OR
    length(btrim(definition_value->>'title'))=0 THEN RAISE EXCEPTION 'invalid canonical identity' USING ERRCODE='22023'; END IF;
  SELECT * INTO runtime_row FROM novlearn_admin_private.publication_runtime WHERE singleton;
  IF NOT FOUND OR NOT runtime_row.enabled THEN RAISE EXCEPTION 'publication capability disabled' USING ERRCODE='55000'; END IF;
  IF p_payload->>'engineContract' IS DISTINCT FROM runtime_row.engine_contract OR p_payload->>'generationVersion' IS DISTINCT FROM runtime_row.generation_version OR
    p_payload->>'canonicalizationVersion' IS DISTINCT FROM runtime_row.canonicalization_version OR
    p_payload->>'engineArchiveSha256' IS DISTINCT FROM runtime_row.engine_archive_sha256 THEN RAISE EXCEPTION 'target Engine contract mismatch' USING ERRCODE='22023'; END IF;
  actual_digest:=public.exercise_publication_digest(definition_value,runtime_row.engine_contract,runtime_row.generation_version,runtime_row.canonicalization_version);
  IF p_payload->>'businessDigest' IS DISTINCT FROM actual_digest THEN RAISE EXCEPTION 'business digest mismatch' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('catalogId',identity_uuid,'revision',revision_number,'definition',definition_value,
    'header',novlearn_admin_private.publication_header(definition_value),'digest',actual_digest);
END; $$;
REVOKE ALL ON FUNCTION novlearn_admin_private.publication_input(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION novlearn_admin_private.publication_input(jsonb,text) TO novlearn_publication_writer;

CREATE FUNCTION public.inspect_exercise_publication(p_payload jsonb,p_mode text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='10s' AS $$
DECLARE prepared jsonb;
BEGIN
  prepared:=novlearn_admin_private.publication_input(p_payload,p_mode);
  RETURN jsonb_build_object('desiredHeader',prepared->'header','state',novlearn_admin_private.publication_target_state((prepared->>'catalogId')::uuid,(prepared->>'revision')::integer));
END; $$;
REVOKE ALL ON FUNCTION public.inspect_exercise_publication(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.apply_exercise_publication(p_payload jsonb,p_expected_state text,p_mode text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='10s' SET lock_timeout='3s' AS $$
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
    INSERT INTO public.exercises(catalog_id,title,chapter,difficulty,competences,app_title,"Is_Flash","Need_Calculator",content)
    VALUES(identity_uuid,header->>'title',header->>'chapter',header->>'difficulty',ARRAY(SELECT jsonb_array_elements_text(header->'competences')),
      header->>'app_title',(header->>'Is_Flash')::boolean,(header->>'Need_Calculator')::boolean,'{}') RETURNING id INTO parent_id;
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
END; $$;
REVOKE ALL ON FUNCTION public.apply_exercise_publication(jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
-- Ownership grants only the fixed function bodies, not role membership.
GRANT CREATE ON SCHEMA public TO novlearn_publication_writer;
ALTER FUNCTION public.inspect_exercise_publication(jsonb,text) OWNER TO novlearn_publication_writer;
ALTER FUNCTION public.apply_exercise_publication(jsonb,text,text) OWNER TO novlearn_publication_writer;
REVOKE CREATE ON SCHEMA public FROM novlearn_publication_writer;
GRANT EXECUTE ON FUNCTION public.inspect_exercise_publication(jsonb,text),public.apply_exercise_publication(jsonb,text,text) TO novlearn_publication_executor;
COMMIT;
