-- Simple editorial readiness and staging readers for the Admin catalogue sync.
-- This migration is additive to the canonical NovLearn history. It is intended
-- for Staging first; Production activation remains a separate controlled step.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS novlearn_catalog_sync;
CREATE TABLE IF NOT EXISTS novlearn_catalog_sync.runtime (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text NOT NULL CHECK (environment IN ('staging','production')),
  enforce_production_sync boolean NOT NULL DEFAULT false
);
DO $runtime$
BEGIN
  IF EXISTS (SELECT 1 FROM novlearn_catalog_sync.runtime WHERE singleton AND environment <> 'staging') THEN
    RAISE EXCEPTION 'catalog sync runtime is not Staging';
  END IF;
  INSERT INTO novlearn_catalog_sync.runtime(singleton,environment)
    VALUES(true,'staging') ON CONFLICT(singleton) DO NOTHING;
END;
$runtime$;
REVOKE ALL ON SCHEMA novlearn_catalog_sync FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA novlearn_catalog_sync FROM PUBLIC, anon, authenticated, service_role;

-- A duel pins the candidate versions it may use for its whole lifetime. The
-- FK prevents version cleanup; there is deliberately no delete/cascade path.
CREATE TABLE public.duel_catalog_reservations (
  duel_id bigint NOT NULL REFERENCES public.duels(id) ON DELETE RESTRICT,
  exercise_id bigint NOT NULL REFERENCES public.exercises(id) ON DELETE RESTRICT,
  exercise_version_id uuid NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(duel_id,exercise_id),
  CONSTRAINT duel_catalog_reservations_version_fk FOREIGN KEY(exercise_id,exercise_version_id)
    REFERENCES public.exercise_versions(exercise_id,id) ON DELETE RESTRICT
);
ALTER TABLE public.duel_catalog_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.duel_catalog_reservations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.duel_catalog_reservations TO service_role;

CREATE FUNCTION novlearn_catalog_sync.guard_reserved_duel_archive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.admin_archived_at IS NULL AND NEW.admin_archived_at IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.duels d
    WHERE d.status='active' AND (d.exercise_id=OLD.id OR EXISTS(
      SELECT 1 FROM public.duel_exercise_instances i WHERE i.duel_id=d.id AND i.exercise_id=OLD.id))
      AND NOT EXISTS(SELECT 1 FROM public.duel_catalog_reservations r WHERE r.duel_id=d.id AND r.exercise_id=OLD.id)
  ) THEN RAISE EXCEPTION 'active duel must reserve this exercise before archival' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION novlearn_catalog_sync.guard_reserved_duel_archive() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER exercise_archive_reserved_duel BEFORE UPDATE OF admin_archived_at ON public.exercises
FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.guard_reserved_duel_archive();

CREATE FUNCTION novlearn_catalog_sync.require_available_duel_reservation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE parent public.exercises;
BEGIN
  SELECT * INTO parent FROM public.exercises WHERE id=NEW.exercise_id FOR SHARE;
  IF NOT FOUND OR parent.admin_archived_at IS NOT NULL OR parent.catalog_id IS NULL THEN
    RAISE EXCEPTION 'new duels cannot reserve archived or legacy exercises' USING ERRCODE='23503'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.exercise_versions v WHERE v.exercise_id=NEW.exercise_id AND v.id=NEW.exercise_version_id AND
    (public.novlearn_catalog_is_staging() OR (v.editorial_status='published' AND parent.active_version_id=v.id))) THEN
    RAISE EXCEPTION 'duel reservation version is not eligible' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION novlearn_catalog_sync.require_available_duel_reservation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER duel_reservation_requires_available_exercise BEFORE INSERT OR UPDATE ON public.duel_catalog_reservations
FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.require_available_duel_reservation();

CREATE OR REPLACE FUNCTION public.novlearn_catalog_is_staging()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT environment='staging' FROM novlearn_catalog_sync.runtime WHERE singleton
$$;
REVOKE ALL ON FUNCTION public.novlearn_catalog_is_staging() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.novlearn_catalog_is_staging() TO anon, authenticated, service_role;

-- Stable identifiers are new identities, not guesses based on matching names.
ALTER TABLE public.chapters
  ADD COLUMN catalog_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN editorial_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN admin_archived_at timestamptz,
  ADD COLUMN ready_at timestamptz,
  ADD COLUMN ready_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN synced_fingerprint_sha256 text,
  ADD COLUMN synced_at timestamptz;
ALTER TABLE public.exercises
  ADD COLUMN synced_fingerprint_sha256 text,
  ADD COLUMN synced_at timestamptz;
