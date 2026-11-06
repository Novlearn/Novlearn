
BEGIN;
INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('f6110600-0000-4000-8000-000000000001','authenticated','authenticated','security-a@novlearn.invalid','{}','{"first_name":"Security test","birth_date":"2000-01-01"}',now(),now()),
('f6110600-0000-4000-8000-000000000002','authenticated','authenticated','security-b@novlearn.invalid','{}','{"first_name":"Security test","birth_date":"2000-01-01"}',now(),now());

-- Fixtures use explicit keys; every row is rolled back.
INSERT INTO public.duels(id,player1_id,player2_id,status) VALUES
 (-611060001,'f6110600-0000-4000-8000-000000000002','f6110600-0000-4000-8000-000000000002','waiting');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f6110600-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"f6110600-0000-4000-8000-000000000001","is_anonymous":false,"user_metadata":{"role":"admin"}}',true);
DO $test$
DECLARE t record; n integer;
BEGIN
 IF public.is_novlearn_admin() THEN RAISE EXCEPTION 'metadata escalation'; END IF;
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
  IF has_table_privilege(current_user,format('public.%I',t.tablename),'TRUNCATE') THEN RAISE EXCEPTION 'truncate allowed: %',t.tablename; END IF;
 END LOOP;
 IF (SELECT count(*) FROM public.profiles)<>1 THEN RAISE EXCEPTION 'cross-profile read'; END IF;
 IF EXISTS(SELECT 1 FROM public.exercise_versions) THEN RAISE EXCEPTION 'answer definitions leaked'; END IF;
 IF EXISTS(SELECT 1 FROM public.exercises WHERE active_version_id IS NULL AND catalog_id IS NOT NULL) THEN RAISE EXCEPTION 'draft leaked'; END IF;
 IF EXISTS(SELECT 1 FROM public.duels WHERE id=-611060001) THEN RAISE EXCEPTION 'other duel leaked'; END IF;
 UPDATE public.profiles SET first_name='Allowed self edit' WHERE id=auth.uid();
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'self edit broken'; END IF;
 BEGIN UPDATE public.profiles SET role='admin' WHERE id=auth.uid(); RAISE EXCEPTION 'role escalation allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.profiles SET crown_count=999 WHERE id=auth.uid(); RAISE EXCEPTION 'reward forgery allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.friends(id,user1_id,user2_id,status) VALUES(-611060001,auth.uid(),'f6110600-0000-4000-8000-000000000002','accepted'); RAISE EXCEPTION 'friendship forgery allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.duels SET player1_score=999 WHERE id=-611060001; RAISE EXCEPTION 'duel score update allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 FOR t IN SELECT unnest(ARRAY['ds','ds_competence_scores','exercise_attempts','duel_attempts','user_competence_scores','user_progress','friends','friend_requests','friend_codes','duels']) AS name LOOP
  IF has_table_privilege(current_user,format('public.%I',t.name),'INSERT') OR has_table_privilege(current_user,format('public.%I',t.name),'UPDATE') OR has_table_privilege(current_user,format('public.%I',t.name),'DELETE') THEN RAISE EXCEPTION 'authoritative write grant on %',t.name; END IF;
 END LOOP;
 BEGIN PERFORM public.get_friends_and_requests('f6110600-0000-4000-8000-000000000002'); RAISE EXCEPTION 'friends RPC IDOR'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.publish_exercise_version(1,gen_random_uuid()); RAISE EXCEPTION 'student publish allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM * FROM public.engine_exercise_sessions; RAISE EXCEPTION 'private solutions read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.generate_random_code(1000000); RAISE EXCEPTION 'unbounded RPC'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF length(public.generate_random_code(8))<>8 THEN RAISE EXCEPTION 'code generation broken'; END IF;
 PERFORM public.get_random_exercise();
END $test$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"f6110600-0000-4000-8000-000000000001","is_anonymous":true,"user_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
DO $guest$ BEGIN
 IF public.is_novlearn_admin() THEN RAISE EXCEPTION 'guest admin'; END IF;
 IF EXISTS(SELECT 1 FROM public.profiles) THEN RAISE EXCEPTION 'guest profiles'; END IF;
 IF EXISTS(SELECT 1 FROM public.exercise_versions) THEN RAISE EXCEPTION 'guest definitions'; END IF;
END $guest$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE anon;
DO $anon$ BEGIN
 IF EXISTS(SELECT 1 FROM public.profiles) THEN RAISE EXCEPTION 'anonymous profiles'; END IF;
 IF EXISTS(SELECT 1 FROM public.exercises WHERE active_version_id IS NULL AND catalog_id IS NOT NULL) THEN RAISE EXCEPTION 'anonymous draft'; END IF;
 PERFORM public.get_random_exercise();
 BEGIN PERFORM public.get_my_role(); RAISE EXCEPTION 'anonymous role RPC'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $anon$;
RESET ROLE;
-- Admin must keep access to drafts and editorial RPC; service must keep authoritative writes.
UPDATE public.profiles SET role='admin' WHERE id='f6110600-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','f6110600-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"f6110600-0000-4000-8000-000000000001","is_anonymous":false}',true);
SET LOCAL ROLE authenticated;
DO $admin$ BEGIN
 IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'admin blocked'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.exercise_versions) THEN RAISE EXCEPTION 'admin versions blocked'; END IF;
 PERFORM public.admin_list_exercises();
END $admin$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $server$ BEGIN
 UPDATE public.duels SET player1_score=1 WHERE id=-611060001;
 IF NOT FOUND THEN RAISE EXCEPTION 'service duel write broken'; END IF;
END $server$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: real PostgreSQL roles, row isolation, forged metadata, role/reward/score writes, private definitions, guest/anon isolation, admin read and service writes; all fixtures rolled back' AS result;
