-- CDC 7.3: observe the CURRENT target pointer by stable catalogue UUID.
-- Metadata only; no definer, login, membership, mutation or publication grant.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog;
DO $preflight$
DECLARE item record;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='novlearn_active_version_reader') THEN
  RAISE EXCEPTION 'Active-version reader already exists; inspect before application';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='novlearn_pedagogy_reader' AND NOT rolcanlogin AND NOT rolinherit
  AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN
  RAISE EXCEPTION 'Requires the reviewed SQL69 reader baseline';
 END IF;
 IF (SELECT count(*) FROM pg_class WHERE oid IN ('public.exercises'::regclass,'public.exercise_versions'::regclass) AND relrowsecurity)<>2 THEN
  RAISE EXCEPTION 'Both catalogue relations require RLS';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_policy WHERE polrelid IN ('public.exercises'::regclass,'public.exercise_versions'::regclass)
   AND polcmd IN ('r','*') AND 0=ANY(polroles)) THEN
  RAISE EXCEPTION 'Unexpected PUBLIC catalogue SELECT policy';
 END IF;
 FOR item IN SELECT * FROM (VALUES
  ('exercises','id','bigint'),('exercises','catalog_id','uuid'),('exercises','active_version_id','uuid'),
  ('exercises','admin_archived_at','timestamp with time zone'),('exercises','publication_epoch','bigint'),
  ('exercise_versions','id','uuid'),('exercise_versions','exercise_id','bigint'),('exercise_versions','revision','integer'),
  ('exercise_versions','editorial_status','text'),('exercise_versions','published_at','timestamp with time zone'),
  ('exercise_versions','definition_sha256','text'),('exercise_versions','engine_contract','text'),
  ('exercise_versions','generation_version','text'),('exercise_versions','canonicalization_version','text')
 ) AS expected(table_name,column_name,column_type) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=format('public.%I',item.table_name)::regclass
   AND a.attname=item.column_name AND a.attnum>0 AND NOT a.attisdropped AND format_type(a.atttypid,a.atttypmod)=item.column_type) THEN
   RAISE EXCEPTION 'Unexpected catalogue metadata column %.%',item.table_name,item.column_name;
  END IF;
 END LOOP;
END;
$preflight$;
CREATE ROLE novlearn_active_version_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO novlearn_active_version_reader;
GRANT SELECT(id,catalog_id,active_version_id,admin_archived_at,publication_epoch) ON public.exercises TO novlearn_active_version_reader;
GRANT SELECT(id,exercise_id,revision,editorial_status,published_at,definition_sha256,engine_contract,generation_version,canonicalization_version)
 ON public.exercise_versions TO novlearn_active_version_reader;
DO $closed_paths$
BEGIN
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
  WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
   AND has_schema_privilege('novlearn_active_version_reader',n.oid,'USAGE')
   AND has_column_privilege('novlearn_active_version_reader',c.oid,a.attnum,'SELECT'))<>14 OR
  EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND
   ((c.relkind IN ('r','p','v','m','f') AND
    (has_table_privilege('novlearn_active_version_reader',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
     EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      AND has_column_privilege('novlearn_active_version_reader',c.oid,a.attnum,'INSERT,UPDATE,REFERENCES')))) OR
    (c.relkind='S' AND has_sequence_privilege('novlearn_active_version_reader',c.oid,'SELECT,USAGE,UPDATE')))) OR
  has_database_privilege('novlearn_active_version_reader',current_database(),'CREATE,TEMPORARY') OR
  EXISTS(SELECT 1 FROM pg_namespace n WHERE has_schema_privilege('novlearn_active_version_reader',n.oid,'CREATE')) OR
  EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE
   ((n.nspname='pg_catalog' AND p.proname IN ('lo_create','lo_creat','lo_from_bytea','lo_import')
     AND has_function_privilege('novlearn_active_version_reader',p.oid,'EXECUTE')) OR
    (p.prosecdef AND n.nspname !~ '^pg_' AND has_schema_privilege('novlearn_active_version_reader',n.oid,'USAGE')
     AND has_function_privilege('novlearn_active_version_reader',p.oid,'EXECUTE')
     AND NOT(p.oid='public.is_guest()'::regprocedure AND md5(pg_get_functiondef(p.oid))='12a65aed1e8a67a9de23751a793fd2db')))) THEN
  RAISE EXCEPTION 'Unexpected effective read/write/creation/definer capability, including PUBLIC';
 END IF;
END;
$closed_paths$;
CREATE POLICY novlearn_active_version_read_exercises ON public.exercises FOR SELECT TO novlearn_active_version_reader USING(true);
CREATE POLICY novlearn_active_version_read_versions ON public.exercise_versions FOR SELECT TO novlearn_active_version_reader USING(true);
COMMENT ON ROLE novlearn_active_version_reader IS 'Current active target-version metadata only: 14 SELECT columns, no definitions, answers, identities, writes, login or publication. Separate audited physical login required.';
COMMIT;
