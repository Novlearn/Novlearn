-- Local Admin test evidence. No existing content/status/data is rewritten.
BEGIN;
CREATE SCHEMA novlearn_admin_private;
REVOKE ALL ON SCHEMA novlearn_admin_private FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE novlearn_admin_private.test_signing_keys (
  id uuid PRIMARY KEY,
  secret bytea NOT NULL CHECK (octet_length(secret) = 32),
  enabled boolean NOT NULL DEFAULT true
);
ALTER TABLE novlearn_admin_private.test_signing_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON novlearn_admin_private.test_signing_keys FROM PUBLIC, anon, authenticated, service_role;
-- Deliberately empty: only a separately approved owner can provision a key.

ALTER TABLE public.exercise_versions ADD COLUMN test_epoch bigint NOT NULL DEFAULT 0 CHECK (test_epoch >= 0);
CREATE FUNCTION public.advance_exercise_test_epoch() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.test_epoch <> 0 THEN RAISE EXCEPTION 'test epoch is server owned' USING ERRCODE='42501'; END IF;
  ELSE
    IF NEW.test_epoch IS DISTINCT FROM OLD.test_epoch THEN
      RAISE EXCEPTION 'test epoch is server owned' USING ERRCODE='42501';
    END IF;
    IF NEW.exercise_id IS DISTINCT FROM OLD.exercise_id OR NEW.revision IS DISTINCT FROM OLD.revision
      OR NEW.definition IS DISTINCT FROM OLD.definition OR NEW.engine_contract IS DISTINCT FROM OLD.engine_contract
      OR NEW.generation_version IS DISTINCT FROM OLD.generation_version
      OR NEW.canonicalization_version IS DISTINCT FROM OLD.canonicalization_version THEN
      NEW.test_epoch := OLD.test_epoch + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER exercise_version_test_epoch_before_write BEFORE INSERT OR UPDATE
  ON public.exercise_versions FOR EACH ROW EXECUTE FUNCTION public.advance_exercise_test_epoch();
