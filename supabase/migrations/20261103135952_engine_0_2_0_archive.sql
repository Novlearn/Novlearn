-- Prepared for the observed STAGING baseline only. Review and apply separately.
-- This does not enable publication or alter historical receipts/attempts.
-- Staging only: align new test receipts with the shared qualified Engine archive.
-- Existing receipts and editorial decisions remain immutable historical evidence.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $rotation$
DECLARE
  old_archive constant text := '82e499726db2da454627903ed65802eaa2ab3e7185f7f6cb3c84c1cbdbde3cea';
  new_archive constant text := 'cc62b257798bda3ebffe293f49997e72ece2ee11b7f392c28e92217ceb45af91';
  runtime_row novlearn_admin_private.publication_runtime%ROWTYPE;
  function_oid oid := 'public.admin_record_exercise_test(text,text)'::regprocedure;
  previous_row jsonb; current_row jsonb; body text; definition text;
BEGIN
  LOCK TABLE novlearn_admin_private.publication_operations IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO runtime_row FROM novlearn_admin_private.publication_runtime WHERE singleton FOR UPDATE;
  IF NOT FOUND OR runtime_row.enabled OR runtime_row.engine_archive_sha256 IS DISTINCT FROM old_archive
    OR runtime_row.engine_contract IS DISTINCT FROM 'schema-5;engine-0.1.0'
    OR runtime_row.generation_version IS DISTINCT FROM 'mulberry32-rejection-v1'
    OR runtime_row.canonicalization_version IS DISTINCT FROM 'pg-jsonb-text-v1' THEN
    RAISE EXCEPTION 'Expected disabled Staging runtime baseline is required';
  END IF;
  IF EXISTS(SELECT 1 FROM novlearn_admin_private.publication_operations WHERE state IN ('executing','uncertain')) THEN
    RAISE EXCEPTION 'Reconcile publication outcomes before rotating Engine';
  END IF;
  SELECT to_jsonb(p),p.prosrc,pg_get_functiondef(p.oid) INTO previous_row,body,definition
    FROM pg_proc p WHERE p.oid=function_oid;
  IF encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM
      '3d397ea7db2a41f1b3f89c67fac529074aee45e2d93aec543c970d654d7797f6'
    OR (length(body)-length(replace(body,old_archive,'')))/length(old_archive)<>1 THEN
    RAISE EXCEPTION 'Receipt function differs from the reviewed Staging baseline';
  END IF;
  EXECUTE replace(definition,body,replace(body,old_archive,new_archive));
  SELECT to_jsonb(p) INTO current_row FROM pg_proc p WHERE p.oid=function_oid;
  IF current_row-'prosrc' IS DISTINCT FROM previous_row-'prosrc' THEN
    RAISE EXCEPTION 'Function execution attributes must remain unchanged';
  END IF;
  UPDATE novlearn_admin_private.publication_runtime SET engine_archive_sha256=new_archive WHERE singleton;
END;
$rotation$;

-- Private Vercel preview storage, with existing Admin authorization and quotas.
CREATE SCHEMA IF NOT EXISTS novlearn_admin_private;
CREATE TABLE novlearn_admin_private.preview_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL,
 digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
 seed bigint NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
 artifact text NOT NULL CHECK (artifact ~ '^[a-f0-9]{64}$'),
 official jsonb NOT NULL CHECK (jsonb_typeof(official)='object' AND octet_length(official::text)<=524288 AND official->>'schemaVersion'='5'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes'
);
ALTER TABLE novlearn_admin_private.preview_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON novlearn_admin_private.preview_snapshots FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.admin_put_preview_snapshot(p_digest text,p_seed bigint,p_official jsonb,p_artifact text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; item novlearn_admin_private.preview_snapshots;
BEGIN
 IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'admin required' USING ERRCODE='42501'; END IF;
 actor:=auth.uid();
 IF actor IS NULL THEN RAISE EXCEPTION 'session required' USING ERRCODE='42501'; END IF;
 LOCK TABLE novlearn_admin_private.preview_snapshots IN SHARE ROW EXCLUSIVE MODE;
 DELETE FROM novlearn_admin_private.preview_snapshots WHERE expires_at<=clock_timestamp();
 IF (SELECT count(*) FROM novlearn_admin_private.preview_snapshots WHERE owner_id=actor)>=2 THEN
  DELETE FROM novlearn_admin_private.preview_snapshots WHERE id=(SELECT id FROM novlearn_admin_private.preview_snapshots WHERE owner_id=actor ORDER BY created_at,id LIMIT 1);
 END IF;
 IF (SELECT count(*) FROM novlearn_admin_private.preview_snapshots)>=32 THEN RAISE EXCEPTION 'preview capacity' USING ERRCODE='P0001'; END IF;
 INSERT INTO novlearn_admin_private.preview_snapshots(owner_id,digest,seed,official,artifact)
 VALUES(actor,p_digest,p_seed,p_official,p_artifact) RETURNING * INTO item;
 RETURN jsonb_build_object('previewId',item.id,'owner',item.owner_id,'digest',item.digest,'seed',item.seed,'artifact',item.artifact,'official',item.official,'expiresAt',floor(extract(epoch from item.expires_at)*1000)::bigint);
END $$;
CREATE FUNCTION public.admin_get_preview_snapshot(p_id uuid,p_artifact text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item novlearn_admin_private.preview_snapshots;
BEGIN
 IF NOT public.is_novlearn_admin() OR auth.uid() IS NULL THEN RAISE EXCEPTION 'admin required' USING ERRCODE='42501'; END IF;
 SELECT * INTO item FROM novlearn_admin_private.preview_snapshots WHERE id=p_id AND owner_id=auth.uid() AND expires_at>clock_timestamp() AND artifact=p_artifact;
 IF NOT FOUND THEN RAISE EXCEPTION 'preview unavailable' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('previewId',item.id,'owner',item.owner_id,'digest',item.digest,'seed',item.seed,'artifact',item.artifact,'official',item.official,'expiresAt',floor(extract(epoch from item.expires_at)*1000)::bigint);
END $$;
REVOKE ALL ON FUNCTION public.admin_put_preview_snapshot(text,bigint,jsonb,text),public.admin_get_preview_snapshot(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_put_preview_snapshot(text,bigint,jsonb,text),public.admin_get_preview_snapshot(uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
