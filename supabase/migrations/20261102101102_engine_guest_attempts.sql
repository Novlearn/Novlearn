-- Keep guest practice available without awarding registered-player rewards.
-- Existing legacy behavior is outside this narrowly scoped canonical guard.
BEGIN;
DO $$ DECLARE source text; patched text; BEGIN
 SELECT pg_get_functiondef('public.handle_exercise_completion()'::regprocedure) INTO source;
 IF md5(source)<>'28f8d602399ed85ab26ec315662f5e33' THEN RAISE EXCEPTION 'completion trigger changed; reconcile first'; END IF;
 patched:=replace(source,E'BEGIN\n  BEGIN',E'BEGIN\n  IF NEW.exercise_version_id IS NOT NULL AND NEW.is_guest THEN RETURN NEW; END IF;\n  BEGIN');
 IF patched=source THEN RAISE EXCEPTION 'completion anchor missing'; END IF;
 EXECUTE patched;
END $$;
COMMIT;
