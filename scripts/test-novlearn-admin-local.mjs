import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { localDatabaseUrl } from './local-database-url.mjs';

const connectionString = localDatabaseUrl(process.env.NOVLEARN_LOCAL_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
const client = new pg.Client({ connectionString });
let checks = 0;
const expectedSqlStates = {
  'active pointer rejects an approved but unpublished revision': 'P0001',
  'published version UPDATE is rejected': 'P0001',
  'published version DELETE is rejected': 'P0001',
  'published versions cannot be inserted directly': 'P0001',
  'attempt cannot reference a draft version': 'P0001',
  'authenticated Admin cannot read private replay artifacts': '42501',
  'authenticated Admin cannot read private attempt instances': '42501',
  'authenticated Admin cannot read private duel instances': '42501',
  'regular user cannot publish': '42501',
  'anon cannot read exercise versions': '42501',
  'anon cannot read private replay artifacts': '42501',
  'anon cannot read private attempt instances': '42501',
  'anon cannot invoke publication': '42501',
  'service_role cannot UPDATE a published version': 'P0001',
  'service_role cannot DELETE published versions': '42501',
  'service_role cannot TRUNCATE the version catalog': '42501',
  'attempt instance metadata must be complete': '23502',
  'version must belong to the attempt exercise': 'P0001',
  'duel attempt cannot point at another duel round': '23503',
};

async function expectSqlFailure(label, sql, values = []) {
  await client.query('SAVEPOINT expected_failure');
  assert.ok(Object.hasOwn(expectedSqlStates, label), 'test must declare its expected SQLSTATE');
  let failure;
  try {
    await client.query(sql, values);
  } catch (error) {
    failure = error;
  }
  await client.query('ROLLBACK TO SAVEPOINT expected_failure');
  await client.query('RELEASE SAVEPOINT expected_failure');
  assert.equal(failure?.code, expectedSqlStates[label], `${label}: expected the intended SQL failure`);
  checks += 1;
}

async function createAuthUser(id, email) {
  await client.query(
    `insert into auth.users
       (id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ($1, 'authenticated', 'authenticated', $2, '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       '{"first_name":"SQL test","birth_date":"2000-01-01"}'::jsonb,
       now(), now())`,
    [id, email],
  );
}

try {
  await client.connect();
  await client.query('begin');

  const adminId = randomUUID();
  const studentId = randomUUID();
  const exerciseId = (await client.query(
    `insert into public.exercises (chapter, difficulty, content, title)
     values ('SQL integration test', 'easy', '{}'::jsonb, 'versioned test') returning id`,
  )).rows[0].id;
  const otherExerciseId = (await client.query(
    `insert into public.exercises (chapter, difficulty, content, title)
     values ('SQL integration test', 'easy', '{}'::jsonb, 'other versioned test') returning id`,
  )).rows[0].id;

  await createAuthUser(adminId, `admin-${adminId}@novlearn.test`);
  await createAuthUser(studentId, `student-${studentId}@novlearn.test`);
  await client.query("update public.profiles set role = 'admin' where id = $1", [adminId]);

  const legacyAttempt = await client.query(
    `insert into public.exercise_attempts (user_id, exercise_id, is_correct)
     values ($1, $2, true) returning id, exercise_version_id`,
    [studentId, exerciseId],
  );
  assert.equal(legacyAttempt.rows[0].exercise_version_id, null, 'legacy attempt version remains NULL');
  const legacyInstanceCount = await client.query(
    'select count(*)::int as count from public.exercise_attempt_instances where attempt_id = $1',
    [legacyAttempt.rows[0].id],
  );
  assert.equal(legacyInstanceCount.rows[0].count, 0, 'legacy attempt receives no invented instance');
  checks += 2;

  const definition = { elements: [{ type: 'question', prompt: 'Combien font 2 + 2 ?' }], variables: { n: 2 } };
  const version = (await client.query(
    `insert into public.exercise_versions
       (exercise_id, revision, definition, engine_contract, generation_version,
        canonicalization_version, definition_sha256, approval_fingerprint_sha256)
     values ($1, 1, $2::jsonb, 'novlearn-engine-v1', 'generator-1', 'pg-jsonb-text-v1',
       repeat('0', 64), repeat('0', 64)) returning id, definition::text as canonical_json, definition_sha256`,
    [exerciseId, JSON.stringify(definition)],
  )).rows[0];
  const nodeHash = createHash('sha256').update(version.canonical_json, 'utf8').digest('hex');
  assert.equal(version.definition_sha256, nodeHash, 'database SHA-256 matches Node crypto over stored JSONB text');
  const databaseHash = await client.query(
    `select encode(extensions.digest(convert_to($1, 'UTF8'), 'sha256'), 'hex') as hash`,
    [version.canonical_json],
  );
  assert.equal(version.definition_sha256, databaseHash.rows[0].hash, 'version digest matches real pgcrypto SHA-256');
  checks += 2;

  await client.query(
    `update public.exercise_versions
       set editorial_status = 'approved', approved_at = now(), approved_by = $2
     where id = $1`, [version.id, adminId],
  );
  await expectSqlFailure('active pointer rejects an approved but unpublished revision',
    'update public.exercises set active_version_id = $1 where id = $2', [version.id, exerciseId]);
  await client.query(
    `update public.exercise_versions set editorial_status = 'published' where id = $1`, [version.id],
  );
  await expectSqlFailure('published version UPDATE is rejected',
    'update public.exercise_versions set definition = $2::jsonb where id = $1', [version.id, '{"changed":true}']);
  await expectSqlFailure('published version DELETE is rejected',
    'delete from public.exercise_versions where id = $1', [version.id]);
  await expectSqlFailure('published versions cannot be inserted directly',
    `insert into public.exercise_versions
       (exercise_id, revision, definition, engine_contract, generation_version,
        canonicalization_version, definition_sha256, approval_fingerprint_sha256, editorial_status)
     values ($1, 99, '{}'::jsonb, 'engine', 'generator', 'jsonb-v1', repeat('0', 64), repeat('0', 64), 'published')`,
    [exerciseId]);

  const revisedVersionId = (await client.query(
    `insert into public.exercise_versions
       (exercise_id, revision, definition, engine_contract, generation_version,
        canonicalization_version, definition_sha256, approval_fingerprint_sha256)
     values ($1, 2, '{"draft":true}'::jsonb, 'novlearn-engine-v1', 'generator-1', 'pg-jsonb-text-v1',
       repeat('0', 64), repeat('0', 64)) returning id`, [exerciseId],
  )).rows[0].id;
  await client.query(
    `update public.exercise_versions set editorial_status = 'approved', approved_at = now(), approved_by = $2
     where id = $1`, [revisedVersionId, adminId],
  );
  const draftAgain = await client.query(
    `update public.exercise_versions set definition = '{"draft":false}'::jsonb where id = $1
     returning editorial_status, approved_at, approved_by, approved_fingerprint_sha256`, [revisedVersionId],
  );
  assert.equal(draftAgain.rows[0].editorial_status, 'draft', 'content changes invalidate approval');
  assert.equal(draftAgain.rows[0].approved_at, null, 'approval time is cleared after content change');
  assert.equal(draftAgain.rows[0].approved_by, null, 'approver is cleared after content change');
  assert.equal(draftAgain.rows[0].approved_fingerprint_sha256, null, 'approval fingerprint is cleared after content change');
  checks += 4;
  await expectSqlFailure('attempt cannot reference a draft version',
    `insert into public.exercise_attempts (user_id, exercise_id, exercise_version_id, is_correct)
     values ($1, $2, $3, true)`, [studentId, exerciseId, revisedVersionId]);

  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [adminId]);
  await client.query('set local role authenticated');
  const adminAccess = await client.query(
    `select public.is_novlearn_admin() as is_admin,
            (select count(*) from public.exercise_versions where id = $1)::int as visible_versions`,
    [version.id],
  );
  assert.equal(adminAccess.rows[0].is_admin, true, 'Admin authorization comes from profiles.role');
  assert.equal(adminAccess.rows[0].visible_versions, 1, 'Admin RLS policy exposes exercise versions');
  await client.query('select public.publish_exercise_version($1, $2)', [exerciseId, version.id]);
  await expectSqlFailure('authenticated Admin cannot read private replay artifacts',
    'select * from public.exercise_attempt_replay_artifacts');
  await expectSqlFailure('authenticated Admin cannot read private attempt instances',
    'select * from public.exercise_attempt_instances');
  await expectSqlFailure('authenticated Admin cannot read private duel instances',
    'select * from public.duel_exercise_instances');
  await client.query('reset role');

  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [studentId]);
  await client.query('set local role authenticated');
  const studentAccess = await client.query(
    `select public.is_novlearn_admin() as is_admin,
            (select count(*) from public.exercise_versions where id = $1)::int as visible_versions`,
    [version.id],
  );
  assert.equal(studentAccess.rows[0].is_admin, false, 'regular authenticated user is not an Admin');
  assert.equal(studentAccess.rows[0].visible_versions, 0, 'RLS hides versions from regular users');
  await expectSqlFailure('regular user cannot publish',
    'select public.publish_exercise_version($1, $2)', [exerciseId, version.id]);
  await client.query('reset role');

  await client.query('set local role anon');
  await expectSqlFailure('anon cannot read exercise versions', 'select * from public.exercise_versions');
  await expectSqlFailure('anon cannot read private replay artifacts',
    'select * from public.exercise_attempt_replay_artifacts');
  await expectSqlFailure('anon cannot read private attempt instances',
    'select * from public.exercise_attempt_instances');
  await expectSqlFailure('anon cannot invoke publication',
    'select public.publish_exercise_version($1, $2)', [exerciseId, version.id]);
  await client.query('reset role');

  await client.query('set local role service_role');
  await expectSqlFailure('service_role cannot UPDATE a published version',
    `update public.exercise_versions set definition = '{"tampered":true}'::jsonb where id = $1`,
    [version.id]);
  await expectSqlFailure('service_role cannot DELETE published versions',
    'delete from public.exercise_versions where id = $1', [version.id]);
  await expectSqlFailure('service_role cannot TRUNCATE the version catalog',
    'truncate table public.exercise_versions');
  await client.query('reset role');

  const active = await client.query('select active_version_id from public.exercises where id = $1', [exerciseId]);
  assert.equal(active.rows[0].active_version_id, version.id, 'publication RPC moves the active pointer');
  checks += 3;

  const versionedAttempt = await client.query(
    `insert into public.exercise_attempts (user_id, exercise_id, exercise_version_id, is_correct)
     values ($1, $2, $3, true) returning id`, [studentId, exerciseId, version.id],
  );
  await client.query(
    `insert into public.exercise_attempt_instances
       (attempt_id, instance_seed, generation_version, instance_data)
     values ($1, 'private-seed', 'generator-1', '{"prompt":"private"}'::jsonb)`,
    [versionedAttempt.rows[0].id],
  );

  await expectSqlFailure('attempt instance metadata must be complete',
    `insert into public.exercise_attempt_instances (attempt_id, generation_version, instance_data)
     values ($1, 'generator-1', '{}'::jsonb)`, [versionedAttempt.rows[0].id]);
  await expectSqlFailure('version must belong to the attempt exercise',
    `insert into public.exercise_attempts (user_id, exercise_id, exercise_version_id, is_correct)
     values ($1, $2, $3, true)`, [studentId, otherExerciseId, version.id]);

  const duel = (await client.query(
    `insert into public.duels (player1_id, player2_id, status) values ($1, $2, 'active') returning id`,
    [adminId, studentId],
  )).rows[0].id;
  const instanceId = (await client.query(
    `insert into public.duel_exercise_instances
       (duel_id, round_number, exercise_id, exercise_version_id, instance_seed, generation_version, replay_data)
     values ($1, 1, $2, $3, 'seed-1', 'generator-1', '{"answer":"4"}'::jsonb) returning id`,
    [duel, exerciseId, version.id],
  )).rows[0].id;
  await client.query(
    `insert into public.duel_attempts
       (duel_id, player_id, element_id, is_correct, duel_exercise_instance_id)
     values ($1, $2, 0, true, $3)`, [duel, studentId, instanceId],
  );
  const otherDuel = (await client.query(
    `insert into public.duels (player1_id, player2_id, status) values ($1, $2, 'active') returning id`,
    [adminId, studentId],
  )).rows[0].id;
  await expectSqlFailure('duel attempt cannot point at another duel round',
    `insert into public.duel_attempts
       (duel_id, player_id, element_id, is_correct, duel_exercise_instance_id)
     values ($1, $2, 1, true, $3)`, [otherDuel, studentId, instanceId]);

  await client.query('rollback');
  console.log(`PASS: ${checks} NovLearn Admin SQL integration assertions (transaction rolled back).`);
} catch (error) {
  try { await client.query('rollback'); } catch {}
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end();
}
