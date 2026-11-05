-- Staging only: align new test receipts with the shared qualified Engine archive.
-- Existing receipts and editorial decisions remain immutable historical evidence.
SET LOCAL lock_timeout = '5s';
DO $rotation$
DECLARE
  old_archive constant text := '206444e1efea28fd163589f36d8b0ad653968d90f3dd2e3fc8f77da135a0798d';
  new_archive constant text := '82e499726db2da454627903ed65802eaa2ab3e7185f7f6cb3c84c1cbdbde3cea';
  runtime_row novlearn_admin_private.publication_runtime%ROWTYPE;
  function_oid oid := 'public.admin_record_exercise_test(text,text)'::regprocedure;
  previous_row jsonb; current_row jsonb; body text; definition text;
BEGIN
  LOCK TABLE novlearn_admin_private.publication_operations IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO runtime_row FROM novlearn_admin_private.publication_runtime WHERE singleton FOR UPDATE;
  IF NOT FOUND OR runtime_row.enabled OR runtime_row.engine_archive_sha256 IS DISTINCT FROM old_archive
    OR runtime_row.engine_contract IS DISTINCT FROM 'schema-5;engine-0.1.0'
    OR runtime_row.generation_version IS DISTINCT FROM 'mulberry32-rejection-v1'
    OR runtime_row.canonicalization_version IS DISTINCT FROM 'pg-jsonb-text-v1' THEN
    RAISE EXCEPTION 'Expected disabled Staging runtime baseline is required';
  END IF;
  IF EXISTS(SELECT 1 FROM novlearn_admin_private.publication_operations WHERE state IN ('executing','uncertain')) THEN
    RAISE EXCEPTION 'Reconcile publication outcomes before rotating Engine';
  END IF;
  SELECT to_jsonb(p),p.prosrc,pg_get_functiondef(p.oid) INTO previous_row,body,definition
    FROM pg_proc p WHERE p.oid=function_oid;
  IF encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM
      '25c6a5f39765eed619b1c8ed03249f235c4aaa366898728a0726431350072e3c'
    OR (length(body)-length(replace(body,old_archive,'')))/length(old_archive)<>1 THEN
    RAISE EXCEPTION 'Receipt function differs from the reviewed Staging baseline';
  END IF;
  EXECUTE replace(definition,body,replace(body,old_archive,new_archive));
  SELECT to_jsonb(p) INTO current_row FROM pg_proc p WHERE p.oid=function_oid;
  IF current_row-'prosrc' IS DISTINCT FROM previous_row-'prosrc' THEN
    RAISE EXCEPTION 'Function execution attributes must remain unchanged';
  END IF;
  UPDATE novlearn_admin_private.publication_runtime SET engine_archive_sha256=new_archive WHERE singleton;
END;
$rotation$;
NOTIFY pgrst,'reload schema';
