// Disposable PostgreSQL/WASM check of preview RPCs; not a Supabase rollout proof.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const first = '20000000-0000-4000-8000-000000000001';
const second = '20000000-0000-4000-8000-000000000002';
const student = '20000000-0000-4000-8000-000000000003';
const artifact = '6d1d52f38297d6f91be0eaa4aea57eb63f61973eae4cc83d86fd0aa6651dd85a';
const digest = 'a'.repeat(64);
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
async function as(id) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('test.actor', $1, false)", [id]);
  await db.exec('SET ROLE authenticated');
}
async function put(official = { schemaVersion: 5 }) {
  return (await db.query('SELECT public.admin_put_preview_snapshot($1,42,$2::jsonb,$3) AS value', [digest, JSON.stringify(official), artifact])).rows[0].value;
}
async function get(id, archive = artifact) {
  return (await db.query('SELECT public.admin_get_preview_snapshot($1,$2) AS value', [id, archive])).rows[0].value;
}
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
    CREATE FUNCTION public.is_novlearn_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT auth.uid() IN ('${first}'::uuid,'${second}'::uuid) $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
  `);
  const sql = await readFile(new URL('../supabase/migrations/20261103135952_engine_0_2_0_archive.sql', import.meta.url), 'utf8');
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;\s*$/); checks++;
  const preview = sql.slice(sql.indexOf('-- Private Vercel')).replace(/COMMIT;\s*$/, '');
  await db.exec(preview);
  await as(student);
  await assert.rejects(put(), /admin required/); checks++;
  await as(first);
  await assert.rejects(db.query('SELECT * FROM novlearn_admin_private.preview_snapshots'), /permission denied/); checks++;
  const a = await put();
  check(a.artifact, artifact);
  check((await get(a.previewId)).owner, first);
  await assert.rejects(get(a.previewId, 'b'.repeat(64)), /preview unavailable/); checks++;
  await as(second);
  await assert.rejects(get(a.previewId), /preview unavailable/); checks++;
  await as(first);
  await assert.rejects(put({ schemaVersion: 4 }), /violates check constraint/); checks++;
  await put(); await put();
  await assert.rejects(get(a.previewId), /preview unavailable/); checks++;
  await db.exec('RESET ROLE');
  check((await db.query('SELECT count(*)::int AS n FROM novlearn_admin_private.preview_snapshots')).rows[0].n, 2);
  await db.exec("UPDATE novlearn_admin_private.preview_snapshots SET expires_at=clock_timestamp()-interval '1 second'");
  await as(first);
  const fresh = await put();
  check((await get(fresh.previewId)).digest, digest);
  await db.exec('RESET ROLE');
  check((await db.query('SELECT count(*)::int AS n FROM novlearn_admin_private.preview_snapshots')).rows[0].n, 1);
  console.log(JSON.stringify({ result: 'PASS', checks, scope: 'preview RPCs on disposable PostgreSQL/WASM, synthetic Auth; no remote mutation' }));
} finally { await db.close(); }
