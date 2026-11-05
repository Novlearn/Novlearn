-- NovLearn Admin: private replay records, duel rounds, and scoped admin policies.
-- Does not replace or widen any of the existing legacy exercise policies.
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

-- Staging Admin authenticates through Supabase Auth. Authorization is sourced
-- only from profiles.role (app-controlled), never user-editable user_metadata.
CREATE FUNCTION public.is_novlearn_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
  );
$function$;
REVOKE ALL ON FUNCTION public.is_novlearn_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_novlearn_admin() TO authenticated;

REVOKE ALL ON public.exercise_versions FROM PUBLIC, anon, authenticated;
REVOKE DELETE, TRUNCATE ON public.exercise_versions FROM service_role;
GRANT SELECT, INSERT, UPDATE ON public.exercise_versions TO authenticated;
CREATE POLICY novlearn_admin_manage_exercise_versions
  ON public.exercise_versions FOR ALL TO authenticated
  USING ((SELECT public.is_novlearn_admin()))
  WITH CHECK ((SELECT public.is_novlearn_admin()));
CREATE FUNCTION public.publish_exercise_version(p_exercise_id bigint, p_version_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public.is_novlearn_admin() THEN
    RAISE EXCEPTION 'administrator access required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.exercise_versions v
    WHERE v.exercise_id = p_exercise_id AND v.id = p_version_id
      AND v.editorial_status = 'published'
  ) THEN
    RAISE EXCEPTION 'only a published version of this exercise can be activated';
  END IF;
  UPDATE public.exercises SET active_version_id = p_version_id WHERE id = p_exercise_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exercise not found'; END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.publish_exercise_version(bigint, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_exercise_version(bigint, uuid) TO authenticated;

COMMIT;
