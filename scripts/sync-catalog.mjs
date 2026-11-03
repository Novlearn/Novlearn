import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TABLES = ["chapters", "competences", "exercises", "flashcards"];
const q = (name) => '"' + name.replaceAll('"', '""') + '"';
const tableSql = (table) => "public." + q(table);

export function parseArgs(args) {
  const options = { apply: false, flashcards: false, adoptExisting: false, help: false };
  for (const arg of args) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--flashcards") options.flashcards = true;
    else if (arg === "--adopt-existing") options.adoptExisting = true;
    else if (arg === "--help") options.help = true;
    else throw new Error("Option inconnue : " + arg);
  }
  return options;
}

// Reject arbitrary URLs, overridden hosts and transaction poolers before connecting.
export function connectionConfig(value, expectedRef) {
  if (!expectedRef || !/^[a-z0-9]{20}$/.test(expectedRef)) {
    throw new Error("La reference du projet Supabase doit contenir 20 caracteres minuscules.");
  }
  let url;
  try { url = new URL(value); } catch { throw new Error("URL PostgreSQL manquante ou invalide."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      url.pathname !== "/postgres" || (url.port && url.port !== "5432")) {
    throw new Error("Utiliser une connexion Supabase directe ou Session pooler, port 5432, base postgres.");
  }
  const direct = url.hostname === "db." + expectedRef + ".supabase.co";
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname);
  const user = decodeURIComponent(url.username);
  if ((!direct && !pooler) || (pooler && !user.endsWith("." + expectedRef))) {
    throw new Error("La connexion ne correspond pas au projet Supabase attendu.");
  }
  for (const [key, val] of url.searchParams) {
    if (key !== "sslmode" || !["require", "verify-full"].includes(val)) {
      throw new Error("Parametre de connexion interdit. Seul sslmode=require ou verify-full est accepte.");
    }
  }
  if (!user || !url.password) throw new Error("La connexion doit contenir un utilisateur et un mot de passe.");
  return {
    host: url.hostname, port: 5432, database: "postgres",
    user, password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15000,
  };
}

export function readConfig(env) {
  const productionRef = env.CATALOG_PRODUCTION_PROJECT_REF;
  const stagingRef = env.CATALOG_STAGING_PROJECT_REF;
  if (productionRef === stagingRef) {
    throw new Error("Production et staging doivent etre deux projets differents.");
  }
  return {
    productionRef, stagingRef,
    production: connectionConfig(env.CATALOG_PRODUCTION_DB_URL, productionRef),
    staging: connectionConfig(env.CATALOG_STAGING_DB_URL, stagingRef),
  };
}

async function schema(client, table) {
  const { rows } = await client.query(`
    SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
           a.attgenerated AS generated, a.attnotnull AS required,
           a.attidentity AS identity, pg_get_expr(d.adbin, d.adrelid) AS default_value
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind = 'r'
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
  `, [table]);
  if (!rows.length) throw new Error("Table absente : public." + table + ". Appliquer les migrations au staging.");
  return rows;
}

export function compatibleColumns(table, source, target) {
  const targetByName = new Map(target.map((col) => [col.name, col]));
  const columns = source.filter((col) => !col.generated);
  for (const col of columns) {
    const dest = targetByName.get(col.name);
    if (!dest || dest.type !== col.type || dest.generated) {
      throw new Error("Schemas incompatibles pour " + table + "." + col.name + ". Appliquer les migrations.");
    }
  }
  const sourceNames = new Set(columns.map((col) => col.name));
  for (const col of target) {
    if (!sourceNames.has(col.name) && col.required && !col.generated && !col.identity && col.default_value == null) {
      throw new Error("Colonne staging obligatoire sans valeur par defaut : " + table + "." + col.name);
    }
  }
  for (const name of table === "chapters" ? ["id", "name"] : table === "competences" ? ["id", "chapter_id"] : ["id"]) {
    if (!sourceNames.has(name)) throw new Error("Colonne attendue absente : " + table + "." + name);
  }
  return columns.map((col) => col.name);
}

function incoming(table, datasets) {
  const values = [datasets[table]];
  if (table !== "competences") {
    return { cte: `WITH incoming AS (
      SELECT * FROM jsonb_populate_recordset(NULL::${tableSql(table)}, $1::jsonb)
    )`, values };
  }
  values.push(datasets.chapters);
  // Chapters seeded independently have different UUIDs: retain staging IDs by name.
  return { cte: `WITH source_chapters AS (
      SELECT * FROM jsonb_populate_recordset(NULL::public.chapters, $2::jsonb)
    ), incoming AS (
      SELECT (jsonb_populate_record(NULL::public.competences,
        to_jsonb(s) || jsonb_build_object('chapter_id', COALESCE(d.id, c.id)))).*
      FROM jsonb_populate_recordset(NULL::public.competences, $1::jsonb) s
      LEFT JOIN source_chapters c ON c.id = s.chapter_id
      LEFT JOIN public.chapters d ON d.name = c.name
    )`, values };
}

