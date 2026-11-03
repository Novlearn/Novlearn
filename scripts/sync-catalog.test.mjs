import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { compatibleColumns, connectionConfig, parseArgs, readConfig, syncCatalog } from "./sync-catalog.mjs";

const PROD = "aaaaaaaaaaaaaaaaaaaa";
const STAGE = "bbbbbbbbbbbbbbbbbbbb";
const url = (ref) => "postgresql://postgres." + ref + ":secret@aws-0-eu-west-3.pooler.supabase.com:5432/postgres";

test("connections: refuse production as target, mismatched references and URL overrides", () => {
  const env = { CATALOG_PRODUCTION_PROJECT_REF: PROD, CATALOG_STAGING_PROJECT_REF: STAGE,
    CATALOG_PRODUCTION_DB_URL: url(PROD), CATALOG_STAGING_DB_URL: url(STAGE) };
  assert.equal(readConfig(env).staging.ssl.rejectUnauthorized, true);
  assert.throws(() => readConfig({ ...env, CATALOG_STAGING_PROJECT_REF: PROD }), /differents/);
  assert.throws(() => readConfig({ ...env, CATALOG_STAGING_DB_URL: url(PROD) }), /correspond/);
  assert.throws(() => connectionConfig(url(STAGE) + "?host=db." + PROD + ".supabase.co", STAGE), /interdit/);
  assert.throws(() => connectionConfig(url(STAGE).replace(":5432/", ":6543/"), STAGE), /5432/);
  assert.throws(() => connectionConfig(url(STAGE).replace(".supabase.com", ".supabase.com.evil.test"), STAGE), /correspond/);
  assert.throws(() => connectionConfig(url(STAGE) + "?sslmode=disable", STAGE), /interdit/);
  assert.throws(() => connectionConfig(url(STAGE).slice(0, -8) + "/other", STAGE), /postgres/);
  assert.equal(connectionConfig("postgresql://reader:secret@db." + PROD + ".supabase.co:5432/postgres", PROD).user, "reader");
});

test("CLI: preview by default; only explicit options accepted", () => {
  assert.equal(parseArgs([]).apply, false);
  assert.deepEqual(parseArgs(["--apply", "--flashcards"]), { apply: true, flashcards: true, adoptExisting: false, help: false });
  assert.throws(() => parseArgs(["--tables=profiles"]), /inconnue/);
});

test("schema mismatch is rejected before data can be copied", () => {
  const col = (name, type, extra = {}) => ({ name, type, generated: "", required: false, ...extra });
  const source = [col("id", "bigint"), col("content", "jsonb")];
  assert.throws(() => compatibleColumns("exercises", source, [col("id", "integer"), col("content", "jsonb")]), /incompatibles/);
  assert.throws(() => compatibleColumns("exercises", source, [...source, col("mandatory", "text", { required: true })]), /obligatoire/);
  assert.deepEqual(compatibleColumns("exercises", source, [...source, col("optional", "text")]), ["id", "content"]);
});

const DDL = `
  CREATE TABLE chapters (id uuid PRIMARY KEY, name text NOT NULL UNIQUE, order_index integer NOT NULL);
  CREATE TABLE competences (id text PRIMARY KEY, name text NOT NULL,
    chapter_id uuid REFERENCES chapters(id), max_points integer NOT NULL);
  CREATE TABLE exercises (id bigserial PRIMARY KEY, chapter text NOT NULL, title text,
    difficulty text CHECK (difficulty IN ('easy', 'hard')), content jsonb NOT NULL,
    competences text[], "Is_Flash" boolean, created_at timestamptz DEFAULT now());
  CREATE TABLE flashcards (id uuid PRIMARY KEY, chapter text, question text, answer text);
  CREATE TABLE profiles (id uuid PRIMARY KEY, email text);
  CREATE TABLE user_competence_scores (user_id uuid REFERENCES profiles(id),
    competence_id text REFERENCES competences(id), points integer);
  CREATE TABLE exercise_attempts (id integer PRIMARY KEY, exercise_id bigint REFERENCES exercises(id));
`;
const SOURCE_ID = "00000000-0000-0000-0000-000000000001";
const TARGET_ID = "00000000-0000-0000-0000-000000000002";
const NEW_ID = "00000000-0000-0000-0000-000000000003";
const USER_ID = "00000000-0000-0000-0000-000000000004";
const BIG_ID = "9007199254740993";

