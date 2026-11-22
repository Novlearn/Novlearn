-- PROPOSAL ONLY. Selected runtime DDL, not the Staging migration chain.
BEGIN;
CREATE TABLE public.exercise_attempt_instances (
  attempt_id bigint PRIMARY KEY REFERENCES public.exercise_attempts(id) ON DELETE RESTRICT,
  instance_seed text NOT NULL,
  generation_version text NOT NULL CHECK (length(generation_version) > 0),
  instance_data jsonb NOT NULL CHECK (jsonb_typeof(instance_data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.exercise_attempt_instances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exercise_attempt_instances FROM PUBLIC, anon, authenticated;

CREATE TABLE public.exercise_attempt_replay_artifacts (
  attempt_id bigint PRIMARY KEY REFERENCES public.exercise_attempts(id) ON DELETE RESTRICT,
  replay_data jsonb NOT NULL CHECK (jsonb_typeof(replay_data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.exercise_attempt_replay_artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exercise_attempt_replay_artifacts FROM PUBLIC, anon, authenticated;

CREATE TABLE public.duel_exercise_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  duel_id bigint NOT NULL REFERENCES public.duels(id) ON DELETE RESTRICT,
  round_number integer NOT NULL CHECK (round_number > 0),
  exercise_id bigint NOT NULL,
  exercise_version_id uuid NOT NULL,
  instance_seed text NOT NULL,
  generation_version text NOT NULL CHECK (length(generation_version) > 0),
  replay_data jsonb NOT NULL CHECK (jsonb_typeof(replay_data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT duel_exercise_instances_round_key UNIQUE (duel_id, round_number),
  CONSTRAINT duel_exercise_instances_id_version_key UNIQUE (id, exercise_version_id),
  CONSTRAINT duel_exercise_instances_duel_id_key UNIQUE (duel_id, id),
  CONSTRAINT duel_exercise_instances_version_fk FOREIGN KEY (exercise_id, exercise_version_id)
    REFERENCES public.exercise_versions (exercise_id, id) ON DELETE RESTRICT
);
ALTER TABLE public.duel_exercise_instances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.duel_exercise_instances FROM PUBLIC, anon, authenticated;

ALTER TABLE public.duel_attempts
  ADD COLUMN duel_exercise_instance_id uuid,
  ADD CONSTRAINT duel_attempts_instance_fk FOREIGN KEY (duel_id, duel_exercise_instance_id)
    REFERENCES public.duel_exercise_instances (duel_id, id) ON DELETE RESTRICT;
CREATE INDEX duel_attempts_instance_idx ON public.duel_attempts (duel_exercise_instance_id)
  WHERE duel_exercise_instance_id IS NOT NULL;

CREATE FUNCTION public.require_published_duel_exercise_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.exercise_versions
    WHERE exercise_id = NEW.exercise_id AND id = NEW.exercise_version_id
      AND editorial_status = 'published'
  ) THEN
    RAISE EXCEPTION 'duel instance must reference a published exercise version';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER duel_exercise_instance_published_version
  BEFORE INSERT OR UPDATE OF exercise_id, exercise_version_id ON public.duel_exercise_instances
  FOR EACH ROW EXECUTE FUNCTION public.require_published_duel_exercise_version();
REVOKE ALL ON FUNCTION public.require_published_duel_exercise_version() FROM PUBLIC, anon, authenticated;

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
CREATE FUNCTION public.require_published_active_exercise_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE version_status text;
BEGIN
  IF NEW.active_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT editorial_status INTO version_status
    FROM public.exercise_versions
    WHERE exercise_id = NEW.id AND id = NEW.active_version_id;
  IF version_status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'active exercise version must be published';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER exercises_active_version_before_change
  BEFORE INSERT OR UPDATE OF active_version_id ON public.exercises
  FOR EACH ROW EXECUTE FUNCTION public.require_published_active_exercise_version();
REVOKE ALL ON FUNCTION public.require_published_active_exercise_version() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION novlearn_admin_private.publication_header(p_definition jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE chapter_ref text:=p_definition->'catalogue'->>'chapter'; chapter_row public.chapters%ROWTYPE;
  skill_ref text; skill_row public.competences%ROWTYPE; count_matches integer; skill_ids text[]:='{}'; difficulty numeric;
BEGIN
  IF chapter_ref IS NULL OR btrim(chapter_ref)='' THEN RAISE EXCEPTION 'chapter required' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO count_matches FROM public.chapters WHERE name=chapter_ref;
  IF count_matches<>1 THEN RAISE EXCEPTION 'primary chapter missing or ambiguous' USING ERRCODE='22023'; END IF;
  SELECT * INTO chapter_row FROM public.chapters WHERE name=chapter_ref FOR SHARE;
  IF jsonb_typeof(COALESCE(p_definition->'catalogue'->'skills','[]'::jsonb))<>'array' THEN RAISE EXCEPTION 'invalid skills' USING ERRCODE='22023'; END IF;
  FOR skill_ref IN SELECT value FROM jsonb_array_elements_text(COALESCE(p_definition->'catalogue'->'skills','[]'::jsonb)) LOOP
    SELECT count(*) INTO count_matches FROM public.competences WHERE id=skill_ref;
    IF count_matches<>1 THEN RAISE EXCEPTION 'target skill missing or ambiguous' USING ERRCODE='22023'; END IF;
    SELECT * INTO skill_row FROM public.competences WHERE id=skill_ref FOR SHARE;
    IF skill_row.id=ANY(skill_ids) THEN RAISE EXCEPTION 'duplicate resolved skill' USING ERRCODE='22023'; END IF;
    skill_ids:=array_append(skill_ids,skill_row.id);
  END LOOP;
  IF p_definition->'catalogue' ? 'difficulty' THEN
    IF jsonb_typeof(p_definition->'catalogue'->'difficulty')<>'number' THEN RAISE EXCEPTION 'invalid difficulty' USING ERRCODE='22023'; END IF;
    difficulty:=(p_definition->'catalogue'->>'difficulty')::numeric;
    IF difficulty NOT IN (1,2,3) THEN RAISE EXCEPTION 'legacy target supports difficulty 1 2 or 3 only' USING ERRCODE='22023'; END IF;
  END IF;
  RETURN jsonb_build_object('title',p_definition->>'title','chapter',chapter_row.name,'competences',to_jsonb(skill_ids),
    'difficulty',CASE difficulty WHEN 1 THEN 'easy' WHEN 2 THEN 'medium' WHEN 3 THEN 'hard' ELSE NULL END,
    'app_title',COALESCE(p_definition->'catalogue'->>'appTitle',p_definition->>'title'),
    'Is_Flash',COALESCE(p_definition->'catalogue'->>'exerciseType','classic')='flash',
    'Need_Calculator',COALESCE((p_definition->'catalogue'->>'needsCalculator')::boolean,false));
END; $$;


COMMIT;
