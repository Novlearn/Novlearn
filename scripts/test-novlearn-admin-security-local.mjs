// Real local PostgreSQL/Supabase security tests. All fixtures are rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { localDatabaseUrl } from './local-database-url.mjs';
const db = new pg.Client({ connectionString: localDatabaseUrl(process.env.NOVLEARN_LOCAL_DATABASE_URL) });
let checks = 0;
const admin = randomUUID(); const student = randomUUID();
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
async function denied(sql, values, code) {
  await db.query('SAVEPOINT expected_denial');
  let failure;
  try { await db.query(sql, values); } catch (error) { failure = error; }
  await db.query('ROLLBACK TO SAVEPOINT expected_denial');
  await db.query('RELEASE SAVEPOINT expected_denial');
  assert.ok(failure, 'SQL operation must be denied');
  equal(failure.code, code, 'expected actual permission/RLS SQLSTATE');
}
async function identity(id, guest = false, role = 'authenticated') {
  await db.query('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [id ?? '']);
  await db.query("SELECT set_config('request.jwt.claims', $1, true)",
    [JSON.stringify({ sub: id, is_anonymous: guest, user_metadata: { role: 'admin' } })]);
  assert.ok(['authenticated', 'anon', 'service_role'].includes(role));
  await db.query(`SET LOCAL ROLE ${role}`);
}
try {
  await db.connect(); await db.query('BEGIN');
  for (const id of [admin, student]) await db.query(`INSERT INTO auth.users
    (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    VALUES($1,'authenticated','authenticated',$2,'',now(),
      '{"provider":"email","providers":["email"]}',
      '{"first_name":"SQL security fixture","birth_date":"2000-01-01","role":"admin"}',now(),now())`,
    [id, `${id}@novlearn.test`]);
  equal((await db.query('SELECT role FROM public.profiles WHERE id=$1', [student])).rows[0].role,
    'user', 'Auth metadata does not provision admin');
  await db.query("UPDATE public.profiles SET role='admin' WHERE id=$1", [admin]);
  const exercise = (await db.query(`INSERT INTO public.exercises(title,chapter,content)
    VALUES('SQL security fixture','test','{}') RETURNING id`)).rows[0].id;
  const version = (await db.query(`INSERT INTO public.exercise_versions(exercise_id,revision,definition,
    engine_contract,generation_version,canonicalization_version,definition_sha256,approval_fingerprint_sha256)
    VALUES($1,1,'{"fixture":"SQL only"}','5','1','pg-jsonb-text-v1',repeat('0',64),repeat('0',64)) RETURNING id`, [exercise])).rows[0].id;
  await db.query(`UPDATE public.exercise_versions SET editorial_status='approved',approved_at=now(),approved_by=$2
    WHERE id=$1`, [version, admin]);
  await db.query("UPDATE public.exercise_versions SET editorial_status='published' WHERE id=$1", [version]);
  await identity(student);
  equal((await db.query('SELECT public.is_novlearn_admin() AS allowed')).rows[0].allowed, false, 'student no admin');
  await denied("UPDATE public.profiles SET role='admin' WHERE id=$1", [student], '42501');
  await denied("INSERT INTO public.profiles(id,email,first_name,birth_date,role) VALUES($1,$2,'test','2000-01-01','admin')",
    [student, 'fixture@novlearn.test'], '42501');
  await denied(`INSERT INTO public.profiles(id,email,first_name,birth_date,role)
    VALUES($1,$2,'test','2000-01-01','admin') ON CONFLICT(id) DO UPDATE SET role=excluded.role`,
    [student, 'fixture@novlearn.test'], '42501');
  await denied('UPDATE public.profiles SET id=$2 WHERE id=$1', [student, randomUUID()], '42501');
  await denied('DELETE FROM public.profiles WHERE id=$1', [student], '42501');
  equal((await db.query("UPDATE public.profiles SET first_name='Attempt' WHERE id=$1", [admin])).rowCount,
    0, 'cross-profile write filtered');
  equal((await db.query("UPDATE public.profiles SET first_name='Permitted' WHERE id=$1", [student])).rowCount,
    1, 'ordinary self edit preserved');
  await denied(`INSERT INTO public.exercise_attempts(user_id,exercise_id,exercise_version_id,is_correct)
    VALUES($1,$2,$3,true)`, [student, exercise, version], '42501');
  equal((await db.query('SELECT id FROM public.exercise_versions WHERE id=$1', [version])).rowCount, 0, 'student version hidden');
  await denied('SELECT public.publish_exercise_version($1,$2)', [exercise, version], '42501');
  for (const table of ['exercise_attempt_instances', 'exercise_attempt_replay_artifacts', 'duel_exercise_instances'])
    await denied(`SELECT * FROM public.${table}`, [], '42501');
  await identity(admin, true);
  equal((await db.query('SELECT public.is_novlearn_admin() AS allowed')).rows[0].allowed, false, 'guest cannot inherit admin');
  equal((await db.query('SELECT id FROM public.profiles WHERE id=$1', [admin])).rowCount, 0, 'guest profiles hidden');
  equal((await db.query('SELECT id FROM public.exercise_versions WHERE id=$1', [version])).rowCount, 0, 'guest versions hidden');
  await identity(null, false, 'anon');
  equal((await db.query('SELECT id FROM public.profiles WHERE id=$1', [admin])).rowCount, 0, 'anon profiles hidden');
  await denied('SELECT public.is_novlearn_admin()', [], '42501');
  await denied('SELECT public.publish_exercise_version($1,$2)', [exercise, version], '42501');
  await identity(admin);
  equal((await db.query('SELECT public.is_novlearn_admin() AS allowed')).rows[0].allowed, true, 'admin allowed');
  await db.query('SELECT public.publish_exercise_version($1,$2)', [exercise, version]);
  await identity(admin, false, 'service_role');
  await denied('DELETE FROM public.exercise_versions WHERE id=$1', [version], '42501');
  await denied('TRUNCATE public.exercise_versions CASCADE', [], '42501');
  await db.query('RESET ROLE');
  equal((await db.query(`SELECT count(*)::int AS n FROM pg_policies
    WHERE schemaname='public' AND policyname LIKE 'No guest access to %'
      AND permissive='PERMISSIVE' AND cmd='ALL'`)).rows[0].n, 0, 'no permissive guest ALL policy remains');
  await db.query('ROLLBACK');
  equal((await db.query('SELECT count(*)::int AS n FROM auth.users WHERE id=ANY($1::uuid[])', [[admin, student]])).rows[0].n,
    0, 'test accounts rolled back');
  console.log(`PASS: ${checks} real local SQL security assertions; fixtures rolled back, loopback only.`);
} catch (error) {
  try { await db.query('ROLLBACK'); } catch {}
  console.error(error.message); process.exitCode = 1;
} finally { await db.end(); }