REVOKE ALL ON FUNCTION public.advance_exercise_test_epoch() FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.admin_exercise_test_runs (
  id uuid PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES public.exercise_versions(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  test_epoch bigint NOT NULL CHECK (test_epoch >= 0),
  key_id uuid NOT NULL REFERENCES novlearn_admin_private.test_signing_keys(id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  passed boolean NOT NULL,
  payload text NOT NULL CHECK (octet_length(payload) <= 262144),
  signature text NOT NULL CHECK (signature ~ '^[0-9a-f]{64}$')
);
ALTER TABLE public.admin_exercise_test_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_exercise_test_runs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.admin_exercise_test_runs TO authenticated;
CREATE POLICY novlearn_admin_read_test_runs ON public.admin_exercise_test_runs FOR SELECT TO authenticated
  USING ((SELECT public.is_novlearn_admin()));
CREATE INDEX admin_exercise_test_runs_version_idx ON public.admin_exercise_test_runs(version_id, recorded_at DESC, id);

CREATE FUNCTION public.admin_record_exercise_test(p_payload text, p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  body jsonb; version public.exercise_versions%ROWTYPE; secret bytea; actual bytea; supplied bytea;
  different integer := 0; i integer; stamp timestamptz; receipt uuid; actor uuid; key uuid;
  old_payload text; old_signature text;
BEGIN
  IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501'; END IF;
  IF p_payload IS NULL OR octet_length(p_payload)>262144 OR p_signature IS NULL OR p_signature !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid receipt' USING ERRCODE='22023';
  END IF;
  body:=p_payload::jsonb;
  IF jsonb_typeof(body) IS DISTINCT FROM 'object' OR
     (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(body) k) IS DISTINCT FROM
     ARRAY['actorId','cases','engineArchiveSha256','epoch','fingerprint','issuedAt','keyId','receiptId','report','schemaVersion','versionId']::text[] OR
     body->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR
     body->>'engineArchiveSha256' IS DISTINCT FROM '650128cdeb1e798b952a09e91b038d018b9e7947d0a6ee4c247695f899190290' OR
     jsonb_typeof(body->'report') IS DISTINCT FROM 'object' OR jsonb_typeof(body->'cases') IS DISTINCT FROM 'array' OR
     body->'report'->>'engineVersion' IS DISTINCT FROM '0.1.0' OR
     jsonb_typeof(body->'report'->'passed') IS DISTINCT FROM 'boolean' OR
     body->'report'->'complete' IS DISTINCT FROM 'true'::jsonb OR
     jsonb_typeof(body->'report'->'seeds') IS DISTINCT FROM 'array' OR
     jsonb_array_length(body->'report'->'seeds') NOT BETWEEN 1 AND 5 OR
     jsonb_array_length(body->'cases')>16 THEN
    RAISE EXCEPTION 'invalid receipt envelope' USING ERRCODE='22023';
  END IF;
  actor:=(body->>'actorId')::uuid; receipt:=(body->>'receiptId')::uuid; key:=(body->>'keyId')::uuid;
  IF actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'receipt actor mismatch' USING ERRCODE='42501'; END IF;
  SELECT k.secret INTO secret FROM novlearn_admin_private.test_signing_keys k WHERE k.id=key AND k.enabled;
  IF secret IS NULL THEN RAISE EXCEPTION 'receipt signing key unavailable' USING ERRCODE='42501'; END IF;
  actual:=extensions.hmac(convert_to(p_payload,'UTF8'),secret,'sha256'); supplied:=decode(p_signature,'hex');
  FOR i IN 0..31 LOOP different:=different | (get_byte(actual,i) # get_byte(supplied,i)); END LOOP;
  IF different<>0 THEN RAISE EXCEPTION 'receipt signature refused' USING ERRCODE='42501'; END IF;
  SELECT * INTO version FROM public.exercise_versions WHERE id=(body->>'versionId')::uuid FOR UPDATE;
  IF NOT FOUND OR version.approval_fingerprint_sha256 IS DISTINCT FROM body->>'fingerprint'
    OR version.test_epoch IS DISTINCT FROM (body->>'epoch')::bigint THEN
    RAISE EXCEPTION 'tested revision changed' USING ERRCODE='40001';
  END IF;
  IF body->>'fingerprint' !~ '^[0-9a-f]{64}$' OR jsonb_typeof(body->'issuedAt') IS DISTINCT FROM 'number'
    OR body->>'issuedAt' !~ '^[0-9]{1,12}$' THEN RAISE EXCEPTION 'invalid receipt timestamp' USING ERRCODE='22023'; END IF;
  stamp:=to_timestamp((body->>'issuedAt')::bigint);
  IF stamp<clock_timestamp()-interval '10 minutes' OR stamp>clock_timestamp()+interval '30 seconds' THEN
    RAISE EXCEPTION 'receipt expired' USING ERRCODE='22023';
  END IF;
  SELECT payload,signature INTO old_payload,old_signature FROM public.admin_exercise_test_runs WHERE id=receipt;
  IF FOUND THEN
    IF old_payload IS DISTINCT FROM p_payload OR old_signature IS DISTINCT FROM p_signature THEN
      RAISE EXCEPTION 'receipt identity conflict' USING ERRCODE='40001';
    END IF;
    RETURN jsonb_build_object('receiptId',receipt,'recorded',true,'passed',(body->'report'->>'passed')::boolean);
  END IF;
  INSERT INTO public.admin_exercise_test_runs(id,version_id,actor_id,fingerprint,test_epoch,key_id,issued_at,passed,payload,signature)
    VALUES(receipt,version.id,actor,version.approval_fingerprint_sha256,version.test_epoch,key,stamp,
      (body->'report'->>'passed')::boolean,p_payload,p_signature);
  RETURN jsonb_build_object('receiptId',receipt,'recorded',true,'passed',(body->'report'->>'passed')::boolean);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_record_exercise_test(text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_record_exercise_test(text,text) TO authenticated;
COMMIT;