async function fixture() {
  const source = new PGlite();
  const target = new PGlite();
  await source.exec(DDL);
  await target.exec(DDL);
  await source.exec(`
    INSERT INTO chapters VALUES ('${SOURCE_ID}', 'Suites', 1), ('${NEW_ID}', 'Probas', 2);
    INSERT INTO competences VALUES ('suite', 'Suite mise a jour', '${SOURCE_ID}', 40),
      ('proba', 'Probabilites', '${NEW_ID}', 30);
    INSERT INTO exercises (id, chapter, title, difficulty, content, competences, "Is_Flash", created_at)
    VALUES (1, 'Suites', 'Production', 'easy', '{"elements":[{"text":"Équation"}],"n":9007199254740993}', ARRAY['suite'], true, '2026-01-01T12:00:00Z'),
      (${BIG_ID}, 'Probas', 'Grand ID', 'hard', '{"variables":[1,2,3]}', ARRAY['proba'], false, '2026-01-01T12:00:00Z');
    INSERT INTO flashcards VALUES ('${NEW_ID}', 'Suites', 'Question', 'Réponse');
    INSERT INTO profiles VALUES ('${USER_ID}', 'production@example.test');
  `);
  await target.exec(`
    INSERT INTO chapters VALUES ('${TARGET_ID}', 'Suites', 9);
    INSERT INTO competences VALUES ('suite', 'Ancienne suite', '${TARGET_ID}', 20);
    INSERT INTO exercises (id, chapter, title, difficulty, content)
      VALUES (1, 'Suites', 'Ancien', 'easy', '{}'), (99, 'Suites', 'Brouillon staging', 'easy', '{}');
    INSERT INTO profiles VALUES ('${USER_ID}', 'staging@example.test');
    INSERT INTO user_competence_scores VALUES ('${USER_ID}', 'suite', 12);
    INSERT INTO exercise_attempts VALUES (1, 1), (2, 99);
  `);
  return { source, target };
}
const catalog = async (db) => (await db.query("SELECT to_jsonb(e)::text AS data FROM exercises e ORDER BY id")).rows;
const wrap = (db) => ({ query: (sql, params) => db.query(sql, params) });

test("SQL: preview writes nothing; apply preserves drafts, FK, JSON, UUID mapping and bigint; repeat is idempotent", async () => {
  const { source, target } = await fixture();
  try {
    const before = await catalog(target);
    const sourceBefore = await catalog(source);
    const preview = await syncCatalog({ source: wrap(source), target: wrap(target), productionRef: PROD, flashcards: true });
    assert.deepEqual(await catalog(target), before);
    assert.deepEqual(preview.find((r) => r.table === "exercises"), {
      table: "exercises", added: 1, updated: 1, unchanged: 0, staging_only: 1, untracked_conflicts: 1 });
    assert.equal((await target.query("SELECT count(*)::int AS n FROM flashcards")).rows[0].n, 0);

    await syncCatalog({ source: wrap(source), target: wrap(target), productionRef: PROD, apply: true, flashcards: true, adoptExisting: true });
    const chapter = (await target.query("SELECT chapter_id::text AS id FROM competences WHERE id='suite'")).rows[0];
    assert.equal(chapter.id, TARGET_ID);
    assert.equal((await target.query("SELECT chapter_id::text AS id FROM competences WHERE id='proba'")).rows[0].id, NEW_ID);
    assert.equal((await target.query("SELECT title FROM exercises WHERE id=99")).rows[0].title, "Brouillon staging");
    assert.equal((await target.query("SELECT email FROM profiles")).rows[0].email, "staging@example.test");
    assert.equal((await target.query("SELECT points FROM user_competence_scores")).rows[0].points, 12);
    assert.equal((await target.query("SELECT count(*)::int AS n FROM exercise_attempts")).rows[0].n, 2);
    assert.equal((await target.query("SELECT content->>'n' AS n FROM exercises WHERE id=1")).rows[0].n, BIG_ID);
    assert.equal((await target.query("SELECT id::text AS id FROM exercises WHERE title='Grand ID'")).rows[0].id, BIG_ID);
    assert.equal((await target.query('SELECT "Is_Flash" AS value FROM exercises WHERE id=1')).rows[0].value, true);
    assert.deepEqual(await catalog(source), sourceBefore);
    const next = (await target.query("SELECT nextval('exercises_id_seq')::text AS id")).rows[0].id;
    assert.equal(next, (BigInt(BIG_ID) + 1n).toString());
    const second = await syncCatalog({ source: wrap(source), target: wrap(target), productionRef: PROD, apply: true, flashcards: true });
    assert.ok(second.every((r) => r.added === 0 && r.updated === 0));
  } finally { await source.close(); await target.close(); }
});

