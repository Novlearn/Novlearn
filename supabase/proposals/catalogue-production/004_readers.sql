-- PROPOSAL ONLY. Install after the canonical target capability, before new code.
BEGIN;
CREATE FUNCTION public.novlearn_catalog_is_staging() RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path='' AS $$ SELECT false $$;
REVOKE ALL ON FUNCTION public.novlearn_catalog_is_staging() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.novlearn_catalog_is_staging() TO anon,authenticated,service_role;
CREATE TRIGGER exercise_version_manage_before_write BEFORE INSERT OR UPDATE OR DELETE ON public.exercise_versions
 FOR EACH ROW EXECUTE FUNCTION public.manage_exercise_version();
CREATE FUNCTION novlearn_catalog_sync.guard_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'historical snapshots are immutable'; END $$;
CREATE TRIGGER historical_snapshot_immutable BEFORE UPDATE OR DELETE ON novlearn_admin_private.historical_exercise_snapshots
 FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.guard_snapshot();
CREATE FUNCTION novlearn_catalog_sync.guard_parent() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.legacy_version_id IS DISTINCT FROM OLD.legacy_version_id AND
    (current_user<>'postgres' OR OLD.legacy_version_id IS NOT NULL OR NOT EXISTS(
      SELECT FROM public.exercise_versions WHERE id=NEW.legacy_version_id AND exercise_id=NEW.id AND publication_origin='historical')) THEN
   RAISE EXCEPTION 'historical execution identity is immutable'; END IF;
 IF NEW.catalog_id IS DISTINCT FROM OLD.catalog_id AND (OLD.catalog_id IS NOT NULL OR current_user<>'postgres') THEN
   RAISE EXCEPTION 'catalogue identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER exercise_parent_identity BEFORE UPDATE ON public.exercises FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.guard_parent();
CREATE TRIGGER chapters_manage BEFORE INSERT OR UPDATE OR DELETE ON public.chapters FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.manage_catalog_item();
CREATE TRIGGER competences_manage BEFORE INSERT OR UPDATE OR DELETE ON public.competences FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.manage_catalog_item();
CREATE TRIGGER flashcards_manage BEFORE INSERT OR UPDATE OR DELETE ON public.flashcards FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.manage_catalog_item();
-- Restrictive policies compose with the existing public reads; no historical
-- reader or statistics trigger is replaced. No null-version attempt backfill.
CREATE FUNCTION public.novlearn_catalog_reader_allows(p_catalog uuid,p_active uuid,p_archive timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_archive IS NULL AND (NOT enforce_production_sync OR (p_catalog IS NOT NULL AND p_active IS NOT NULL))
 FROM novlearn_catalog_sync.runtime WHERE singleton $$;
CREATE FUNCTION public.novlearn_catalog_item_reader_allows(p_status text,p_archive timestamptz,p_fingerprint text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_archive IS NULL AND (NOT enforce_production_sync OR (p_status='published' AND p_fingerprint IS NOT NULL))
 FROM novlearn_catalog_sync.runtime WHERE singleton $$;
REVOKE ALL ON FUNCTION public.novlearn_catalog_reader_allows(uuid,uuid,timestamptz),
 public.novlearn_catalog_item_reader_allows(text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.novlearn_catalog_reader_allows(uuid,uuid,timestamptz),
 public.novlearn_catalog_item_reader_allows(text,timestamptz,text) TO anon,authenticated,service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['chapters','competences','flashcards'] LOOP
  EXECUTE format('CREATE POLICY production_available_items ON public.%I AS RESTRICTIVE FOR SELECT TO anon,authenticated
   USING(public.novlearn_catalog_item_reader_allows(editorial_status,admin_archived_at,synced_fingerprint_sha256))',t);
 END LOOP;
END $$;
CREATE FUNCTION public.require_published_attempt_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.exercise_version_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.exercise_versions WHERE exercise_id=NEW.exercise_id
  AND id=NEW.exercise_version_id AND editorial_status='published') THEN RAISE EXCEPTION 'attempt must use published explicit version'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attempt_published_version BEFORE INSERT OR UPDATE OF exercise_id,exercise_version_id ON public.exercise_attempts
 FOR EACH ROW EXECUTE FUNCTION public.require_published_attempt_version();
REVOKE ALL ON FUNCTION public.require_published_attempt_version() FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY production_available_exercises ON public.exercises AS RESTRICTIVE FOR SELECT TO anon,authenticated
 USING(public.novlearn_catalog_reader_allows(catalog_id,active_version_id,admin_archived_at));
-- Canonical definitions contain answers. Only the application servers may read
-- them; learner responses contain an Engine public projection.
REVOKE ALL ON public.exercise_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.exercise_versions TO service_role;
GRANT SELECT,INSERT ON public.exercise_attempt_instances,public.exercise_attempt_replay_artifacts,public.duel_exercise_instances TO service_role;
CREATE TABLE public.duel_catalog_reservations (
 duel_id bigint NOT NULL REFERENCES public.duels(id), exercise_id bigint NOT NULL REFERENCES public.exercises(id),
 exercise_version_id uuid NOT NULL, reserved_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(duel_id,exercise_id),
 FOREIGN KEY(exercise_id,exercise_version_id) REFERENCES public.exercise_versions(exercise_id,id)
);
ALTER TABLE public.duel_catalog_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.duel_catalog_reservations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.duel_catalog_reservations TO service_role;
CREATE FUNCTION novlearn_catalog_sync.require_available_duel_reservation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent public.exercises;
BEGIN
 SELECT * INTO parent FROM public.exercises WHERE id=NEW.exercise_id FOR SHARE;
 IF parent.id IS NULL OR parent.admin_archived_at IS NOT NULL OR
    NEW.exercise_version_id IS DISTINCT FROM coalesce(parent.active_version_id,parent.legacy_version_id) OR
    NOT EXISTS(SELECT FROM public.exercise_versions WHERE exercise_id=NEW.exercise_id AND id=NEW.exercise_version_id AND editorial_status='published') THEN
  RAISE EXCEPTION 'duel reservation unavailable' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER duel_reservation_available BEFORE INSERT ON public.duel_catalog_reservations
 FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.require_available_duel_reservation();
CREATE OR REPLACE FUNCTION public.require_published_duel_exercise_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM public.duel_catalog_reservations WHERE duel_id=NEW.duel_id AND exercise_id=NEW.exercise_id
  AND exercise_version_id=NEW.exercise_version_id) THEN
  RAISE EXCEPTION 'duel must use its reserved version' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION novlearn_catalog_sync.require_session_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM public.exercises e JOIN public.exercise_versions v ON v.exercise_id=e.id
  WHERE e.id=NEW.exercise_id AND v.id=NEW.exercise_version_id AND e.admin_archived_at IS NULL
    AND v.editorial_status='published' AND v.id=coalesce(e.active_version_id,e.legacy_version_id)) THEN
  RAISE EXCEPTION 'new session must use available explicit version' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER engine_session_available BEFORE INSERT ON public.engine_exercise_sessions
 FOR EACH ROW EXECUTE FUNCTION novlearn_catalog_sync.require_session_version();
-- No availability recheck at completion: the stored official/version is the contract.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA novlearn_catalog_sync FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
