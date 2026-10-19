-- Consolidate the SELECT alternatives introduced by SQL 65, 66 and 67.
-- Each old PUBLIC predicate is retained for all other physical roles.
-- No grants, roles, restrictive/write policies, functions or data are changed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog;
DO $consolidate$
DECLARE entry record; idx integer; role_oid oid; old_using text;
BEGIN
  IF (SELECT count(*) FROM pg_roles r WHERE r.rolname IN
      ('novlearn_activity_reader','novlearn_users_reader','novlearn_user_detail_reader')
      AND NOT r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper
      AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
      AND NOT r.rolbypassrls
      AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid))<>3 THEN
    RAISE EXCEPTION 'Expected the three SQL 65/66/67 isolated nominal readers';
  END IF;
  -- Pin every input before changing any policy. pg_get_expr is stable here
  -- because search_path is fixed; schema-qualified subqueries are retained.
  FOR entry IN SELECT * FROM (VALUES
    ('chapters','Public read chapters','b326b5062b2f0e69046810717534cb09',
      ARRAY['novlearn_user_detail_reader'],ARRAY['novlearn_detail_read']),
    ('competences','Public read competences','b326b5062b2f0e69046810717534cb09',
      ARRAY['novlearn_user_detail_reader'],ARRAY['novlearn_detail_read']),
    ('exercise_attempts','L''utilisateur voit ses tentatives','ff452c766f1dd1d84c376129b36406c1',
      ARRAY['novlearn_activity_reader','novlearn_users_reader','novlearn_user_detail_reader'],
      ARRAY['novlearn_activity_read_exercises','novlearn_users_read_exercises','novlearn_detail_read']),
    ('duel_attempts','Voir les tentatives de son duel','8d082d276f7f974740c397409b44b291',
      ARRAY['novlearn_activity_reader','novlearn_users_reader','novlearn_user_detail_reader'],
      ARRAY['novlearn_activity_read_duel_attempts','novlearn_users_read_duel_attempts','novlearn_detail_read']),
    ('duels','Voir ses duels','261a9decbb56f76808e95a35223eee56',
      ARRAY['novlearn_activity_reader','novlearn_users_reader','novlearn_user_detail_reader'],
      ARRAY['novlearn_activity_read_duels','novlearn_users_read_duels','novlearn_detail_read']),
    ('user_progress','L''utilisateur voit sa progression','ff452c766f1dd1d84c376129b36406c1',
      ARRAY['novlearn_user_detail_reader'],ARRAY['novlearn_detail_read']),
    ('user_competence_scores','Users can read own competence scores','ff452c766f1dd1d84c376129b36406c1',
      ARRAY['novlearn_user_detail_reader'],ARRAY['novlearn_detail_read'])
  ) AS inputs(table_name,public_policy,using_md5,readers,policies) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=format('public.%I',entry.table_name)::regclass
        AND c.relkind='r' AND c.relrowsecurity) OR
       NOT EXISTS(SELECT 1 FROM pg_policy p
        WHERE p.polrelid=format('public.%I',entry.table_name)::regclass
        AND p.polname=entry.public_policy AND p.polcmd='r' AND p.polpermissive
        AND p.polroles=ARRAY[0::oid] AND p.polwithcheck IS NULL
        AND md5(pg_get_expr(p.polqual,p.polrelid))=entry.using_md5) OR
       (SELECT count(*) FROM pg_policy p
        WHERE p.polrelid=format('public.%I',entry.table_name)::regclass
        AND p.polcmd IN ('r','*') AND p.polpermissive AND 0=ANY(p.polroles))<>1 THEN
      RAISE EXCEPTION 'Unexpected PUBLIC SELECT baseline for %',entry.table_name;
    END IF;
    FOR idx IN 1..cardinality(entry.readers) LOOP
      SELECT oid INTO STRICT role_oid FROM pg_roles WHERE rolname=entry.readers[idx];
      IF NOT EXISTS(SELECT 1 FROM pg_policy p
          WHERE p.polrelid=format('public.%I',entry.table_name)::regclass
          AND p.polname=entry.policies[idx] AND p.polcmd='r' AND p.polpermissive
          AND p.polroles=ARRAY[role_oid] AND p.polwithcheck IS NULL
          AND pg_get_expr(p.polqual,p.polrelid)='true') OR
         (SELECT count(*) FROM pg_policy p
          WHERE p.polrelid=format('public.%I',entry.table_name)::regclass
          AND p.polcmd IN ('r','*') AND p.polpermissive AND role_oid=ANY(p.polroles))<>1 THEN
        RAISE EXCEPTION 'Unexpected reader SELECT baseline for % / %',entry.table_name,entry.readers[idx];
      END IF;
    END LOOP;
  END LOOP;
  FOR entry IN SELECT * FROM (VALUES
    ('chapters','Public read chapters',ARRAY['novlearn_user_detail_reader'],ARRAY['novlearn_detail_read']),
    ('competences','Public read competences',ARRAY['novlearn_user_detail_reader'],ARRAY['novlearn_detail_read']),
    ('exercise_attempts','L''utilisateur voit ses tentatives',
      ARRAY['novlearn_activity_reader','novlearn_users_reader','novlearn_user_detail_reader'],
      ARRAY['novlearn_activity_read_exercises','novlearn_users_read_exercises','novlearn_detail_read']),
    ('duel_attempts','Voir les tentatives de son duel',
      ARRAY['novlearn_activity_reader','novlearn_users_reader','novlearn_user_detail_reader'],
      ARRAY['novlearn_activity_read_duel_attempts','novlearn_users_read_duel_attempts','novlearn_detail_read']),
    ('duels','Voir ses duels',
      ARRAY['novlearn_activity_reader','novlearn_users_reader','novlearn_user_detail_reader'],
      ARRAY['novlearn_activity_read_duels','novlearn_users_read_duels','novlearn_detail_read']),
    ('user_progress','L''utilisateur voit sa progression',ARRAY['novlearn_user_detail_reader'],ARRAY['novlearn_detail_read']),
    ('user_competence_scores','Users can read own competence scores',ARRAY['novlearn_user_detail_reader'],ARRAY['novlearn_detail_read'])
  ) AS inputs(table_name,public_policy,readers,policies) LOOP
    SELECT pg_get_expr(p.polqual,p.polrelid) INTO STRICT old_using FROM pg_policy p
      WHERE p.polrelid=format('public.%I',entry.table_name)::regclass AND p.polname=entry.public_policy;
    IF old_using<>'true' THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (CURRENT_USER=ANY(%L::name[]) OR (%s))',
        entry.public_policy,entry.table_name,entry.readers::text,old_using);
    END IF;
    FOR idx IN 1..cardinality(entry.policies) LOOP
      EXECUTE format('DROP POLICY %I ON public.%I',entry.policies[idx],entry.table_name);
    END LOOP;
  END LOOP;
END;
$consolidate$;
COMMIT;
