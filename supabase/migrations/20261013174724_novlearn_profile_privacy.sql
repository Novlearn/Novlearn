-- Local Lot 1A: protect other users' private profile fields and privileged RPCs.
-- Social readers receive only the existing public name/avatar fields.
BEGIN;
DROP POLICY IF EXISTS profiles_select_others ON public.profiles;
CREATE POLICY novlearn_profiles_select_self_or_admin
  ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT public.is_novlearn_admin()));
CREATE POLICY novlearn_profiles_admin_read
  ON public.profiles FOR SELECT TO authenticated
  USING ((SELECT public.is_novlearn_admin()));

CREATE FUNCTION public.get_public_profiles(p_ids uuid[])
RETURNS TABLE(id uuid,first_name text,last_name text,avatar_id text,avatar_color text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF auth.uid() IS NULL OR COALESCE((auth.jwt()->>'is_anonymous')::boolean,false) THEN
    RAISE EXCEPTION 'permanent authenticated identity required' USING ERRCODE='42501';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids)>100 THEN
    RAISE EXCEPTION 'request at most 100 explicit profile IDs' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT p.id,p.first_name,p.last_name,p.avatar_id,p.avatar_color
    FROM public.profiles p WHERE p.id=ANY(p_ids) ORDER BY p.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_profile(target_user_id uuid)
RETURNS TABLE(id uuid,email text,first_name text,last_name text,birth_date date,
  role text,created_at timestamptz,consent_date timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $function$
  SELECT p.id,p.email,p.first_name,p.last_name,p.birth_date,p.role,p.created_at,p.consent_date
    FROM public.profiles p WHERE p.id=target_user_id AND (SELECT public.is_novlearn_admin());
$function$;
REVOKE ALL ON FUNCTION public.admin_get_profile(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_get_profile(uuid) TO authenticated;

-- Historical RPC had a NULL-unsafe identity comparison and returned friend email.
CREATE OR REPLACE FUNCTION public.get_friends_and_requests(target_user_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE friends_list json; requests_list json;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM target_user_id OR
    COALESCE((auth.jwt()->>'is_anonymous')::boolean,false) THEN
    RAISE EXCEPTION 'own permanent identity required' USING ERRCODE='42501';
  END IF;
  SELECT json_agg(t) INTO friends_list FROM (
    SELECT p.id,p.first_name,p.last_name,f.id AS friendship_id
    FROM public.friends f JOIN public.profiles p ON p.id=CASE
      WHEN f.user1_id=target_user_id THEN f.user2_id ELSE f.user1_id END
    WHERE (f.user1_id=target_user_id OR f.user2_id=target_user_id) AND f.status='accepted'
  ) t;
  SELECT json_agg(t) INTO requests_list FROM (
    SELECT fr.id AS request_id,p.id AS from_user_id,p.first_name,p.last_name
    FROM public.friend_requests fr JOIN public.profiles p ON p.id=fr.from_user_id
    WHERE fr.to_user_id=target_user_id AND fr.status='pending'
  ) t;
  RETURN json_build_object('friends',COALESCE(friends_list,'[]'::json),
    'requests',COALESCE(requests_list,'[]'::json));
END;
$function$;
REVOKE ALL ON FUNCTION public.get_friends_and_requests(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_friends_and_requests(uuid) TO authenticated;
COMMIT;
