-- Ongoing private snapshots; completed replay uses the existing replay tables.
BEGIN;
CREATE TABLE public.engine_exercise_sessions (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 exercise_id bigint NOT NULL REFERENCES public.exercises(id),
 exercise_version_id uuid NOT NULL REFERENCES public.exercise_versions(id),
 definition_sha256 text NOT NULL CHECK (definition_sha256 ~ '^[a-f0-9]{64}$'),
 official jsonb NOT NULL CHECK (jsonb_typeof(official)='object' AND octet_length(official::text)<2097152),
 public_instance jsonb NOT NULL CHECK (jsonb_typeof(public_instance)='object'),
 metadata jsonb NOT NULL,
 state jsonb NOT NULL DEFAULT '{"questions":{}}',
 revision integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','skipped','abandoned')),
 attempt_id bigint UNIQUE REFERENCES public.exercise_attempts(id),
 context_result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours'
);
CREATE INDEX engine_sessions_owner_active ON public.engine_exercise_sessions(owner_id,exercise_id,created_at DESC) WHERE status='active';
ALTER TABLE public.engine_exercise_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engine_exercise_sessions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.engine_exercise_sessions TO service_role;

-- Caller is the trusted application, never a browser. Revision prevents lost updates.
CREATE FUNCTION public.engine_transition_session(p_id uuid,p_owner uuid,p_revision integer,p_state jsonb,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s public.engine_exercise_sessions; correct boolean; cid text; level integer; aid bigint;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,0));
 SELECT * INTO s FROM public.engine_exercise_sessions WHERE id=p_id AND owner_id=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'instance unavailable' USING ERRCODE='P0002'; END IF;
 IF s.revision<>p_revision OR s.status<>'active' THEN RAISE EXCEPTION 'instance changed' USING ERRCODE='40001'; END IF;
 IF p_status NOT IN ('active','completed','skipped','abandoned') OR jsonb_typeof(p_state)<>'object' OR octet_length(p_state::text)>131072 THEN
  RAISE EXCEPTION 'invalid transition'; END IF;
 IF p_status='completed' AND s.expires_at<=now() THEN RAISE EXCEPTION 'instance expired'; END IF;
 IF (p_status='completed' OR p_status='abandoned' AND COALESCE((s.metadata->>'trackAbandon')::boolean,false)) AND NOT COALESCE((s.metadata->>'preview')::boolean,false) THEN
  correct:=p_status='completed' AND COALESCE((p_state->>'correct')::boolean,false);
  INSERT INTO public.exercise_attempts(user_id,exercise_id,exercise_version_id,is_correct,is_abandoned,is_guest)
   VALUES(s.owner_id,s.exercise_id,s.exercise_version_id,correct,p_status='abandoned',COALESCE((s.metadata->>'guest')::boolean,false)) RETURNING id INTO aid;
  INSERT INTO public.exercise_attempt_instances(attempt_id,instance_seed,generation_version,instance_data)
   VALUES(aid,s.official->'generation'->>'seed',s.official->'generation'->>'version',s.official);
  INSERT INTO public.exercise_attempt_replay_artifacts(attempt_id,replay_data) VALUES(aid,jsonb_build_object('official',s.official,'state',p_state));
  IF s.metadata->>'mode'='practice' AND COALESCE((s.metadata->>'countPoints')::boolean,false) THEN
   level:=CASE lower(s.metadata->>'difficulty') WHEN 'medium' THEN 1 WHEN 'moyen' THEN 1 WHEN 'hard' THEN 2 WHEN 'difficile' THEN 2 ELSE 0 END;
   FOR cid IN SELECT jsonb_array_elements_text(s.metadata->'competences') LOOP
    INSERT INTO public.user_competence_scores(user_id,competence_id,points,streak)
     SELECT s.owner_id,c.id,0,0 FROM public.competences c WHERE c.id=cid ON CONFLICT DO NOTHING;
    UPDATE public.user_competence_scores u SET
     points=CASE WHEN correct THEN least(c.max_points,u.points+level+1+CASE WHEN u.streak<1 THEN 0 WHEN u.streak<3 THEN 1 WHEN u.streak<5 THEN 2 ELSE 3 END) ELSE u.points END,
     streak=CASE WHEN correct THEN u.streak+1 ELSE 0 END,updated_at=now()
     FROM public.competences c WHERE u.user_id=s.owner_id AND u.competence_id=cid AND c.id=cid;
   END LOOP;
  END IF;
 END IF;
 UPDATE public.engine_exercise_sessions SET state=p_state,status=p_status,revision=revision+1,attempt_id=aid
  WHERE id=s.id RETURNING * INTO s;
 RETURN jsonb_build_object('revision',s.revision,'status',s.status,'attemptId',s.attempt_id);
END $$;
REVOKE ALL ON FUNCTION public.engine_transition_session(uuid,uuid,integer,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.engine_transition_session(uuid,uuid,integer,jsonb,text) TO service_role;

-- DS scoring stays on the existing submit route, with one application per snapshot.
CREATE FUNCTION public.engine_apply_ds_result(p_id uuid,p_owner uuid,p_ds uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s public.engine_exercise_sessions; d public.ds; correct boolean; delta integer;
BEGIN
 SELECT * INTO s FROM public.engine_exercise_sessions WHERE id=p_id AND owner_id=p_owner FOR UPDATE;
 IF NOT FOUND OR s.metadata->>'mode'<>'ds' OR s.metadata->>'dsId' IS DISTINCT FROM p_ds::text OR s.status NOT IN ('completed','skipped') OR COALESCE((s.metadata->>'preview')::boolean,false)
 THEN RAISE EXCEPTION 'invalid DS receipt'; END IF;
 IF s.context_result IS NOT NULL THEN RETURN s.context_result; END IF;
 SELECT * INTO d FROM public.ds WHERE id=p_ds AND user_id=p_owner FOR UPDATE;
 IF NOT FOUND OR d.deadline<=now() THEN RAISE EXCEPTION 'DS unavailable'; END IF;
 IF s.status='completed' THEN
  correct:=COALESCE((s.state->>'correct')::boolean,false);
  delta:=CASE WHEN NOT correct THEN 0 WHEN lower(s.metadata->>'difficulty') IN ('medium','moyen') THEN 2 WHEN lower(s.metadata->>'difficulty') IN ('hard','difficile') THEN 3 ELSE 1 END;
  UPDATE public.ds_competence_scores SET points=least(max_points,points+delta),updated_at=now()
   WHERE ds_id=p_ds AND competence_id IN (SELECT jsonb_array_elements_text(s.metadata->'competences')) AND competence_id=ANY(d.competence_ids);
  UPDATE public.ds SET current_streak=greatest(-10,least(10,current_streak+CASE WHEN correct THEN 1 ELSE -1 END)) WHERE id=p_ds;
 END IF;
 UPDATE public.engine_exercise_sessions SET context_result='{"message":"Réponse enregistrée"}' WHERE id=s.id;
 RETURN '{"message":"Réponse enregistrée"}'::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.engine_apply_ds_result(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.engine_apply_ds_result(uuid,uuid,uuid) TO service_role;
COMMIT;
