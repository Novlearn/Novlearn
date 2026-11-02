-- Technical import of the existing Staging catalogue. This is not human approval.
-- No role membership, public RPC, publication capability or receipt is granted.
BEGIN;
CREATE TABLE novlearn_admin_private.engine_legacy_imports (
  exercise_id bigint PRIMARY KEY REFERENCES public.exercises(id),
  project_ref text NOT NULL CHECK(project_ref='tksvbkvfusrnxulpahky'),
  source_sha256 text NOT NULL CHECK(source_sha256='806067c4383e7b497ae74262de595ede92e605c910aeac8527b93982d911cd5e'),
  original_sha256 text NOT NULL CHECK(original_sha256~'^[a-f0-9]{64}$'),
  definition_sha256 text NOT NULL CHECK(definition_sha256~'^[a-f0-9]{64}$'),
  engine_archive_sha256 text NOT NULL CHECK(engine_archive_sha256='791c6472fc87ba0559d8889cf3f4482ab5466def49eec9e418ddbc2c7278f3ea'),
  qualification_sha256 text NOT NULL CHECK(qualification_sha256~'^[a-f0-9]{64}$'),
  qualified_seeds bigint[] NOT NULL CHECK(qualified_seeds=ARRAY[0,1,42,123,4294967295]::bigint[]),
  imported_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE novlearn_admin_private.engine_legacy_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON novlearn_admin_private.engine_legacy_imports FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE novlearn_admin_private.engine_legacy_imports IS
  'Private technical migration manifest; fingerprints of qualified existing Staging content, not editorial approval.';

DO $migration$
DECLARE definition text; admission text;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.manage_exercise_version()'::regprocedure)
      <>'dcb4721348165cf28fa833903d8c3236' THEN
   RAISE EXCEPTION 'Version trigger changed; review migration before applying';
 END IF;
 definition:=pg_get_functiondef('public.manage_exercise_version()'::regprocedure);
 admission:=$admission$
  -- Single-use import admission for the qualified historical parent. Normal
  -- writer transfers and local editorial approval keep their existing checks.
  IF TG_OP='INSERT' AND NEW.publication_origin='transfer' AND current_user='postgres' THEN
    IF NOT EXISTS (
      SELECT 1 FROM novlearn_admin_private.engine_legacy_imports m
      JOIN public.exercises p ON p.id=m.exercise_id
      JOIN novlearn_admin_private.publication_runtime r ON r.singleton
      WHERE m.exercise_id=NEW.exercise_id AND p.catalog_id IS NULL
        AND p.active_version_id IS NULL AND p.admin_archived_at IS NULL
        AND NOT r.enabled AND r.engine_archive_sha256=m.engine_archive_sha256
        AND NEW.engine_contract=r.engine_contract AND NEW.generation_version=r.generation_version
        AND NEW.canonicalization_version=r.canonicalization_version AND NEW.revision=1
        AND NEW.definition->'schemaVersion'='5'::jsonb AND NEW.definition->>'kind'='composed'
        AND NEW.definition->>'revision'='1'
        AND NEW.definition->'extensions'->'legacy'->>'adapterVersion'='staging-catalogue-reviewed-v1'
        AND ((NEW.definition->'extensions'->'legacy'->'original')-'created_at')=(to_jsonb(p)-'created_at')
        AND m.original_sha256=encode(extensions.digest(convert_to(
          (NEW.definition->'extensions'->'legacy'->'original')::text,'UTF8'),'sha256'),'hex')
        AND m.definition_sha256=encode(extensions.digest(convert_to(NEW.definition::text,'UTF8'),'sha256'),'hex')
        AND NOT EXISTS(SELECT 1 FROM public.exercise_versions v WHERE v.exercise_id=p.id)
    ) THEN
      RAISE EXCEPTION 'Qualified historical Staging import required' USING ERRCODE='42501';
    END IF;
  END IF;
$admission$;
 definition:=replace(definition,
   '  IF TG_OP=''INSERT'' AND NEW.publication_origin=''transfer'' THEN',
   admission || E'\n  IF TG_OP=''INSERT'' AND NEW.publication_origin=''transfer'' THEN');
 definition:=replace(definition,
   'IF current_user<>''novlearn_publication_writer'' OR NEW.editorial_status<>''published'' OR',
   'IF current_user NOT IN (''novlearn_publication_writer'',''postgres'') OR NEW.editorial_status<>''published'' OR');
 IF position(admission IN definition)=0 THEN RAISE EXCEPTION 'Import admission not installed'; END IF;
 EXECUTE definition;
END;
$migration$;
COMMIT;
