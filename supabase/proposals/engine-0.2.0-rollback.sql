-- STAGING rollback only, after application flags are disabled and jobs drained.
-- Preserve all historical receipts and leave ephemeral previews to expire.
-- Review separately; never include this file in an automatic migration push.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $rollback$
DECLARE
  old_archive constant text := '82e499726db2da454627903ed65802eaa2ab3e7185f7f6cb3c84c1cbdbde3cea';
  new_archive constant text := 'cc62b257798bda3ebffe293f49997e72ece2ee11b7f392c28e92217ceb45af91';
  runtime_row novlearn_admin_private.publication_runtime%ROWTYPE;
  function_oid oid := 'public.admin_record_exercise_test(text,text)'::regprocedure;
  previous_row jsonb; current_row jsonb; body text; restored text; definition text;
BEGIN
  LOCK TABLE novlearn_admin_private.publication_operations IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO runtime_row FROM novlearn_admin_private.publication_runtime WHERE singleton FOR UPDATE;
  IF NOT FOUND OR runtime_row.enabled OR runtime_row.engine_archive_sha256 IS DISTINCT FROM new_archive THEN
    RAISE EXCEPTION 'Expected disabled 0.2.0 Staging runtime is required';
  END IF;
  IF EXISTS(SELECT 1 FROM novlearn_admin_private.publication_operations WHERE state IN ('executing','uncertain')) THEN
    RAISE EXCEPTION 'Reconcile publication outcomes before rollback';
  END IF;
  SELECT to_jsonb(p),p.prosrc,pg_get_functiondef(p.oid) INTO previous_row,body,definition FROM pg_proc p WHERE p.oid=function_oid;
  restored:=replace(body,new_archive,old_archive);
  IF (length(body)-length(replace(body,new_archive,'')))/length(new_archive)<>1
    OR encode(extensions.digest(convert_to(restored,'UTF8'),'sha256'),'hex') IS DISTINCT FROM
      '3d397ea7db2a41f1b3f89c67fac529074aee45e2d93aec543c970d654d7797f6' THEN
    RAISE EXCEPTION 'Receipt body cannot be restored to the reviewed 0.1.8 baseline';
  END IF;
  EXECUTE replace(definition,body,restored);
  SELECT to_jsonb(p) INTO current_row FROM pg_proc p WHERE p.oid=function_oid;
  IF current_row-'prosrc' IS DISTINCT FROM previous_row-'prosrc' THEN
    RAISE EXCEPTION 'Function execution attributes must remain unchanged';
  END IF;
  UPDATE novlearn_admin_private.publication_runtime SET engine_archive_sha256=old_archive WHERE singleton;
END;
$rollback$;
NOTIFY pgrst,'reload schema';
COMMIT;
