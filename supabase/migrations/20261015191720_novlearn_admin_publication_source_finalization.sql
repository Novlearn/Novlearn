-- Local preparation only. No existing operation or source row is backfilled.
-- This remains private machine bookkeeping, after a VERIFIED target observation.
BEGIN;
CREATE OR REPLACE FUNCTION novlearn_admin_private.record_publication_outcome(p_id uuid,p_digest text,p_expected_state text,p_state text,p_outcome jsonb,p_error text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE operation novlearn_admin_private.publication_operations%ROWTYPE;
 source_parent public.exercises%ROWTYPE; source_version public.exercise_versions%ROWTYPE;
 review_row public.admin_exercise_reviews%ROWTYPE; receipt_row public.admin_exercise_test_runs%ROWTYPE;
BEGIN
 IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' OR p_expected_state IS NULL OR p_expected_state NOT IN ('executing','uncertain') OR
  p_state IS NULL OR p_state NOT IN ('uncertain','committed','failed') THEN RAISE EXCEPTION 'invalid publication observation' USING ERRCODE='22023'; END IF;

 -- Read the immutable source identity before locking the journal row. Source
 -- writers/exporters lock parent then version; do not invert that order here.
 -- In particular, do not release the pending uniqueness guard while waiting
 -- for the parent: another claim could otherwise wait on that guard WITH its
 -- parent SHARE lock, deadlocking this finalization.
 SELECT * INTO operation FROM novlearn_admin_private.publication_operations WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'publication operation unavailable' USING ERRCODE='P0002'; END IF;
 IF operation.plan_digest IS DISTINCT FROM p_digest THEN RAISE EXCEPTION 'confirmation mismatch' USING ERRCODE='40001'; END IF;
 IF operation.state NOT IN ('executing','uncertain') AND operation.state IS DISTINCT FROM p_state THEN
  RAISE EXCEPTION 'publication observation state changed' USING ERRCODE='40001'; END IF;
 IF p_state='committed' AND operation.state IN ('executing','uncertain') THEN
  SELECT * INTO source_parent FROM public.exercises
   WHERE id=(SELECT exercise_id FROM public.exercise_versions WHERE id=operation.version_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'publication source unavailable' USING ERRCODE='40001'; END IF;
  SELECT * INTO source_version FROM public.exercise_versions WHERE id=operation.version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'publication source unavailable' USING ERRCODE='40001'; END IF;
 END IF;

 -- Refresh state after waiting. An identical terminal observation is a no-op,
 -- including historical records: never reactivate a source on a replay.
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

 IF p_state='committed' THEN
  -- The pending guard has preserved source content since claim. Recheck its
  -- exact identity/evidence, without requiring the initiating profile or key
  -- still to be enabled AFTER an already verified target commit.
  IF source_parent.id IS NULL OR source_parent.admin_archived_at IS NOT NULL OR
   source_parent.catalog_id::text IS DISTINCT FROM operation.payload->>'catalogId' OR
   source_version.id IS DISTINCT FROM operation.version_id OR source_version.exercise_id IS DISTINCT FROM source_parent.id OR
   source_version.publication_origin<>'local' OR source_version.editorial_status NOT IN ('approved','published') OR
   source_version.approval_fingerprint_sha256 IS DISTINCT FROM operation.source_fingerprint OR
   source_version.approved_fingerprint_sha256 IS DISTINCT FROM operation.source_fingerprint OR source_version.approved_by IS NULL OR
   source_version.test_epoch IS DISTINCT FROM operation.source_epoch OR to_jsonb(source_version.revision) IS DISTINCT FROM operation.payload->'revision' OR
   source_version.definition::text IS DISTINCT FROM operation.payload->>'definitionJson' OR
   source_version.engine_contract IS DISTINCT FROM operation.payload->>'engineContract' OR
   source_version.generation_version IS DISTINCT FROM operation.payload->>'generationVersion' OR
   source_version.canonicalization_version IS DISTINCT FROM operation.payload->>'canonicalizationVersion' OR
   public.exercise_publication_digest(source_version.definition,source_version.engine_contract,source_version.generation_version,source_version.canonicalization_version)
    IS DISTINCT FROM operation.payload->>'businessDigest' THEN
   RAISE EXCEPTION 'publication source no longer matches confirmed content' USING ERRCODE='40001'; END IF;
  SELECT * INTO review_row FROM public.admin_exercise_reviews WHERE version_id=operation.version_id
   ORDER BY recorded_at DESC,id DESC LIMIT 1 FOR SHARE;
  SELECT * INTO receipt_row FROM public.admin_exercise_test_runs WHERE version_id=operation.version_id
   AND fingerprint=operation.source_fingerprint AND test_epoch=operation.source_epoch
   ORDER BY recorded_at DESC,id DESC LIMIT 1 FOR SHARE;
  IF review_row.id IS DISTINCT FROM (operation.source_snapshot->>'reviewId')::uuid OR review_row.action IS DISTINCT FROM 'approve' OR
   review_row.fingerprint IS DISTINCT FROM operation.source_fingerprint OR review_row.test_epoch IS DISTINCT FROM operation.source_epoch OR
   review_row.receipt_id IS DISTINCT FROM receipt_row.id OR receipt_row.id IS NULL OR NOT receipt_row.passed OR
   receipt_row.id IS DISTINCT FROM (operation.source_snapshot->>'receiptId')::uuid OR
   jsonb_typeof(operation.source_snapshot->'report') IS DISTINCT FROM 'object' OR jsonb_typeof(operation.source_snapshot->'cases') IS DISTINCT FROM 'array' OR
   receipt_row.payload::jsonb->'report' IS DISTINCT FROM operation.source_snapshot->'report' OR
   receipt_row.payload::jsonb->'cases' IS DISTINCT FROM operation.source_snapshot->'cases' OR
   receipt_row.payload::jsonb->>'engineArchiveSha256' IS DISTINCT FROM operation.payload->>'engineArchiveSha256' THEN
   RAISE EXCEPTION 'publication source evidence changed' USING ERRCODE='40001'; END IF;
 END IF;

 -- This terminal state and the source writes commit ATOMICALLY. Our own
 -- triggers see this operation resolved; other sessions still see it pending
 -- until commit, and the parent/version row locks prevent a concurrent edit.
 UPDATE novlearn_admin_private.publication_operations SET state=p_state,outcome=p_outcome,error_code=p_error,updated_at=clock_timestamp() WHERE id=p_id;
 IF p_state='committed' THEN
  IF source_version.editorial_status='approved' THEN
   UPDATE public.exercise_versions SET editorial_status='published' WHERE id=operation.version_id;
  END IF;
  -- Use the SOURCE UUID, never the target version ID in p_outcome. Preserve
  -- Staging draft metadata and every already-published definition verbatim.
  IF source_parent.active_version_id IS DISTINCT FROM operation.version_id THEN
   UPDATE public.exercises SET active_version_id=operation.version_id WHERE id=source_parent.id;
  END IF;
 END IF;
 INSERT INTO novlearn_admin_private.publication_operation_events(operation_id,actor_id,state,error_code) VALUES(p_id,NULL,p_state,p_error);
 RETURN novlearn_admin_private.publication_journal_item(p_id);
END; $$;
REVOKE ALL ON FUNCTION novlearn_admin_private.record_publication_outcome(uuid,text,text,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION novlearn_admin_private.record_publication_outcome(uuid,text,text,text,jsonb,text) TO novlearn_publication_journal_executor;
-- An atomic marker for server checkout. A database without this migration must
-- fail before any plan/claim, rather than publish with the older record-only RPC.
CREATE FUNCTION novlearn_admin_private.publication_source_contract() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT 'atomic-source-finalization-v1'::text $$;
REVOKE ALL ON FUNCTION novlearn_admin_private.publication_source_contract() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION novlearn_admin_private.publication_source_contract() TO novlearn_publication_journal_executor;
COMMIT;
