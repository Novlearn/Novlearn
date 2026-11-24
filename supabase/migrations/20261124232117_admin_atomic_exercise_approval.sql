-- Approve a saved exercise revision atomically on the Staging source.
-- Production retains its existing target trigger and receives no approval RPC.
DO $staging_migration$
BEGIN
  IF public.novlearn_catalog_is_staging() IS DISTINCT FROM true THEN
    RETURN;
  END IF;
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

CREATE OR REPLACE FUNCTION public.manage_exercise_version()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $function$
DECLARE content_changed boolean:=false; ready_changed boolean:=false;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.editorial_status='published' THEN RAISE EXCEPTION 'published exercise versions are immutable'; END IF;
    RETURN OLD;
  END IF;
  -- Historical execution occupies revision zero, outside source numbering.
  -- Only the reviewed operator preparation can create it; never the importer.
  IF TG_OP='INSERT' AND NEW.publication_origin='historical' THEN
    IF current_user<>'postgres' OR NEW.revision<>0 OR NEW.editorial_status<>'published' THEN
      RAISE EXCEPTION 'historical execution requires operator preparation' USING ERRCODE='42501';
    END IF;
    NEW.definition_sha256:=encode(extensions.digest(convert_to(NEW.definition::text,'UTF8'),'sha256'),'hex');
    NEW.approval_fingerprint_sha256:=NEW.definition_sha256;
    RETURN NEW;
  END IF;
  IF TG_OP='INSERT' AND NEW.publication_origin='transfer' THEN
    IF current_user NOT IN ('novlearn_publication_writer','novlearn_catalogue_sync_writer') OR NEW.editorial_status<>'published' OR
      NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.approved_fingerprint_sha256 IS NOT NULL OR
      NEW.created_by IS NOT NULL OR NEW.updated_by IS NOT NULL THEN
      RAISE EXCEPTION 'transfer insertion requires the bounded publication capability' USING ERRCODE='42501';
    END IF;
    NEW.definition_sha256:=encode(extensions.digest(convert_to(NEW.definition::text,'UTF8'),'sha256'),'hex');
    NEW.approval_fingerprint_sha256:=encode(extensions.digest(convert_to(jsonb_build_object('exercise_id',NEW.exercise_id,'revision',NEW.revision,
      'definition',NEW.definition,'engine_contract',NEW.engine_contract,'generation_version',NEW.generation_version,
      'canonicalization_version',NEW.canonicalization_version)::text,'UTF8'),'sha256'),'hex');
    NEW.published_at:=clock_timestamp();NEW.updated_at:=clock_timestamp();RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND NEW.publication_origin IS DISTINCT FROM OLD.publication_origin THEN RAISE EXCEPTION 'publication origin is immutable' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.editorial_status='published' THEN RAISE EXCEPTION 'published exercise versions are immutable'; END IF;
    content_changed:=NEW.exercise_id IS DISTINCT FROM OLD.exercise_id OR NEW.revision IS DISTINCT FROM OLD.revision OR NEW.definition IS DISTINCT FROM OLD.definition OR
      NEW.engine_contract IS DISTINCT FROM OLD.engine_contract OR NEW.generation_version IS DISTINCT FROM OLD.generation_version OR NEW.canonicalization_version IS DISTINCT FROM OLD.canonicalization_version;
    ready_changed:=NEW.ready_at IS DISTINCT FROM OLD.ready_at OR NEW.ready_by IS DISTINCT FROM OLD.ready_by OR
      NEW.ready_fingerprint_sha256 IS DISTINCT FROM OLD.ready_fingerprint_sha256;
    IF content_changed AND OLD.editorial_status='ready' THEN NEW.editorial_status:='draft'; END IF;
    IF NEW.editorial_status='ready' AND (OLD.editorial_status<>'ready' OR ready_changed) AND
       current_setting('novlearn_catalog_sync.ready_version',true) IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'use the protected readiness transition';
    END IF;
    -- The existing source receipt finalizer is SECURITY DEFINER, owned by postgres.
    IF NEW.editorial_status='published' AND
       (current_user<>'postgres' OR OLD.editorial_status<>'ready' OR content_changed OR ready_changed) THEN
      RAISE EXCEPTION 'only unchanged ready revisions can be published';
    END IF;
  ELSIF NEW.editorial_status<>'draft' THEN RAISE EXCEPTION 'insert a draft before review, approval, or publication';
  END IF;
  NEW.definition_sha256:=encode(extensions.digest(convert_to(NEW.definition::text,'UTF8'),'sha256'),'hex');
  NEW.approval_fingerprint_sha256:=encode(extensions.digest(convert_to(jsonb_build_object('exercise_id',NEW.exercise_id,'revision',NEW.revision,
    'definition',NEW.definition,'engine_contract',NEW.engine_contract,'generation_version',NEW.generation_version,
    'canonicalization_version',NEW.canonicalization_version)::text,'UTF8'),'sha256'),'hex');
  IF NEW.editorial_status='ready' THEN
    IF NEW.ready_at IS NULL OR NEW.ready_by IS NULL THEN
      RAISE EXCEPTION 'readiness metadata is required';
    END IF;
    NEW.ready_fingerprint_sha256:=NEW.approval_fingerprint_sha256;
  ELSIF NEW.editorial_status='published' THEN
    IF NEW.ready_at IS NULL OR NEW.ready_by IS NULL OR
       NEW.ready_fingerprint_sha256 IS DISTINCT FROM NEW.approval_fingerprint_sha256 THEN
      RAISE EXCEPTION 'published source must retain its readiness proof';
    END IF;
    NEW.published_at:=coalesce(NEW.published_at,now());
  ELSE
    NEW.ready_at:=NULL;NEW.ready_by:=NULL;NEW.ready_fingerprint_sha256:=NULL;
  END IF;
  NEW.updated_at:=now();RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.manage_exercise_version() FROM PUBLIC,anon,authenticated,service_role;

