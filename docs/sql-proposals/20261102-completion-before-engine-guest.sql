CREATE OR REPLACE FUNCTION public.handle_exercise_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  points_to_add    INT;
  difficulty_level TEXT;
  new_streak       INT;
  safe_exercise_id BIGINT;
BEGIN
  BEGIN
    safe_exercise_id := CAST(NEW.exercise_id AS BIGINT);
  EXCEPTION WHEN OTHERS THEN
    safe_exercise_id := NULL;
  END;

  IF safe_exercise_id IS NOT NULL THEN
    SELECT difficulty INTO difficulty_level
    FROM public.exercises WHERE id = safe_exercise_id;
  END IF;

  CASE LOWER(TRIM(difficulty_level))
    WHEN 'medium'    THEN points_to_add := 2;
    WHEN 'moyen'     THEN points_to_add := 2;
    WHEN 'hard'      THEN points_to_add := 3;
    WHEN 'difficile' THEN points_to_add := 3;
    ELSE                  points_to_add := 1;
  END CASE;

  IF NEW.is_correct = TRUE THEN
    UPDATE public.profiles
    SET current_streak = CASE
                           WHEN COALESCE(current_streak, 0) < 0 THEN 1
                           ELSE COALESCE(current_streak, 0) + 1
                         END,
        max_streak     = GREATEST(
                           COALESCE(max_streak, 0),
                           CASE
                             WHEN COALESCE(current_streak, 0) < 0 THEN 1
                             ELSE COALESCE(current_streak, 0) + 1
                           END
                         ),
        updated_at     = NOW()
    WHERE id = NEW.user_id
    RETURNING current_streak INTO new_streak;

    INSERT INTO public.monthly_scores (user_id, month_date, score, exercises_count, max_streak)
    VALUES (
      NEW.user_id,
      DATE_TRUNC('month', NEW.attempted_at)::DATE,
      points_to_add,
      1,
      new_streak
    )
    ON CONFLICT (user_id, month_date) DO UPDATE SET
      score           = monthly_scores.score + EXCLUDED.score,
      exercises_count = monthly_scores.exercises_count + 1,
      max_streak      = GREATEST(monthly_scores.max_streak, EXCLUDED.max_streak),
      updated_at      = NOW();

  ELSE
    UPDATE public.profiles
    SET current_streak = CASE
                           WHEN COALESCE(current_streak, 0) > 0 THEN -1
                           ELSE COALESCE(current_streak, 0) - 1
                         END,
        updated_at     = NOW()
    WHERE id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$function$
