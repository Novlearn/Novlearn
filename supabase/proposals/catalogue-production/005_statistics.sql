-- PROPOSAL ONLY. Preserve the observed historical trigger and its null-version
-- path. Versioned Engine activity scores its pinned difficulty, never the new
-- parent header after a synchronization. Guest Engine work awards no rewards.
BEGIN;
DO $$ BEGIN
 IF (SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_proc
     WHERE oid='public.handle_exercise_completion()'::regprocedure) IS DISTINCT FROM 'c9b134058cc34617182bd86a8f7eb35d' THEN
  RAISE EXCEPTION 'historical completion trigger changed; reconcile before migrating'; END IF;
END $$;
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
  IF NEW.exercise_version_id IS NOT NULL AND NEW.is_guest THEN RETURN NEW; END IF;
  BEGIN
    safe_exercise_id := CAST(NEW.exercise_id AS BIGINT);
  EXCEPTION WHEN OTHERS THEN
    safe_exercise_id := NULL;
  END;

  IF NEW.exercise_version_id IS NOT NULL THEN
    SELECT CASE v.publication_origin WHEN 'historical' THEN h.original->>'difficulty'
      ELSE CASE v.definition->'catalogue'->>'difficulty' WHEN '1' THEN 'easy' WHEN '2' THEN 'medium'
        WHEN '3' THEN 'hard' ELSE v.definition->'catalogue'->>'difficulty' END END
      INTO difficulty_level FROM public.exercise_versions v
      LEFT JOIN novlearn_admin_private.historical_exercise_snapshots h ON h.exercise_id=v.exercise_id
      WHERE v.exercise_id=safe_exercise_id AND v.id=NEW.exercise_version_id;
  ELSIF safe_exercise_id IS NOT NULL THEN
    SELECT difficulty INTO difficulty_level FROM public.exercises WHERE id=safe_exercise_id;
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
COMMIT;
