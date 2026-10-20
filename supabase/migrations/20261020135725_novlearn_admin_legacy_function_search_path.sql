-- Fix only the two legacy invoker functions reported by advisor 0011.
-- No body, owner, ACL, role, policy, relation or application data changes.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE
  before_functions jsonb;
  after_functions jsonb;
BEGIN
  IF to_regprocedure('public.handle_updated_at()') IS NULL
     OR to_regprocedure('public.generate_random_code(integer)') IS NULL THEN
    RAISE EXCEPTION 'Legacy search-path prerequisites: missing function';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid IN ('public.handle_updated_at()'::regprocedure,
                    'public.generate_random_code(integer)'::regprocedure)
      AND (p.prokind <> 'f' OR p.prosecdef OR l.lanname <> 'plpgsql'
           OR p.proconfig IS NOT NULL OR p.proisstrict
           OR p.provolatile <> 'v' OR p.proparallel <> 'u'
           OR (p.proname = 'handle_updated_at' AND
               (p.prorettype <> 'trigger'::regtype OR p.pronargdefaults <> 0
                OR md5(replace(p.prosrc, chr(13) || chr(10), chr(10)))
                   <> 'da5ac28a58c8b4bb30209bf0d3d7082c'))
           OR (p.proname = 'generate_random_code' AND
               (p.prorettype <> 'text'::regtype OR p.pronargdefaults <> 1
                OR pg_get_expr(p.proargdefaults, 0) IS DISTINCT FROM '8'
                OR md5(replace(p.prosrc, chr(13) || chr(10), chr(10)))
                   <> 'a3f1a78d8c4d064d4cd81f91b1cfa953')))
  ) THEN
    RAISE EXCEPTION 'Legacy search-path prerequisites: unexpected function contract';
  END IF;

  SELECT jsonb_agg(to_jsonb(p) - 'proconfig' ORDER BY p.oid)
    INTO before_functions FROM pg_proc p
    WHERE p.oid IN ('public.handle_updated_at()'::regprocedure,
                    'public.generate_random_code(integer)'::regprocedure);

  ALTER FUNCTION public.handle_updated_at() SET search_path = '';
  ALTER FUNCTION public.generate_random_code(integer) SET search_path = '';

  SELECT jsonb_agg(to_jsonb(p) - 'proconfig' ORDER BY p.oid)
    INTO after_functions FROM pg_proc p
    WHERE p.oid IN ('public.handle_updated_at()'::regprocedure,
                    'public.generate_random_code(integer)'::regprocedure);
  IF before_functions IS DISTINCT FROM after_functions OR EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid IN ('public.handle_updated_at()'::regprocedure,
                    'public.generate_random_code(integer)'::regprocedure)
      AND p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'Legacy search-path postflight: unexpected mutation';
  END IF;
END;
$migration$;
COMMIT;