function diffSql(columns, left, right) {
  const row = (alias) => "ROW(" + columns.map((name) => alias + "." + q(name)).join(", ") + ")";
  return "to_jsonb(" + row(left) + ") IS DISTINCT FROM to_jsonb(" + row(right) + ")";
}

async function plan(client, table, columns, datasets) {
  const { cte, values } = incoming(table, datasets);
  const key = table === "chapters" ? "name" : "id";
  const updated = columns.filter((name) => name !== "id");
  const diff = diffSql(updated, "d", "s");
  const { rows: [counts] } = await client.query(cte + `
    SELECT
      (SELECT count(*)::int FROM incoming s LEFT JOIN ${tableSql(table)} d ON d.${q(key)} = s.${q(key)}
       WHERE d.id IS NULL) AS added,
      (SELECT count(*)::int FROM incoming s JOIN ${tableSql(table)} d ON d.${q(key)} = s.${q(key)}
       WHERE ${diff}) AS updated,
      (SELECT count(*)::int FROM incoming s JOIN ${tableSql(table)} d ON d.${q(key)} = s.${q(key)}
       WHERE NOT (${diff})) AS unchanged,
      (SELECT count(*)::int FROM ${tableSql(table)} d
       WHERE NOT EXISTS (SELECT 1 FROM incoming s WHERE s.${q(key)} = d.${q(key)})) AS staging_only
  `, values);
  return { table, ...counts };
}

async function upsert(client, table, columns, datasets) {
  const { cte, values } = incoming(table, datasets);
  const key = table === "chapters" ? "name" : "id";
  const updated = columns.filter((name) => name !== "id");
  await client.query(cte + `
    INSERT INTO ${tableSql(table)} AS d (${columns.map(q).join(", ")})
    OVERRIDING SYSTEM VALUE
    SELECT ${columns.map((name) => "s." + q(name)).join(", ")} FROM incoming s
    ON CONFLICT (${q(key)}) DO UPDATE
      SET ${updated.map((name) => q(name) + " = EXCLUDED." + q(name)).join(", ")}
      WHERE ${diffSql(updated, "d", "EXCLUDED")}
  `, values);
}

// ALTER SEQUENCE is transactional, unlike setval(). Never decrease the next ID.
async function advanceSequence(client, table) {
  const { rows: [{ sequence }] } = await client.query(
    "SELECT pg_get_serial_sequence($1, 'id') AS sequence", ["public." + table]);
  if (!sequence) return;
  const { rows: [{ schema_name, sequence_name }] } = await client.query(`
    SELECT n.nspname AS schema_name, c.relname AS sequence_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = $1::regclass
  `, [sequence]);
  const sequenceSql = q(schema_name) + "." + q(sequence_name);
  const { rows: [{ last_value, is_called }] } = await client.query(
    "SELECT last_value::text, is_called FROM " + sequenceSql);
  const { rows: [{ max_id }] } = await client.query(
    "SELECT max(id)::text AS max_id FROM " + tableSql(table));
  if (max_id == null) return;
  const current = BigInt(last_value) + (is_called ? 1n : 0n);
  const minimum = BigInt(max_id) + 1n;
  if (minimum > current) {
    await client.query("ALTER SEQUENCE " + sequenceSql + " RESTART WITH " + minimum.toString());
  }
}


async function untrackedConflicts(client, columns, datasets, productionRef) {
  const { rows: [{ exists }] } = await client.query(
    "SELECT to_regclass('novlearn_catalog_sync.imported_exercises') IS NOT NULL AS exists");
  const tracked = exists
    ? "SELECT exercise_id FROM novlearn_catalog_sync.imported_exercises WHERE production_project_ref = $2"
    : "SELECT NULL::bigint AS exercise_id WHERE false AND $2::text IS NOT NULL";
  const { rows: [{ conflicts }] } = await client.query(`
    WITH incoming AS (
      SELECT * FROM jsonb_populate_recordset(NULL::public.exercises, $1::jsonb)
    ), tracked AS (${tracked})
    SELECT count(*)::int AS conflicts FROM incoming s
    JOIN public.exercises d ON d.id = s.id
    LEFT JOIN tracked t ON t.exercise_id = s.id
    WHERE t.exercise_id IS NULL AND ${diffSql(columns.filter((c) => c !== "id"), "d", "s")}
  `, [datasets.exercises, productionRef]);
  return conflicts;
}