ALTER TABLE public.exercises ADD CONSTRAINT exercises_synced_fingerprint_check
  CHECK(synced_fingerprint_sha256 IS NULL OR synced_fingerprint_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE public.chapters ADD CONSTRAINT chapters_catalog_id_key UNIQUE(catalog_id);
ALTER TABLE public.chapters ADD CONSTRAINT chapters_editorial_status_check
  CHECK(editorial_status IN ('draft','ready','published','archived'));
ALTER TABLE public.chapters ADD CONSTRAINT chapters_synced_fingerprint_check
  CHECK(synced_fingerprint_sha256 IS NULL OR synced_fingerprint_sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE public.competences
  ADD COLUMN catalog_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN editorial_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN admin_archived_at timestamptz,
  ADD COLUMN ready_at timestamptz,
  ADD COLUMN ready_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN synced_fingerprint_sha256 text,
  ADD COLUMN synced_at timestamptz;
ALTER TABLE public.competences ADD CONSTRAINT competences_catalog_id_key UNIQUE(catalog_id);
ALTER TABLE public.competences ADD CONSTRAINT competences_editorial_status_check
  CHECK(editorial_status IN ('draft','ready','published','archived'));
ALTER TABLE public.competences ADD CONSTRAINT competences_synced_fingerprint_check
  CHECK(synced_fingerprint_sha256 IS NULL OR synced_fingerprint_sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE public.flashcards
  ADD COLUMN catalog_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN editorial_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN admin_archived_at timestamptz,
  ADD COLUMN ready_at timestamptz,
  ADD COLUMN ready_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN synced_fingerprint_sha256 text,
  ADD COLUMN synced_at timestamptz;
ALTER TABLE public.flashcards ADD CONSTRAINT flashcards_catalog_id_key UNIQUE(catalog_id);
ALTER TABLE public.flashcards ADD CONSTRAINT flashcards_editorial_status_check
  CHECK(editorial_status IN ('draft','ready','published','archived'));
ALTER TABLE public.flashcards ADD CONSTRAINT flashcards_synced_fingerprint_check
  CHECK(synced_fingerprint_sha256 IS NULL OR synced_fingerprint_sha256 ~ '^[0-9a-f]{64}$');

-- Older editorial statuses are historical workflow states. Preserve the
-- recorded admin decision as a ready attestation; do not require Engine data.
ALTER TABLE public.exercise_versions
  ADD COLUMN ready_at timestamptz,
  ADD COLUMN ready_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN ready_fingerprint_sha256 text;
ALTER TABLE public.exercise_versions DROP CONSTRAINT exercise_versions_editorial_status_check;
ALTER TABLE public.exercise_versions DROP CONSTRAINT exercise_versions_approval_fields_check;

CREATE OR REPLACE FUNCTION public.manage_exercise_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
DECLARE content_changed boolean := false; ready_changed boolean := false;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.editorial_status='published' THEN RAISE EXCEPTION 'published exercise versions are immutable'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.editorial_status='published' THEN RAISE EXCEPTION 'published exercise versions are immutable'; END IF;
    content_changed := NEW.exercise_id IS DISTINCT FROM OLD.exercise_id OR NEW.revision IS DISTINCT FROM OLD.revision OR
      NEW.definition IS DISTINCT FROM OLD.definition OR NEW.engine_contract IS DISTINCT FROM OLD.engine_contract OR
      NEW.generation_version IS DISTINCT FROM OLD.generation_version OR NEW.canonicalization_version IS DISTINCT FROM OLD.canonicalization_version;
    ready_changed := NEW.ready_at IS DISTINCT FROM OLD.ready_at OR NEW.ready_by IS DISTINCT FROM OLD.ready_by OR
      NEW.ready_fingerprint_sha256 IS DISTINCT FROM OLD.ready_fingerprint_sha256;
    IF content_changed AND OLD.editorial_status='ready' THEN NEW.editorial_status:='draft'; END IF;
    IF NEW.admin_archived_at IS DISTINCT FROM OLD.admin_archived_at AND
       current_setting('novlearn_catalog_sync.archive_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'use the protected archive transition'; END IF;
    IF NEW.editorial_status IN ('archived','draft') AND OLD.editorial_status='archived' AND
       NEW.admin_archived_at IS NULL AND current_setting('novlearn_catalog_sync.archive_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'use the protected restore transition'; END IF;
    IF NEW.editorial_status='archived' AND OLD.editorial_status IS DISTINCT FROM 'archived' AND
       current_setting('novlearn_catalog_sync.archive_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'use the protected archive transition'; END IF;
    IF NEW.editorial_status='ready' AND OLD.editorial_status<>'ready' AND
       current_setting('novlearn_catalog_sync.ready_version',true) IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'use the protected readiness transition';
    END IF;
    IF NEW.editorial_status='published' AND OLD.editorial_status<>'ready' THEN
      RAISE EXCEPTION 'only ready revisions can be published';
    END IF;
    IF ready_changed AND NOT content_changed AND NEW.editorial_status='ready' AND
       current_setting('novlearn_catalog_sync.ready_version',true) IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'readiness attestation is protected';
    END IF;
  ELSIF NEW.publication_origin='transfer' THEN
    IF NEW.editorial_status<>'published' THEN RAISE EXCEPTION 'transferred revisions are published'; END IF;
  ELSIF NEW.editorial_status<>'draft' THEN
    RAISE EXCEPTION 'insert a draft before readiness';
  END IF;
  NEW.definition_sha256:=encode(extensions.digest(convert_to(NEW.definition::text,'UTF8'),'sha256'),'hex');
  NEW.approval_fingerprint_sha256:=encode(extensions.digest(convert_to(jsonb_build_object(
    'exercise_id',NEW.exercise_id,'revision',NEW.revision,'definition',NEW.definition,
    'engine_contract',NEW.engine_contract,'generation_version',NEW.generation_version,
    'canonicalization_version',NEW.canonicalization_version)::text,'UTF8'),'sha256'),'hex');
  IF NEW.editorial_status='ready' THEN
    IF NEW.ready_at IS NULL OR NEW.ready_by IS NULL THEN RAISE EXCEPTION 'readiness metadata is required'; END IF;
    NEW.ready_fingerprint_sha256:=NEW.approval_fingerprint_sha256;
  ELSIF NEW.editorial_status='published' AND NEW.publication_origin='local' THEN
    IF NEW.ready_at IS NULL OR NEW.ready_by IS NULL OR NEW.ready_fingerprint_sha256 IS DISTINCT FROM NEW.approval_fingerprint_sha256 THEN
      RAISE EXCEPTION 'published source must retain its readiness proof'; END IF;
  ELSIF NEW.editorial_status='published' AND NEW.publication_origin='transfer' THEN
    NEW.ready_at:=NULL; NEW.ready_by:=NULL; NEW.ready_fingerprint_sha256:=NULL;
  ELSE
    NEW.ready_at:=NULL; NEW.ready_by:=NULL; NEW.ready_fingerprint_sha256:=NULL;
  END IF;
  IF NEW.editorial_status='published' THEN NEW.published_at:=coalesce(NEW.published_at,now()); END IF;
  NEW.updated_at:=now();
  RETURN NEW;
END;
$function$;

-- Preserve existing explicit approvals as readiness while passing through the
-- same trigger-protected transition used by the RPC.
DO $readiness_backfill$
DECLARE existing_approval record;
BEGIN
  FOR existing_approval IN
    SELECT id FROM public.exercise_versions WHERE editorial_status='approved' ORDER BY id
  LOOP
    PERFORM set_config('novlearn_catalog_sync.ready_version',existing_approval.id::text,true);
    UPDATE public.exercise_versions
      SET editorial_status='ready',ready_at=approved_at,ready_by=approved_by,
          ready_fingerprint_sha256=approved_fingerprint_sha256,
          approved_at=NULL,approved_by=NULL,approved_fingerprint_sha256=NULL
      WHERE id=existing_approval.id;
  END LOOP;
  UPDATE public.exercise_versions SET editorial_status='draft',approved_at=NULL,approved_by=NULL,approved_fingerprint_sha256=NULL
    WHERE editorial_status='in_review';
END;
$readiness_backfill$;
ALTER TABLE public.exercise_versions ADD CONSTRAINT exercise_versions_editorial_status_check
  CHECK(editorial_status IN ('draft','ready','published'));
ALTER TABLE public.exercise_versions ADD CONSTRAINT exercise_versions_readiness_fields_check
  CHECK((editorial_status='ready' AND ready_at IS NOT NULL AND ready_by IS NOT NULL
           AND ready_fingerprint_sha256=approval_fingerprint_sha256)
     OR (editorial_status='published' AND publication_origin='local' AND ready_at IS NOT NULL
           AND ready_by IS NOT NULL AND ready_fingerprint_sha256=approval_fingerprint_sha256)
     OR (editorial_status IN ('draft','published') AND ready_at IS NULL AND ready_by IS NULL
           AND ready_fingerprint_sha256 IS NULL));
ALTER TABLE public.exercise_versions ADD CONSTRAINT exercise_versions_readiness_fingerprint_check
  CHECK(ready_fingerprint_sha256 IS NULL OR ready_fingerprint_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE public.exercise_versions ADD CONSTRAINT exercise_versions_approval_fields_check
  CHECK(publication_origin='transfer' OR editorial_status<>'published' OR
        (published_at IS NOT NULL AND ready_fingerprint_sha256=approval_fingerprint_sha256));

-- Expand the existing event streams rather than introducing a parallel log.
ALTER TABLE public.admin_content_events DROP CONSTRAINT admin_content_events_action_check;
ALTER TABLE public.admin_content_events ADD CONSTRAINT admin_content_events_action_check
  CHECK(action IN ('draft_created','draft_saved','ready','archived','restored','sync_confirmed'));
ALTER TABLE public.admin_flashcard_events DROP CONSTRAINT admin_flashcard_events_action_check;
ALTER TABLE public.admin_flashcard_events ADD CONSTRAINT admin_flashcard_events_action_check
  CHECK(action IN ('created','updated','deleted','ready','archived','restored','sync_confirmed'));
ALTER TABLE public.admin_taxonomy_events DROP CONSTRAINT admin_taxonomy_events_action_check;
ALTER TABLE public.admin_taxonomy_events ADD CONSTRAINT admin_taxonomy_events_action_check
  CHECK(action IN ('created','updated','deleted','ready','archived','restored','sync_confirmed'));

CREATE OR REPLACE FUNCTION public.admin_set_exercise_version_ready(p_version_id uuid,p_expected_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v public.exercise_versions; parent public.exercises;
BEGIN
  IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501'; END IF;
  IF p_expected_fingerprint IS NULL OR p_expected_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'content fingerprint required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v FROM public.exercise_versions WHERE id=p_version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'version not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO parent FROM public.exercises WHERE id=v.exercise_id FOR SHARE;
  IF parent.catalog_id IS NULL OR parent.admin_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'exercise unavailable for readiness' USING ERRCODE='40001'; END IF;
  IF v.approval_fingerprint_sha256 IS DISTINCT FROM p_expected_fingerprint THEN
    RAISE EXCEPTION 'exercise changed since review' USING ERRCODE='40001'; END IF;
  IF v.editorial_status='ready' THEN RETURN jsonb_build_object('id',v.id,'status','ready','fingerprint',v.approval_fingerprint_sha256); END IF;
  IF v.editorial_status<>'draft' OR v.publication_origin<>'local' THEN
    RAISE EXCEPTION 'only a local draft can be marked ready' USING ERRCODE='22023'; END IF;
  PERFORM set_config('novlearn_catalog_sync.ready_version',v.id::text,true);
  UPDATE public.exercise_versions SET editorial_status='ready',ready_at=clock_timestamp(),ready_by=auth.uid()
    WHERE id=v.id RETURNING * INTO v;
  INSERT INTO public.admin_content_events(actor_id,exercise_id,version_id,action)
    VALUES(auth.uid(),v.exercise_id,v.id,'ready');
  RETURN jsonb_build_object('id',v.id,'status','ready','fingerprint',v.approval_fingerprint_sha256);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_exercise_version_ready(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_exercise_version_ready(uuid,text) TO authenticated;

-- Accept an edit to a ready draft; the trigger atomically returns it to draft.
CREATE OR REPLACE FUNCTION public.admin_save_exercise_draft(p_exercise_id bigint,p_version_id uuid,p_expected_fingerprint text,p_definition jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE parent public.exercises; candidate public.exercise_versions; next_revision integer; canonical jsonb; header jsonb; event_action text;
BEGIN
  IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_definition) IS DISTINCT FROM 'object' OR p_definition->>'schemaVersion'<>'5' OR
     p_definition->>'kind'<>'composed' OR jsonb_typeof(p_definition->'title')<>'string' OR
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

-- Export is an explicit, bounded pedagogical projection. It does not read
-- test receipts, Engine reports, user data, or rows absent from the selection.
CREATE OR REPLACE FUNCTION public.admin_export_exercise_publication(p_version_id uuid,p_fingerprint text,p_epoch bigint,p_roundtrip_definition jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE parent_row public.exercises; v public.exercise_versions;
BEGIN
  IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v FROM public.exercise_versions WHERE id=p_version_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'source unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO parent_row FROM public.exercises WHERE id=v.exercise_id FOR SHARE;
  IF parent_row.admin_archived_at IS NOT NULL OR parent_row.catalog_id IS NULL THEN RAISE EXCEPTION 'source unavailable' USING ERRCODE='40001'; END IF;
  IF v.publication_origin<>'local' OR v.editorial_status<>'ready' OR v.ready_by IS NULL OR
     v.approval_fingerprint_sha256 IS DISTINCT FROM p_fingerprint OR
     v.ready_fingerprint_sha256 IS DISTINCT FROM p_fingerprint OR v.test_epoch IS DISTINCT FROM p_epoch THEN
    RAISE EXCEPTION 'source readiness changed' USING ERRCODE='40001'; END IF;
  IF p_roundtrip_definition IS NULL OR p_roundtrip_definition IS DISTINCT FROM v.definition THEN
    RAISE EXCEPTION 'canonical definition mismatch' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('payload',jsonb_build_object('schemaVersion',1,'catalogId',parent_row.catalog_id,
    'revision',v.revision,'definitionJson',v.definition::text,'engineContract',v.engine_contract,
    'generationVersion',v.generation_version,'canonicalizationVersion',v.canonicalization_version,
    'businessDigest',public.exercise_publication_digest(v.definition,v.engine_contract,v.generation_version,v.canonicalization_version)),
    'source',jsonb_build_object('versionId',v.id,'fingerprint',p_fingerprint,'epoch',p_epoch,'status','ready'));
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_export_exercise_publication(uuid,text,bigint,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_export_exercise_publication(uuid,text,bigint,jsonb) TO authenticated;

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
      RAISE EXCEPTION 'ready revision changed or missing' USING ERRCODE='40001'; END IF;
    chapter_name:=v.definition->'catalogue'->>'chapter';
    IF chapter_name IS NOT NULL AND chapter_name<>'' THEN
      SELECT count(*) INTO n FROM public.chapters ch
        WHERE ch.id::text=chapter_name OR lower(ch.name)=lower(chapter_name) OR chapter_name=ANY(ch.aliases);
      SELECT ch.catalog_id INTO chapter_id FROM public.chapters ch
        WHERE ch.id::text=chapter_name OR lower(ch.name)=lower(chapter_name) OR chapter_name=ANY(ch.aliases) LIMIT 1;
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
REVOKE ALL ON FUNCTION public.admin_export_catalogue_sync_item(text,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_export_catalogue_sync_item(text,uuid,text) TO authenticated;

CREATE FUNCTION public.admin_get_catalog_item_readiness(p_kind text,p_catalog_id uuid)
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

CREATE OR REPLACE FUNCTION public.admin_set_catalog_item_ready(p_kind text,p_catalog_id uuid,p_expected_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE row_value jsonb; row_id text; fingerprint text; chapter_id uuid; actor uuid:=auth.uid();
BEGIN
  IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('chapter','competence','flashcard') OR p_catalog_id IS NULL OR
     p_expected_fingerprint IS NULL OR p_expected_fingerprint !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid sync identity' USING ERRCODE='22023'; END IF;
  IF p_kind='chapter' THEN
    SELECT to_jsonb(c)-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[],c.id::text
      INTO row_value,row_id FROM public.chapters c WHERE c.catalog_id=p_catalog_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.chapters WHERE catalog_id=p_catalog_id AND admin_archived_at IS NOT NULL) THEN
      RAISE EXCEPTION 'archived chapter cannot be marked ready' USING ERRCODE='40001'; END IF;
  ELSIF p_kind='competence' THEN
    SELECT (to_jsonb(c)||jsonb_build_object('chapter_catalog_id',ch.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[],c.id
      INTO row_value,row_id FROM public.competences c JOIN public.chapters ch ON ch.id=c.chapter_id WHERE c.catalog_id=p_catalog_id FOR UPDATE OF c;
  ELSE
    SELECT (to_jsonb(f)||jsonb_build_object('chapter_catalog_id',ch.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[],f.id::text
      INTO row_value,row_id FROM public.flashcards f JOIN public.chapters ch ON lower(ch.name)=lower(f.chapter) OR f.chapter=ANY(ch.aliases) WHERE f.catalog_id=p_catalog_id FOR UPDATE OF f;
    IF (SELECT count(*) FROM public.chapters ch JOIN public.flashcards f ON (lower(ch.name)=lower(f.chapter) OR f.chapter=ANY(ch.aliases)) WHERE f.catalog_id=p_catalog_id)<>1 THEN
      RAISE EXCEPTION 'flashcard chapter reference is missing or ambiguous' USING ERRCODE='23503'; END IF;
  END IF;
  IF row_value IS NULL THEN RAISE EXCEPTION 'catalogue item not found' USING ERRCODE='P0002'; END IF;
  fingerprint:=encode(extensions.digest(convert_to(row_value::text,'UTF8'),'sha256'),'hex');
  IF fingerprint IS DISTINCT FROM p_expected_fingerprint THEN RAISE EXCEPTION 'catalogue item changed since review' USING ERRCODE='40001'; END IF;
  PERFORM set_config('novlearn_catalog_sync.ready_item',p_catalog_id::text,true);
  IF p_kind='chapter' THEN
    UPDATE public.chapters SET editorial_status='ready',ready_at=clock_timestamp(),ready_by=actor WHERE catalog_id=p_catalog_id;
    INSERT INTO public.admin_taxonomy_events(actor_id,entity_kind,entity_id,action,after_value) VALUES(actor,'chapter',row_id,'ready',row_value);
  ELSIF p_kind='competence' THEN
    IF NOT EXISTS(SELECT 1 FROM public.chapters WHERE id=(row_value->>'chapter_id')::uuid AND admin_archived_at IS NULL) THEN RAISE EXCEPTION 'competence chapter unavailable' USING ERRCODE='23503'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.chapters WHERE id=(row_value->>'chapter_id')::uuid AND editorial_status IN ('ready','published') AND admin_archived_at IS NULL) THEN RAISE EXCEPTION 'competence chapter is not ready' USING ERRCODE='23503'; END IF;
    IF EXISTS(SELECT 1 FROM public.competences WHERE catalog_id=p_catalog_id AND admin_archived_at IS NOT NULL) THEN RAISE EXCEPTION 'archived competence cannot be marked ready' USING ERRCODE='40001'; END IF;
    UPDATE public.competences SET editorial_status='ready',ready_at=clock_timestamp(),ready_by=actor WHERE catalog_id=p_catalog_id;
    INSERT INTO public.admin_taxonomy_events(actor_id,entity_kind,entity_id,action,after_value) VALUES(actor,'competence',row_id,'ready',row_value);
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.chapters ch JOIN public.flashcards f ON f.chapter=ch.name OR f.chapter=ANY(ch.aliases)
      WHERE f.catalog_id=p_catalog_id AND ch.editorial_status IN ('ready','published') AND ch.admin_archived_at IS NULL) THEN
      RAISE EXCEPTION 'flashcard chapter is not ready' USING ERRCODE='23503'; END IF;
    IF EXISTS(SELECT 1 FROM public.flashcards WHERE catalog_id=p_catalog_id AND admin_archived_at IS NOT NULL) THEN RAISE EXCEPTION 'archived flashcard cannot be marked ready' USING ERRCODE='40001'; END IF;
    UPDATE public.flashcards SET editorial_status='ready',ready_at=clock_timestamp(),ready_by=actor WHERE catalog_id=p_catalog_id;
    INSERT INTO public.admin_flashcard_events(actor_id,flashcard_id,action,after_value) VALUES(actor,row_id::uuid,'ready',row_value);
  END IF;
  RETURN jsonb_build_object('kind',p_kind,'catalogId',p_catalog_id,'status','ready','fingerprint',fingerprint);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_catalog_item_ready(text,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_catalog_item_ready(text,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION novlearn_catalog_sync.manage_catalog_item()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE content_changed boolean;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'catalogue entities are archived, never deleted'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.catalog_id IS DISTINCT FROM OLD.catalog_id THEN
      RAISE EXCEPTION 'catalogue identity is immutable'; END IF;
    content_changed:=(to_jsonb(NEW)-ARRAY['admin_epoch','editorial_status','admin_archived_at','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['admin_epoch','editorial_status','admin_archived_at','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[]);
    IF content_changed AND OLD.editorial_status IN ('ready','published') THEN NEW.editorial_status:='draft';NEW.ready_at:=NULL;NEW.ready_by:=NULL;END IF;
    IF (NEW.ready_at IS DISTINCT FROM OLD.ready_at OR NEW.ready_by IS DISTINCT FROM OLD.ready_by) AND
       current_setting('novlearn_catalog_sync.ready_item',true) IS DISTINCT FROM NEW.catalog_id::text AND
       current_setting('novlearn_catalog_sync.archive_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'readiness attestation is protected'; END IF;
    IF NEW.editorial_status='ready' AND OLD.editorial_status IS DISTINCT FROM 'ready' AND
       current_setting('novlearn_catalog_sync.ready_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'use the protected readiness transition'; END IF;
    IF NEW.editorial_status='published' AND OLD.editorial_status IS DISTINCT FROM 'published' AND
       current_setting('novlearn_catalog_sync.sync_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'publication follows confirmed synchronization'; END IF;
  ELSIF NEW.editorial_status<>'draft' THEN
    RAISE EXCEPTION 'insert a draft before readiness';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION novlearn_catalog_sync.manage_catalog_item() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER chapters_catalog_manage BEFORE INSERT OR UPDATE OR DELETE ON public.chapters FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.manage_catalog_item();
CREATE TRIGGER competences_catalog_manage BEFORE INSERT OR UPDATE OR DELETE ON public.competences FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.manage_catalog_item();
CREATE TRIGGER flashcards_catalog_manage BEFORE INSERT OR UPDATE OR DELETE ON public.flashcards FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.manage_catalog_item();

CREATE OR REPLACE FUNCTION public.admin_archive_catalog_item(p_kind text,p_catalog_id uuid,p_expected_fingerprint text,p_archived boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE row_value jsonb; row_id text; fingerprint text; actor uuid:=auth.uid(); uses bigint;
BEGIN
  IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('chapter','competence','flashcard') OR p_archived IS NULL OR p_expected_fingerprint IS NULL THEN RAISE EXCEPTION 'invalid archive request' USING ERRCODE='22023'; END IF;
  LOCK TABLE public.chapters,public.competences,public.exercises,public.exercise_versions,public.flashcards IN SHARE ROW EXCLUSIVE MODE;
  IF p_kind='chapter' THEN
    SELECT (to_jsonb(c)-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[]),c.id::text INTO row_value,row_id
      FROM public.chapters c WHERE c.catalog_id=p_catalog_id FOR UPDATE;
    IF p_archived THEN
      SELECT count(*) INTO uses FROM public.competences WHERE chapter_id=(row_value->>'id')::uuid AND editorial_status='published';
      uses:=uses+(SELECT count(*) FROM public.flashcards WHERE lower(chapter)=lower(row_value->>'name') AND editorial_status='published');
      uses:=uses+(SELECT count(*) FROM public.exercises e JOIN public.exercise_versions v ON v.exercise_id=e.id AND v.editorial_status='published'
        WHERE e.chapter=row_value->>'name' OR v.definition->'catalogue'->>'chapter'=row_value->>'name');
    END IF;
  ELSIF p_kind='competence' THEN
    SELECT (to_jsonb(c)||jsonb_build_object('chapter_catalog_id',ch.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[],c.id
      INTO row_value,row_id FROM public.competences c LEFT JOIN public.chapters ch ON ch.id=c.chapter_id WHERE c.catalog_id=p_catalog_id FOR UPDATE OF c;
    IF p_archived THEN
      SELECT (SELECT count(*) FROM public.exercises e WHERE c.id=ANY(coalesce(e.competences,'{}'))) +
        (SELECT count(*) FROM public.exercise_versions v WHERE v.editorial_status='published' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v.definition->'catalogue'->'skills')='array' THEN v.definition->'catalogue'->'skills' ELSE '[]'::jsonb END) s WHERE s=c.id))
        INTO uses FROM public.competences c WHERE c.catalog_id=p_catalog_id;
    END IF;
  ELSE
    SELECT (to_jsonb(f)||jsonb_build_object('chapter_catalog_id',ch.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[],f.id::text
      INTO row_value,row_id FROM public.flashcards f LEFT JOIN public.chapters ch ON lower(ch.name)=lower(f.chapter) OR f.chapter=ANY(ch.aliases)
      WHERE f.catalog_id=p_catalog_id FOR UPDATE OF f;
  END IF;
  IF row_value IS NULL THEN RAISE EXCEPTION 'catalogue item not found' USING ERRCODE='P0002'; END IF;
  fingerprint:=encode(extensions.digest(convert_to(row_value::text,'UTF8'),'sha256'),'hex');
  IF fingerprint IS DISTINCT FROM p_expected_fingerprint THEN RAISE EXCEPTION 'catalogue item changed since review' USING ERRCODE='40001'; END IF;
  IF p_archived AND p_kind IN ('chapter','competence') AND coalesce(uses,0)>0 THEN RAISE EXCEPTION 'active published content still references this item' USING ERRCODE='23503'; END IF;
  IF p_kind='chapter' THEN
    PERFORM set_config('novlearn_catalog_sync.archive_item',p_catalog_id::text,true);
    UPDATE public.chapters SET admin_archived_at=CASE WHEN p_archived THEN now() ELSE NULL END,editorial_status=CASE WHEN p_archived THEN 'archived' ELSE 'draft' END,ready_at=NULL,ready_by=NULL WHERE catalog_id=p_catalog_id;
    INSERT INTO public.admin_taxonomy_events(actor_id,entity_kind,entity_id,action,before_value,after_value) VALUES(actor,'chapter',row_id,CASE WHEN p_archived THEN 'archived' ELSE 'restored' END,row_value,NULL);
  ELSIF p_kind='competence' THEN
    PERFORM set_config('novlearn_catalog_sync.archive_item',p_catalog_id::text,true);
    UPDATE public.competences SET admin_archived_at=CASE WHEN p_archived THEN now() ELSE NULL END,editorial_status=CASE WHEN p_archived THEN 'archived' ELSE 'draft' END,ready_at=NULL,ready_by=NULL WHERE catalog_id=p_catalog_id;
    INSERT INTO public.admin_taxonomy_events(actor_id,entity_kind,entity_id,action,before_value,after_value) VALUES(actor,'competence',row_id,CASE WHEN p_archived THEN 'archived' ELSE 'restored' END,row_value,NULL);
  ELSE
    PERFORM set_config('novlearn_catalog_sync.archive_item',p_catalog_id::text,true);
    UPDATE public.flashcards SET admin_archived_at=CASE WHEN p_archived THEN now() ELSE NULL END,editorial_status=CASE WHEN p_archived THEN 'archived' ELSE 'draft' END,ready_at=NULL,ready_by=NULL WHERE catalog_id=p_catalog_id;
    INSERT INTO public.admin_flashcard_events(actor_id,flashcard_id,action,before_value,after_value) VALUES(actor,row_id::uuid,CASE WHEN p_archived THEN 'archived' ELSE 'restored' END,row_value,NULL);
  END IF;
  RETURN jsonb_build_object('kind',p_kind,'catalogId',p_catalog_id,'archived',p_archived,'fingerprint',fingerprint);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_archive_catalog_item(text,uuid,text,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_archive_catalog_item(text,uuid,text,boolean) TO authenticated;

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
    SELECT 'chapter:'||catalog_id::text,jsonb_build_object('kind','chapter','catalogId',catalog_id,'status',CASE WHEN admin_archived_at IS NULL THEN editorial_status ELSE 'archived' END,'fingerprint',encode(extensions.digest(convert_to((to_jsonb(c)-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex'))
    FROM public.chapters c WHERE (editorial_status='ready' AND synced_fingerprint_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to((to_jsonb(c)-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex'))
      OR (admin_archived_at IS NOT NULL AND synced_fingerprint_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to((to_jsonb(c)-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex'))
    UNION ALL
    SELECT 'competence:'||c.catalog_id::text,jsonb_build_object('kind','competence','catalogId',c.catalog_id,'status',CASE WHEN c.admin_archived_at IS NULL THEN c.editorial_status ELSE 'archived' END,'fingerprint',encode(extensions.digest(convert_to(((to_jsonb(c)||jsonb_build_object('chapter_catalog_id',ch.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex'))
    FROM public.competences c LEFT JOIN public.chapters ch ON ch.id=c.chapter_id WHERE (c.editorial_status='ready' AND c.synced_fingerprint_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(((to_jsonb(c)||jsonb_build_object('chapter_catalog_id',ch.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex'))
      OR (c.admin_archived_at IS NOT NULL AND c.synced_fingerprint_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(((to_jsonb(c)||jsonb_build_object('chapter_catalog_id',ch.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex'))
    UNION ALL
    SELECT 'flashcard:'||f.catalog_id::text,jsonb_build_object('kind','flashcard','catalogId',f.catalog_id,'status',CASE WHEN f.admin_archived_at IS NULL THEN f.editorial_status ELSE 'archived' END,'fingerprint',encode(extensions.digest(convert_to(((to_jsonb(f)||jsonb_build_object('chapter_catalog_id',ch.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex'))
    FROM public.flashcards f LEFT JOIN public.chapters ch ON lower(ch.name)=lower(f.chapter) OR f.chapter=ANY(ch.aliases) WHERE (f.editorial_status='ready' AND f.synced_fingerprint_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(((to_jsonb(f)||jsonb_build_object('chapter_catalog_id',ch.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex'))
      OR (f.admin_archived_at IS NOT NULL AND f.synced_fingerprint_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(((to_jsonb(f)||jsonb_build_object('chapter_catalog_id',ch.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex'))
  ) items WHERE sort_key>p_after ORDER BY sort_key LIMIT p_limit;
  RETURN jsonb_build_object('items',result,'limit',p_limit,'next',CASE WHEN jsonb_array_length(result)=p_limit THEN result->-1->>'sortKey' END);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_catalogue_sync_ready(text,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_catalogue_sync_ready(text,integer) TO authenticated;

-- The learner database is the authority for direct reads. Staging accepts all
-- canonical statuses; Production remains legacy-compatible until an explicit
-- correspondence audit enables enforce_production_sync in its own migration.
CREATE OR REPLACE FUNCTION public.novlearn_catalog_reader_allows(p_catalog_id uuid,p_active_version_id uuid,p_archived_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN environment='staging' THEN true
    WHEN enforce_production_sync THEN p_catalog_id IS NOT NULL AND p_active_version_id IS NOT NULL AND p_archived_at IS NULL
    ELSE p_catalog_id IS NULL OR p_active_version_id IS NOT NULL END
  FROM novlearn_catalog_sync.runtime WHERE singleton
$$;
REVOKE ALL ON FUNCTION public.novlearn_catalog_reader_allows(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.novlearn_catalog_reader_allows(uuid,uuid,timestamptz) TO anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.novlearn_catalog_item_reader_allows(p_status text,p_archived_at timestamptz,p_synced_fingerprint text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN environment='staging' THEN true
    WHEN enforce_production_sync THEN p_status='published' AND p_archived_at IS NULL AND p_synced_fingerprint IS NOT NULL
    ELSE true END
  FROM novlearn_catalog_sync.runtime WHERE singleton
$$;
REVOKE ALL ON FUNCTION public.novlearn_catalog_item_reader_allows(text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.novlearn_catalog_item_reader_allows(text,timestamptz,text) TO anon,authenticated,service_role;
ALTER POLICY novlearn_anon_hide_unpublished_canonical ON public.exercises
  USING(public.novlearn_catalog_reader_allows(catalog_id,active_version_id,admin_archived_at));
ALTER POLICY novlearn_user_hide_unpublished_canonical ON public.exercises
  USING(public.novlearn_catalog_reader_allows(catalog_id,active_version_id,admin_archived_at) OR (SELECT public.is_novlearn_admin()));
CREATE POLICY novlearn_catalog_chapter_reader ON public.chapters AS RESTRICTIVE FOR SELECT TO anon,authenticated
  USING(public.novlearn_catalog_item_reader_allows(editorial_status,admin_archived_at,synced_fingerprint_sha256));
CREATE POLICY novlearn_catalog_competence_reader ON public.competences AS RESTRICTIVE FOR SELECT TO anon,authenticated
  USING(public.novlearn_catalog_item_reader_allows(editorial_status,admin_archived_at,synced_fingerprint_sha256));
CREATE POLICY novlearn_catalog_flashcard_reader ON public.flashcards AS RESTRICTIVE FOR SELECT TO anon,authenticated
  USING(public.novlearn_catalog_item_reader_allows(editorial_status,admin_archived_at,synced_fingerprint_sha256));

-- Staging attempts and durable sessions may reference the revision actually
-- used, regardless of its editorial state. Production keeps the published
-- pointer rule; all foreign keys remain RESTRICT and snapshots remain intact.
CREATE OR REPLACE FUNCTION public.require_published_attempt_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.exercise_version_id IS NULL THEN RETURN NEW; END IF;
  IF public.novlearn_catalog_is_staging() THEN
    IF NOT EXISTS(SELECT 1 FROM public.exercise_versions v WHERE v.exercise_id=NEW.exercise_id AND v.id=NEW.exercise_version_id) THEN
      RAISE EXCEPTION 'attempt references an unknown revision'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM public.exercise_versions v WHERE v.exercise_id=NEW.exercise_id AND v.id=NEW.exercise_version_id AND v.editorial_status='published') THEN
    RAISE EXCEPTION 'attempt must reference a published exercise version';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_published_active_exercise_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE version_status text;
BEGIN
  IF NEW.active_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT editorial_status INTO version_status FROM public.exercise_versions WHERE exercise_id=NEW.id AND id=NEW.active_version_id;
  IF version_status IS DISTINCT FROM 'published' THEN RAISE EXCEPTION 'active exercise version must be published'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_published_duel_exercise_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.novlearn_catalog_is_staging() THEN
    IF NOT EXISTS(SELECT 1 FROM public.exercise_versions WHERE exercise_id=NEW.exercise_id AND id=NEW.exercise_version_id) THEN
      RAISE EXCEPTION 'duel references an unknown exercise revision'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM public.exercise_versions WHERE exercise_id=NEW.exercise_id AND id=NEW.exercise_version_id AND editorial_status='published') THEN
    RAISE EXCEPTION 'duel instance must reference a published exercise version';
  END IF;
  RETURN NEW;
END;
$$;

-- No hard-delete path remains for editorial catalogue entities. Reuse existing
-- event streams and keep their old records and FK relationships untouched.
CREATE OR REPLACE FUNCTION novlearn_catalog_sync.prevent_catalogue_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'catalogue entities are archived, never deleted'; END;
$$;
REVOKE ALL ON FUNCTION novlearn_catalog_sync.prevent_catalogue_delete() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER no_delete_chapters BEFORE DELETE ON public.chapters FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.prevent_catalogue_delete();
CREATE TRIGGER no_delete_competences BEFORE DELETE ON public.competences FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.prevent_catalogue_delete();
CREATE TRIGGER no_delete_flashcards BEFORE DELETE ON public.flashcards FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.prevent_catalogue_delete();
REVOKE DELETE, TRUNCATE ON public.chapters,public.competences,public.flashcards FROM PUBLIC,anon,authenticated;

-- Reuse the existing publication journal for all catalogue kinds. Each row is
-- one source item; batch_id groups at most 100 rows into one target transaction.
ALTER TABLE novlearn_admin_private.publication_operations ALTER COLUMN version_id DROP NOT NULL;
ALTER TABLE novlearn_admin_private.publication_operations ADD COLUMN catalog_kind text
  CHECK(catalog_kind IS NULL OR catalog_kind IN ('exercise','chapter','competence','flashcard'));
ALTER TABLE novlearn_admin_private.publication_operations ADD COLUMN catalog_id uuid;
ALTER TABLE novlearn_admin_private.publication_operations DROP CONSTRAINT publication_operations_mode_check;
ALTER TABLE novlearn_admin_private.publication_operations ADD CONSTRAINT publication_operations_mode_check
  CHECK(mode IN ('publish','rollback','sync'));
CREATE INDEX publication_operations_catalog_recent_idx
  ON novlearn_admin_private.publication_operations(catalog_kind,catalog_id,created_at DESC,id);
CREATE UNIQUE INDEX publication_operations_catalog_batch_key
  ON novlearn_admin_private.publication_operations(batch_id,catalog_kind,catalog_id) WHERE mode='sync';

CREATE OR REPLACE FUNCTION public.admin_prepare_catalogue_sync_operation(
  p_batch_id uuid,p_kind text,p_catalog_id uuid,p_fingerprint text,p_target_key text,p_inspection jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE exported jsonb; operation novlearn_admin_private.publication_operations%ROWTYPE; actor uuid:=auth.uid();
BEGIN
  IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501'; END IF;
  IF p_batch_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('exercise','chapter','competence','flashcard') OR p_catalog_id IS NULL OR
     p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$' OR p_target_key IS NULL OR p_target_key !~ '^[a-z][a-z0-9_-]{0,63}$' OR
     jsonb_typeof(p_inspection) IS DISTINCT FROM 'object' OR octet_length(p_inspection::text)>65536 THEN
    RAISE EXCEPTION 'invalid catalogue sync plan' USING ERRCODE='22023'; END IF;
  exported:=public.admin_export_catalogue_sync_item(p_kind,p_catalog_id,p_fingerprint);
  IF p_kind='exercise' AND (exported->>'versionId') IS NULL AND exported->>'action'<>'archive' THEN
    RAISE EXCEPTION 'ready exercise revision unavailable' USING ERRCODE='40001'; END IF;
  operation.id:=gen_random_uuid();operation.created_at:=clock_timestamp();operation.expires_at:=operation.created_at+interval '15 minutes';
  operation.plan_digest:=encode(extensions.digest(convert_to(jsonb_build_object('id',operation.id,'actor',actor,'batch',p_batch_id,
    'kind',p_kind,'catalogId',p_catalog_id,'source',exported,'targetKey',p_target_key,'inspection',p_inspection,
    'expiresAt',operation.expires_at)::text,'UTF8'),'sha256'),'hex');
  INSERT INTO novlearn_admin_private.publication_operations(id,batch_id,actor_id,version_id,target_key,mode,source_fingerprint,
    source_epoch,source_snapshot,payload,inspection,plan_digest,state,created_at,expires_at,updated_at,catalog_kind,catalog_id)
  VALUES(operation.id,p_batch_id,actor,CASE WHEN exported->>'versionId' IS NULL THEN NULL ELSE (exported->>'versionId')::uuid END,
    p_target_key,'sync',p_fingerprint,0,exported,exported,p_inspection,operation.plan_digest,'planned',operation.created_at,
    operation.expires_at,operation.created_at,p_kind,p_catalog_id);
  INSERT INTO novlearn_admin_private.publication_operation_events(operation_id,actor_id,state) VALUES(operation.id,actor,'planned');
  RETURN novlearn_admin_private.publication_journal_item(operation.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_prepare_catalogue_sync_operation(uuid,text,uuid,text,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_prepare_catalogue_sync_operation(uuid,text,uuid,text,text,jsonb) TO authenticated;

CREATE FUNCTION novlearn_admin_private.catalogue_sync_batch_digest(p_batch_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT encode(extensions.digest(convert_to(jsonb_agg(jsonb_build_object('id',id,'planDigest',plan_digest) ORDER BY id)::text,'UTF8'),'sha256'),'hex')
  FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync'
$function$;
REVOKE ALL ON FUNCTION novlearn_admin_private.catalogue_sync_batch_digest(uuid) FROM PUBLIC,anon,authenticated,service_role,novlearn_publication_journal_executor;
GRANT EXECUTE ON FUNCTION novlearn_admin_private.catalogue_sync_batch_digest(uuid) TO novlearn_publication_journal_executor;

CREATE FUNCTION novlearn_admin_private.claim_catalogue_sync_batch(p_actor uuid,p_batch_id uuid,p_batch_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE operation record; current_export jsonb; total integer; claimed jsonb;
BEGIN
  PERFORM novlearn_admin_private.publication_journal_actor(p_actor);
  IF p_batch_id IS NULL OR p_batch_digest IS NULL OR p_batch_digest !~ '^[0-9a-f]{64}$' OR
     novlearn_admin_private.catalogue_sync_batch_digest(p_batch_id) IS DISTINCT FROM p_batch_digest THEN
    RAISE EXCEPTION 'catalogue batch changed' USING ERRCODE='40001'; END IF;
  SELECT count(*) INTO total FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync';
  IF total NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'catalogue batch size must be 1..100' USING ERRCODE='22023'; END IF;
  IF (SELECT count(DISTINCT target_key) FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync')<>1 THEN
    RAISE EXCEPTION 'a catalogue batch must target one environment' USING ERRCODE='22023'; END IF;
  FOR operation IN SELECT * FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync' ORDER BY catalog_kind,catalog_id FOR UPDATE LOOP
    IF operation.actor_id IS DISTINCT FROM p_actor OR operation.state<>'planned' OR operation.expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'catalogue operation is expired or already claimed' USING ERRCODE='40001'; END IF;
    current_export:=public.admin_export_catalogue_sync_item(operation.catalog_kind,operation.catalog_id,operation.source_fingerprint);
    IF current_export IS DISTINCT FROM operation.source_snapshot OR current_export IS DISTINCT FROM operation.payload THEN
      RAISE EXCEPTION 'catalogue source changed since planning' USING ERRCODE='40001'; END IF;
  END LOOP;
  UPDATE novlearn_admin_private.publication_operations SET state='executing',updated_at=clock_timestamp()
    WHERE batch_id=p_batch_id AND mode='sync';
  INSERT INTO novlearn_admin_private.publication_operation_events(operation_id,actor_id,state)
    SELECT id,p_actor,'executing' FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync';
  SELECT jsonb_agg(novlearn_admin_private.publication_journal_item(id) ORDER BY catalog_kind,catalog_id) INTO claimed
    FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync';
  RETURN jsonb_build_object('batchId',p_batch_id,'batchDigest',p_batch_digest,'operations',claimed);
END;
$function$;

CREATE FUNCTION novlearn_admin_private.record_catalogue_sync_batch(
  p_actor uuid,p_batch_id uuid,p_batch_digest text,p_expected_state text,p_state text,p_receipt jsonb,p_error text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE operation record; receipt_item jsonb; item_outcome jsonb; total integer; seen integer:=0; result jsonb;
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
      IF (operation.state='committed') AND operation.outcome IS DISTINCT FROM jsonb_build_object('batchId',p_batch_id,'stateToken',p_receipt->'stateToken','item',receipt_item) THEN
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
  IF EXISTS(SELECT 1 FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync'
      AND state NOT IN (p_expected_state,'committed')) THEN RAISE EXCEPTION 'catalogue batch state changed' USING ERRCODE='40001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync' AND state=p_expected_state) THEN
    SELECT jsonb_agg(novlearn_admin_private.publication_journal_item(id) ORDER BY catalog_kind,catalog_id) INTO result
      FROM novlearn_admin_private.publication_operations WHERE batch_id=p_batch_id AND mode='sync';
    RETURN result;
  END IF;
  IF p_expected_state='uncertain' AND p_state='failed' THEN
    RAISE EXCEPTION 'an uncertain operation can fail only after target reconciliation' USING ERRCODE='40001'; END IF;
  WITH changed AS (
    UPDATE novlearn_admin_private.publication_operations o SET state=p_state,
      outcome=CASE WHEN p_state='committed' THEN jsonb_build_object('batchId',p_batch_id,'stateToken',p_receipt->'stateToken','item',(
        SELECT x FROM jsonb_array_elements(p_receipt->'items') x WHERE x->>'kind'=o.catalog_kind AND x->>'catalogId'=o.catalog_id::text)) ELSE NULL END,
      error_code=CASE WHEN p_state='failed' THEN p_error ELSE NULL END,updated_at=clock_timestamp()
    WHERE o.batch_id=p_batch_id AND o.mode='sync' AND o.state=p_expected_state
    RETURNING id
  )
  INSERT INTO novlearn_admin_private.publication_operation_events(operation_id,actor_id,state,error_code)
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
REVOKE ALL ON FUNCTION novlearn_admin_private.claim_catalogue_sync_batch(uuid,uuid,text),
  novlearn_admin_private.record_catalogue_sync_batch(uuid,uuid,text,text,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION novlearn_admin_private.claim_catalogue_sync_batch(uuid,uuid,text),
  novlearn_admin_private.record_catalogue_sync_batch(uuid,uuid,text,text,text,jsonb,text) TO novlearn_publication_journal_executor;

CREATE OR REPLACE FUNCTION novlearn_admin_private.guard_pending_publication_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE affected_catalog uuid; affected_exercises bigint[]; affected_versions uuid[];
BEGIN
  IF TG_RELID='public.exercises'::regclass AND TG_OP IN ('UPDATE','DELETE') THEN
    affected_exercises:=ARRAY[OLD.id]; affected_catalog:=OLD.catalog_id;
  ELSIF TG_RELID='public.exercise_versions'::regclass AND TG_OP IN ('INSERT','UPDATE','DELETE') THEN
    affected_exercises:=CASE TG_OP WHEN 'INSERT' THEN ARRAY[NEW.exercise_id] WHEN 'DELETE' THEN ARRAY[OLD.exercise_id] ELSE ARRAY[OLD.exercise_id,NEW.exercise_id] END;
    affected_versions:=CASE TG_OP WHEN 'INSERT' THEN ARRAY[NEW.id] WHEN 'DELETE' THEN ARRAY[OLD.id] ELSE ARRAY[OLD.id,NEW.id] END;
  ELSIF TG_RELID IN ('public.admin_exercise_test_runs'::regclass,'public.admin_exercise_reviews'::regclass) AND TG_OP IN ('INSERT','UPDATE','DELETE') THEN
    affected_versions:=CASE TG_OP WHEN 'INSERT' THEN ARRAY[NEW.version_id] WHEN 'DELETE' THEN ARRAY[OLD.version_id] ELSE ARRAY[OLD.version_id,NEW.version_id] END;
    SELECT array_agg(exercise_id) INTO affected_exercises FROM public.exercise_versions WHERE id=ANY(affected_versions);
  ELSIF TG_RELID='public.chapters'::regclass OR TG_RELID='public.competences'::regclass OR TG_RELID='public.flashcards'::regclass THEN
    affected_catalog:=OLD.catalog_id;
  ELSE RAISE EXCEPTION 'invalid publication guard context' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM novlearn_admin_private.publication_operations o JOIN public.exercise_versions v ON v.id=o.version_id
    WHERE o.state IN ('executing','uncertain') AND v.exercise_id=ANY(affected_exercises)) OR
     EXISTS(SELECT 1 FROM novlearn_admin_private.publication_operations o WHERE o.mode='sync' AND o.state IN ('executing','uncertain') AND
       (o.catalog_id=affected_catalog OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.payload->'dependencies')='array' THEN o.payload->'dependencies' ELSE '[]'::jsonb END) dep WHERE dep->>'catalogId'=affected_catalog::text))) THEN
    RAISE EXCEPTION 'catalogue transfer pending or uncertain; reconcile before editing this source' USING ERRCODE='40001'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER admin_publication_source_before_write BEFORE UPDATE OR DELETE ON public.chapters FOR EACH ROW EXECUTE FUNCTION novlearn_admin_private.guard_pending_publication_source();
CREATE TRIGGER admin_publication_source_before_write BEFORE UPDATE OR DELETE ON public.competences FOR EACH ROW EXECUTE FUNCTION novlearn_admin_private.guard_pending_publication_source();
CREATE TRIGGER admin_publication_source_before_write BEFORE UPDATE OR DELETE ON public.flashcards FOR EACH ROW EXECUTE FUNCTION novlearn_admin_private.guard_pending_publication_source();

NOTIFY pgrst,'reload schema';
COMMIT;
