BEGIN;

SELECT plan(22);

SELECT ok(
  (SELECT c.relrowsecurity FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'novlearn_catalog_sync' AND c.relname = 'runtime'),
  'runtime has row level security enabled'
);
SELECT ok(
  NOT (SELECT c.relforcerowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'novlearn_catalog_sync' AND c.relname = 'runtime'),
  'runtime does not force RLS on its postgres owner'
);
SELECT is(
  (SELECT count(*)::integer FROM pg_policy p
   JOIN pg_class c ON c.oid = p.polrelid
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'novlearn_catalog_sync' AND c.relname = 'runtime'),
  0,
  'runtime has no public or role policies'
);
SELECT is(
  (SELECT pg_get_userbyid(c.relowner) FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'novlearn_catalog_sync' AND c.relname = 'runtime'),
  'postgres',
  'postgres remains the runtime owner'
);

SELECT ok(NOT has_schema_privilege('anon', 'novlearn_catalog_sync', 'USAGE'), 'anon has no schema usage');
SELECT ok(NOT has_table_privilege('anon', 'novlearn_catalog_sync.runtime', 'SELECT'), 'anon has no direct read');
SELECT ok(NOT has_table_privilege('anon', 'novlearn_catalog_sync.runtime', 'INSERT,UPDATE,DELETE,TRUNCATE'), 'anon has no direct write');
SELECT ok(NOT has_schema_privilege('authenticated', 'novlearn_catalog_sync', 'USAGE'), 'authenticated has no schema usage');
SELECT ok(NOT has_table_privilege('authenticated', 'novlearn_catalog_sync.runtime', 'SELECT'), 'authenticated has no direct read');
SELECT ok(NOT has_table_privilege('authenticated', 'novlearn_catalog_sync.runtime', 'INSERT,UPDATE,DELETE,TRUNCATE'), 'authenticated has no direct write');
SELECT ok(NOT has_schema_privilege('service_role', 'novlearn_catalog_sync', 'USAGE'), 'service_role has no schema usage');
SELECT ok(NOT has_table_privilege('service_role', 'novlearn_catalog_sync.runtime', 'SELECT'), 'service_role has no direct read');
SELECT ok(NOT has_table_privilege('service_role', 'novlearn_catalog_sync.runtime', 'INSERT,UPDATE,DELETE,TRUNCATE'), 'service_role has no direct write');
SELECT ok(NOT has_schema_privilege('novlearn_publication_journal_executor', 'novlearn_catalog_sync', 'USAGE'), 'journal executor has no schema usage');
SELECT ok(NOT has_table_privilege('novlearn_publication_journal_executor', 'novlearn_catalog_sync.runtime', 'SELECT'), 'journal executor has no direct read');
SELECT ok(NOT has_table_privilege('novlearn_publication_journal_executor', 'novlearn_catalog_sync.runtime', 'INSERT,UPDATE,DELETE,TRUNCATE'), 'journal executor has no direct write');

SELECT ok(
  (SELECT p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'novlearn_catalog_is_staging'),
  'the staging reader remains a postgres-owned SECURITY DEFINER function'
);
SELECT set_config('request.jwt.claims', '{"iss":"https://tksvbkvfusrnxulpahky.supabase.co/auth/v1"}', true);
SELECT ok(public.novlearn_catalog_is_staging(), 'the Staging JWT issuer selects Staging');
SELECT set_config('request.jwt.claims', '{"iss":"https://abwipnppcrghdhwriyjp.supabase.co/auth/v1"}', true);
SELECT ok(NOT public.novlearn_catalog_is_staging(), 'the Production JWT issuer is not treated as Staging');

SELECT set_config('request.jwt.claims', '{"iss":"https://tksvbkvfusrnxulpahky.supabase.co/auth/v1"}', true);
SET LOCAL ROLE anon;
SELECT ok(public.novlearn_catalog_is_staging(), 'anon can use the bounded Staging reader');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT ok(public.novlearn_catalog_is_staging(), 'authenticated can use the bounded Staging reader');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT ok(public.novlearn_catalog_is_staging(), 'service_role can use the bounded Staging reader');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
