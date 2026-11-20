-- Private storage for short-lived Admin student-preview snapshots.

CREATE SCHEMA IF NOT EXISTS novlearn_admin_private;
REVOKE ALL ON SCHEMA novlearn_admin_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS novlearn_admin_private.preview_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  seed bigint NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  artifact text NOT NULL CHECK (artifact ~ '^[a-f0-9]{64}$'),
  official jsonb NOT NULL CHECK (
    jsonb_typeof(official) = 'object'
    AND official->>'schemaVersion' = '5'
    AND official->>'engineVersion' = '0.1.0'
    AND octet_length(official::text) <= 524288
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS preview_snapshots_owner_expiry_idx
  ON novlearn_admin_private.preview_snapshots (owner_id, expires_at, created_at);

CREATE INDEX IF NOT EXISTS preview_snapshots_expiry_idx
  ON novlearn_admin_private.preview_snapshots (expires_at);

ALTER TABLE novlearn_admin_private.preview_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE novlearn_admin_private.preview_snapshots
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_put_preview_snapshot(
  p_digest text,
  p_seed bigint,
  p_official jsonb,
  p_artifact text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner uuid := auth.uid();
  v_count integer;
  v_id uuid;
  v_snapshot novlearn_admin_private.preview_snapshots%ROWTYPE;
BEGIN
  IF NOT public.is_novlearn_admin() THEN
    RAISE EXCEPTION 'administrator access required' USING ERRCODE = '42501';
  END IF;

  IF p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$'
     OR p_seed IS NULL OR p_seed NOT BETWEEN 0 AND 4294967295
     OR p_artifact IS NULL OR p_artifact !~ '^[a-f0-9]{64}$'
     OR p_official IS NULL OR jsonb_typeof(p_official) IS DISTINCT FROM 'object'
     OR p_official->>'schemaVersion' IS DISTINCT FROM '5'
     OR p_official->>'engineVersion' IS DISTINCT FROM '0.1.0'
     OR octet_length(p_official::text) > 524288 THEN
    RAISE EXCEPTION 'invalid preview snapshot' USING ERRCODE = '22023';
  END IF;

  -- Serialize bounded retention so concurrent requests cannot exceed either cap.
  PERFORM pg_advisory_xact_lock(20261120, 1);
  DELETE FROM novlearn_admin_private.preview_snapshots
    WHERE expires_at <= clock_timestamp();

  SELECT count(*) INTO v_count
    FROM novlearn_admin_private.preview_snapshots
    WHERE owner_id = v_owner;
  IF v_count >= 2 THEN
    SELECT id INTO v_id
      FROM novlearn_admin_private.preview_snapshots
      WHERE owner_id = v_owner
      ORDER BY created_at, id
      LIMIT 1;
    DELETE FROM novlearn_admin_private.preview_snapshots WHERE id = v_id;
  END IF;

  SELECT count(*) INTO v_count
    FROM novlearn_admin_private.preview_snapshots;
  IF v_count >= 32 THEN
    RAISE EXCEPTION 'preview capacity reached' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO novlearn_admin_private.preview_snapshots
    (owner_id, digest, seed, artifact, official, expires_at)
  VALUES
    (v_owner, p_digest, p_seed, p_artifact, p_official,
     clock_timestamp() + interval '10 minutes')
  RETURNING * INTO v_snapshot;

  RETURN jsonb_build_object(
    'previewId', v_snapshot.id,
    'owner', v_snapshot.owner_id,
    'digest', v_snapshot.digest,
    'seed', v_snapshot.seed,
    'artifact', v_snapshot.artifact,
    'official', v_snapshot.official,
    'expiresAt', floor(extract(epoch FROM v_snapshot.expires_at) * 1000)::bigint
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_preview_snapshot(
  p_id uuid,
  p_artifact text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner uuid := auth.uid();
  v_snapshot novlearn_admin_private.preview_snapshots%ROWTYPE;
BEGIN
  IF NOT public.is_novlearn_admin() THEN
    RAISE EXCEPTION 'administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_artifact IS NULL OR p_artifact !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'preview unavailable' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_snapshot
    FROM novlearn_admin_private.preview_snapshots
    WHERE id = p_id
      AND owner_id = v_owner
      AND artifact = p_artifact
      AND expires_at > clock_timestamp();
  IF NOT FOUND THEN
    DELETE FROM novlearn_admin_private.preview_snapshots
      WHERE id = p_id AND owner_id = v_owner AND expires_at <= clock_timestamp();
    RAISE EXCEPTION 'preview unavailable' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'previewId', v_snapshot.id,
    'owner', v_snapshot.owner_id,
    'digest', v_snapshot.digest,
    'seed', v_snapshot.seed,
    'artifact', v_snapshot.artifact,
    'official', v_snapshot.official,
    'expiresAt', floor(extract(epoch FROM v_snapshot.expires_at) * 1000)::bigint
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_put_preview_snapshot(text, bigint, jsonb, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_preview_snapshot(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_put_preview_snapshot(text, bigint, jsonb, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_preview_snapshot(uuid, text)
  TO authenticated;

