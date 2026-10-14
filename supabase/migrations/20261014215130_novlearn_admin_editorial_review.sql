-- Local Staging review. No row/status/identity is backfilled or published.
BEGIN;
-- Table-level grants override column revocations, so revoke them first.
REVOKE INSERT, UPDATE ON public.exercise_versions FROM authenticated;
GRANT INSERT(exercise_id,revision,definition,engine_contract,generation_version,canonicalization_version,
  definition_sha256,approval_fingerprint_sha256,created_by,updated_by)
  ON public.exercise_versions TO authenticated;
GRANT UPDATE(definition,updated_by) ON public.exercise_versions TO authenticated;

CREATE TABLE public.admin_exercise_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.exercise_versions(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  receipt_id uuid REFERENCES public.admin_exercise_test_runs(id) ON DELETE RESTRICT,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  test_epoch bigint NOT NULL,
  action text NOT NULL CHECK (action IN ('request_review','approve','return_to_draft')),
  checklist jsonb NOT NULL,
  comment text NOT NULL CHECK (length(comment)<=2000),
  references_snapshot jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.admin_exercise_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_exercise_reviews FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.admin_exercise_reviews TO authenticated;
CREATE POLICY novlearn_admin_read_reviews ON public.admin_exercise_reviews FOR SELECT TO authenticated
  USING ((SELECT public.is_novlearn_admin()));
CREATE INDEX admin_exercise_reviews_version_idx ON public.admin_exercise_reviews(version_id,recorded_at DESC,id);

CREATE FUNCTION public.admin_review_exercise_version(
  p_version_id uuid,p_expected_fingerprint text,p_expected_epoch bigint,p_expected_status text,
  p_action text,p_receipt_id uuid,p_checklist jsonb,p_comment text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  parent public.exercises%ROWTYPE; version public.exercise_versions%ROWTYPE;
  run public.admin_exercise_test_runs%ROWTYPE; chapter public.chapters%ROWTYPE;
  report jsonb; seed jsonb; check_item jsonb; question jsonb; label text; matches integer;
  chapter_ref text; skill_ref text; skill public.competences%ROWTYPE;
  resolved_refs jsonb:='{}'; skills jsonb:='[]'; actor uuid; target_status text; review_id uuid;
BEGIN
  IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501'; END IF;
  actor:=auth.uid();
  IF p_action IS NULL OR p_action NOT IN ('request_review','approve','return_to_draft') OR
    p_expected_fingerprint IS NULL OR p_expected_fingerprint !~ '^[0-9a-f]{64}$' OR
    p_expected_epoch IS NULL OR p_expected_epoch<0 OR p_expected_status IS NULL OR
    p_comment IS NULL OR length(p_comment)>2000 OR jsonb_typeof(p_checklist) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid review request' USING ERRCODE='22023';
  END IF;
  SELECT e.* INTO parent FROM public.exercises e WHERE e.id=(SELECT exercise_id FROM public.exercise_versions WHERE id=p_version_id) FOR UPDATE;
  IF NOT FOUND OR parent.admin_archived_at IS NOT NULL THEN RAISE EXCEPTION 'exercise unavailable or archived' USING ERRCODE='40001'; END IF;
  SELECT * INTO version FROM public.exercise_versions WHERE id=p_version_id AND exercise_id=parent.id FOR UPDATE;
  IF NOT FOUND OR version.approval_fingerprint_sha256 IS DISTINCT FROM p_expected_fingerprint OR
    version.test_epoch IS DISTINCT FROM p_expected_epoch OR version.editorial_status IS DISTINCT FROM p_expected_status OR
    version.editorial_status='published' THEN RAISE EXCEPTION 'revision state changed or immutable' USING ERRCODE='40001'; END IF;
  IF p_action='return_to_draft' THEN
    IF version.editorial_status NOT IN ('in_review','approved') OR length(btrim(p_comment))=0 OR p_checklist<>'{}'::jsonb OR p_receipt_id IS NOT NULL THEN
      RAISE EXCEPTION 'return requires review/approval and a reason' USING ERRCODE='22023';
    END IF;
    target_status:='draft';
  ELSE
    IF (p_action='request_review' AND version.editorial_status<>'draft') OR
      (p_action='approve' AND version.editorial_status<>'in_review') THEN
      RAISE EXCEPTION 'invalid editorial transition' USING ERRCODE='40001';
    END IF;
    SELECT * INTO run FROM public.admin_exercise_test_runs WHERE version_id=version.id
      AND fingerprint=version.approval_fingerprint_sha256 AND test_epoch=version.test_epoch
      ORDER BY recorded_at DESC,id DESC LIMIT 1;
    IF NOT FOUND OR run.id IS DISTINCT FROM p_receipt_id OR NOT run.passed OR
      NOT EXISTS(SELECT 1 FROM novlearn_admin_private.test_signing_keys WHERE id=run.key_id AND enabled) THEN
      RAISE EXCEPTION 'latest current tests must pass with an active signing key' USING ERRCODE='22023';
    END IF;
    report:=run.payload::jsonb->'report';
    IF report->'passed' IS DISTINCT FROM 'true'::jsonb OR report->'complete' IS DISTINCT FROM 'true'::jsonb
      OR report->>'engineVersion' IS DISTINCT FROM '0.1.0' OR jsonb_typeof(report->'seeds') IS DISTINCT FROM 'array'
      OR jsonb_array_length(report->'seeds') NOT BETWEEN 2 AND 5 OR
      (SELECT count(DISTINCT s->>'seed') FROM jsonb_array_elements(report->'seeds') s)<>jsonb_array_length(report->'seeds') THEN
      RAISE EXCEPTION 'complete reproducible multi-seed tests required' USING ERRCODE='22023';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(version.definition->'elements') q WHERE q->>'type' IN ('question','mcq')) THEN
      RAISE EXCEPTION 'question coverage missing' USING ERRCODE='22023';
    END IF;
    FOR seed IN SELECT value FROM jsonb_array_elements(report->'seeds') LOOP
      IF seed->'passed' IS DISTINCT FROM 'true'::jsonb OR seed->'reproducible' IS DISTINCT FROM 'true'::jsonb
        OR seed->'publicProjectionSafe' IS DISTINCT FROM 'true'::jsonb
        OR jsonb_typeof(seed->'diagnostics') IS DISTINCT FROM 'array' OR jsonb_array_length(seed->'diagnostics')<>0
        OR jsonb_typeof(seed->'checks') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'seed tests incomplete' USING ERRCODE='22023';
      END IF;
      FOR check_item IN SELECT value FROM jsonb_array_elements(seed->'checks') LOOP
        IF check_item->'passed' IS DISTINCT FROM 'true'::jsonb OR
          check_item->>'expectedState' IS NULL OR check_item->>'expectedState' NOT IN ('correct','incorrect','invalid') OR
          check_item->'result'->>'state' IS DISTINCT FROM check_item->>'expectedState' THEN
          RAISE EXCEPTION 'correction checks must pass' USING ERRCODE='22023';
        END IF;
      END LOOP;
      FOR question IN SELECT value FROM jsonb_array_elements(version.definition->'elements') WHERE value->>'type' IN ('question','mcq') LOOP
        FOREACH label IN ARRAY ARRAY['correct','incorrect','invalid'] LOOP
          IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(seed->'checks') c WHERE c->>'questionId'=question->>'id'
            AND c->>'expectedState'=label AND c->'result'->>'state'=label AND c->'passed'='true'::jsonb) THEN
            RAISE EXCEPTION 'positive negative and invalid coverage required for every question' USING ERRCODE='22023';
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
    -- Resolve resolved_refs without rewriting canonical content or copying taxonomy.
    chapter_ref:=version.definition->'catalogue'->>'chapter';
    IF chapter_ref IS NULL OR btrim(chapter_ref)='' THEN RAISE EXCEPTION 'chapter reference required' USING ERRCODE='22023'; END IF;
    SELECT count(*) INTO matches FROM public.chapters WHERE id::text=chapter_ref OR name=chapter_ref OR chapter_ref=ANY(aliases);
    IF matches<>1 THEN RAISE EXCEPTION 'chapter reference missing or ambiguous' USING ERRCODE='22023'; END IF;
    SELECT * INTO chapter FROM public.chapters WHERE id::text=chapter_ref OR name=chapter_ref OR chapter_ref=ANY(aliases) FOR SHARE;
    IF jsonb_typeof(COALESCE(version.definition->'catalogue'->'skills','[]'::jsonb)) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid skill resolved_refs' USING ERRCODE='22023';
    END IF;
    FOR skill_ref IN SELECT value FROM jsonb_array_elements_text(COALESCE(version.definition->'catalogue'->'skills','[]'::jsonb)) LOOP
      SELECT count(*) INTO matches FROM public.competences WHERE chapter_id=chapter.id AND (id=skill_ref OR name=skill_ref);
      IF matches<>1 THEN RAISE EXCEPTION 'skill reference missing ambiguous or outside chapter' USING ERRCODE='22023'; END IF;
      SELECT * INTO skill FROM public.competences WHERE chapter_id=chapter.id AND (id=skill_ref OR name=skill_ref) FOR SHARE;
      skills:=skills||jsonb_build_array(jsonb_build_object('id',skill.id,'name',skill.name));
    END LOOP;
    resolved_refs:=jsonb_build_object('chapterId',chapter.id,'chapterName',chapter.name,'skills',skills);
    IF p_action='approve' THEN
      IF p_checklist IS DISTINCT FROM '{"mathematicsCorrect":true,"statementClear":true,"gradingChecked":true,"referencesChecked":true}'::jsonb THEN
        RAISE EXCEPTION 'explicit complete human checklist required' USING ERRCODE='22023';
      END IF;
      target_status:='approved';
    ELSE
      IF p_checklist<>'{}'::jsonb THEN RAISE EXCEPTION 'review request cannot attest human approval' USING ERRCODE='22023'; END IF;
      target_status:='in_review';
    END IF;
  END IF;
  UPDATE public.exercise_versions SET editorial_status=target_status,updated_by=actor,
    approved_by=CASE WHEN target_status='approved' THEN actor ELSE NULL END,
    approved_at=CASE WHEN target_status='approved' THEN clock_timestamp() ELSE NULL END,
    approved_fingerprint_sha256=CASE WHEN target_status='approved' THEN version.approval_fingerprint_sha256 ELSE NULL END
    WHERE id=version.id;
  INSERT INTO public.admin_exercise_reviews(version_id,actor_id,receipt_id,fingerprint,test_epoch,action,checklist,comment,references_snapshot)
    VALUES(version.id,actor,p_receipt_id,version.approval_fingerprint_sha256,version.test_epoch,p_action,p_checklist,p_comment,resolved_refs)
    RETURNING id INTO review_id;
  RETURN jsonb_build_object('reviewId',review_id,'versionId',version.id,'status',target_status,'fingerprint',version.approval_fingerprint_sha256,'epoch',version.test_epoch);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_review_exercise_version(uuid,text,bigint,text,text,uuid,jsonb,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_exercise_version(uuid,text,bigint,text,text,uuid,jsonb,text) TO authenticated;
COMMIT;
