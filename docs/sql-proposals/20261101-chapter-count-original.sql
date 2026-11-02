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
