BEGIN;
ALTER TABLE public.engine_exercise_sessions DROP CONSTRAINT engine_exercise_sessions_owner_id_fkey;
ALTER TABLE public.engine_exercise_sessions ADD CONSTRAINT engine_exercise_sessions_owner_id_fkey
 FOREIGN KEY(owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX engine_one_active_context ON public.engine_exercise_sessions
 (owner_id,exercise_id,(metadata->>'mode'),(COALESCE(metadata->>'dsId','')))
 WHERE status='active';
COMMIT;
