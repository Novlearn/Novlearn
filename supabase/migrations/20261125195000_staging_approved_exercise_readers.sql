-- The browser sees eligible exercise metadata through existing restrictive RLS.
-- The Engine definition, including answer keys, remains behind server access.
DO $migration$
BEGIN
  IF public.novlearn_catalog_is_staging() IS DISTINCT FROM true THEN
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION public.novlearn_catalog_reader_allows(
    p_catalog_id uuid, p_active_version_id uuid, p_archived_at timestamptz
  ) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $reader$
    SELECT CASE WHEN public.novlearn_catalog_is_staging() THEN
      p_archived_at IS NULL AND p_catalog_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.exercises AS exercise
        JOIN public.exercise_versions AS version ON version.exercise_id = exercise.id
        WHERE exercise.catalog_id = p_catalog_id
          AND exercise.admin_archived_at IS NULL
          AND version.editorial_status IN ('ready', 'published')
      )
    WHEN runtime.enforce_production_sync THEN
      p_catalog_id IS NOT NULL AND p_active_version_id IS NOT NULL AND p_archived_at IS NULL
    ELSE p_catalog_id IS NULL OR p_active_version_id IS NOT NULL END
    FROM novlearn_catalog_sync.runtime AS runtime
    WHERE singleton
  $reader$;
END;
$migration$;
