-- Staging only: align new test receipts with the shared qualified Engine archive.
-- Existing receipts and editorial decisions remain immutable historical evidence.
SET LOCAL lock_timeout = '5s';
DO $rotation$
DECLARE
  old_archive constant text := 'd4d3abc408ab37f2f8a5faa512964b48947828bae9209cb1460b47111ca582f9';
  new_archive constant text := 'aa07fdf2c833900957dce2e2632e05a845025f96bf2264147a4eea99b35bcab9';
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
      '03adc65112a6985c903c93193920faca555608992bcb5b6c10d05be2b8b8552b'
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
