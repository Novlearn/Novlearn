-- Read-only Staging content overview. No existing row or privilege is rewritten.
BEGIN;
CREATE FUNCTION public.admin_content_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_novlearn_admin() THEN
    RAISE EXCEPTION 'administrator access required' USING ERRCODE = '42501';
  END IF;
  WITH catalogue AS MATERIALIZED (
    SELECT e.id,e.active_version_id,e.admin_archived_at,
      v.id AS version_id,v.approval_fingerprint_sha256,v.test_epoch,
      CASE WHEN e.admin_archived_at IS NOT NULL THEN 'archived'
        ELSE COALESCE(v.editorial_status,'legacy') END AS status
    FROM public.exercises e LEFT JOIN LATERAL (
      SELECT id,editorial_status,approval_fingerprint_sha256,test_epoch
      FROM public.exercise_versions WHERE exercise_id=e.id ORDER BY revision DESC LIMIT 1
    ) v ON true
  ), current_tests AS (
    SELECT c.id,r.passed FROM catalogue c JOIN LATERAL (
      SELECT passed FROM public.admin_exercise_test_runs
      WHERE version_id=c.version_id AND fingerprint=c.approval_fingerprint_sha256 AND test_epoch=c.test_epoch
      ORDER BY recorded_at DESC,id DESC LIMIT 1
    ) r ON true WHERE c.admin_archived_at IS NULL
  ), active AS MATERIALIZED (
    SELECT e.id,v.id AS version_id,v.revision,v.published_at,
      left(COALESCE(v.definition->>'title',e.title,'Exercice sans titre'),240) AS title
    FROM public.exercises e JOIN public.exercise_versions v ON v.exercise_id=e.id AND v.id=e.active_version_id
    WHERE e.admin_archived_at IS NULL AND v.editorial_status='published'
  )
  SELECT jsonb_build_object(
    'environment','staging','asOf',statement_timestamp(),
    'catalogue',jsonb_build_object('total',(SELECT count(*)::text FROM catalogue),
      'draft',(SELECT count(*)::text FROM catalogue WHERE status='draft'),
      'in_review',(SELECT count(*)::text FROM catalogue WHERE status='in_review'),
      'approved',(SELECT count(*)::text FROM catalogue WHERE status='approved'),
      'published',(SELECT count(*)::text FROM catalogue WHERE status='published'),
      'legacy',(SELECT count(*)::text FROM catalogue WHERE status='legacy'),
      'archived',(SELECT count(*)::text FROM catalogue WHERE status='archived')),
    'tests',jsonb_build_object('failed',(SELECT count(*)::text FROM current_tests WHERE NOT passed)),
    'content',jsonb_build_object('chapters',(SELECT count(*)::text FROM public.chapters),
      'competences',(SELECT count(*)::text FROM public.competences),'flashcards',(SELECT count(*)::text FROM public.flashcards)),
    'activeVersions',(SELECT count(*)::text FROM active),
    'recentActiveVersions',COALESCE((SELECT jsonb_agg(jsonb_build_object('exerciseId',id::text,
      'versionId',version_id,'revision',revision,'title',title,'publishedAt',published_at)
      ORDER BY published_at DESC,version_id DESC) FROM (
        SELECT * FROM active ORDER BY published_at DESC,version_id DESC LIMIT 5
      ) recent),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_content_overview() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_content_overview() TO authenticated;
COMMIT;
