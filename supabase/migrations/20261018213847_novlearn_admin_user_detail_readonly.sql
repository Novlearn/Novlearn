-- CDC 15.2 / D08: a distinct read-only capability for bounded user detail.
-- No login, password, definition/answer, scoring algorithm or data rewrite.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='novlearn_user_detail_reader') THEN
    RAISE EXCEPTION 'User detail reader already exists; inspect before application';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relrowsecurity AND ((n.nspname='auth' AND c.relname='users') OR
      (n.nspname='public' AND c.relname IN ('profiles','exercise_attempts','duel_attempts','duels',
      'user_progress','user_competence_scores','competences','chapters','exercises'))))<>10 THEN
    RAISE EXCEPTION 'User detail requires the reviewed ten-table RLS baseline';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='public.profiles'::regclass
      AND p.polname='novlearn_users_profile_identity_select' AND NOT p.polpermissive
      AND p.polcmd='r' AND p.polroles=ARRAY[0::oid]
      AND md5(pg_get_expr(p.polqual,p.polrelid))='fc4647e4da8e327c1feaf0d2c911ea33') THEN
    RAISE EXCEPTION 'Expected SQL 66 restrictive profile SELECT policy';
  END IF;
  IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid IN ('public.exercise_attempts'::regclass,'public.duels'::regclass)
      AND p.polname='novlearn_activity_identity_select' AND NOT p.polpermissive
      AND p.polcmd='r' AND p.polroles=ARRAY[0::oid]
      AND md5(pg_get_expr(p.polqual,p.polrelid))='9fa254e7e44c78a6b4364689041cfef3')<>2 THEN
    RAISE EXCEPTION 'Expected SQL 66 restrictive activity SELECT policies';
  END IF;
  IF (SELECT count(*) FROM pg_policy p WHERE
      ((p.polrelid='public.user_progress'::regclass AND p.polname='No guest access to user_progress') OR
       (p.polrelid='public.user_competence_scores'::regclass AND p.polname='No guest access to user_competence_scores'))
      AND NOT p.polpermissive AND p.polcmd='*' AND p.polroles=ARRAY[0::oid]
      AND md5(pg_get_expr(p.polqual,p.polrelid))='a933380f4bba6d03c7b332c244094d0e'
      AND md5(pg_get_expr(p.polwithcheck,p.polrelid))='a933380f4bba6d03c7b332c244094d0e')<>2 THEN
    RAISE EXCEPTION 'Unexpected progression identity policies';
  END IF;
