-- Staging rollout only, after complete canonical import. No score is changed.
-- Legacy browser writes cannot create a second scoring path alongside Engine.
BEGIN;
DO $migration$
DECLARE target text;
BEGIN
 IF (SELECT count(*) FROM novlearn_admin_private.engine_legacy_imports
     WHERE project_ref='tksvbkvfusrnxulpahky'
       AND source_sha256='806067c4383e7b497ae74262de595ede92e605c910aeac8527b93982d911cd5e')<>111 OR
    EXISTS(SELECT 1 FROM public.exercises WHERE catalog_id IS NULL) THEN
   RAISE EXCEPTION 'Complete qualified Staging import required; not a Production rollout';
 END IF;
 FOREACH target IN ARRAY ARRAY['exercise_attempts','user_competence_scores','ds_competence_scores','duel_attempts'] LOOP
   EXECUTE format('CREATE POLICY engine_server_insert ON public.%I AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(false)',target);
   EXECUTE format('CREATE POLICY engine_server_update ON public.%I AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING(false) WITH CHECK(false)',target);
   EXECUTE format('CREATE POLICY engine_server_delete ON public.%I AS RESTRICTIVE FOR DELETE TO anon,authenticated USING(false)',target);
 END LOOP;
END;
$migration$;
COMMIT;
