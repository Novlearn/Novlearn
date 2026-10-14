-- Local Lot 1A: derived statistics are written only by trusted server paths.
-- Existing rows are preserved; no recalculation, backfill or reward reset.
BEGIN;
CREATE FUNCTION public.protect_novlearn_profile_statistics()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF current_user IN ('anon','authenticated') THEN
    IF TG_OP='INSERT' AND (NEW.crown_count IS DISTINCT FROM 0 OR
      NEW.star_count IS DISTINCT FROM 0 OR NEW.current_streak IS DISTINCT FROM 0 OR
      NEW.max_streak IS DISTINCT FROM 0) THEN
      RAISE EXCEPTION 'profile statistics are server-owned' USING ERRCODE='42501';
    ELSIF TG_OP='UPDATE' AND (NEW.crown_count IS DISTINCT FROM OLD.crown_count OR
      NEW.star_count IS DISTINCT FROM OLD.star_count OR
      NEW.current_streak IS DISTINCT FROM OLD.current_streak OR
      NEW.max_streak IS DISTINCT FROM OLD.max_streak) THEN
      RAISE EXCEPTION 'profile statistics are server-owned' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER novlearn_profile_statistics_before_write
  BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW
  EXECUTE FUNCTION public.protect_novlearn_profile_statistics();
REVOKE ALL ON FUNCTION public.protect_novlearn_profile_statistics() FROM PUBLIC,anon,authenticated;

-- Readers remain governed by existing grants/RLS. Keep server triggers/jobs
-- working; prevent direct client table mutations.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.monthly_scores,public.user_stats,
  public.user_weekly_rewards,public.leaderboard_snapshots FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.monthly_scores,public.user_stats,
  public.user_weekly_rewards,public.leaderboard_snapshots TO service_role;
COMMIT;