-- Draft writes are mediated by this session-checked RPC. The authenticated
-- role has no direct grant to update editorial status or audit columns.
CREATE OR REPLACE FUNCTION public.admin_save_exercise_draft(p_exercise_id bigint, p_version_id uuid, p_expected_fingerprint text, p_definition jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE parent public.exercises; candidate public.exercise_versions; next_revision integer; canonical jsonb; header jsonb; event_action text;
BEGIN
  IF public.novlearn_catalog_is_staging() IS DISTINCT FROM true OR
     public.is_novlearn_admin() IS DISTINCT FROM true THEN RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_definition) IS DISTINCT FROM 'object' OR (p_definition->>'schemaVersion') IS DISTINCT FROM '5' OR
     (p_definition->>'kind') IS DISTINCT FROM 'composed' OR jsonb_typeof(p_definition->'title') IS DISTINCT FROM 'string' OR
     length(btrim(p_definition->>'title')) NOT BETWEEN 1 AND 160 OR octet_length(p_definition::text)>262144 THEN
    RAISE EXCEPTION 'invalid canonical draft envelope' USING ERRCODE='22023'; END IF;
  IF p_exercise_id IS NULL THEN
    IF p_version_id IS NOT NULL OR p_expected_fingerprint IS NOT NULL THEN RAISE EXCEPTION 'invalid new exercise identity' USING ERRCODE='22023'; END IF;
    INSERT INTO public.exercises(catalog_id,title,chapter) VALUES(gen_random_uuid(),p_definition->>'title',coalesce(p_definition->'catalogue'->>'chapter','')) RETURNING * INTO parent;
  ELSE
    SELECT * INTO parent FROM public.exercises WHERE id=p_exercise_id FOR UPDATE;
    IF NOT FOUND OR parent.catalog_id IS NULL OR parent.admin_archived_at IS NOT NULL THEN RAISE EXCEPTION 'exercise unavailable' USING ERRCODE='40001'; END IF;
  END IF;
  IF p_version_id IS NOT NULL THEN
    SELECT * INTO candidate FROM public.exercise_versions WHERE id=p_version_id AND exercise_id=parent.id FOR UPDATE;
    IF NOT FOUND OR candidate.editorial_status NOT IN ('draft','ready') OR p_expected_fingerprint IS NULL OR
       candidate.approval_fingerprint_sha256 IS DISTINCT FROM p_expected_fingerprint THEN
      RAISE EXCEPTION 'draft changed or is no longer editable' USING ERRCODE='40001'; END IF;
    canonical:=p_definition||jsonb_build_object('id',parent.catalog_id::text,'revision',candidate.revision::text);
    UPDATE public.exercise_versions SET definition=canonical,updated_by=auth.uid() WHERE id=candidate.id RETURNING * INTO candidate;
    event_action:='draft_saved';
  ELSE
    IF p_expected_fingerprint IS NOT NULL THEN RAISE EXCEPTION 'new revision cannot carry an old fingerprint' USING ERRCODE='22023'; END IF;
    UPDATE public.exercise_versions SET editorial_status='draft' WHERE exercise_id=parent.id AND editorial_status='ready';
    SELECT coalesce(max(revision),0)+1 INTO next_revision FROM public.exercise_versions WHERE exercise_id=parent.id;
    canonical:=p_definition||jsonb_build_object('id',parent.catalog_id::text,'revision',next_revision::text);
    INSERT INTO public.exercise_versions(exercise_id,revision,definition,engine_contract,generation_version,canonicalization_version,
      definition_sha256,approval_fingerprint_sha256,created_by,updated_by)
      VALUES(parent.id,next_revision,canonical,'schema-5;engine-0.1.0','mulberry32-rejection-v1','pg-jsonb-text-v1',repeat('0',64),repeat('0',64),auth.uid(),auth.uid())
      RETURNING * INTO candidate;
    event_action:='draft_created';
  END IF;
  header:=novlearn_admin_private.publication_header(canonical);
  UPDATE public.exercises SET title=header->>'title',chapter=header->>'chapter',difficulty=header->>'difficulty',
    competences=ARRAY(SELECT jsonb_array_elements_text(header->'competences')),app_title=header->>'app_title',
    "Is_Flash"=(header->>'Is_Flash')::boolean,"Need_Calculator"=(header->>'Need_Calculator')::boolean WHERE id=parent.id;
  INSERT INTO public.admin_content_events(actor_id,exercise_id,version_id,action) VALUES(auth.uid(),parent.id,candidate.id,event_action);
  RETURN jsonb_build_object('exerciseId',parent.id::text,'versionId',candidate.id,'revision',candidate.revision,'fingerprint',candidate.approval_fingerprint_sha256);
