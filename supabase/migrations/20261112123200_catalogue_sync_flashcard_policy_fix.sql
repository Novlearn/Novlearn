BEGIN;
SET LOCAL lock_timeout='5s';
-- Upgrade path for targets where 20261112123000_catalogue_sync_target.sql
-- was already installed before the historical-policy fix was included.
DROP POLICY IF EXISTS "Flashcards admin write" ON public.flashcards;
CREATE POLICY "Flashcards admin write" ON public.flashcards FOR ALL TO authenticated
  USING ((SELECT public.is_novlearn_admin()))
  WITH CHECK ((SELECT public.is_novlearn_admin()));
NOTIFY pgrst,'reload schema';
COMMIT;
