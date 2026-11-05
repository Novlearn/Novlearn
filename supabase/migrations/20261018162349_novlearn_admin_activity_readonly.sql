-- Canonical local migration for the reviewed Admin aggregate input role.
-- Remote application and login provisioning require separate qualification/approval.
-- No account, membership, password, data backfill or privileged definer is added.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $preflight$
DECLARE item record;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='novlearn_activity_reader') THEN
    RAISE EXCEPTION 'Activity reader role already exists; review its origin before application';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relrowsecurity AND ((n.nspname='auth' AND c.relname='users') OR
      (n.nspname='public' AND c.relname IN ('exercise_attempts','duel_attempts','duels'))))<>4 THEN
    RAISE EXCEPTION 'Activity reader requires the reviewed RLS table baseline';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='auth' AND tablename='users') THEN
    RAISE EXCEPTION 'Unexpected Auth policies; review before adding the bounded reader';
  END IF;
  FOR item IN SELECT * FROM (VALUES
      ('exercise_attempts','No guest access to exercise_attempts'),
      ('duels','No guest access to duels')) AS x(table_name,policy_name)
  LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=format('public.%I',item.table_name)::regclass
      AND p.polname=item.policy_name AND NOT p.polpermissive AND p.polcmd='*' AND p.polroles=ARRAY[0::oid]
      AND md5(pg_get_expr(p.polqual,p.polrelid))='a933380f4bba6d03c7b332c244094d0e'
      AND md5(pg_get_expr(p.polwithcheck,p.polrelid))='a933380f4bba6d03c7b332c244094d0e') THEN
      RAISE EXCEPTION 'Unexpected restrictive identity policy on %',item.table_name;
    END IF;
  END LOOP;
END;
$preflight$;

CREATE ROLE novlearn_activity_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA auth,public TO novlearn_activity_reader;
GRANT SELECT(id,created_at,is_anonymous) ON auth.users TO novlearn_activity_reader;
GRANT SELECT(user_id,attempted_at,is_correct,is_abandoned) ON public.exercise_attempts TO novlearn_activity_reader;
-- duel_id and the duel identity/participant columns are also referenced by the
-- unchanged legacy PUBLIC SELECT policy; grant its minimal RLS dependencies.
GRANT SELECT(duel_id,player_id,submitted_at) ON public.duel_attempts TO novlearn_activity_reader;
GRANT SELECT(id,player1_id,player2_id,status,finished_at) ON public.duels TO novlearn_activity_reader;

-- A PUBLIC grant is inherited even by NOINHERIT roles. Preserve the established
-- API client grants while excluding this new reader from profile projections.
REVOKE EXECUTE ON FUNCTION public.get_monthly_leaderboard(timestamptz,integer,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_weekly_leaderboard(timestamptz,integer,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_success_rate_leaderboard(timestamptz,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_monthly_leaderboard(timestamptz,integer,text) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_weekly_leaderboard(timestamptz,integer,text) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_success_rate_leaderboard(timestamptz,integer,integer) TO anon,authenticated,service_role;

-- Bound PUBLIC creation paths as well as application DML. NOINHERIT cannot
-- exclude PUBLIC. Keep the exact effective grants of every preexisting role;
-- the new reader and future roles require explicit provisioning instead.
DO $public_creation_paths$
DECLARE recipients text; item record; db_oid oid;
BEGIN
  SELECT string_agg(quote_ident(rolname),', ' ORDER BY rolname) INTO STRICT recipients
  FROM pg_roles WHERE rolname<>'novlearn_activity_reader';
  SELECT oid INTO STRICT db_oid FROM pg_database WHERE datname=current_database();
  IF EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL
      aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
      WHERE d.oid=db_oid AND a.grantee=0 AND a.privilege_type='TEMPORARY') THEN
    EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO %s',current_database(),recipients);
    EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC',current_database());
  END IF;
  FOR item IN SELECT p.oid::regprocedure::text AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='pg_catalog' AND p.proname IN ('lo_create','lo_creat','lo_from_bytea','lo_import')
      AND EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s',item.signature,recipients);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC',item.signature);
  END LOOP;
END;
$public_creation_paths$;

DO $identity_policies$
DECLARE item record; old_using text; old_check text;
BEGIN
  FOR item IN SELECT * FROM (VALUES
      ('exercise_attempts','No guest access to exercise_attempts'),
      ('duels','No guest access to duels')) AS x(table_name,policy_name)
  LOOP
    SELECT pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)
    INTO STRICT old_using,old_check FROM pg_policy p
    WHERE p.polrelid=format('public.%I',item.table_name)::regclass AND p.polname=item.policy_name;
    EXECUTE format('DROP POLICY %I ON public.%I',item.policy_name,item.table_name);
    -- Only SELECT gains an exception for the physical SQL role. Every original
    -- mutation predicate is copied exactly, including PUBLIC/guest restrictions.
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO PUBLIC USING (current_user=''novlearn_activity_reader'' OR (%s))',
      'novlearn_activity_identity_select',item.table_name,old_using);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO PUBLIC WITH CHECK (%s)',
      'novlearn_activity_identity_insert',item.table_name,old_check);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO PUBLIC USING (%s) WITH CHECK (%s)',
      'novlearn_activity_identity_update',item.table_name,old_using,old_check);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO PUBLIC USING (%s)',
      'novlearn_activity_identity_delete',item.table_name,old_using);
  END LOOP;
END;
$identity_policies$;

CREATE POLICY novlearn_activity_read_auth ON auth.users FOR SELECT TO novlearn_activity_reader USING (true);
CREATE POLICY novlearn_activity_read_exercises ON public.exercise_attempts FOR SELECT TO novlearn_activity_reader USING (true);
CREATE POLICY novlearn_activity_read_duel_attempts ON public.duel_attempts FOR SELECT TO novlearn_activity_reader USING (true);
CREATE POLICY novlearn_activity_read_duels ON public.duels FOR SELECT TO novlearn_activity_reader USING (true);
COMMENT ON ROLE novlearn_activity_reader IS 'Admin aggregate source columns only; no login, writes, nominal profile fields, privileged definer or publication capability. Provisioning and effective-role audit required separately.';
COMMIT;