EXCEPTION WHEN serialization_failure THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Content changed; reload before retrying';
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_save_exercise_draft(bigint,uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_exercise_draft(bigint,uuid,text,jsonb)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_and_approve_exercise(
  p_exercise_id bigint,
  p_version_id uuid,
  p_expected_fingerprint text,
  p_definition jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  saved jsonb;
  saved_version_id uuid;
  saved_fingerprint text;
BEGIN
  IF public.novlearn_catalog_is_staging() IS DISTINCT FROM true OR
     public.is_novlearn_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Staging administrator access required' USING ERRCODE='42501';
  END IF;
  saved := public.admin_save_exercise_draft(
    p_exercise_id, p_version_id, p_expected_fingerprint, p_definition
  );
  saved_version_id := (saved->>'versionId')::uuid;
  saved_fingerprint := saved->>'fingerprint';

  PERFORM public.admin_set_exercise_version_ready(saved_version_id, saved_fingerprint);

  IF NOT EXISTS (
    SELECT 1 FROM public.exercise_versions
    WHERE id = saved_version_id AND editorial_status = 'ready'
      AND approval_fingerprint_sha256 = saved_fingerprint
      AND ready_fingerprint_sha256 = saved_fingerprint
  ) THEN
    RAISE EXCEPTION 'readiness could not be confirmed' USING ERRCODE='PT409';
  END IF;

  RETURN saved || jsonb_build_object('status', 'ready');
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_save_and_approve_exercise(bigint,uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_and_approve_exercise(bigint,uuid,text,jsonb)
  TO authenticated;
NOTIFY pgrst,'reload schema';
END;
$staging_migration$;
