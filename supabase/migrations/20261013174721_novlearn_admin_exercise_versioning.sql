-- NovLearn Admin: canonical exercise identity and immutable published versions.
-- Legacy exercises and attempts are deliberately not converted or backfilled.
BEGIN;

ALTER TABLE public.exercises
  ADD COLUMN catalog_id uuid,
  ADD COLUMN active_version_id uuid;

ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_catalog_id_key UNIQUE (catalog_id);

CREATE TABLE public.exercise_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id bigint NOT NULL REFERENCES public.exercises(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  engine_contract text NOT NULL CHECK (length(engine_contract) > 0),
  generation_version text NOT NULL CHECK (length(generation_version) > 0),
  canonicalization_version text NOT NULL CHECK (length(canonicalization_version) > 0),
  definition_sha256 text NOT NULL CHECK (definition_sha256 ~ '^[0-9a-f]{64}$'),
  approval_fingerprint_sha256 text NOT NULL CHECK (approval_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  approved_fingerprint_sha256 text,
  editorial_status text NOT NULL DEFAULT 'draft'
    CHECK (editorial_status IN ('draft', 'in_review', 'approved', 'published')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  CONSTRAINT exercise_versions_revision_key UNIQUE (exercise_id, revision),
  CONSTRAINT exercise_versions_parent_id_key UNIQUE (exercise_id, id),
  CONSTRAINT exercise_versions_approval_fields_check CHECK (
    editorial_status NOT IN ('approved', 'published') OR
    (approved_at IS NOT NULL AND approved_by IS NOT NULL AND
     approved_fingerprint_sha256 = approval_fingerprint_sha256)
  ),
  CONSTRAINT exercise_versions_publication_fields_check CHECK (
    editorial_status <> 'published' OR published_at IS NOT NULL
  )
);
ALTER TABLE public.exercise_versions ENABLE ROW LEVEL SECURITY;

CREATE INDEX exercise_versions_exercise_status_idx
  ON public.exercise_versions (exercise_id, editorial_status, revision DESC);

ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_active_version_fk
  FOREIGN KEY (id, active_version_id)
  REFERENCES public.exercise_versions (exercise_id, id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION public.manage_exercise_version()
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

CREATE TRIGGER exercise_version_manage_before_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.exercise_versions
  FOR EACH ROW EXECUTE FUNCTION public.manage_exercise_version();
REVOKE ALL ON FUNCTION public.manage_exercise_version() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.require_published_active_exercise_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE version_status text;
BEGIN
  IF NEW.active_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT editorial_status INTO version_status
    FROM public.exercise_versions
    WHERE exercise_id = NEW.id AND id = NEW.active_version_id;
  IF version_status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'active exercise version must be published';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER exercises_active_version_before_change
  BEFORE INSERT OR UPDATE OF active_version_id ON public.exercises
  FOR EACH ROW EXECUTE FUNCTION public.require_published_active_exercise_version();
REVOKE ALL ON FUNCTION public.require_published_active_exercise_version() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.exercise_attempts
  ADD COLUMN exercise_version_id uuid,
  ADD CONSTRAINT exercise_attempts_version_requires_exercise_check
    CHECK (exercise_version_id IS NULL OR exercise_id IS NOT NULL),
  ADD CONSTRAINT exercise_attempts_version_exercise_fk
    FOREIGN KEY (exercise_id, exercise_version_id)
    REFERENCES public.exercise_versions (exercise_id, id) ON DELETE RESTRICT;
CREATE INDEX exercise_attempts_version_idx ON public.exercise_attempts (exercise_version_id)
  WHERE exercise_version_id IS NOT NULL;

CREATE FUNCTION public.require_published_attempt_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.exercise_version_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.exercise_versions v
    WHERE v.exercise_id = NEW.exercise_id AND v.id = NEW.exercise_version_id
      AND v.editorial_status = 'published'
  ) THEN
    RAISE EXCEPTION 'attempt must reference a published exercise version';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER exercise_attempt_published_version_before_write
  BEFORE INSERT OR UPDATE OF exercise_id, exercise_version_id
  ON public.exercise_attempts FOR EACH ROW
  EXECUTE FUNCTION public.require_published_attempt_version();
REVOKE ALL ON FUNCTION public.require_published_attempt_version() FROM PUBLIC, anon, authenticated;

COMMIT;