test("SQL: a failed exercise insert rolls back preceding chapter and competence changes", async () => {
  const { source, target } = await fixture();
  try {
    await target.exec("ALTER TABLE exercises ADD CONSTRAINT only_easy CHECK (difficulty = 'easy')");
    const before = await catalog(target);
    await assert.rejects(syncCatalog({ source: wrap(source), target: wrap(target), productionRef: PROD, apply: true, adoptExisting: true }));
    assert.deepEqual(await catalog(target), before);
    assert.equal((await target.query("SELECT order_index FROM chapters WHERE name='Suites'")).rows[0].order_index, 9);
    assert.equal((await target.query("SELECT max_points FROM competences WHERE id='suite'")).rows[0].max_points, 20);
    assert.equal((await target.query("SELECT count(*)::int AS n FROM chapters WHERE name='Probas'")).rows[0].n, 0);
    assert.equal((await target.query("SELECT last_value::text AS n FROM exercises_id_seq")).rows[0].n, "1");
  } finally { await source.close(); await target.close(); }
});

test("SQL: verification failure also rolls back the sequence restart", async () => {
  const { source, target } = await fixture();
  try {
    await target.exec(`
      CREATE FUNCTION change_title() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN NEW.title := 'Unexpected trigger edit'; RETURN NEW; END $$;
      CREATE TRIGGER exercise_title BEFORE INSERT OR UPDATE ON exercises
        FOR EACH ROW EXECUTE FUNCTION change_title();
    `);
    const before = await catalog(target);
    await assert.rejects(syncCatalog({ source: wrap(source), target: wrap(target), productionRef: PROD, apply: true, adoptExisting: true }), /Verification/);
    assert.deepEqual(await catalog(target), before);
    assert.equal((await target.query("SELECT last_value::text AS n FROM exercises_id_seq")).rows[0].n, "1");
    assert.equal((await target.query("SELECT order_index FROM chapters WHERE name='Suites'")).rows[0].order_index, 9);
  } finally { await source.close(); await target.close(); }
});

test("SQL: updates to imported exercises succeed, but a new production ID cannot overwrite a staging draft", async () => {
  const { source, target } = await fixture();
  try {
    const before = await catalog(target);
    await assert.rejects(syncCatalog({ source: wrap(source), target: wrap(target), productionRef: PROD, apply: true }), /non importes/);
    assert.deepEqual(await catalog(target), before);
    assert.equal((await target.query("SELECT to_regclass('novlearn_catalog_sync.imported_exercises') AS relation")).rows[0].relation, null);
    await syncCatalog({ source: wrap(source), target: wrap(target), productionRef: PROD, apply: true, adoptExisting: true });
    await source.exec("UPDATE exercises SET title='Production revised' WHERE id=1");
    await syncCatalog({ source: wrap(source), target: wrap(target), productionRef: PROD, apply: true });
    assert.equal((await target.query("SELECT title FROM exercises WHERE id=1")).rows[0].title, "Production revised");

    await source.exec("INSERT INTO exercises (id, chapter, title, difficulty, content) VALUES (99, 'Suites', 'New production exercise', 'easy', '{}')");
    const preview = await syncCatalog({ source: wrap(source), target: wrap(target), productionRef: PROD });
    assert.equal(preview.find((r) => r.table === "exercises").untracked_conflicts, 1);
    const previous = await catalog(target);
    await assert.rejects(syncCatalog({ source: wrap(source), target: wrap(target), productionRef: PROD, apply: true }), /non importes/);
    assert.deepEqual(await catalog(target), previous);
    assert.equal((await target.query("SELECT title FROM exercises WHERE id=99")).rows[0].title, "Brouillon staging");
  } finally { await source.close(); await target.close(); }
});
