-- Local preparation only. No LOGIN, credential, role membership or target write.
BEGIN;
CREATE ROLE novlearn_publication_journal_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE TABLE novlearn_admin_private.publication_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 version_id uuid NOT NULL REFERENCES public.exercise_versions(id) ON DELETE RESTRICT,
 target_key text NOT NULL CHECK(target_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
 mode text NOT NULL CHECK(mode IN ('publish','rollback')),
 source_fingerprint text NOT NULL CHECK(source_fingerprint ~ '^[0-9a-f]{64}$'),
 source_epoch bigint NOT NULL CHECK(source_epoch>=0),
 source_snapshot jsonb NOT NULL, payload jsonb NOT NULL, inspection jsonb NOT NULL,
 plan_digest text NOT NULL CHECK(plan_digest ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','executing','uncertain','committed','failed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), outcome jsonb, error_code text,
 CHECK((state='committed')=(outcome IS NOT NULL)),
 CHECK((state='failed')=(error_code IS NOT NULL))
);
CREATE TABLE novlearn_admin_private.publication_operation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operation_id uuid NOT NULL REFERENCES novlearn_admin_private.publication_operations(id) ON DELETE RESTRICT,
 actor_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 state text NOT NULL CHECK(state IN ('planned','executing','uncertain','committed','failed','cancelled')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), error_code text
);
ALTER TABLE novlearn_admin_private.publication_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE novlearn_admin_private.publication_operation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON novlearn_admin_private.publication_operations,novlearn_admin_private.publication_operation_events FROM PUBLIC,anon,authenticated,service_role,novlearn_publication_journal_executor;
CREATE INDEX publication_operations_actor_recent_idx ON novlearn_admin_private.publication_operations(actor_id,created_at DESC,id);
CREATE INDEX publication_operation_events_operation_idx ON novlearn_admin_private.publication_operation_events(operation_id,recorded_at,id);
CREATE UNIQUE INDEX publication_one_pending_catalog_idx ON novlearn_admin_private.publication_operations((payload->>'catalogId')) WHERE state IN ('executing','uncertain');

-- Durable content guard: a dropped source connection must not release content
-- for editing while a target commit may still be in flight. There is no timed
-- unlock. Account and signing-key revocation are deliberately not blocked here.
CREATE FUNCTION novlearn_admin_private.guard_pending_publication_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE affected bigint[]; versions uuid[];
BEGIN
 IF TG_RELID='public.exercises'::regclass AND TG_OP IN ('UPDATE','DELETE') THEN
  affected:=ARRAY[OLD.id];
 ELSIF TG_RELID='public.exercise_versions'::regclass AND TG_OP IN ('INSERT','UPDATE','DELETE') THEN
  affected:=CASE TG_OP WHEN 'INSERT' THEN ARRAY[NEW.exercise_id] WHEN 'DELETE' THEN ARRAY[OLD.exercise_id] ELSE ARRAY[OLD.exercise_id,NEW.exercise_id] END;
 ELSIF TG_RELID IN ('public.admin_exercise_test_runs'::regclass,'public.admin_exercise_reviews'::regclass) AND TG_OP IN ('INSERT','UPDATE','DELETE') THEN
  versions:=CASE TG_OP WHEN 'INSERT' THEN ARRAY[NEW.version_id] WHEN 'DELETE' THEN ARRAY[OLD.version_id] ELSE ARRAY[OLD.version_id,NEW.version_id] END;
  SELECT array_agg(exercise_id) INTO affected FROM public.exercise_versions WHERE id=ANY(versions);
 ELSE RAISE EXCEPTION 'invalid publication guard context' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM novlearn_admin_private.publication_operations o JOIN public.exercise_versions v ON v.id=o.version_id
  WHERE o.state IN ('executing','uncertain') AND v.exercise_id=ANY(affected)) THEN
  RAISE EXCEPTION 'publication pending or uncertain; resolve it before editing this source' USING ERRCODE='40001'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION novlearn_admin_private.guard_pending_publication_source() FROM PUBLIC,anon,authenticated,service_role,novlearn_publication_journal_executor;
CREATE TRIGGER admin_publication_source_before_write BEFORE UPDATE OR DELETE ON public.exercises FOR EACH ROW EXECUTE FUNCTION novlearn_admin_private.guard_pending_publication_source();
CREATE TRIGGER admin_publication_source_before_write BEFORE INSERT OR UPDATE OR DELETE ON public.exercise_versions FOR EACH ROW EXECUTE FUNCTION novlearn_admin_private.guard_pending_publication_source();
CREATE TRIGGER admin_publication_source_before_write BEFORE INSERT OR UPDATE OR DELETE ON public.admin_exercise_test_runs FOR EACH ROW EXECUTE FUNCTION novlearn_admin_private.guard_pending_publication_source();
CREATE TRIGGER admin_publication_source_before_write BEFORE INSERT OR UPDATE OR DELETE ON public.admin_exercise_reviews FOR EACH ROW EXECUTE FUNCTION novlearn_admin_private.guard_pending_publication_source();

