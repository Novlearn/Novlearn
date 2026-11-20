-- Schema-only definitions observed on historical Production, 2026-11-13.
CREATE OR REPLACE FUNCTION public.get_chapters_with_count(target_user_id uuid)
 RETURNS TABLE(chapter_name text, total_exercises bigint, completed_exercises bigint, progress_percentage numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Sécurité : uniquement ses propres données
  IF auth.uid() != target_user_id THEN
    RAISE EXCEPTION 'Accès non autorisé';
  END IF;

  RETURN QUERY
  SELECT
    e.chapter as chapter_name,
    COUNT(DISTINCT e.id) as total_exercises,
    COUNT(DISTINCT ea.exercise_id) FILTER (WHERE ea.user_id = target_user_id AND ea.is_correct = true) as completed_exercises,
    CASE
      WHEN COUNT(DISTINCT e.id) = 0 THEN 0
      ELSE ROUND((COUNT(DISTINCT ea.exercise_id) FILTER (WHERE ea.user_id = target_user_id AND ea.is_correct = true)::numeric / COUNT(DISTINCT e.id)::numeric) * 100, 1)
    END as progress_percentage
  FROM public.exercises e
  LEFT JOIN public.exercise_attempts ea ON e.id = ea.exercise_id AND ea.user_id = target_user_id
  GROUP BY e.chapter
  ORDER BY e.chapter;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_random_exercise(p_chapter text DEFAULT NULL::text, p_difficulty text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
