-- Staging first. Keep server/service-role and editorial publication paths intact.
-- RLS does not restrict TRUNCATE. Remove non-row privileges from API roles.
DO $acl$
DECLARE t record;
BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
  EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.%I FROM PUBLIC, anon, authenticated',t.tablename);
 END LOOP;
END $acl$;

-- These mutations are performed by the authenticated FastAPI/Engine servers.
-- No browser caller, including an administrator, may forge authoritative state.
REVOKE INSERT, UPDATE, DELETE ON public.duels, public.friends,
 public.friend_requests, public.friend_codes, public.ds,
 public.ds_competence_scores, public.exercise_attempts,
 public.duel_attempts, public.user_competence_scores,
 public.user_progress FROM PUBLIC, anon, authenticated;

-- Deny as RLS as well, so an accidental future grant cannot reopen writes.
DO $rls$
DECLARE t text; action text;
BEGIN
 FOREACH t IN ARRAY ARRAY['duels','friends','friend_requests','friend_codes','ds','user_progress'] LOOP
  FOREACH action IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
   EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO anon, authenticated %s',
    'server_owned_'||lower(action),t,action,
    CASE action WHEN 'INSERT' THEN 'WITH CHECK (false)' WHEN 'UPDATE' THEN 'USING (false) WITH CHECK (false)' ELSE 'USING (false)' END);
  END LOOP;
 END LOOP;
END $rls$;

-- The feedback endpoint permits unauthenticated submissions, never client moderation.
CREATE POLICY feedback_pending_insert ON public.feedbacks AS RESTRICTIVE
 FOR INSERT TO anon, authenticated WITH CHECK (
 status = 'pending' AND (user_id IS NULL OR user_id=(SELECT auth.uid()))
 );

-- Pure helpers do not require the owner's privileges.
ALTER FUNCTION public.generate_random_code(integer) SECURITY INVOKER;
ALTER FUNCTION public.generate_random_code(integer) SET search_path = '';
ALTER FUNCTION public.is_guest() SECURITY INVOKER;
-- Prevent an RPC helper from allocating an arbitrary-length string.
CREATE OR REPLACE FUNCTION public.generate_random_code(length integer DEFAULT 8)
 RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; result text := ''; i integer;
BEGIN
 IF length IS NULL OR length < 1 OR length > 64 THEN
  RAISE EXCEPTION 'code length must be between 1 and 64' USING ERRCODE='22023';
 END IF;
 FOR i IN 1..length LOOP
  result := result || pg_catalog.substr(chars,pg_catalog.floor(pg_catalog.random()*pg_catalog.length(chars)+1)::integer,1);
 END LOOP;
 RETURN result;
END $function$;
-- This reader must obey catalogue RLS, including unpublished drafts.
ALTER FUNCTION public.get_random_exercise(text,text) SECURITY INVOKER;
ALTER FUNCTION public.get_random_exercise(text,text) SET search_path = '';
REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM PUBLIC, anon;
-- Preserve authenticated use from profile policies.
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;
