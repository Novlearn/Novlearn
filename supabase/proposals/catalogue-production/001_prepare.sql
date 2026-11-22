-- PROPOSAL ONLY. Historical Production, never Staging. No identity association,
-- activation, data cleanup, source journal, or Engine approval is performed here.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('novlearn_catalog_sync.runtime') IS NOT NULL OR
    to_regclass('public.exercise_versions') IS NOT NULL THEN
   RAISE EXCEPTION 'Expected the audited historical schema; reconcile existing capabilities first';
 END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS novlearn_admin_private;
CREATE SCHEMA novlearn_catalog_sync;
CREATE FUNCTION public.is_novlearn_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM public.profiles WHERE id=(SELECT auth.uid()) AND role='admin') $$;
REVOKE ALL ON FUNCTION public.is_novlearn_admin() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.is_novlearn_admin() TO authenticated;
REVOKE ALL ON SCHEMA novlearn_admin_private,novlearn_catalog_sync FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE novlearn_catalog_sync.runtime (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 environment text NOT NULL CHECK(environment='production'),
 enforce_production_sync boolean NOT NULL DEFAULT false
);
INSERT INTO novlearn_catalog_sync.runtime VALUES(true,'production',false);
ALTER TABLE novlearn_catalog_sync.runtime ENABLE ROW LEVEL SECURITY;
CREATE TABLE novlearn_admin_private.publication_runtime (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), enabled boolean NOT NULL DEFAULT false,
 engine_contract text NOT NULL, generation_version text NOT NULL,
 canonicalization_version text NOT NULL, engine_archive_sha256 text NOT NULL
);
INSERT INTO novlearn_admin_private.publication_runtime VALUES
 (true,false,'schema-5;engine-0.1.0','mulberry32-rejection-v1','pg-jsonb-text-v1',
 '6d1d52f38297d6f91be0eaa4aea57eb63f61973eae4cc83d86fd0aa6651dd85a');
ALTER TABLE novlearn_admin_private.publication_runtime ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='novlearn_publication_executor') THEN
  CREATE ROLE novlearn_publication_executor NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='novlearn_publication_writer') THEN
  CREATE ROLE novlearn_publication_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
ALTER TABLE public.exercises ADD COLUMN catalog_id uuid UNIQUE,
 ADD COLUMN active_version_id uuid, ADD COLUMN legacy_version_id uuid,
 ADD COLUMN admin_archived_at timestamptz, ADD COLUMN publication_epoch bigint NOT NULL DEFAULT 0;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['chapters','competences','flashcards'] LOOP
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN catalog_id uuid UNIQUE,
   ADD COLUMN editorial_status text NOT NULL DEFAULT ''draft'' CHECK(editorial_status IN (''draft'',''ready'',''published'',''archived'')),
   ADD COLUMN admin_archived_at timestamptz, ADD COLUMN ready_at timestamptz,
   ADD COLUMN ready_by uuid REFERENCES auth.users(id), ADD COLUMN admin_epoch bigint NOT NULL DEFAULT 0',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['exercises','chapters','competences','flashcards'] LOOP
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN synced_fingerprint_sha256 text
   CHECK(synced_fingerprint_sha256 ~ ''^[0-9a-f]{64}$''), ADD COLUMN synced_at timestamptz',t);
 END LOOP;
END $$;
CREATE TABLE public.exercise_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exercise_id bigint NOT NULL REFERENCES public.exercises(id) ON DELETE RESTRICT,
 revision integer NOT NULL CHECK(revision>=0), definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
 engine_contract text NOT NULL, generation_version text NOT NULL, canonicalization_version text NOT NULL,
 definition_sha256 text NOT NULL CHECK(definition_sha256 ~ '^[0-9a-f]{64}$'),
 approval_fingerprint_sha256 text NOT NULL CHECK(approval_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
 approved_fingerprint_sha256 text, editorial_status text NOT NULL DEFAULT 'draft'
 CHECK(editorial_status IN ('draft','in_review','approved','ready','published','archived')),
 publication_origin text NOT NULL DEFAULT 'local' CHECK(publication_origin IN ('local','transfer','historical')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid REFERENCES auth.users(id), updated_by uuid REFERENCES auth.users(id),
 approved_at timestamptz, approved_by uuid REFERENCES auth.users(id), published_at timestamptz,
 ready_at timestamptz, ready_by uuid REFERENCES auth.users(id), ready_fingerprint_sha256 text,
 test_epoch bigint NOT NULL DEFAULT 0,
 UNIQUE(exercise_id,revision), UNIQUE(exercise_id,id),
 CHECK((publication_origin='historical')=(revision=0)),
 CHECK(publication_origin='local' OR (editorial_status='published' AND approved_at IS NULL AND approved_by IS NULL
 AND approved_fingerprint_sha256 IS NULL AND created_by IS NULL AND updated_by IS NULL)),
 CHECK(editorial_status<>'published' OR published_at IS NOT NULL)
);
CREATE INDEX exercise_versions_parent_status ON public.exercise_versions(exercise_id,editorial_status,revision DESC);
ALTER TABLE public.exercise_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercises ADD CONSTRAINT exercises_active_version_fk FOREIGN KEY(id,active_version_id)
 REFERENCES public.exercise_versions(exercise_id,id) DEFERRABLE INITIALLY DEFERRED,
 ADD CONSTRAINT exercises_legacy_version_fk FOREIGN KEY(id,legacy_version_id)
 REFERENCES public.exercise_versions(exercise_id,id);
ALTER TABLE public.exercise_attempts ADD COLUMN exercise_version_id uuid,
 ADD CONSTRAINT exercise_attempts_version_parent CHECK(exercise_version_id IS NULL OR exercise_id IS NOT NULL),
 ADD CONSTRAINT exercise_attempts_version_fk FOREIGN KEY(exercise_id,exercise_version_id)
 REFERENCES public.exercise_versions(exercise_id,id);
-- No UPDATE of any historical attempt. Unknown means NULL forever.
CREATE TABLE novlearn_admin_private.historical_exercise_snapshots (
 exercise_id bigint PRIMARY KEY REFERENCES public.exercises(id), original jsonb NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'), captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE novlearn_admin_private.historical_exercise_snapshots ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION novlearn_admin_private.historical_projection(p jsonb) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('content',p->'content','title',p->'title','chapter',p->'chapter','difficulty',p->'difficulty',
 'competences',p->'competences','competence_id',p->'competence_id','app_title',p->'app_title',
 'Is_Flash',p->'Is_Flash','Need_Calculator',p->'Need_Calculator') $$;
INSERT INTO novlearn_admin_private.historical_exercise_snapshots(exercise_id,original,fingerprint)
 SELECT id,to_jsonb(e),encode(extensions.digest(convert_to(
 novlearn_admin_private.historical_projection(to_jsonb(e))::text,'UTF8'),'sha256'),'hex') FROM public.exercises e;
REVOKE ALL ON ALL TABLES IN SCHEMA novlearn_admin_private,novlearn_catalog_sync FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION novlearn_admin_private.historical_projection(jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
