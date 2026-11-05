-- Local Lot 1A hardening. Requires consumer/schema review before remote use.
-- No historical rows, roles, IDs or exercise contents are changed.
BEGIN;

DO $preconditions$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
    JOIN pg_catalog.pg_depend d ON d.refobjid = e.oid
      AND d.refclassid = 'pg_catalog.pg_extension'::regclass
      AND d.classid = 'pg_catalog.pg_proc'::regclass AND d.deptype = 'e'
    WHERE e.extname = 'pgcrypto' AND n.nspname = 'extensions'
      AND d.objid = to_regprocedure('extensions.digest(bytea,text)')) THEN
    RAISE EXCEPTION 'Lot 1A requires real pgcrypto digest in schema extensions';
  END IF;
END;
$preconditions$;

-- A permissive FOR ALL policy is ORed with ownership policies and bypasses them.
DROP POLICY IF EXISTS "No guest access to profiles" ON public.profiles;
CREATE POLICY novlearn_profiles_require_permanent_identity
  ON public.profiles AS RESTRICTIVE FOR ALL TO PUBLIC
  USING ((SELECT auth.uid()) IS NOT NULL AND
    NOT COALESCE(((SELECT auth.jwt())->>'is_anonymous')::boolean, false))
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND
    NOT COALESCE(((SELECT auth.jwt())->>'is_anonymous')::boolean, false));

CREATE POLICY novlearn_profiles_insert_self_user
  ON public.profiles AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()) AND role = 'user');
CREATE POLICY novlearn_profiles_update_self
  ON public.profiles AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- Profile deletion is performed only by the existing trusted account endpoint.
REVOKE DELETE ON public.profiles FROM PUBLIC, anon, authenticated;
CREATE POLICY novlearn_profiles_no_client_delete
  ON public.profiles AS RESTRICTIVE FOR DELETE TO PUBLIC USING (false);

-- Invoker trigger: current_user is the actual SQL writer, not a client claim.
-- Trusted Auth/service functions retain their existing provisioning paths.
CREATE FUNCTION public.protect_novlearn_profile_role()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' AND NEW.role IS DISTINCT FROM 'user' THEN
      RAISE EXCEPTION 'client cannot assign profile role' USING ERRCODE = '42501';
    ELSIF TG_OP = 'UPDATE' AND
      (NEW.role IS DISTINCT FROM OLD.role OR NEW.id IS DISTINCT FROM OLD.id) THEN
      RAISE EXCEPTION 'client cannot change profile role or identity' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER novlearn_profile_role_before_write
  BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW
  EXECUTE FUNCTION public.protect_novlearn_profile_role();
REVOKE ALL ON FUNCTION public.protect_novlearn_profile_role() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_novlearn_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND NOT COALESCE(((SELECT auth.jwt())->>'is_anonymous')::boolean, false)
    AND EXISTS (SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin');
$function$;
REVOKE ALL ON FUNCTION public.is_novlearn_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_novlearn_admin() TO authenticated;

-- Preserve the intended guest exclusion without giving it permission to write
-- every row. Only the specifically named legacy guest policies are replaced.
DO $policies$
DECLARE p record;
BEGIN
  FOR p IN SELECT tablename, policyname, qual FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND permissive = 'PERMISSIVE' AND cmd = 'ALL'
      AND policyname LIKE 'No guest access to %'
  LOOP
    IF p.qual IS NULL OR p.qual NOT IN ('(NOT is_guest())', '(NOT public.is_guest())') THEN
      RAISE EXCEPTION 'unexpected legacy guest predicate on %.%: review before migration', p.tablename, p.policyname;
    END IF;
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO PUBLIC
      USING ((SELECT auth.uid()) IS NOT NULL AND
        NOT COALESCE(((SELECT auth.jwt())->>''is_anonymous'')::boolean, false))
      WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND
        NOT COALESCE(((SELECT auth.jwt())->>''is_anonymous'')::boolean, false))',
      p.policyname, p.tablename);
  END LOOP;
END;
$policies$;

-- The browser cannot create or retarget a canonical attempt. Its official
-- version binding must be written by the trusted grading service.
CREATE FUNCTION public.protect_novlearn_attempt_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND
    ((TG_OP = 'INSERT' AND NEW.exercise_version_id IS NOT NULL) OR
     (TG_OP = 'UPDATE' AND (OLD.exercise_version_id IS NOT NULL OR
       NEW.exercise_version_id IS NOT NULL))) THEN
    RAISE EXCEPTION 'canonical attempts are server-owned' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER novlearn_attempt_version_before_write
  BEFORE INSERT OR UPDATE ON public.exercise_attempts FOR EACH ROW
  EXECUTE FUNCTION public.protect_novlearn_attempt_version();
REVOKE ALL ON FUNCTION public.protect_novlearn_attempt_version() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.require_novlearn_attempt_instance_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.exercise_attempts a
    JOIN public.exercise_versions v ON v.id = a.exercise_version_id AND v.exercise_id = a.exercise_id
    WHERE a.id = NEW.attempt_id AND v.editorial_status = 'published'
      AND v.generation_version = NEW.generation_version) THEN
    RAISE EXCEPTION 'private instance requires a matching published attempt version';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER novlearn_attempt_instance_before_write
  BEFORE INSERT OR UPDATE ON public.exercise_attempt_instances FOR EACH ROW
  EXECUTE FUNCTION public.require_novlearn_attempt_instance_version();
REVOKE ALL ON FUNCTION public.require_novlearn_attempt_instance_version() FROM PUBLIC, anon, authenticated;

-- Explicit server capabilities; no dependency on project-wide default grants.
GRANT SELECT, INSERT, UPDATE ON public.exercise_versions TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.exercise_attempt_instances,
  public.exercise_attempt_replay_artifacts, public.duel_exercise_instances TO service_role;
REVOKE DELETE, TRUNCATE ON public.exercise_versions, public.exercise_attempt_instances,
  public.exercise_attempt_replay_artifacts, public.duel_exercise_instances FROM service_role;

-- Social profile reads and legacy exercise delivery are deliberately not
-- silently broken here. Their privacy transition remains a Lot 1A gate.
COMMIT;
