-- Local Lot 1A: explicit RPC permissions, NULL-safe ownership, trusted namespaces.
-- No reward algorithm, ranking metric, historic row or math rule is changed.
BEGIN;

REVOKE ALL ON FUNCTION public.award_weekly_top3() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.award_weekly_top3() TO service_role;
-- Latest reward body calls public ranking functions; pg_temp is explicitly last.
ALTER FUNCTION public.award_weekly_top3() SET search_path = pg_catalog,public,pg_temp;

-- All relations in these current bodies were reviewed as schema-qualified.
ALTER FUNCTION public.get_my_role() SET search_path = '';
ALTER FUNCTION public.is_guest() SET search_path = '';
ALTER FUNCTION public.get_monthly_leaderboard(timestamptz,integer,text) SET search_path = '';
ALTER FUNCTION public.get_weekly_leaderboard(timestamptz,integer,text) SET search_path = '';
ALTER FUNCTION public.get_success_rate_leaderboard(timestamptz,integer,integer) SET search_path = '';
ALTER FUNCTION public.handle_new_user() SET search_path = '';
ALTER FUNCTION public.handle_exercise_completion() SET search_path = '';
ALTER FUNCTION public.update_user_stats_on_attempt() SET search_path = '';
ALTER FUNCTION public.feedbacks_nullify_missing_profile() SET search_path = '';

-- Trigger invocation does not need an exposed client EXECUTE grant.
REVOKE ALL ON FUNCTION public.handle_new_user(),public.handle_exercise_completion(),
  public.update_user_stats_on_attempt(),public.feedbacks_nullify_missing_profile()
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_public_profile(target_user_id uuid)
RETURNS TABLE(id uuid,first_name text,last_name text,crown_count integer,star_count integer,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT p.id,p.first_name,p.last_name,p.crown_count,p.star_count,p.created_at
    FROM public.profiles p WHERE p.id=target_user_id AND auth.uid() IS NOT NULL
      AND NOT COALESCE((auth.jwt()->>'is_anonymous')::boolean,false);
$function$;
REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.find_user_by_friend_code(input_code text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE matched_user uuid;
BEGIN
  IF auth.uid() IS NULL OR COALESCE((auth.jwt()->>'is_anonymous')::boolean,false) THEN
    RAISE EXCEPTION 'permanent authenticated identity required' USING ERRCODE='42501';
  END IF;
  SELECT f.user_id INTO matched_user FROM public.friend_codes f
    WHERE f.code=input_code AND (f.expires_at IS NULL OR f.expires_at>now()) LIMIT 1;
  RETURN matched_user;
END;
$function$;
REVOKE ALL ON FUNCTION public.find_user_by_friend_code(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.find_user_by_friend_code(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_chapters_with_count(target_user_id uuid)
RETURNS TABLE(chapter_name text,total_exercises bigint,completed_exercises bigint,progress_percentage numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
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
REVOKE ALL ON FUNCTION public.get_chapters_with_count(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_chapters_with_count(uuid) TO authenticated;
COMMIT;
