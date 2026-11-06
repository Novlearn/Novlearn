-- Public leaderboard RPCs intentionally expose public ranking fields only.
-- NULL LIMIT means unlimited in PostgreSQL: reject unbounded caller input.
CREATE OR REPLACE FUNCTION public.get_monthly_leaderboard(month_start timestamp with time zone, result_limit integer DEFAULT 10, sort_by text DEFAULT 'score'::text)
 RETURNS TABLE(user_id uuid, first_name text, last_name text, score integer, best_streak integer, rank bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF result_limit IS NULL OR result_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'result_limit must be between 1 and 100' USING ERRCODE='22023';
  END IF;
  -- Logique de tri dynamique
  IF sort_by = 'streak' THEN
    RETURN QUERY
    SELECT 
      ms.user_id,
      p.first_name,
      p.last_name,
      ms.score,
      ms.max_streak AS best_streak,
      -- Classement par Streak, puis Score pour départager
      ROW_NUMBER() OVER (ORDER BY ms.max_streak DESC, ms.score DESC) AS rank
    FROM public.monthly_scores ms
    LEFT JOIN public.profiles p ON ms.user_id = p.id
    WHERE 
      EXTRACT(MONTH FROM ms.month_date) = EXTRACT(MONTH FROM month_start)
      AND EXTRACT(YEAR FROM ms.month_date) = EXTRACT(YEAR FROM month_start)
    ORDER BY rank ASC
    LIMIT result_limit;
    
  ELSE
    -- Par défaut : Classement par Score
    RETURN QUERY
    SELECT 
      ms.user_id,
      p.first_name,
      p.last_name,
      ms.score,
      ms.max_streak AS best_streak,
      -- Classement par Score, puis Streak pour départager
      ROW_NUMBER() OVER (ORDER BY ms.score DESC, ms.max_streak DESC) AS rank
    FROM public.monthly_scores ms
    LEFT JOIN public.profiles p ON ms.user_id = p.id
    WHERE 
      EXTRACT(MONTH FROM ms.month_date) = EXTRACT(MONTH FROM month_start)
      AND EXTRACT(YEAR FROM ms.month_date) = EXTRACT(YEAR FROM month_start)
    ORDER BY rank ASC
    LIMIT result_limit;
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_success_rate_leaderboard(week_start timestamp with time zone, min_attempts integer DEFAULT 10, result_limit integer DEFAULT 20)
 RETURNS TABLE(user_id uuid, first_name text, last_name text, success_rate numeric, total_attempts bigint, correct_attempts bigint, rank bigint, crown_count integer, star_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF result_limit IS NULL OR result_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'result_limit must be between 1 and 100' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  WITH user_stats AS (
    SELECT
      ea.user_id,
      p.first_name,
      p.last_name,
      COUNT(*)                                          AS total_attempts,
      COUNT(*) FILTER (WHERE ea.is_correct = true)     AS correct_attempts,
      ROUND(
        COUNT(*) FILTER (WHERE ea.is_correct = true)::NUMERIC
        / NULLIF(COUNT(*), 0)::NUMERIC * 100,
        2
      )                                                 AS success_rate,
      p.crown_count,
      p.star_count
    FROM public.exercise_attempts ea
    JOIN public.profiles p ON p.id = ea.user_id
    WHERE ea.is_guest = false
      AND ea.attempted_at >= week_start
    GROUP BY ea.user_id, p.first_name, p.last_name, p.crown_count, p.star_count
    HAVING COUNT(*) >= min_attempts
  )
  SELECT
    us.user_id,
    us.first_name,
    us.last_name,
    us.success_rate,
    us.total_attempts,
    us.correct_attempts,
    ROW_NUMBER() OVER (
      ORDER BY us.success_rate DESC, us.total_attempts DESC
    ) AS rank,
    us.crown_count,
    us.star_count
  FROM user_stats us
  ORDER BY us.success_rate DESC, us.total_attempts DESC
  LIMIT result_limit;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_weekly_leaderboard(week_start timestamp with time zone, result_limit integer DEFAULT 10, sort_by text DEFAULT 'score'::text)
 RETURNS TABLE(user_id uuid, first_name text, last_name text, score bigint, best_streak bigint, rank bigint, crown_count integer, star_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF result_limit IS NULL OR result_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'result_limit must be between 1 and 100' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  WITH user_scores AS (
    SELECT
      ea.user_id,
      p.first_name,
      p.last_name,
      COUNT(*) AS score,
      COUNT(DISTINCT DATE(ea.attempted_at)) AS best_streak,
      p.crown_count,
      p.star_count
    FROM public.exercise_attempts ea
    LEFT JOIN public.profiles p ON p.id = ea.user_id
    WHERE ea.is_correct = true
      AND ea.attempted_at >= week_start
      AND ea.is_guest = false  -- exclure les tentatives des invités
    GROUP BY ea.user_id, p.first_name, p.last_name, p.crown_count, p.star_count
  ),
  ranked_scores AS (
    SELECT
      us.user_id,
      us.first_name,
      us.last_name,
      us.score,
      us.best_streak,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN sort_by = 'streak' THEN us.best_streak ELSE us.score END DESC
      ) AS rank,
      us.crown_count,
      us.star_count
    FROM user_scores us
  )
  SELECT
    rs.user_id,
    rs.first_name,
    rs.last_name,
    rs.score,
    rs.best_streak,
    rs.rank,
    rs.crown_count,
    rs.star_count
  FROM ranked_scores rs
  ORDER BY rs.rank
  LIMIT result_limit;
END;
$function$
;
