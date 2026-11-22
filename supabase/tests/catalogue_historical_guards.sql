-- Run on the isolated target rehearsal, after its first import. All rolled back.
BEGIN;
SET LOCAL ROLE novlearn_catalogue_sync_writer;
DO $$ BEGIN
 BEGIN
  UPDATE public.exercises SET content='{}'::jsonb WHERE id=1;
  RAISE EXCEPTION 'writer unexpectedly erased historical content';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.exercises SET id=id+100000 WHERE id=1;
  RAISE EXCEPTION 'writer unexpectedly rewrote a historical primary key';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.exercises(id,catalog_id,title,chapter,content)
  VALUES(nextval('public.exercises_id_seq'),gen_random_uuid(),'Forbidden legacy write','Synthetic historical chapter','{"private":"replacement"}');
  RAISE EXCEPTION 'writer unexpectedly inserted unpreserved legacy content';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='novlearn_catalogue_sync_writer' AND
  (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) OR
 EXISTS(SELECT FROM pg_auth_members WHERE roleid='novlearn_catalogue_sync_writer'::regrole
  AND member='postgres'::regrole AND (set_option OR inherit_option)) THEN
  RAISE EXCEPTION 'writer retained unsafe role attributes or execution membership'; END IF;
END $$;
ROLLBACK;