END;
$preflight$;
CREATE ROLE novlearn_user_detail_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA auth,public TO novlearn_user_detail_reader;
GRANT SELECT(id,email,is_anonymous) ON auth.users TO novlearn_user_detail_reader;
GRANT SELECT(id,first_name,last_name) ON public.profiles TO novlearn_user_detail_reader;
GRANT SELECT(id,user_id,exercise_id,is_correct,is_abandoned,attempted_at,exercise_version_id) ON public.exercise_attempts TO novlearn_user_detail_reader;
GRANT SELECT(id,duel_id,player_id,is_correct,submitted_at) ON public.duel_attempts TO novlearn_user_detail_reader;
-- IDs and participants are dependencies of the existing duel-attempt RLS policy.
GRANT SELECT(id,player1_id,player2_id,exercise_id) ON public.duels TO novlearn_user_detail_reader;
GRANT SELECT(id,user_id,chapter,level,exercises_completed,last_activity) ON public.user_progress TO novlearn_user_detail_reader;
GRANT SELECT(user_id,competence_id,points,updated_at) ON public.user_competence_scores TO novlearn_user_detail_reader;
GRANT SELECT(id,name,max_points,chapter_id) ON public.competences TO novlearn_user_detail_reader;
GRANT SELECT(id,name) ON public.chapters TO novlearn_user_detail_reader;
GRANT SELECT(id,title,app_title) ON public.exercises TO novlearn_user_detail_reader;
DO $closed_public_paths$
BEGIN
  IF has_database_privilege('novlearn_user_detail_reader',current_database(),'CREATE,TEMPORARY') OR
     has_schema_privilege('novlearn_user_detail_reader','public','CREATE') OR
     EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='pg_catalog' AND p.proname IN ('lo_create','lo_creat','lo_from_bytea','lo_import')
       AND has_function_privilege('novlearn_user_detail_reader',p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'SQL 65 PUBLIC creation confinement is missing';
  END IF;
END;
$closed_public_paths$;
DO $select_identity$
DECLARE old_using text; old_check text; item text; policy_name text;
BEGIN
  SELECT pg_get_expr(p.polqual,p.polrelid) INTO STRICT old_using FROM pg_policy p
  WHERE p.polrelid='public.profiles'::regclass AND p.polname='novlearn_users_profile_identity_select';
  EXECUTE format('ALTER POLICY novlearn_users_profile_identity_select ON public.profiles USING (current_user=''novlearn_user_detail_reader'' OR (%s))',old_using);
  FOREACH item IN ARRAY ARRAY['exercise_attempts','duels'] LOOP
    SELECT pg_get_expr(p.polqual,p.polrelid) INTO STRICT old_using FROM pg_policy p
    WHERE p.polrelid=format('public.%I',item)::regclass AND p.polname='novlearn_activity_identity_select';
    EXECUTE format('ALTER POLICY novlearn_activity_identity_select ON public.%I USING (current_user=''novlearn_user_detail_reader'' OR (%s))',item,old_using);
  END LOOP;
  FOREACH item IN ARRAY ARRAY['user_progress','user_competence_scores'] LOOP
    policy_name:='No guest access to '||item;
    SELECT pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)
    INTO STRICT old_using,old_check FROM pg_policy p
    WHERE p.polrelid=format('public.%I',item)::regclass AND p.polname=policy_name;
    EXECUTE format('DROP POLICY %I ON public.%I',policy_name,item);
    EXECUTE format('CREATE POLICY novlearn_detail_identity_select ON public.%I AS RESTRICTIVE FOR SELECT TO PUBLIC USING (current_user=''novlearn_user_detail_reader'' OR (%s))',item,old_using);
    EXECUTE format('CREATE POLICY novlearn_detail_identity_insert ON public.%I AS RESTRICTIVE FOR INSERT TO PUBLIC WITH CHECK (%s)',item,old_check);
    EXECUTE format('CREATE POLICY novlearn_detail_identity_update ON public.%I AS RESTRICTIVE FOR UPDATE TO PUBLIC USING (%s) WITH CHECK (%s)',item,old_using,old_check);
    EXECUTE format('CREATE POLICY novlearn_detail_identity_delete ON public.%I AS RESTRICTIVE FOR DELETE TO PUBLIC USING (%s)',item,old_using);
  END LOOP;
END;
$select_identity$;
DO $read_policies$
DECLARE item text;
BEGIN
  CREATE POLICY novlearn_detail_read_auth ON auth.users FOR SELECT TO novlearn_user_detail_reader USING (true);
  FOREACH item IN ARRAY ARRAY['profiles','exercise_attempts','duel_attempts','duels','user_progress',
    'user_competence_scores','competences','chapters','exercises'] LOOP
    EXECUTE format('CREATE POLICY novlearn_detail_read ON public.%I FOR SELECT TO novlearn_user_detail_reader USING (true)',item);
  END LOOP;
END;
$read_policies$;
COMMENT ON ROLE novlearn_user_detail_reader IS 'CDC 15.2 / D08: nominal identity, recorded progression and attempt metadata only. No login, writes, Auth secrets, birth date, answers, definitions, private instances, reports or publication. Historical verdicts/progression are not Engine-certified. Fresh Admin authorization and effective-role audit required.';
COMMIT;
