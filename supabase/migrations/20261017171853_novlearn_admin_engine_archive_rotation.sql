-- Local preparation only. No activation, credential or historical data rewrite.
-- Apply only while publication is disabled and pending outcomes are reconciled.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $migration$
DECLARE
  runtime_row novlearn_admin_private.publication_runtime%ROWTYPE;
  entry record; function_oid oid; previous_row jsonb; current_row jsonb;
  original_body text; replacement_body text; definition text; marker text;
  old_archive constant text := '650128cdeb1e798b952a09e91b038d018b9e7947d0a6ee4c247695f899190290';
  new_archive constant text := 'd4d3abc408ab37f2f8a5faa512964b48947828bae9209cb1460b47111ca582f9';
BEGIN
  -- Block journal mutations for the duration of this transaction, including
  -- the race between checking pending outcomes and changing the runtime.
  LOCK TABLE novlearn_admin_private.publication_operations IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO runtime_row FROM novlearn_admin_private.publication_runtime WHERE singleton FOR UPDATE;
  IF NOT FOUND OR runtime_row.enabled OR runtime_row.engine_archive_sha256 IS DISTINCT FROM old_archive OR
    runtime_row.engine_contract IS DISTINCT FROM 'schema-5;engine-0.1.0' OR
    runtime_row.generation_version IS DISTINCT FROM 'mulberry32-rejection-v1' OR
    runtime_row.canonicalization_version IS DISTINCT FROM 'pg-jsonb-text-v1' THEN
    RAISE EXCEPTION 'Engine rotation requires the disabled reviewed runtime baseline';
  END IF;
  IF EXISTS(SELECT 1 FROM novlearn_admin_private.publication_operations WHERE state IN ('executing','uncertain')) THEN
    RAISE EXCEPTION 'Reconcile pending publication outcomes before Engine rotation';
  END IF;
  FOR entry IN SELECT * FROM (VALUES
    ('public.admin_record_exercise_test(text,text)','cb60886537bfb565a3460ea0df43e3abc17a2c603cd027ec2a843d5a7cb40352','receipt'),
    ('public.admin_review_exercise_version(uuid,text,bigint,text,text,uuid,jsonb,text)','a183655d0b8a829b18f74e2ef4def720fbb55d31c060ce7e690a9507d6e24eef','review'),
    ('public.admin_export_exercise_publication(uuid,text,bigint,jsonb)','ee1169238d72db704caccaf57086aaa6bb0282e7fa62c89a07064858fa89b068','export')
  ) AS expected(signature,body_sha256,operation) LOOP
    function_oid:=to_regprocedure(entry.signature);
    IF function_oid IS NULL THEN RAISE EXCEPTION 'Required RPC missing: %',entry.signature; END IF;
    SELECT to_jsonb(p),p.prosrc,pg_get_functiondef(p.oid) INTO previous_row,original_body,definition
      FROM pg_proc p WHERE p.oid=function_oid AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proretset;
    IF NOT FOUND OR encode(extensions.digest(convert_to(original_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM entry.body_sha256 THEN
      RAISE EXCEPTION 'RPC body differs from reviewed baseline: %',entry.signature;
    END IF;
    IF entry.operation='receipt' THEN
      marker:=old_archive;
      replacement_body:=replace(original_body,marker,new_archive);
    ELSIF entry.operation='review' THEN
      marker:=E'    report:=run.payload::jsonb->''report'';';
      replacement_body:=replace(original_body,marker,$guard$    IF run.payload::jsonb->>'engineArchiveSha256' IS DISTINCT FROM
      (SELECT engine_archive_sha256 FROM novlearn_admin_private.publication_runtime WHERE singleton) THEN
      RAISE EXCEPTION 'new tests with the current Engine build required' USING ERRCODE='22023';
    END IF;
$guard$||marker);
    ELSE
      marker:=E'  RETURN jsonb_build_object(''payload'',jsonb_build_object(''schemaVersion'',1,''catalogId'',parent_row.catalog_id,';
      replacement_body:=replace(original_body,marker,$guard$  IF receipt_row.payload::jsonb->>'engineArchiveSha256' IS DISTINCT FROM
    (SELECT engine_archive_sha256 FROM novlearn_admin_private.publication_runtime WHERE singleton) THEN
    RAISE EXCEPTION 'new reviewed tests with the current Engine build required' USING ERRCODE='22023';
  END IF;
$guard$||marker);
    END IF;
    IF (length(original_body)-length(replace(original_body,marker,'')))/length(marker)<>1 OR
      replacement_body IS NOT DISTINCT FROM original_body OR strpos(definition,original_body)=0 THEN
      RAISE EXCEPTION 'RPC replacement marker differs: %',entry.signature;
    END IF;
    EXECUTE replace(definition,original_body,replacement_body);
    SELECT to_jsonb(p) INTO current_row FROM pg_proc p WHERE p.oid=function_oid;
    IF current_row-'prosrc' IS DISTINCT FROM previous_row-'prosrc' THEN
      RAISE EXCEPTION 'RPC execution attributes changed: %',entry.signature;
    END IF;
  END LOOP;
  UPDATE novlearn_admin_private.publication_runtime SET engine_archive_sha256=new_archive WHERE singleton;
  -- Preserve enabled=false, contracts, receipts, reviews and operation history.
END;
$migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
