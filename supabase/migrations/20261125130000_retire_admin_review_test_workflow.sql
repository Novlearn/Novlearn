-- Retire the obsolete Admin review and signed-test workflow.
-- Keep publication_operations in mode 'sync' for Catalogue Sync.
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.admin_record_exercise_test(text, text);
DROP FUNCTION IF EXISTS public.admin_review_exercise_version(
  uuid, text, bigint, text, text, uuid, jsonb, text
);
DROP FUNCTION IF EXISTS public.admin_export_exercise_publication(
  uuid, text, bigint, jsonb
);
DROP FUNCTION IF EXISTS public.admin_list_publication_operations(integer);
DROP FUNCTION IF EXISTS public.inspect_exercise_publication(jsonb, text);
DROP FUNCTION IF EXISTS public.apply_exercise_publication(jsonb, text, text);

DROP FUNCTION IF EXISTS novlearn_admin_private.claim_publication_operation(
  uuid, uuid, text, text
);
DROP FUNCTION IF EXISTS novlearn_admin_private.get_publication_operation(
  uuid, uuid
);
DROP FUNCTION IF EXISTS novlearn_admin_private.pending_publication_operations(
  uuid
);
DROP FUNCTION IF EXISTS novlearn_admin_private.prepare_publication_operation(
  uuid, uuid, uuid, text, bigint, jsonb, text, text, jsonb
);
DROP FUNCTION IF EXISTS novlearn_admin_private.lock_publication_source(
  uuid, uuid, text
);
DROP FUNCTION IF EXISTS novlearn_admin_private.record_publication_outcome(
  uuid, text, text, text, jsonb, text
);

CREATE OR REPLACE FUNCTION public.admin_content_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_novlearn_admin() THEN
    RAISE EXCEPTION 'administrator access required' USING ERRCODE = '42501';
  END IF;
  WITH catalogue AS MATERIALIZED (
    SELECT e.id, e.active_version_id, e.admin_archived_at,
      CASE WHEN e.admin_archived_at IS NOT NULL THEN 'archived'
        ELSE COALESCE(v.editorial_status, 'legacy') END AS status
    FROM public.exercises e
    LEFT JOIN LATERAL (
      SELECT editorial_status
      FROM public.exercise_versions
      WHERE exercise_id = e.id
      ORDER BY revision DESC
      LIMIT 1
    ) v ON true
  ), active AS MATERIALIZED (
    SELECT e.id, v.id AS version_id, v.revision, v.published_at,
      left(COALESCE(v.definition->>'title', e.title, 'Exercice sans titre'), 240) AS title
    FROM public.exercises e
    JOIN public.exercise_versions v
      ON v.exercise_id = e.id AND v.id = e.active_version_id
    WHERE e.admin_archived_at IS NULL AND v.editorial_status = 'published'
  )
  SELECT jsonb_build_object(
    'environment', 'staging',
    'asOf', statement_timestamp(),
    'catalogue', jsonb_build_object(
      'total', (SELECT count(*)::text FROM catalogue),
      'draft', (SELECT count(*)::text FROM catalogue WHERE status = 'draft'),
      'in_review', (SELECT count(*)::text FROM catalogue WHERE status = 'in_review'),
      'approved', (SELECT count(*)::text FROM catalogue WHERE status = 'approved'),
      'ready', (SELECT count(*)::text FROM catalogue WHERE status = 'ready'),
      'published', (SELECT count(*)::text FROM catalogue WHERE status = 'published'),
      'legacy', (SELECT count(*)::text FROM catalogue WHERE status = 'legacy'),
      'archived', (SELECT count(*)::text FROM catalogue WHERE status = 'archived')
    ),
    'content', jsonb_build_object(
      'chapters', (SELECT count(*)::text FROM public.chapters),
      'competences', (SELECT count(*)::text FROM public.competences),
      'flashcards', (SELECT count(*)::text FROM public.flashcards)
    ),
    'activeVersions', (SELECT count(*)::text FROM active),
    'recentActiveVersions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'exerciseId', id::text,
        'versionId', version_id,
        'revision', revision,
        'title', title,
        'publishedAt', published_at
      ) ORDER BY published_at DESC, version_id DESC)
      FROM (SELECT * FROM active ORDER BY published_at DESC, version_id DESC LIMIT 5) recent
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION novlearn_admin_private.guard_pending_publication_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE affected_catalog uuid; affected_exercises bigint[]; affected_versions uuid[];
BEGIN
  IF TG_RELID = 'public.exercises'::regclass AND TG_OP IN ('UPDATE', 'DELETE') THEN
    affected_exercises := ARRAY[OLD.id];
    affected_catalog := OLD.catalog_id;
  ELSIF TG_RELID = 'public.exercise_versions'::regclass
      AND TG_OP IN ('INSERT', 'UPDATE', 'DELETE') THEN
    affected_exercises := CASE TG_OP
      WHEN 'INSERT' THEN ARRAY[NEW.exercise_id]
      WHEN 'DELETE' THEN ARRAY[OLD.exercise_id]
      ELSE ARRAY[OLD.exercise_id, NEW.exercise_id] END;
    affected_versions := CASE TG_OP
      WHEN 'INSERT' THEN ARRAY[NEW.id]
      WHEN 'DELETE' THEN ARRAY[OLD.id]
      ELSE ARRAY[OLD.id, NEW.id] END;
  ELSIF TG_RELID IN (
      'public.chapters'::regclass,
      'public.competences'::regclass,
      'public.flashcards'::regclass
    ) THEN
    affected_catalog := OLD.catalog_id;
  ELSE
    RAISE EXCEPTION 'invalid publication guard context' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM novlearn_admin_private.publication_operations o
    JOIN public.exercise_versions v ON v.id = o.version_id
    WHERE o.state IN ('executing', 'uncertain')
      AND v.exercise_id = ANY(affected_exercises)
  ) OR EXISTS (
    SELECT 1
    FROM novlearn_admin_private.publication_operations o
    WHERE o.mode = 'sync'
      AND o.state IN ('executing', 'uncertain')
      AND (
        o.catalog_id = affected_catalog
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(o.payload->'dependencies') = 'array'
              THEN o.payload->'dependencies' ELSE '[]'::jsonb END
          ) dep
          WHERE dep->>'catalogId' = affected_catalog::text
        )
      )
  ) THEN
    RAISE EXCEPTION 'catalogue transfer pending or uncertain; reconcile before editing this source'
      USING ERRCODE = '40001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS exercise_version_test_epoch_before_write
  ON public.exercise_versions;
DROP FUNCTION IF EXISTS public.advance_exercise_test_epoch();
ALTER TABLE public.exercise_versions DROP COLUMN IF EXISTS test_epoch;

DROP TABLE IF EXISTS public.admin_exercise_reviews;
DROP TABLE IF EXISTS public.admin_exercise_test_runs;
DROP TABLE IF EXISTS novlearn_admin_private.test_signing_keys;
DROP TABLE IF EXISTS novlearn_admin_private.publication_runtime;

COMMIT;
