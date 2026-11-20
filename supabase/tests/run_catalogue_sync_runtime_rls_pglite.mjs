import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const migration = await readFile(
  resolve(root, 'supabase/migrations/20261113101533_catalogue_sync_runtime_rls.sql'),
  'utf8',
);
const environmentMigration = await readFile(
  resolve(root, 'supabase/migrations/20261112103445_catalogue_environment_claim.sql'),
  'utf8',
);
const environmentFunction = environmentMigration.match(
  /CREATE OR REPLACE FUNCTION public\.novlearn_catalog_is_staging\(\)[\s\S]*?\$\$;/,
)?.[0];
if (!environmentFunction) throw new Error('canonical environment reader missing');

const db = new PGlite();
try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE novlearn_publication_journal_executor NOLOGIN NOINHERIT NOBYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA novlearn_catalog_sync;
    CREATE TABLE novlearn_catalog_sync.runtime(
      singleton boolean PRIMARY KEY DEFAULT true,
      environment text NOT NULL CHECK (environment IN ('staging','production')),
      enforce_production_sync boolean NOT NULL DEFAULT false
    );
    INSERT INTO novlearn_catalog_sync.runtime(singleton,environment) VALUES(true,'staging');
    REVOKE ALL ON SCHEMA novlearn_catalog_sync FROM PUBLIC,anon,authenticated,service_role,novlearn_publication_journal_executor;
    REVOKE ALL ON novlearn_catalog_sync.runtime FROM PUBLIC,anon,authenticated,service_role,novlearn_publication_journal_executor;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT current_setting('request.jwt.claims',true)::jsonb
    $$;
  `);
  await db.exec(environmentFunction);
  await db.exec(`
    REVOKE ALL ON FUNCTION public.novlearn_catalog_is_staging() FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION public.novlearn_catalog_is_staging() TO anon,authenticated,service_role;
  `);
  await db.exec(migration);

  const { rows: [state] } = await db.query(`
    SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
      pg_get_userbyid(c.relowner) AS owner,
      (SELECT count(*)::integer FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
      has_schema_privilege('anon','novlearn_catalog_sync','USAGE') AS anon_usage,
      has_table_privilege('anon','novlearn_catalog_sync.runtime','SELECT') AS anon_select,
      has_table_privilege('authenticated','novlearn_catalog_sync.runtime','INSERT,UPDATE,DELETE') AS auth_write,
      has_table_privilege('service_role','novlearn_catalog_sync.runtime','SELECT') AS service_select,
      has_table_privilege('novlearn_publication_journal_executor','novlearn_catalog_sync.runtime','SELECT') AS executor_select
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='novlearn_catalog_sync' AND c.relname='runtime'
  `);
  assert.deepEqual(state, {
    rls: true, force_rls: false, owner: 'postgres', policies: 0,
    anon_usage: false, anon_select: false, auth_write: false,
    service_select: false, executor_select: false,
  });

  await db.query('SELECT set_config($1,$2,false)', [
    'request.jwt.claims', JSON.stringify({ iss: 'https://tksvbkvfusrnxulpahky.supabase.co/auth/v1' }),
  ]);
  let result = await db.query('SELECT public.novlearn_catalog_is_staging() AS allowed');
  assert.equal(result.rows[0].allowed, true);
  await db.query('SELECT set_config($1,$2,false)', [
    'request.jwt.claims', JSON.stringify({ iss: 'https://abwipnppcrghdhwriyjp.supabase.co/auth/v1' }),
  ]);
  result = await db.query('SELECT public.novlearn_catalog_is_staging() AS allowed');
  assert.equal(result.rows[0].allowed, false);
  await db.query('SELECT set_config($1,$2,false)', [
    'request.jwt.claims', JSON.stringify({ iss: 'https://tksvbkvfusrnxulpahky.supabase.co/auth/v1' }),
  ]);

  for (const role of ['anon', 'authenticated', 'service_role']) {
    await db.exec(`SET ROLE ${role}`);
    try {
      result = await db.query('SELECT public.novlearn_catalog_is_staging() AS allowed');
      assert.equal(result.rows[0].allowed, true, `${role} must retain the bounded reader`);
      await assert.rejects(
        db.query('SELECT * FROM novlearn_catalog_sync.runtime'),
        (error) => error.code === '42501',
        `${role} direct read must be denied`,
      );
      for (const statement of [
        "INSERT INTO novlearn_catalog_sync.runtime(singleton,environment) VALUES(false,'staging')",
        "UPDATE novlearn_catalog_sync.runtime SET environment='production'",
        'DELETE FROM novlearn_catalog_sync.runtime',
      ]) {
        await assert.rejects(
          db.query(statement),
          (error) => error.code === '42501',
          `${role} direct write must be denied: ${statement.split(' ')[0]}`,
        );
      }
    } finally {
      await db.exec('RESET ROLE');
    }
  }
  await db.exec('SET ROLE novlearn_publication_journal_executor');
  try {
    for (const statement of [
      'SELECT * FROM novlearn_catalog_sync.runtime',
      "INSERT INTO novlearn_catalog_sync.runtime(singleton,environment) VALUES(false,'staging')",
      "UPDATE novlearn_catalog_sync.runtime SET environment='production'",
      'DELETE FROM novlearn_catalog_sync.runtime',
    ]) {
      await assert.rejects(
        db.query(statement),
        (error) => error.code === '42501',
        `journal executor direct access must be denied: ${statement.split(' ')[0]}`,
      );
    }
  } finally {
    await db.exec('RESET ROLE');
  }

  console.log('PGlite runtime RLS smoke passed: RLS on, no policy, direct reads denied, bounded readers and issuer split preserved.');
} finally {
  await db.close();
}
