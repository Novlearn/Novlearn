-- Schema-only exercise-attempt triggers observed on Production 2026-11-13.
ALTER TABLE public.profiles ADD COLUMN max_streak integer DEFAULT 0, ADD COLUMN updated_at timestamptz DEFAULT now();
CREATE TABLE public.monthly_scores(user_id uuid,month_date date,score integer,exercises_count integer,max_streak integer,
 updated_at timestamptz DEFAULT now(),PRIMARY KEY(user_id,month_date));
CREATE TABLE public.user_stats(user_id uuid PRIMARY KEY,total_attempts integer,correct_attempts integer,total_score integer,updated_at timestamptz);
CREATE OR REPLACE FUNCTION public.handle_exercise_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
;
CREATE TRIGGER on_exercise_attempt_process AFTER INSERT ON public.exercise_attempts FOR EACH ROW EXECUTE FUNCTION handle_exercise_completion();
CREATE OR REPLACE FUNCTION public.update_user_stats_on_attempt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.is_guest = true OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_stats (user_id, total_attempts, correct_attempts, total_score, updated_at)
  VALUES (
    NEW.user_id,
    1,
    CASE WHEN NEW.is_correct THEN 1 ELSE 0 END,
    COALESCE(NEW.score, 0),
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_attempts   = public.user_stats.total_attempts   + 1,
    correct_attempts = public.user_stats.correct_attempts + CASE WHEN NEW.is_correct THEN 1 ELSE 0 END,
    total_score      = public.user_stats.total_score      + COALESCE(NEW.score, 0),
    updated_at       = NOW();

  RETURN NEW;
END;
$function$
;
CREATE TRIGGER trg_update_user_stats AFTER INSERT ON public.exercise_attempts FOR EACH ROW EXECUTE FUNCTION update_user_stats_on_attempt();
