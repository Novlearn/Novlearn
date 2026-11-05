-- PROPOSAL ONLY — do not apply directly.
-- Reviewed against migrations 024 and 025. This file is intentionally outside
-- supabase/migrations so `db:push` will not execute it.
-- Before adoption: inventory every client and service-role consumer, replace
-- them with narrow server endpoints/RPCs, then test against a staging branch.

begin;

-- 1) Close table-level exercise disclosure. Today migration 025 grants both
-- anon and authenticated unrestricted SELECT, which exposes content JSON.
drop policy if exists "Tout le monde peut voir les exercices" on public.exercises;
drop policy if exists "Utilisateurs authentifiés peuvent voir les exercices" on public.exercises;
revoke select on public.exercises from anon, authenticated;

-- 2) The catalog is metadata only. A SECURITY DEFINER RPC must be owned by a
-- trusted role, use a fixed search_path, and return no content JSON.
create or replace function public.get_exercise_catalog()
returns table (
  id bigint,
  title text,
  app_title text,
  chapter text,
  difficulty text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select e.id, e.title, e.app_title, e.chapter, e.difficulty, e.created_at
  from public.exercises e
  where auth.uid() is not null
  order by e.created_at desc;
$$;
revoke all on function public.get_exercise_catalog() from public, anon;
grant execute on function public.get_exercise_catalog() to authenticated;

-- 3) Never expose get_random_exercise's full row to student JWTs. The duel
-- server currently selects content with its service key and can continue to
-- do so server-side; clients must receive only a prompt projection. Do not
-- re-grant this function until a replacement returns an explicit safe shape.
revoke all on function public.get_random_exercise(text, text) from public, anon, authenticated;

-- 4) Profiles: drop broad authenticated reads. Keep self reads; public names
-- needed by leaderboards/friends should come from a dedicated narrow RPC that
-- returns only id, first_name, last_name, avatar_id, avatar_color.
drop policy if exists "profiles_select_others" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "Authenticated can read profiles for leaderboard" on public.profiles;
drop policy if exists "Users can view own profile" on public.profiles;
-- This permissive FOR ALL policy also grants SELECT to every non-guest user.
drop policy if exists "No guest access to profiles" on public.profiles;
create policy "profiles_select_own_only"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id and not is_guest());
-- Restore self-service writes with explicit row ownership and guest exclusion.
create policy "profiles_insert_own_only"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id and not is_guest());
create policy "profiles_update_own_only"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id and not is_guest())
  with check ((select auth.uid()) = id and role = get_my_role() and not is_guest());

commit;

-- Staging checks required before deployment:
-- * anon: exercises table SELECT denied; catalog/RPC denied; profiles denied.
-- * authenticated student: catalog succeeds without content; profiles SELECT
--   returns own row only; get_random_exercise denied.
-- * admin: catalog succeeds; admin exercise/profile workflows use a trusted
--   server API and retain the required fields.
-- This proposal intentionally does not include a student exercise detail RPC:
-- the current browser graders need correctAnswer/answer/explanation values.
-- Move grading server-side before detail delivery can safely omit those fields.
