-- D08: bounded nominal lookup; independent from the aggregate-only capability.
-- No login, credential, function, data backfill, write or publication grant.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='novlearn_users_reader') THEN
    RAISE EXCEPTION 'Users reader already exists; inspect before application';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relrowsecurity AND ((n.nspname='auth' AND c.relname='users') OR
      (n.nspname='public' AND c.relname IN ('profiles','exercise_attempts','duel_attempts','duels'))))<>5 THEN
    RAISE EXCEPTION 'Users reader requires the reviewed five-table RLS baseline';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='public.profiles'::regclass
      AND p.polname='novlearn_profiles_require_permanent_identity' AND NOT p.polpermissive
      AND p.polcmd='*' AND p.polroles=ARRAY[0::oid]
      AND md5(pg_get_expr(p.polqual,p.polrelid))='a933380f4bba6d03c7b332c244094d0e'
      AND md5(pg_get_expr(p.polwithcheck,p.polrelid))='a933380f4bba6d03c7b332c244094d0e') THEN
    RAISE EXCEPTION 'Unexpected profile identity policy';
  END IF;
  IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid IN ('public.exercise_attempts'::regclass,'public.duels'::regclass)
      AND p.polname='novlearn_activity_identity_select' AND NOT p.polpermissive
      AND p.polcmd='r' AND p.polroles=ARRAY[0::oid]
      AND md5(pg_get_expr(p.polqual,p.polrelid))='f9a490b0e2868a69aef73bf0e100c02c')<>2 THEN
    RAISE EXCEPTION 'Expected SQL 65 restrictive SELECT policies';
  END IF;
END;
$preflight$;
CREATE ROLE novlearn_users_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA auth,public TO novlearn_users_reader;
GRANT SELECT(id,email,is_anonymous) ON auth.users TO novlearn_users_reader;
GRANT SELECT(id,first_name,last_name) ON public.profiles TO novlearn_users_reader;
GRANT SELECT(user_id,attempted_at) ON public.exercise_attempts TO novlearn_users_reader;
GRANT SELECT(duel_id,player_id,submitted_at) ON public.duel_attempts TO novlearn_users_reader;
-- Existing duel-attempt SELECT policy references these three columns.
GRANT SELECT(id,player1_id,player2_id) ON public.duels TO novlearn_users_reader;
DO $closed_public_paths$
BEGIN
  IF has_database_privilege('novlearn_users_reader',current_database(),'CREATE,TEMPORARY') OR
     has_schema_privilege('novlearn_users_reader','public','CREATE') OR
     EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='pg_catalog' AND p.proname IN ('lo_create','lo_creat','lo_from_bytea','lo_import')
       AND has_function_privilege('novlearn_users_reader',p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'SQL 65 PUBLIC creation confinement is missing';
  END IF;
END;
$closed_public_paths$;
DO $select_only_identity$
DECLARE old_using text; old_check text; item text;
BEGIN
  SELECT pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)
  INTO STRICT old_using,old_check FROM pg_policy p WHERE p.polrelid='public.profiles'::regclass
    AND p.polname='novlearn_profiles_require_permanent_identity';
  DROP POLICY novlearn_profiles_require_permanent_identity ON public.profiles;
  EXECUTE format('CREATE POLICY novlearn_users_profile_identity_select ON public.profiles AS RESTRICTIVE FOR SELECT TO PUBLIC USING (current_user=''novlearn_users_reader'' OR (%s))',old_using);
  EXECUTE format('CREATE POLICY novlearn_users_profile_identity_insert ON public.profiles AS RESTRICTIVE FOR INSERT TO PUBLIC WITH CHECK (%s)',old_check);
  EXECUTE format('CREATE POLICY novlearn_users_profile_identity_update ON public.profiles AS RESTRICTIVE FOR UPDATE TO PUBLIC USING (%s) WITH CHECK (%s)',old_using,old_check);
  EXECUTE format('CREATE POLICY novlearn_users_profile_identity_delete ON public.profiles AS RESTRICTIVE FOR DELETE TO PUBLIC USING (%s)',old_using);
  FOREACH item IN ARRAY ARRAY['exercise_attempts','duels'] LOOP
    SELECT pg_get_expr(p.polqual,p.polrelid) INTO STRICT old_using FROM pg_policy p
    WHERE p.polrelid=format('public.%I',item)::regclass AND p.polname='novlearn_activity_identity_select';
    EXECUTE format('ALTER POLICY novlearn_activity_identity_select ON public.%I USING (current_user=''novlearn_users_reader'' OR (%s))',item,old_using);
  END LOOP;
END;
$select_only_identity$;
CREATE POLICY novlearn_users_read_auth ON auth.users FOR SELECT TO novlearn_users_reader USING (true);
CREATE POLICY novlearn_users_read_profiles ON public.profiles FOR SELECT TO novlearn_users_reader USING (true);
CREATE POLICY novlearn_users_read_exercises ON public.exercise_attempts FOR SELECT TO novlearn_users_reader USING (true);
CREATE POLICY novlearn_users_read_duel_attempts ON public.duel_attempts FOR SELECT TO novlearn_users_reader USING (true);
CREATE POLICY novlearn_users_read_duels ON public.duels FOR SELECT TO novlearn_users_reader USING (true);
COMMENT ON ROLE novlearn_users_reader IS 'D08 names, Auth email and dated activity inputs only. No login, writes, secrets, answers, profile birth date or publication. Fresh Admin authorization and effective-role audit required.';
COMMIT;
