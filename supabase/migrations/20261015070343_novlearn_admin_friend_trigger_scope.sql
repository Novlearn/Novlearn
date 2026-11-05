-- Local defensive hardening: preserve existing triggers and all table rows.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_friend_code_for_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE new_code text; code_exists boolean;
BEGIN
  IF TG_RELID <> 'auth.users'::regclass OR TG_OP <> 'INSERT' OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW' THEN
    RAISE EXCEPTION 'Friend code trigger context is not permitted' USING ERRCODE = '42501';
  END IF;
  LOOP
    new_code := public.generate_random_code(8);
    SELECT EXISTS(SELECT 1 FROM public.friend_codes WHERE code = new_code) INTO code_exists;
    EXIT WHEN NOT code_exists;
  END LOOP;
  INSERT INTO public.friend_codes(user_id, code) VALUES (NEW.id, new_code);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_friend_request_acceptance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_RELID <> 'public.friend_requests'::regclass OR TG_OP <> 'UPDATE' OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW' THEN
    RAISE EXCEPTION 'Friend acceptance trigger context is not permitted' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    INSERT INTO public.friends(user1_id, user2_id, status)
    VALUES (LEAST(NEW.from_user_id, NEW.to_user_id), GREATEST(NEW.from_user_id, NEW.to_user_id), 'accepted')
    ON CONFLICT (user1_id, user2_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- PostgreSQL checks EXECUTE when attaching a trigger, not on each invocation.
-- Existing Auth and friend-request triggers therefore keep working.
REVOKE ALL ON FUNCTION public.create_friend_code_for_new_user(), public.handle_friend_request_acceptance()
FROM PUBLIC, anon, authenticated, service_role, novlearn_publication_executor, novlearn_publication_writer;
COMMIT;
