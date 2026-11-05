// In-memory PostgreSQL/WASM copy. No URL, credentials, remote connection or dump.
// Not a Supabase service or an Engine hosting qualification.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = fileURLToPath(new URL('../', import.meta.url));
const inputs = [];
async function expand(filename) {
  const absolute = path.resolve(filename);
  assert(absolute.startsWith(root), 'Only workspace SQL is accepted');
  const bytes = await readFile(absolute);
  inputs.push({ file: path.relative(root, absolute), sha256: createHash('sha256').update(bytes).digest('hex') });
  const chunks = [];
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    if (line.startsWith('\\set ON_ERROR_STOP')) continue;
    if (line.startsWith('\\ir ')) {
      chunks.push(await expand(path.resolve(path.dirname(absolute), line.slice(4))));
    } else {
      assert(!line.startsWith('\\'), 'Unsupported psql directive');
      chunks.push(line);
    }
  }
  return chunks.join('\n');
}
const sql = await expand(path.join(root, 'scripts/test-engine-pilot-exclusion-local.sql'));
const db = new PGlite();
try {
  const result = await db.exec(sql);
  // Qualify the extra count RPC on synthetic Auth and empty attempt history.
  // This runner never connects to Staging, including after remote authorization.
  await db.exec(`CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '10000000-0000-4000-8000-000000000001'::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE TABLE public.exercise_attempts(exercise_id bigint,user_id uuid,is_correct boolean);`);
  const countOriginal = await readFile(path.join(root, 'docs/sql-proposals/20261101-chapter-count-original.sql'), 'utf8');
  inputs.push({ file: 'docs/sql-proposals/20261101-chapter-count-original.sql', sha256: createHash('sha256').update(countOriginal).digest('hex') });
  const countMd5 = async () => (await db.query("select md5(pg_get_functiondef('public.get_chapters_with_count(uuid)'::regprocedure)) as hash")).rows[0].hash;
  await db.exec(countOriginal);
  assert.equal(await countMd5(), '887bc36f41086cb5ec3647782cd42d04');
  const counts = async () => (await db.query("select * from public.get_chapters_with_count(auth.uid())")).rows;
  assert.equal((await counts()).find(row => row.chapter_name === 'Only draft').total_exercises, 1);
  const insertion = '    WHERE (e.catalog_id IS NULL OR e.active_version_id IS NOT NULL)\n';
  assert.equal(countOriginal.split('    GROUP BY e.chapter').length, 2);
  await db.exec(countOriginal.replace('    GROUP BY e.chapter', insertion + '    GROUP BY e.chapter'));
  assert.deepEqual((await counts()).map(row => [row.chapter_name, row.total_exercises]), [['Chapter', 2]]);
  await db.exec(countOriginal);
  assert.equal(await countMd5(), '887bc36f41086cb5ec3647782cd42d04');
  const appliedFile = 'supabase/rollouts/20261101171424_exclude_unpublished_engine_pilots.applied.sql';
  const rollbackFile = 'supabase/rollouts/20261101171424_exclude_unpublished_engine_pilots.rollback.sql';
  const applied = await readFile(path.join(root, appliedFile), 'utf8');
  const rollback = await readFile(path.join(root, rollbackFile), 'utf8');
  for (const [file, source] of [[appliedFile, applied], [rollbackFile, rollback]]) {
    inputs.push({ file, sha256: createHash('sha256').update(source).digest('hex') });
  }
  await db.exec(applied);
  assert.equal(await countMd5(), 'd8d84f81b6ad579af275f0d9ad2d1b57');
  await assert.rejects(db.exec(rollback), /Unsafe rollback/);
  await db.exec('ROLLBACK');
  assert.equal(await countMd5(), 'd8d84f81b6ad579af275f0d9ad2d1b57');
  // Remove only the synthetic draft in this disposable in-memory database.
  // This is not a remote rollback procedure or authorization to remove pilots.
  await db.exec('DELETE FROM public.exercises WHERE id=2');
  await db.exec(rollback);
  assert.equal(await countMd5(), '887bc36f41086cb5ec3647782cd42d04');
  assert.equal((await db.query("select md5(pg_get_functiondef('public.get_random_exercise(text,text)'::regprocedure)) as hash")).rows[0].hash,
    '14fac9361afb35bb7fa64df3649551eb');
  console.log(JSON.stringify({ target: 'in-memory PostgreSQL/WASM; synthetic data only',
    serverVersion: (await db.query('show server_version')).rows[0],
    result: result.at(-1).rows, additionalCountRpc: 'PASS: original leak, guarded two-function migration and exact rollback; unsafe rollback refused; synthetic data only',
    inputs }, null, 2));
} finally {
  await db.close();
}
