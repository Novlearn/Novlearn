-- Reviewed rollback only; NOT applied remotely. Run through a targeted Staging migration.
-- Archive flags do not protect the old readers. Never delete/publish pilots to bypass this guard.
BEGIN;
DO $$ BEGIN
 IF md5(pg_get_functiondef('public.get_random_exercise(text,text)'::regprocedure)) <> '9c741f73d4d49670c88d7f5bb0939338'
 OR md5(pg_get_functiondef('public.get_chapters_with_count(uuid)'::regprocedure)) <> 'd8d84f81b6ad579af275f0d9ad2d1b57' THEN
  RAISE EXCEPTION 'Function changed since reception; reconcile before rollback';
 END IF;
 IF EXISTS (SELECT 1 FROM public.exercises WHERE catalog_id IS NOT NULL AND active_version_id IS NULL) THEN
  RAISE EXCEPTION 'Unsafe rollback: unpublished canonical parents still exist; retain the guards';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.get_random_exercise(p_chapter text DEFAULT NULL,p_difficulty text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  exercise_data JSON;
BEGIN
  SELECT row_to_json(e) INTO exercise_data
  FROM public.exercises e
  WHERE (p_chapter IS NULL OR e.chapter = p_chapter)
    AND (p_difficulty IS NULL OR e.difficulty = p_difficulty)
  ORDER BY RANDOM()
  LIMIT 1;

  RETURN exercise_data;
END;
$function$;

-- Read-only snapshot of Staging, 2026-11-01. Do not execute remotely.
-- pg_get_functiondef md5: 887bc36f41086cb5ec3647782cd42d04
CREATE OR REPLACE FUNCTION public.get_chapters_with_count(target_user_id uuid)
 RETURNS TABLE(chapter_name text, total_exercises bigint, completed_exercises bigint, progress_percentage numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM target_user_id OR
    COALESCE((auth.jwt()->>'is_anonymous')::boolean,false) THEN
    RAISE EXCEPTION 'own permanent identity required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT e.chapter,COUNT(DISTINCT e.id),
    COUNT(DISTINCT ea.exercise_id) FILTER(WHERE ea.user_id=target_user_id AND ea.is_correct=true),
    CASE WHEN COUNT(DISTINCT e.id)=0 THEN 0 ELSE ROUND(
      (COUNT(DISTINCT ea.exercise_id) FILTER(WHERE ea.user_id=target_user_id AND ea.is_correct=true)::numeric /
        COUNT(DISTINCT e.id)::numeric)*100,1) END
    FROM public.exercises e LEFT JOIN public.exercise_attempts ea
      ON e.id=ea.exercise_id AND ea.user_id=target_user_id
    GROUP BY e.chapter ORDER BY e.chapter;
END;
$function$;

COMMIT;