-- Only the private server capability can name an actor here. It must first
-- verify the actual non-guest Staging session; a browser cannot call this helper.
CREATE FUNCTION novlearn_admin_private.publication_journal_actor(p_actor uuid) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'verified actor required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_actor AND role='admin' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'current administrator required' USING ERRCODE='42501'; END IF;
 PERFORM set_config('request.jwt.claim.sub',p_actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'is_anonymous',false)::text,true);
END; $$;
CREATE FUNCTION novlearn_admin_private.publication_journal_item(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT to_jsonb(o)||jsonb_build_object('source_epoch',o.source_epoch::text)
 FROM novlearn_admin_private.publication_operations o WHERE id=p_id;
$$;

CREATE FUNCTION novlearn_admin_private.prepare_publication_operation(p_actor uuid,p_batch uuid,p_version uuid,p_fingerprint text,p_epoch bigint,p_roundtrip jsonb,p_target_key text,p_mode text,p_inspection jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE exported jsonb; operation novlearn_admin_private.publication_operations%ROWTYPE;
BEGIN
 PERFORM novlearn_admin_private.publication_journal_actor(p_actor);
 IF p_batch IS NULL OR p_target_key IS NULL OR p_target_key !~ '^[a-z][a-z0-9_-]{0,63}$' OR
  p_mode IS NULL OR p_mode NOT IN ('publish','rollback') OR jsonb_typeof(p_inspection) IS DISTINCT FROM 'object' OR octet_length(p_inspection::text)>1048576 THEN
  RAISE EXCEPTION 'invalid publication plan' USING ERRCODE='22023'; END IF;
 exported:=public.admin_export_exercise_publication(p_version,p_fingerprint,p_epoch,p_roundtrip);
 IF (SELECT count(*) FROM jsonb_object_keys(p_inspection))<>2 OR NOT(p_inspection ?& ARRAY['desiredHeader','state']) OR
  jsonb_typeof(p_inspection->'desiredHeader') IS DISTINCT FROM 'object' OR jsonb_typeof(p_inspection->'state') IS DISTINCT FROM 'object' OR
  (p_inspection->'state'->>'catalogId') IS DISTINCT FROM (exported->'payload'->>'catalogId') OR
  (p_inspection->'state'->'requestedRevision') IS DISTINCT FROM (exported->'payload'->'revision') OR
  (p_inspection->'state'->>'stateToken') IS NULL OR (p_inspection->'state'->>'stateToken') !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'target inspection does not match source' USING ERRCODE='22023'; END IF;
 operation.id:=gen_random_uuid();operation.created_at:=clock_timestamp();operation.expires_at:=operation.created_at+interval '15 minutes';
 operation.plan_digest:=encode(extensions.digest(convert_to(jsonb_build_object('id',operation.id,'actor',p_actor,'batch',p_batch,
  'source',exported->'source','payload',exported->'payload','targetKey',p_target_key,'mode',p_mode,'inspection',p_inspection,'expiresAt',operation.expires_at)::text,'UTF8'),'sha256'),'hex');
 INSERT INTO novlearn_admin_private.publication_operations(id,batch_id,actor_id,version_id,target_key,mode,source_fingerprint,source_epoch,
  source_snapshot,payload,inspection,plan_digest,created_at,expires_at,updated_at)
 VALUES(operation.id,p_batch,p_actor,p_version,p_target_key,p_mode,p_fingerprint,p_epoch,exported->'source',exported->'payload',p_inspection,operation.plan_digest,
  operation.created_at,operation.expires_at,operation.created_at);
 INSERT INTO novlearn_admin_private.publication_operation_events(operation_id,actor_id,state) VALUES(operation.id,p_actor,'planned');
 RETURN novlearn_admin_private.publication_journal_item(operation.id);
END; $$;

CREATE FUNCTION novlearn_admin_private.get_publication_operation(p_actor uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM novlearn_admin_private.publication_journal_actor(p_actor);
 IF NOT EXISTS(SELECT 1 FROM novlearn_admin_private.publication_operations WHERE id=p_id AND actor_id=p_actor) THEN
  RAISE EXCEPTION 'publication operation unavailable' USING ERRCODE='P0002'; END IF;
 RETURN novlearn_admin_private.publication_journal_item(p_id);
END; $$;

CREATE FUNCTION novlearn_admin_private.claim_publication_operation(p_actor uuid,p_id uuid,p_digest text,p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE operation novlearn_admin_private.publication_operations%ROWTYPE; current_export jsonb;
BEGIN
 PERFORM novlearn_admin_private.publication_journal_actor(p_actor);
 IF p_action IS NULL OR p_action NOT IN ('claim','cancel') OR p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'invalid publication confirmation' USING ERRCODE='22023'; END IF;
 SELECT * INTO operation FROM novlearn_admin_private.publication_operations WHERE id=p_id AND actor_id=p_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'publication operation unavailable' USING ERRCODE='P0002'; END IF;
 IF operation.plan_digest IS DISTINCT FROM p_digest OR operation.state<>'planned' THEN
  RAISE EXCEPTION 'publication plan changed or already claimed' USING ERRCODE='40001'; END IF;
 IF p_action='claim' THEN
  IF operation.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'publication plan expired' USING ERRCODE='40001'; END IF;
  current_export:=public.admin_export_exercise_publication(operation.version_id,operation.source_fingerprint,operation.source_epoch,(operation.payload->>'definitionJson')::jsonb);
  IF current_export->'source' IS DISTINCT FROM operation.source_snapshot OR current_export->'payload' IS DISTINCT FROM operation.payload THEN
   RAISE EXCEPTION 'source evidence changed since preparation' USING ERRCODE='40001'; END IF;
 END IF;
 BEGIN
  UPDATE novlearn_admin_private.publication_operations SET state=CASE p_action WHEN 'claim' THEN 'executing' ELSE 'cancelled' END,updated_at=clock_timestamp()
  WHERE id=p_id RETURNING * INTO operation;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'another publication is pending for this catalogue identity' USING ERRCODE='40001'; END;
 INSERT INTO novlearn_admin_private.publication_operation_events(operation_id,actor_id,state) VALUES(operation.id,p_actor,operation.state);
 RETURN novlearn_admin_private.publication_journal_item(operation.id);
END; $$;

-- Locks survive this function only while its caller keeps the SQL transaction
-- and dedicated connection open. Never use an autocommit RPC as a source lease.
CREATE FUNCTION novlearn_admin_private.lock_publication_source(p_actor uuid,p_id uuid,p_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE operation novlearn_admin_private.publication_operations%ROWTYPE; current_export jsonb;
BEGIN
 PERFORM novlearn_admin_private.publication_journal_actor(p_actor);
 SELECT * INTO operation FROM novlearn_admin_private.publication_operations WHERE id=p_id AND actor_id=p_actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'publication operation unavailable' USING ERRCODE='P0002'; END IF;
 IF operation.plan_digest IS DISTINCT FROM p_digest OR operation.state<>'executing' THEN
  RAISE EXCEPTION 'publication operation is not executable' USING ERRCODE='40001'; END IF;
 -- The parent/version locks in the export serialize with draft, archive,
 -- receipt and review operations. Also hold the signing-key row against rotation.
 PERFORM 1 FROM novlearn_admin_private.test_signing_keys WHERE id=(SELECT key_id FROM public.admin_exercise_test_runs
  WHERE id=(operation.source_snapshot->>'receiptId')::uuid) AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'signing key unavailable' USING ERRCODE='40001'; END IF;
 current_export:=public.admin_export_exercise_publication(operation.version_id,operation.source_fingerprint,operation.source_epoch,(operation.payload->>'definitionJson')::jsonb);
 IF current_export->'source' IS DISTINCT FROM operation.source_snapshot OR current_export->'payload' IS DISTINCT FROM operation.payload THEN
  RAISE EXCEPTION 'source evidence changed since preparation' USING ERRCODE='40001'; END IF;
 RETURN novlearn_admin_private.publication_journal_item(operation.id);
END; $$;

-- Machine bookkeeping, not a browser/admin transition. The private executor
-- records verified target observations even if the initiating role was revoked
-- after a commit. NULL event actor explicitly identifies this machine record.
CREATE FUNCTION novlearn_admin_private.record_publication_outcome(p_id uuid,p_digest text,p_expected_state text,p_state text,p_outcome jsonb,p_error text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE operation novlearn_admin_private.publication_operations%ROWTYPE;
BEGIN
 IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' OR p_expected_state IS NULL OR p_expected_state NOT IN ('executing','uncertain') OR
  p_state IS NULL OR p_state NOT IN ('uncertain','committed','failed') THEN RAISE EXCEPTION 'invalid publication observation' USING ERRCODE='22023'; END IF;
 SELECT * INTO operation FROM novlearn_admin_private.publication_operations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'publication operation unavailable' USING ERRCODE='P0002'; END IF;
 IF operation.plan_digest IS DISTINCT FROM p_digest THEN RAISE EXCEPTION 'confirmation mismatch' USING ERRCODE='40001'; END IF;
 IF p_state='committed' THEN
  IF p_error IS NOT NULL OR jsonb_typeof(p_outcome) IS DISTINCT FROM 'object' OR octet_length(p_outcome::text)>2048 THEN
   RAISE EXCEPTION 'verified target result required' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_outcome))<>7 OR NOT(p_outcome ?& ARRAY['catalogId','revision','businessDigest','exerciseId','versionId','stateToken','result']) OR
   p_outcome->>'catalogId' IS DISTINCT FROM operation.payload->>'catalogId' OR p_outcome->'revision' IS DISTINCT FROM operation.payload->'revision' OR
   p_outcome->>'businessDigest' IS DISTINCT FROM operation.payload->>'businessDigest' OR
   jsonb_typeof(p_outcome->'exerciseId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_outcome->'versionId') IS DISTINCT FROM 'string' OR
   COALESCE(p_outcome->>'exerciseId','') !~ '^[1-9][0-9]{0,18}$' OR (p_outcome->>'exerciseId')::numeric>9223372036854775807 OR
   COALESCE(p_outcome->>'versionId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
   COALESCE(p_outcome->>'stateToken','') !~ '^[0-9a-f]{64}$' OR
   COALESCE(p_outcome->>'result','') NOT IN ('unchanged',CASE operation.mode WHEN 'rollback' THEN 'rolled_back' ELSE 'published' END) THEN
   RAISE EXCEPTION 'target result does not match confirmed content' USING ERRCODE='22023'; END IF;
 ELSIF p_state='failed' THEN
  IF p_outcome IS NOT NULL OR p_error IS NULL OR p_error NOT IN ('validation','target_rejected','not_applied') THEN
   RAISE EXCEPTION 'definite failure required; transport ambiguity must remain uncertain' USING ERRCODE='22023'; END IF;
 ELSE
  IF p_outcome IS NOT NULL OR p_error IS NOT NULL THEN RAISE EXCEPTION 'uncertain result cannot assert an outcome' USING ERRCODE='22023'; END IF;
 END IF;
 IF operation.state=p_state AND operation.outcome IS NOT DISTINCT FROM p_outcome AND operation.error_code IS NOT DISTINCT FROM p_error THEN
  RETURN novlearn_admin_private.publication_journal_item(p_id); END IF;
 IF operation.state IS DISTINCT FROM p_expected_state OR (p_expected_state='uncertain' AND p_state='uncertain') THEN
  RAISE EXCEPTION 'publication observation state changed' USING ERRCODE='40001'; END IF;
 UPDATE novlearn_admin_private.publication_operations SET state=p_state,outcome=p_outcome,error_code=p_error,updated_at=clock_timestamp() WHERE id=p_id;
 INSERT INTO novlearn_admin_private.publication_operation_events(operation_id,actor_id,state,error_code) VALUES(p_id,NULL,p_state,p_error);
 RETURN novlearn_admin_private.publication_journal_item(p_id);
END; $$;

CREATE FUNCTION public.admin_list_publication_operations(p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501'; END IF;
 IF p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'invalid page' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('total',(SELECT count(*) FROM novlearn_admin_private.publication_operations WHERE actor_id=auth.uid()),
  'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'batchId',batch_id,'versionId',version_id,'catalogId',payload->>'catalogId',
   'targetKey',target_key,'mode',mode,'state',state,'createdAt',created_at,'updatedAt',updated_at,'errorCode',error_code)
   ORDER BY created_at DESC,id DESC) FROM (SELECT * FROM novlearn_admin_private.publication_operations WHERE actor_id=auth.uid() ORDER BY created_at DESC,id DESC OFFSET p_offset LIMIT 25) page),'[]'::jsonb)) INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION novlearn_admin_private.publication_journal_actor(uuid),novlearn_admin_private.publication_journal_item(uuid),
 novlearn_admin_private.prepare_publication_operation(uuid,uuid,uuid,text,bigint,jsonb,text,text,jsonb),
 novlearn_admin_private.get_publication_operation(uuid,uuid),novlearn_admin_private.claim_publication_operation(uuid,uuid,text,text),
 novlearn_admin_private.lock_publication_source(uuid,uuid,text),novlearn_admin_private.record_publication_outcome(uuid,text,text,text,jsonb,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA novlearn_admin_private TO novlearn_publication_journal_executor;
GRANT EXECUTE ON FUNCTION novlearn_admin_private.prepare_publication_operation(uuid,uuid,uuid,text,bigint,jsonb,text,text,jsonb),
 novlearn_admin_private.get_publication_operation(uuid,uuid),novlearn_admin_private.claim_publication_operation(uuid,uuid,text,text),
 novlearn_admin_private.lock_publication_source(uuid,uuid,text),novlearn_admin_private.record_publication_outcome(uuid,text,text,text,jsonb,text)
 TO novlearn_publication_journal_executor;
REVOKE ALL ON FUNCTION public.admin_list_publication_operations(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_publication_operations(integer) TO authenticated;
COMMIT;
