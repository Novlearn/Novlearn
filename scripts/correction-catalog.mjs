/**
 * L0: read-only catalogue snapshot and structural inventory.
 * No user tables, SQL mutations, author code execution or dependency on a CAS.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE = resolve(ROOT, ".local/exercise-correction");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[match[1]] = value;
  }
  return env;
}

export function inventory(rows) {
  const result = {
    exercises: rows.length, elementTypes: {}, answerFormats: {}, variableTypes: {},
    conventions: {}, flags: {}, structuralIssues: {}, computedFunctions: {},
    unsafeIds: 0,
  };
  const increment = (group, key) => {
    result[group][key] = (result[group][key] ?? 0) + 1;
  };
  const supported = new Set(["text", "equation", "question", "mcq", "graph", "sign_table", "variation_table"]);
  for (const row of rows) {
    if (typeof row.id === "number" && !Number.isSafeInteger(row.id)) result.unsafeIds++;
    const content = row.content;
    if (!content || typeof content !== "object" || Array.isArray(content)) {
      increment("structuralIssues", "invalid_content"); continue;
    }
    if (Array.isArray(content.variableDefinitions)) increment("conventions", "variableDefinitions");
    const variables = content.variables ?? content.variableDefinitions ?? [];
    if (!Array.isArray(variables)) increment("structuralIssues", "variables_not_array");
    for (const v of Array.isArray(variables) ? variables : []) {
      if (!v || typeof v !== "object") { increment("structuralIssues", "invalid_variable"); continue; }
      increment("variableTypes", String(v.type ?? "missing"));
      if (typeof v.exclusions === "string") {
        increment("conventions", "string_exclusions");
        if (v.exclusions.trim()) increment("conventions", "nonempty_string_exclusions");
        if (/@[A-Za-z]/.test(v.exclusions)) increment("conventions", "dynamic_string_exclusions");
      }
      if (Array.isArray(v.exclusions)) increment("conventions", "array_exclusions");
      if (v.type === "computed" && typeof v.expression === "string") {
        for (const m of v.expression.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) increment("computedFunctions", m[1]);
      }
    }
    if (!Array.isArray(content.elements)) { increment("structuralIssues", "elements_not_array"); continue; }
    const ids = new Set();
    for (const el of content.elements) {
      if (!el || typeof el !== "object") { increment("structuralIssues", "invalid_element"); continue; }
      increment("elementTypes", String(el.type ?? "missing"));
      if (!supported.has(el.type)) increment("structuralIssues", "unsupported_element_type");
      if (ids.has(el.id)) increment("structuralIssues", "duplicate_element_id");
      ids.add(el.id);
      const c = el.content;
      if (!c || typeof c !== "object") { increment("structuralIssues", "invalid_element_content"); continue; }
      if (el.type === "question" || (el.type === "equation" && c.requireAnswer)) {
        increment("answerFormats", String(c.answerFormat ?? c.answerType ?? "missing"));
        if (c.answer !== undefined) increment("conventions", "legacy_answer");
        if (c.answerType !== undefined) increment("conventions", "answerType");
        if (!String(c.correctAnswer ?? c.answer ?? "").trim()) increment("structuralIssues", "missing_expected_answer");
        if (c.points !== undefined) increment("conventions", "question_points");
        if (c.tolerance !== undefined) increment("conventions", "tolerance");
        if ((c.answerFormat ?? c.answerType) === "set") increment("conventions",
          String(c.correctAnswer ?? c.answer ?? "").includes(";") ? "set_multiple" : "set_without_semicolon");
      }
      if (el.type === "mcq") {
        increment("conventions", c.multipleChoice ? "mcq_multiple_choice" : "mcq_single_choice");
        if (c.correctAnswers !== undefined || c.correctAnswer !== undefined) increment("conventions", "mcq_index_answers");
        if (Array.isArray(c.options)) {
          if (c.options.some(o => o && typeof o === "object" && o.correct !== undefined)) increment("conventions", "mcq_correct_flag");
          if (c.options.some(o => typeof o === "string")) increment("conventions", "mcq_string_options");
          if (c.options.some(o => o && typeof o === "object" && o.isCorrect !== undefined)) increment("conventions", "mcq_isCorrect");
        } else increment("structuralIssues", "mcq_options_not_array");
      }
    }
    increment("flags", row.Is_Flash ? "flash" : "non_flash_or_missing");
    increment("flags", row.Need_Calculator ? "calculator" : "no_calculator_or_missing");
  }
  return result;
}

async function sourceConfig() {
  const file = resolve(ROOT, "backend/.env");
  if (!existsSync(file)) throw new Error("SOURCE_CONFIG_MISSING");
  const env = parseEnv(await readFile(file, "utf8"));
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== "https:" || !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) ||
      url.username || url.password || url.search || url.hash) throw new Error("SOURCE_URL_INVALID");
  if (!env.SUPABASE_SERVICE_KEY) throw new Error("READ_CREDENTIAL_MISSING");
  return { origin: url.origin, key: env.SUPABASE_SERVICE_KEY };
}

async function getPages(config) {
  const pages = [];
  let total = null;
  for (let offset = 0; offset < 100000; offset += 500) {
    const url = new URL("/rest/v1/exercises", config.origin);
    // A projection, never select=*. Only pedagogical definitions and public flags.
    url.searchParams.set("select", "id,title,app_title,chapter,difficulty,competences,content,Is_Flash,Need_Calculator");
    url.searchParams.set("order", "id.asc");
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", "500");
    const response = await fetch(url, {
      method: "GET",
      headers: { apikey: config.key, Authorization: "Bearer " + config.key, Prefer: "count=exact" },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("CATALOGUE_HTTP_" + response.status);
    const text = await response.text();
    let rows;
    try { rows = JSON.parse(text); } catch { throw new Error("CATALOGUE_JSON_INVALID"); }
    if (!Array.isArray(rows)) throw new Error("CATALOGUE_SHAPE_INVALID");
    const range = response.headers.get("content-range");
    const count = range?.match(/\/(\d+)$/)?.[1];
    if (count !== undefined) {
      if (total !== null && total !== Number(count)) throw new Error("CATALOGUE_CHANGED_DURING_READ");
      total = Number(count);
    }
    pages.push({ text, rows });
    if (rows.length < 500) break;
    if (offset + 500 >= 100000) throw new Error("CATALOGUE_TOO_LARGE");
  }
  const rows = pages.flatMap(p => p.rows);
  if (total === null || rows.length !== total) throw new Error("CATALOGUE_COUNT_UNVERIFIED");
  // Preserve numeric literals, including bigint, byte-for-byte inside raw page arrays.
  return { raw: "[" + pages.map(p=>p.text.trim().slice(1,-1)).filter(Boolean).join(",") + "]", rows };
}

export async function exportCatalog() {
  const config = await sourceConfig();
  const startedAt = new Date().toISOString();
  const first = await getPages(config);
  const second = await getPages(config);
  if (sha256(first.raw) !== sha256(second.raw)) throw new Error("CATALOGUE_UNSTABLE_RETRY_LATER");
  // Matching reads reduce drift; REST is not a transactionally consistent SQL snapshot.
  await mkdir(PRIVATE, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = stamp + ".json";
  await writeFile(resolve(PRIVATE, name), first.raw + "\n", { flag: "wx" });
  const manifest = {
    version: 1, source: "configured-backend-supabase",
    sourceFingerprint: sha256(config.origin), startedAt, finishedAt: new Date().toISOString(),
    consistency: "two-identical-ordered-REST-reads; not a SQL transaction",
    snapshot: name, sha256: sha256(first.raw + "\n"), inventory: inventory(first.rows),
    review: "not pedagogically reviewed; no expressions executed",
  };
  await writeFile(resolve(PRIVATE, stamp + ".manifest.json"), JSON.stringify(manifest,null,2)+"\n", { flag: "wx" });
  await writeFile(resolve(PRIVATE, "latest.json"), JSON.stringify({manifest: stamp + ".manifest.json"})+"\n");
  console.log(JSON.stringify({savedPrivately:true, ...manifest.inventory}, null, 2));
}

export async function verifyCatalog() {
  const latest = JSON.parse(await readFile(resolve(PRIVATE,"latest.json"),"utf8"));
  if (typeof latest.manifest !== "string" || latest.manifest.includes("/") || latest.manifest.includes("\\")) throw new Error("MANIFEST_INVALID");
  const manifest = JSON.parse(await readFile(resolve(PRIVATE,latest.manifest),"utf8"));
  if (typeof manifest.snapshot !== "string" || manifest.snapshot.includes("/") || manifest.snapshot.includes("\\")) throw new Error("SNAPSHOT_PATH_INVALID");
  const raw = await readFile(resolve(PRIVATE,manifest.snapshot),"utf8");
  if (sha256(raw) !== manifest.sha256) throw new Error("SNAPSHOT_HASH_MISMATCH");
  const current = inventory(JSON.parse(raw));
  if (JSON.stringify(current) !== JSON.stringify(manifest.inventory)) throw new Error("INVENTORY_MISMATCH");
  console.log(JSON.stringify({verified:true,...current},null,2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const arg = process.argv[2];
    if (process.argv.length !== 3 || !["--export","--verify"].includes(arg)) throw new Error("USE_--export_OR_--verify");
    await (arg === "--export" ? exportCatalog() : verifyCatalog());
  } catch (error) {
    // Never log SDK/network errors: they may embed a URL, credential or payload.
    const safe = /^(SOURCE_|READ_|CATALOGUE_|MANIFEST_|SNAPSHOT_|INVENTORY_|USE_)/.test(error.message);
    console.error(safe ? error.message : "CATALOGUE_OPERATION_FAILED");
    process.exitCode = 1;
  }
}
