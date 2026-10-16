-- Local preparation. PostgREST 14 retries SQLSTATE 40001 indefinitely.
-- Preserve every RPC body, identity, owner, grant and execution attribute;
-- translate transaction conflicts only at these public API boundaries.
BEGIN;
DO $migration$
DECLARE entry record; function_oid oid; previous_row jsonb; current_row jsonb;
 original_body text; definition text; wrapped_body text;
BEGIN
 FOR entry IN SELECT * FROM (VALUES
  ('public.admin_archive_exercise(bigint,boolean,boolean)','75e06a6b7a7c7ecb56778e9908f574ef6491840893254459910e7303f0dbfd61'),
  ('public.admin_duplicate_exercise(uuid)','debe60e335ecd3e191deeda13a4d4bad8039e4658e591ffcbbe2fc29d86be729'),
  ('public.admin_export_exercise_publication(uuid,text,bigint,jsonb)','b34d56fc755237ab279e5a7b7cfaf610e19457c3e6adefb2008582ff809dfc46'),
  ('public.admin_mutate_flashcard(text,uuid,text,jsonb)','eca93cff0e5c49399570cf064ecd299472aa5075c50ddb8327f8f3ac2e7e110e'),
  ('public.admin_mutate_taxonomy(text,text,text,text,jsonb)','428be12f3cd07575bd6fcf6ca0c30dc890ce39d8bb137c92cabaeebfad3d5f2e'),
  ('public.admin_record_exercise_test(text,text)','e7dbe348f8b885ed97e8d7d8070948be0db9a9dc23391ef7a29b082f203106e0'),
  ('public.admin_review_exercise_version(uuid,text,bigint,text,text,uuid,jsonb,text)','799c1e0a03dd2c0865c0900a27a38063c1d5f7c856aa1640b51cb3ad965a3c6c'),
  ('public.admin_save_exercise_draft(bigint,uuid,text,jsonb)','abfc6001582e79fa4d8ba45088705e8f262cf80b7217eaf780cddc20a9da8ab2')
 ) AS expected(signature,body_sha256) LOOP
  function_oid:=to_regprocedure(entry.signature);
  IF function_oid IS NULL THEN RAISE EXCEPTION 'Required RPC missing: %',entry.signature; END IF;
  SELECT to_jsonb(p),p.prosrc,pg_get_functiondef(p.oid) INTO previous_row,original_body,definition
   FROM pg_proc p WHERE p.oid=function_oid AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proretset;
  IF NOT FOUND OR encode(extensions.digest(convert_to(original_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM entry.body_sha256 THEN
   RAISE EXCEPTION 'RPC body differs from reviewed baseline: %',entry.signature;
  END IF;
  wrapped_body:=E'-- novlearn-admin-rpc-http-conflict-v1\nBEGIN\n'||original_body||
   E'\nEXCEPTION WHEN serialization_failure THEN\n RAISE SQLSTATE ''PT409'' USING MESSAGE=''Content changed; reload before retrying'';\nEND;\n';
  IF strpos(definition,original_body)=0 THEN RAISE EXCEPTION 'RPC definition unavailable'; END IF;
  EXECUTE replace(definition,original_body,wrapped_body);
  SELECT to_jsonb(p) INTO current_row FROM pg_proc p WHERE p.oid=function_oid;
  IF current_row-'prosrc' IS DISTINCT FROM previous_row-'prosrc' THEN
   RAISE EXCEPTION 'RPC execution attributes changed: %',entry.signature;
  END IF;
 END LOOP;
END;
$migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
