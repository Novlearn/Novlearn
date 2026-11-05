-- CDC 6.3/6.4/15.1: distinct metadata-only aggregate input capability.
-- No login, membership, answer/definition, privileged definer or data rewrite.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog;
DO $preflight$
DECLARE item record;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='novlearn_pedagogy_reader') THEN
   RAISE EXCEPTION 'Pedagogy reader already exists; inspect before application';
 END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.relrowsecurity AND ((n.nspname='auth' AND c.relname='users') OR
     (n.nspname='public' AND c.relname IN ('exercise_attempts','duel_attempts','duels','exercises','chapters','competences'))))<>7 THEN
   RAISE EXCEPTION 'Pedagogy reader requires the reviewed seven-table RLS baseline';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='auth.users'::regclass AND p.polroles=ARRAY[0::oid]) THEN
   RAISE EXCEPTION 'Unexpected public Auth policy';
 END IF;
 FOR item IN SELECT * FROM (VALUES
    ('exercise_attempts','L''utilisateur voit ses tentatives',true,'ea846f6d321059d5051d01ba822b5f14'),
    ('duel_attempts','Voir les tentatives de son duel',true,'c84cde7b2a6e4f26bf8358953e36a4c0'),
    ('duels','Voir ses duels',true,'5a844e66a14695d885ada2366d6fe933'),
    ('exercise_attempts','novlearn_activity_identity_select',false,'6e3ff0c219317620267fb7155629e851'),
    ('duels','novlearn_activity_identity_select',false,'6e3ff0c219317620267fb7155629e851')
 ) AS expected(table_name,policy_name,permissive,using_md5) LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=format('public.%I',item.table_name)::regclass
     AND p.polname=item.policy_name AND p.polcmd='r' AND p.polpermissive=item.permissive
     AND p.polroles=ARRAY[0::oid] AND p.polwithcheck IS NULL
     AND md5(pg_get_expr(p.polqual,p.polrelid))=item.using_md5) THEN
       RAISE EXCEPTION 'Expected SQL68 policy % / %',item.table_name,item.policy_name;
   END IF;
   IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid=format('public.%I',item.table_name)::regclass
       AND p.polcmd IN ('r','*') AND p.polroles=ARRAY[0::oid] AND p.polpermissive=item.permissive)<>1 THEN
     RAISE EXCEPTION 'Unexpected alternative PUBLIC SELECT policy';
   END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid IN ('public.chapters'::regclass,'public.competences'::regclass)
     AND p.polcmd='r' AND p.polpermissive AND p.polroles=ARRAY[0::oid]
     AND pg_get_expr(p.polqual,p.polrelid)='true' AND p.polwithcheck IS NULL)<>2 THEN
   RAISE EXCEPTION 'Expected public taxonomy SELECT policies';
 END IF;
END;
$preflight$;
CREATE ROLE novlearn_pedagogy_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA auth,public TO novlearn_pedagogy_reader;
GRANT SELECT(id) ON auth.users TO novlearn_pedagogy_reader;
GRANT SELECT(id,exercise_id,user_id,attempted_at,is_correct,is_abandoned) ON public.exercise_attempts TO novlearn_pedagogy_reader;
GRANT SELECT(id,duel_id,player_id,submitted_at,is_correct) ON public.duel_attempts TO novlearn_pedagogy_reader;
-- Participant columns are dependencies of the unchanged historical duel RLS.
GRANT SELECT(id,exercise_id,player1_id,player2_id,status,finished_at) ON public.duels TO novlearn_pedagogy_reader;
GRANT SELECT(id,title,app_title,chapter,difficulty,competences,competence_id,"Is_Flash") ON public.exercises TO novlearn_pedagogy_reader;
GRANT SELECT(id,name,aliases) ON public.chapters TO novlearn_pedagogy_reader;
GRANT SELECT(id,name,chapter_id) ON public.competences TO novlearn_pedagogy_reader;
DO $closed_paths$
BEGIN
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
     WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
       AND has_schema_privilege('novlearn_pedagogy_reader',n.oid,'USAGE')
       AND has_column_privilege('novlearn_pedagogy_reader',c.oid,a.attnum,'SELECT'))<>32 OR
   EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
       AND ((c.relkind IN ('r','p','v','m','f') AND (
         has_table_privilege('novlearn_pedagogy_reader',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
         EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
           AND has_column_privilege('novlearn_pedagogy_reader',c.oid,a.attnum,'INSERT,UPDATE,REFERENCES')))) OR
         (c.relkind='S' AND has_sequence_privilege('novlearn_pedagogy_reader',c.oid,'SELECT,USAGE,UPDATE')))) OR
   has_database_privilege('novlearn_pedagogy_reader',current_database(),'CREATE,TEMPORARY') OR
   EXISTS(SELECT 1 FROM pg_namespace n WHERE has_schema_privilege('novlearn_pedagogy_reader',n.oid,'CREATE')) OR
   EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE
     ((n.nspname='pg_catalog' AND p.proname IN ('lo_create','lo_creat','lo_from_bytea','lo_import')) OR
      (p.prosecdef AND n.nspname !~ '^pg_' AND has_schema_privilege('novlearn_pedagogy_reader',n.oid,'USAGE')
        AND NOT (p.oid='public.is_guest()'::regprocedure AND md5(pg_get_functiondef(p.oid))='12a65aed1e8a67a9de23751a793fd2db')))
     AND has_function_privilege('novlearn_pedagogy_reader',p.oid,'EXECUTE')) THEN
   RAISE EXCEPTION 'Pedagogy reader effective confinement is missing';
 END IF;
END;
$closed_paths$;
DO $select_only$
DECLARE item record; old_using text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
    ('exercise_attempts','L''utilisateur voit ses tentatives'),
    ('duel_attempts','Voir les tentatives de son duel'),
    ('duels','Voir ses duels'),
    ('exercise_attempts','novlearn_activity_identity_select'),
    ('duels','novlearn_activity_identity_select')
 ) AS inputs(table_name,policy_name) LOOP
   SELECT pg_get_expr(p.polqual,p.polrelid) INTO STRICT old_using FROM pg_policy p
     WHERE p.polrelid=format('public.%I',item.table_name)::regclass AND p.polname=item.policy_name;
   EXECUTE format('ALTER POLICY %I ON public.%I USING (CURRENT_USER=''novlearn_pedagogy_reader'' OR (%s))',item.policy_name,item.table_name,old_using);
 END LOOP;
END;
$select_only$;
CREATE POLICY novlearn_pedagogy_read_auth ON auth.users FOR SELECT TO novlearn_pedagogy_reader USING (true);
CREATE POLICY novlearn_pedagogy_read_exercises ON public.exercises FOR SELECT TO novlearn_pedagogy_reader USING (true);
COMMENT ON ROLE novlearn_pedagogy_reader IS 'Admin pedagogy aggregate source columns only; no nominal identities, definitions, answers, writes, login or publication. Effective-role audit and separately qualified provisioning required.';
COMMIT;
