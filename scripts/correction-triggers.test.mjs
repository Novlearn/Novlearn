import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Run the actual repository function/trigger definitions, not rewritten scoring code.
// Minimal schema only: this is not a certification of deployed RLS or whole migrations.
const migration = async name => readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8");
const extract = (sql,regex) => { const match=sql.match(regex); assert.ok(match,"SQL definition not found"); return match[0]; };
async function setup() {
  const db=new PGlite();
  await db.exec(`
    CREATE TABLE profiles(id uuid PRIMARY KEY,current_streak int DEFAULT 0,max_streak int DEFAULT 0,updated_at timestamptz);
    CREATE TABLE exercises(id bigint PRIMARY KEY,difficulty text);
    CREATE TABLE exercise_attempts(id int PRIMARY KEY,user_id uuid,exercise_id text,is_correct boolean,
      is_guest boolean DEFAULT false,score int DEFAULT 0,attempted_at timestamptz DEFAULT now());
    CREATE TABLE monthly_scores(user_id uuid,month_date date,score int,exercises_count int,max_streak int,
      updated_at timestamptz,PRIMARY KEY(user_id,month_date));
    CREATE TABLE user_stats(user_id uuid PRIMARY KEY,total_attempts bigint,correct_attempts bigint,total_score bigint,updated_at timestamptz);
    INSERT INTO profiles(id) VALUES('00000000-0000-0000-0000-000000000001');
    INSERT INTO exercises VALUES(1,'medium');
  `);
  const sql24=await migration("024_new_functions_and_trigger.sql");
  const sql30=await migration("030_fix_max_streak.sql");
  const sql41=await migration("041_weekly_success_rate_and_user_stats.sql");
  await db.exec(extract(sql30,/CREATE OR REPLACE FUNCTION public\.handle_exercise_completion\(\)[\s\S]*?\$\$;/));
  await db.exec(extract(sql24,/CREATE TRIGGER on_exercise_attempt_process[\s\S]*?;/));
  await db.exec(extract(sql41,/CREATE OR REPLACE FUNCTION update_user_stats_on_attempt\(\)[\s\S]*?\$\$;/));
  await db.exec(extract(sql41,/CREATE TRIGGER trg_update_user_stats[\s\S]*?;/));
  return db;
}
async function pending(db) {
  await db.exec("INSERT INTO exercise_attempts(id,user_id,exercise_id,is_correct) VALUES(1,'00000000-0000-0000-0000-000000000001','1',false)");
}
test("L0 SQL: false pending INSERT followed by successful UPDATE is not compensated", async () => {
  const db=await setup();
  try {
    await pending(db);
    await db.exec("UPDATE exercise_attempts SET is_correct=true,score=2 WHERE id=1");
    assert.equal((await db.query("SELECT current_streak FROM profiles")).rows[0].current_streak,-1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM monthly_scores")).rows[0].n,0);
    assert.deepEqual((await db.query("SELECT total_attempts::int,correct_attempts::int,total_score::int FROM user_stats")).rows,
      [{total_attempts:1,correct_attempts:0,total_score:0}]);
    assert.equal((await db.query("SELECT is_correct FROM exercise_attempts")).rows[0].is_correct,true);
  } finally { await db.close(); }
});
test("L0 SQL: DELETE after pending INSERT leaves the counters changed", async () => {
  const db=await setup();
  try {
    await pending(db); await db.exec("DELETE FROM exercise_attempts WHERE id=1");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM exercise_attempts")).rows[0].n,0);
    assert.equal((await db.query("SELECT current_streak FROM profiles")).rows[0].current_streak,-1);
    assert.equal((await db.query("SELECT total_attempts::int AS n FROM user_stats")).rows[0].n,1);
  } finally { await db.close(); }
});
test("L0 SQL: finalized correct INSERT updates medium score and streak once", async () => {
  const db=await setup();
  try {
    await db.exec("INSERT INTO exercise_attempts(id,user_id,exercise_id,is_correct,score) VALUES(1,'00000000-0000-0000-0000-000000000001','1',true,2)");
    assert.deepEqual((await db.query("SELECT current_streak,max_streak FROM profiles")).rows,[{current_streak:1,max_streak:1}]);
    assert.deepEqual((await db.query("SELECT score,exercises_count FROM monthly_scores")).rows,[{score:2,exercises_count:1}]);
    assert.equal((await db.query("SELECT correct_attempts::int AS n FROM user_stats")).rows[0].n,1);
  } finally { await db.close(); }
});