async function rememberImportedExercises(client, datasets, productionRef) {
  await client.query("CREATE SCHEMA IF NOT EXISTS novlearn_catalog_sync");
  await client.query(`
    CREATE TABLE IF NOT EXISTS novlearn_catalog_sync.imported_exercises (
      exercise_id bigint PRIMARY KEY REFERENCES public.exercises(id) ON DELETE CASCADE,
      production_project_ref text NOT NULL
    )
  `);
  await client.query("REVOKE ALL ON SCHEMA novlearn_catalog_sync FROM PUBLIC");
  await client.query("ALTER TABLE novlearn_catalog_sync.imported_exercises ENABLE ROW LEVEL SECURITY");
  await client.query(`
    INSERT INTO novlearn_catalog_sync.imported_exercises (exercise_id, production_project_ref)
    SELECT id, $2 FROM jsonb_populate_recordset(NULL::public.exercises, $1::jsonb)
    ON CONFLICT (exercise_id) DO UPDATE SET production_project_ref = EXCLUDED.production_project_ref
  `, [datasets.exercises, productionRef]);
}

export async function syncCatalog({ source, target, apply = false, flashcards = false, adoptExisting = false, productionRef }) {
  if (!productionRef || !/^[a-z0-9]{20}$/.test(productionRef)) throw new Error("Reference de production manquante ou invalide.");
  const tables = TABLES.filter((table) => table !== "flashcards" || flashcards);
  const datasets = {};
  const columns = {};
  try {
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await target.query(apply ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    for (const client of [source, target]) {
      await client.query("SET LOCAL statement_timeout = '60s'");
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query("SET LOCAL TIME ZONE 'UTC'");
    }
    if (apply) {
      await target.query("LOCK TABLE " + tables.map(tableSql).join(", ") + " IN SHARE ROW EXCLUSIVE MODE");
    }
    for (const table of tables) {
      columns[table] = compatibleColumns(table, await schema(source, table), await schema(target, table));
      // Keep PostgreSQL's JSON text intact: JSON.parse would round large bigint IDs.
      const { rows } = await source.query(
        "SELECT to_jsonb(s)::text AS payload FROM " + tableSql(table) + " s ORDER BY id LIMIT 100001");
      if (rows.length > 100000) throw new Error("Catalogue trop volumineux pour cet outil : " + table);
      if (!rows.length && table !== "flashcards") {
        throw new Error("La table de production " + table + " est vide. Synchronisation annulee.");
      }
      datasets[table] = "[" + rows.map((row) => row.payload).join(",") + "]";
    }
    const { rows: [{ missing }] } = await source.query(`
      SELECT count(*)::int AS missing FROM public.competences c
      LEFT JOIN public.chapters ch ON ch.id = c.chapter_id
      WHERE c.chapter_id IS NOT NULL AND ch.id IS NULL
    `);
    if (missing) throw new Error("Des competences de production referencent des chapitres absents.");
    const conflicts = await untrackedConflicts(target, columns.exercises, datasets, productionRef);
    if (apply && conflicts && !adoptExisting) {
      throw new Error(conflicts + " exercices non importes ont le meme ID que la production et un contenu different. Copie bloquee. Verifier ces exercices avant --adopt-existing.");
    }
    const report = [];
    for (const table of tables) {
      const counts = await plan(target, table, columns[table], datasets);
      if (table === "exercises") counts.untracked_conflicts = conflicts;
      report.push(counts);
      if (apply) await upsert(target, table, columns[table], datasets);
    }
    if (apply) {
      await rememberImportedExercises(target, datasets, productionRef);
      for (const table of tables) await advanceSequence(target, table);
      for (const table of tables) {
        const check = await plan(target, table, columns[table], datasets);
        if (check.added || check.updated) throw new Error("Verification apres copie en echec : " + table);
      }
    }
    await source.query("COMMIT");
    await target.query("COMMIT");
    return report;
  } catch (error) {
    await Promise.allSettled([source.query("ROLLBACK"), target.query("ROLLBACK")]);
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("npm run db:sync:catalog -- [--apply] [--flashcards] [--adopt-existing]\nPar defaut : apercu en lecture seule. --apply : mises a jour sur staging, aucune suppression.");
    return;
  }
  const envFile = fileURLToPath(new URL("../.env.catalog-sync.local", import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const config = readConfig(process.env);
  const { Client } = await import("pg");
  const source = new Client(config.production);
  const target = new Client(config.staging);
  source.on("error", () => {});
  target.on("error", () => {});
  try {
    await source.connect();
    await target.connect();
    console.log("Production " + config.productionRef + " -> staging " + config.stagingRef);
    console.log(options.apply ? "Application en une transaction." : "Apercu : aucune ecriture.");
    const report = await syncCatalog({ source, target, ...options, productionRef: config.productionRef });
    console.table(report);
    if (!options.apply && report.some((r) => r.untracked_conflicts > 0)) {
      console.log("Conflits sur des IDs non importes : application bloquee sans --adopt-existing.");
    }
    console.log(options.apply ? "Synchronisation terminee. Relancer le backend staging si la taxonomie a change." : "Relancer avec --apply pour appliquer.");
  } finally {
    await Promise.allSettled([source.end(), target.end()]);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    // Driver errors may contain row data or connection details: only expose SQLSTATE.
    console.error(error.code ? "Echec PostgreSQL (" + error.code + "). Transaction staging annulee." : error.message);
    process.exitCode = 1;
  });
}
