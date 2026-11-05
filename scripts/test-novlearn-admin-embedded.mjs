// Disposable PostgreSQL/WASM evidence, NOT a full Supabase baseline replay.
// Real bundled pgcrypto; synthetic Auth helpers and explicitly modelled ACLs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });
const admin = '20000000-0000-0000-0000-000000000001';
const student = '20000000-0000-0000-0000-000000000002';
const other = '20000000-0000-0000-0000-000000000003';
const version = '10000000-0000-0000-0000-000000000001';
let checks = 0;
const inputs = new Map();
async function row(sql) { return (await db.query(sql)).rows[0]; }
function equal(actual, expected, label) {
  assert.deepEqual(actual, expected, label); checks++;
}
async function denied(sql, pattern) {
  await assert.rejects(db.exec(sql), pattern); checks++;
}
async function identity(id, guest = false) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claims', $1, false)",
    [JSON.stringify({ sub: id, is_anonymous: guest, user_metadata: { role: 'admin' } })]);
  await db.exec('SET ROLE authenticated');
}
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT (auth.jwt()->>'sub')::uuid $$;
    CREATE FUNCTION public.is_guest() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT COALESCE((auth.jwt()->>'is_anonymous')::boolean, false) $$;
    GRANT USAGE ON SCHEMA auth, public, extensions TO anon, authenticated, service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),
      role text NOT NULL DEFAULT 'user', first_name text);
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO anon, authenticated;
    CREATE POLICY "No guest access to profiles" ON public.profiles FOR ALL USING (true);
    CREATE POLICY profiles_select_others ON public.profiles FOR SELECT TO authenticated USING (true);
    CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated
      WITH CHECK (id = auth.uid());
    CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated
      USING (id = auth.uid()) WITH CHECK (id = auth.uid());
    CREATE TABLE public.exercises(id bigint PRIMARY KEY, content jsonb);
    CREATE TABLE public.exercise_attempts(id bigint PRIMARY KEY, exercise_id bigint,
      user_id uuid DEFAULT '${student}');
    ALTER TABLE public.exercise_attempts ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE ON public.exercise_attempts TO anon, authenticated;
    CREATE POLICY "No guest access to exercise_attempts" ON public.exercise_attempts FOR ALL USING (NOT is_guest());
    CREATE POLICY attempt_select_self ON public.exercise_attempts FOR SELECT USING (auth.uid() = user_id);
    CREATE POLICY attempt_insert_self ON public.exercise_attempts FOR INSERT WITH CHECK (auth.uid() = user_id);
    CREATE TABLE public.duels(id bigint PRIMARY KEY, player1_id uuid, player2_id uuid);
    ALTER TABLE public.duels ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.duels TO anon, authenticated;
    CREATE POLICY "No guest access to duels" ON public.duels FOR ALL USING (NOT is_guest());
    CREATE POLICY duel_select_players ON public.duels FOR SELECT
      USING(auth.uid() = player1_id OR auth.uid() = player2_id);
    CREATE TABLE public.duel_attempts(id bigint PRIMARY KEY, duel_id bigint);
    INSERT INTO auth.users VALUES ('${admin}'), ('${student}'), ('${other}');
    INSERT INTO public.profiles VALUES ('${admin}', 'admin', 'Admin'), ('${student}', 'user', 'Student');
    INSERT INTO public.exercises VALUES (1, '{"legacy":"unchanged"}'), (2, '{}');
    INSERT INTO public.exercise_attempts(id,exercise_id) VALUES (1, 1);
    INSERT INTO public.duels VALUES (7,'${admin}','${student}'), (8,'${admin}','${other}');
  `);
  for (const name of [
    '20261013174721_novlearn_admin_exercise_versioning.sql',
    '20261013174722_novlearn_admin_private_replay_and_publishing.sql',
    '20261013174723_novlearn_admin_profile_role_hardening.sql',
  ]) {
    const file = new URL(`../supabase/migrations/${name}`, import.meta.url);
    const source = await readFile(file, 'utf8');
    inputs.set(file, source);
    await db.exec(source);
  }

  equal(await row('SELECT content, catalog_id, active_version_id FROM public.exercises WHERE id=1'),
    { content: { legacy: 'unchanged' }, catalog_id: null, active_version_id: null }, 'legacy exercise preserved');
  equal(await row('SELECT exercise_version_id FROM public.exercise_attempts WHERE id=1'),
    { exercise_version_id: null }, 'history not invented');
  equal((await row('SELECT count(*)::int AS n FROM public.exercise_attempt_instances')).n, 0,
    'historical instances not invented');
  equal((await row("SELECT role FROM public.profiles WHERE id='" + admin + "'" )).role, 'admin', 'existing role preserved');
  await identity(student);
  equal((await row('SELECT public.is_novlearn_admin() AS result')).result, false, 'metadata cannot grant admin');
  equal((await row('SELECT count(*)::int AS n FROM public.duels')).n, 1, 'ALL guest policy no longer bypasses duel ownership');
  equal((await row('SELECT count(*)::int AS n FROM public.exercise_attempts')).n, 1, 'own legacy attempt visible');
  await denied(`UPDATE public.profiles SET role='admin' WHERE id='${student}'`, /client cannot change/);
  await denied(`INSERT INTO public.profiles(id, role) VALUES ('${other}', 'admin')`, /client cannot assign/);
  await db.exec(`UPDATE public.profiles SET first_name='Allowed' WHERE id='${student}'`);
  equal((await row(`SELECT first_name FROM public.profiles WHERE id='${student}'`)).first_name, 'Allowed', 'own ordinary update');
  await db.exec(`UPDATE public.profiles SET first_name='Attack' WHERE id='${admin}'`);
  equal((await row(`SELECT first_name FROM public.profiles WHERE id='${admin}'`)).first_name, 'Admin', 'cross-profile update filtered');
  await denied(`UPDATE public.profiles SET id='${other}' WHERE id='${student}'`, /client cannot change/);
  await denied(`DELETE FROM public.profiles WHERE id='${student}'`, /permission denied/);
  await denied(`INSERT INTO public.profiles(id) VALUES ('${other}')`, /row-level security/);
  await identity(other);
  await denied(`INSERT INTO public.profiles(id, role) VALUES ('${other}', 'admin')`, /client cannot assign/);
  await db.exec(`INSERT INTO public.profiles(id) VALUES ('${other}')`);
  equal((await row(`SELECT role FROM public.profiles WHERE id='${other}'`)).role, 'user', 'self insert ordinary role');
  await denied(`INSERT INTO public.profiles(id,role) VALUES ('${other}','admin')
    ON CONFLICT(id) DO UPDATE SET role=excluded.role`, /client cannot assign/);
  await identity(admin, true);
  equal((await row('SELECT public.is_novlearn_admin() AS result')).result, false, 'guest admin role refused');
  equal((await row('SELECT count(*)::int AS n FROM public.profiles')).n, 0, 'guest cannot read profiles');
  equal((await row('SELECT count(*)::int AS n FROM public.exercise_attempts')).n, 0, 'guest cannot read attempts');
  equal((await row('SELECT count(*)::int AS n FROM public.exercise_versions')).n, 0, 'guest cannot read versions');
  await denied(`INSERT INTO public.profiles(id) VALUES ('40000000-0000-0000-0000-000000000001')`, /row-level security/);

  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claims', '{}', false)");
  await db.exec('SET ROLE anon');
  equal((await row('SELECT count(*)::int AS n FROM public.profiles')).n, 0, 'anon profiles hidden');
  equal((await row('SELECT count(*)::int AS n FROM public.duels')).n, 0, 'anon duels hidden');
  equal((await row('SELECT count(*)::int AS n FROM public.exercise_attempts')).n, 0, 'anon attempts hidden');
  await denied('SELECT * FROM public.exercise_versions', /permission denied/);
  await denied('SELECT public.is_novlearn_admin()', /permission denied/);
  await denied(`SELECT public.publish_exercise_version(1, '${version}')`, /permission denied/);
  await denied(`INSERT INTO public.profiles(id) VALUES ('${other}')`, /row-level security/);

  await identity(admin);
  equal((await row('SELECT public.is_novlearn_admin() AS result')).result, true, 'trusted admin');
  await db.exec(`INSERT INTO public.exercise_versions(id,exercise_id,revision,definition,
    engine_contract,generation_version,canonicalization_version,definition_sha256,approval_fingerprint_sha256)
    VALUES ('${version}',1,1,'{"schema":5,"fixture":"SQL only"}','5','1','pg-jsonb-text-v1',repeat('0',64),repeat('0',64))`);
  const hashed = await row(`SELECT definition::text AS json, definition_sha256 AS hash,
    approval_fingerprint_sha256 AS fingerprint FROM public.exercise_versions WHERE id='${version}'`);
  equal(hashed.hash, createHash('sha256').update(hashed.json).digest('hex'), 'real SHA256 equals Node');
  assert.notEqual(hashed.fingerprint, '0'.repeat(64)); checks++;
  await db.exec(`UPDATE public.exercise_versions SET editorial_status='approved',approved_at=now(),approved_by='${admin}' WHERE id='${version}'`);
  await denied(`SELECT public.publish_exercise_version(1, '${version}')`, /only a published/);
  await db.exec(`UPDATE public.exercise_versions SET editorial_status='published' WHERE id='${version}'`);
  await db.exec(`SELECT public.publish_exercise_version(1, '${version}')`);
  await denied(`SELECT public.publish_exercise_version(2, '${version}')`, /only a published/);
  await denied(`UPDATE public.exercise_versions SET definition='{}' WHERE id='${version}'`, /immutable/);
  await denied(`DELETE FROM public.exercise_versions WHERE id='${version}'`, /permission denied/);
  for (const table of ['exercise_attempt_instances', 'exercise_attempt_replay_artifacts', 'duel_exercise_instances'])
    await denied(`SELECT * FROM public.${table}`, /permission denied/);
  await identity(student);
  equal((await row('SELECT count(*)::int AS n FROM public.exercise_versions')).n, 0, 'student version hidden');
  await denied(`SELECT public.publish_exercise_version(1, '${version}')`, /administrator access required/);
  await denied(`INSERT INTO public.exercise_attempts(id,exercise_id,exercise_version_id)
    VALUES(2,1,'${version}')`, /canonical attempts are server-owned/);
  await denied(`INSERT INTO public.exercise_versions(exercise_id,revision,definition,engine_contract,
    generation_version,canonicalization_version,definition_sha256,approval_fingerprint_sha256)
    VALUES(1,2,'{}','5','1','jsonb',repeat('0',64),repeat('0',64))`, /row-level security/);
  await db.exec('RESET ROLE');
  equal((await row(`SELECT permissive FROM pg_catalog.pg_policies WHERE tablename='duels'
    AND policyname='No guest access to duels'`)).permissive, 'RESTRICTIVE', 'legacy guest policy corrected');
  await denied(`DELETE FROM public.exercise_versions WHERE id='${version}'`, /immutable/);
  await denied(`UPDATE public.exercises SET active_version_id='${version}' WHERE id=2`, /active exercise version must be published/);
  await db.exec(`INSERT INTO public.exercise_versions(exercise_id,revision,definition,engine_contract,
    generation_version,canonicalization_version,definition_sha256,approval_fingerprint_sha256)
    VALUES(1,2,'{}','5','1','jsonb',repeat('0',64),repeat('0',64));
    UPDATE public.exercise_versions SET editorial_status='approved',approved_at=now(),approved_by='${admin}' WHERE revision=2;
    UPDATE public.exercise_versions SET revision=3 WHERE revision=2;`);
  equal(await row('SELECT editorial_status,approved_fingerprint_sha256 FROM public.exercise_versions WHERE revision=3'),
    { editorial_status: 'draft', approved_fingerprint_sha256: null }, 'revision invalidates approval');
  await denied(`INSERT INTO public.exercise_attempts(id,exercise_id,exercise_version_id)
    VALUES(2,2,'${version}')`, /attempt must reference a published exercise version/);
  await denied(`INSERT INTO public.exercise_attempt_instances(attempt_id,instance_seed,generation_version,instance_data)
    VALUES(1,'42','1','{}')`, /matching published attempt version/);
  await db.exec(`INSERT INTO public.exercise_attempts(id,exercise_id,exercise_version_id) VALUES(2,1,'${version}')`);
  await denied(`INSERT INTO public.exercise_attempt_instances(attempt_id,instance_seed,generation_version,instance_data)
    VALUES(2,'42','wrong','{}')`, /matching published attempt version/);
  await db.exec(`INSERT INTO public.exercise_attempt_instances(attempt_id,instance_seed,generation_version,instance_data)
    VALUES(2,'42','1','{}')`);
  await db.exec(`INSERT INTO public.duel_exercise_instances(id,duel_id,round_number,exercise_id,
    exercise_version_id,instance_seed,generation_version,replay_data)
    VALUES('30000000-0000-0000-0000-000000000001',7,1,1,'${version}','42','1','{"private":true}')`);
  await denied(`INSERT INTO public.duel_attempts(id,duel_id,duel_exercise_instance_id)
    VALUES(1,8,'30000000-0000-0000-0000-000000000001')`, /foreign key/);
  equal((await row('SELECT exercise_version_id FROM public.exercise_attempts WHERE id=1')).exercise_version_id,
    null, 'existing attempt version remains unknown');
  await db.exec('SET ROLE service_role');
  await denied('TRUNCATE public.exercise_versions CASCADE', /permission denied/);
  await denied(`DELETE FROM public.exercise_versions WHERE id='${version}'`, /permission denied/);
  await db.exec('RESET ROLE');
  for (const [file, source] of inputs) {
    equal(await readFile(file, 'utf8'), source, `migration stable during test: ${file.pathname}`);
    console.log(`migration SHA256 ${file.pathname.split('/').at(-1)} ${createHash('sha256').update(source).digest('hex')}`);
  }
  console.log(`PASS: ${checks} embedded SQL assertions; real pgcrypto, synthetic Auth/ACL baseline, no network.`);
} finally { await db.close(); }
