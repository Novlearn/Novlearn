import { createClient } from "@supabase/supabase-js";
import { supportsDuelElements } from "./engineEligibility";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const APP_ENV = process.env.APP_ENV || "development";
const PRODUCTION_CATALOG_SYNC_ENFORCED = process.env.PRODUCTION_CATALOG_SYNC_ENFORCED === "true";
const STAGING_REF = "tksvbkvfusrnxulpahky";
const PRODUCTION_REF = "abwipnppcrghdhwriyjp";

export function assertDuelDatabaseEnvironment(): void {
  if (process.env.NODE_ENV === "test") return;
  let host: string;
  try { host = new URL(SUPABASE_URL).hostname; }
  catch { throw new Error("Duel database environment is not configured"); }
  const expected = APP_ENV === "production" ? `${PRODUCTION_REF}.supabase.co` : `${STAGING_REF}.supabase.co`;
  const localDevelopment = APP_ENV === "development" && ["localhost", "127.0.0.1"].includes(host);
  if (!["development", "staging", "production"].includes(APP_ENV) || (!localDevelopment && host !== expected) || !SUPABASE_SERVICE_KEY)
    throw new Error("Duel database credentials do not match APP_ENV");
  if (!localDevelopment && SUPABASE_SERVICE_KEY.startsWith("ey")) {
    try {
      const claims = JSON.parse(Buffer.from(SUPABASE_SERVICE_KEY.split(".")[1], "base64url").toString("utf8"));
      if (claims.ref !== (APP_ENV === "production" ? PRODUCTION_REF : STAGING_REF) || claims.role !== "service_role")
        throw new Error("Duel database credentials do not match APP_ENV");
    } catch { throw new Error("Duel database credentials do not match APP_ENV"); }
  }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VariableConfig {
  id: number;
  name: string;
  type: "integer" | "decimal";
  min: number;
  max: number;
  decimals?: number;
}

export interface ExerciseElement {
  id: number;
  type: string;
  content: Record<string, unknown>;
}

export interface ExerciseRow {
  catalog_id?:string|null;
  active_version_id?:string|null;
  legacy_version_id?:string|null;
  id: number;
  title: string;
  app_title?: string | null;
  chapter: string;
  difficulty: string;
}

export interface DuelRow {
  id: number;
  player1_id: string;
  player2_id: string;
  status: string;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function verifySupabaseToken(token: string): Promise<{ userId: string; email: string }> {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error("Invalid or expired token");
  return { userId: user.id, email: user.email || "" };
}

// ─── Duel ─────────────────────────────────────────────────────────────────────

export async function getDuel(duelId: number): Promise<DuelRow> {
  const { data, error } = await supabase
    .from("duels")
    .select("id, player1_id, player2_id, status")
    .eq("id", duelId)
    .single();
  if (error || !data) throw new Error(`Duel ${duelId} not found`);
  return data as DuelRow;
}

export async function saveDuelResult(
  duelId: number,
  player1Score: number,
  player2Score: number,
  winnerId: string | null,
): Promise<void> {
  await supabase.from("duels").update({
    status: "finished",
    player1_score: player1Score,
    player2_score: player2Score,
    winner_id: winnerId,
    finished_at: new Date().toISOString(),
  }).eq("id", duelId);
}

export async function recordAttempt(
  duelId: number,
  playerId: string,
  elementId: number,
  answer: string,
  isCorrect: boolean,
  timeSpentMs: number,
  instanceId?:string,
): Promise<void> {
  const { error } = await supabase.from("duel_attempts").insert({
    duel_id: duelId,
    player_id: playerId,
    element_id: elementId,
    answer,
    is_correct: isCorrect,
    time_spent: Math.min(Math.max(0, timeSpentMs), 600_000),
    ...(instanceId?{duel_exercise_instance_id:instanceId}:{}),
  });
  if(error) throw new Error("Duel attempt persistence failed");
}

// ─── Profiles ─────────────────────────────────────────────────────────────────

export async function getPlayerName(userId: string): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("first_name, last_name, email")
    .eq("id", userId)
    .single();
  if (!data) return userId.slice(0, 8);
  const full = `${data.first_name || ""} ${data.last_name || ""}`.trim();
  return full || data.email?.split("@")[0] || userId.slice(0, 8);
}

// ─── Exercises ────────────────────────────────────────────────────────────────

const exerciseMetadataColumns = () => "id,title,app_title,chapter,difficulty,catalog_id,active_version_id,admin_archived_at" +
  (APP_ENV === "production" ? ",legacy_version_id" : "");

async function listEligibleDuelExercises(): Promise<Array<{ row: ExerciseRow; versionId: string }>> {
  assertDuelDatabaseEnvironment();
  let exercises = supabase
    .from("exercises")
    .select(exerciseMetadataColumns())
    // For duels we only want "flash" exercises that do NOT require a calculator.
    // Column names follow the Supabase schema (case‑sensitive).
    .eq("Is_Flash", true)
    .eq("Need_Calculator", false);
  if (APP_ENV === "staging" || APP_ENV === "development") {
    exercises = exercises.not("catalog_id", "is", null);
  } else if (APP_ENV === "production" && PRODUCTION_CATALOG_SYNC_ENFORCED) {
    exercises = exercises.not("active_version_id", "is", null).is("admin_archived_at", null);
  } else {
    exercises = exercises.or("active_version_id.not.is.null,legacy_version_id.not.is.null").is("admin_archived_at", null);
  }
  const { data, error } = await exercises;

  if (error || !data?.length) throw new Error("No exercises available");

  const staging = APP_ENV === "staging" || APP_ENV === "development";
  const rows = data as unknown as ExerciseRow[];
  const canonical = rows.filter(e => staging ? e.catalog_id : (e.active_version_id || (!PRODUCTION_CATALOG_SYNC_ENFORCED && e.legacy_version_id)));
  const selectedVersionByExercise = new Map<number, string>();
  if (canonical.length) {
    const versions = await supabase.from("exercise_versions")
      .select("id,exercise_id,revision,editorial_status,elements:definition->elements")
      .in(staging ? "exercise_id" : "id", staging ? canonical.map(e => e.id) : canonical.map(e => e.active_version_id || e.legacy_version_id))
      .order("revision", { ascending: false });
    if (versions.error) throw new Error("Duel exercise versions unavailable");
    for (const version of versions.data ?? []) {
      if (staging && selectedVersionByExercise.has(version.exercise_id)) continue;
      if ((staging || version.editorial_status === "published") && supportsDuelElements(version.elements) &&
          canonical.some(e => e.id === version.exercise_id && (staging || (e.active_version_id || e.legacy_version_id) === version.id))) {
        selectedVersionByExercise.set(version.exercise_id, version.id);
      }
    }
  }
  const available = canonical.filter(e => selectedVersionByExercise.has(e.id));
  if (!available.length) return [];
  return available.map(row => ({ row: row as ExerciseRow, versionId: selectedVersionByExercise.get(row.id)! }));
}

export async function reserveDuelExercises(duelId: number): Promise<void> {
  const existing = await supabase.from("duel_catalog_reservations").select("exercise_id").eq("duel_id", duelId).limit(1);
  if (existing.error) throw new Error("Duel catalogue reservations unavailable");
  if (existing.data?.length) return;
  const candidates = await listEligibleDuelExercises();
  if (!candidates.length) throw new Error("No exercises available");
  const { error } = await supabase.from("duel_catalog_reservations").insert(
    candidates.slice(0, 100).map(({ row, versionId }) => ({ duel_id: duelId, exercise_id: row.id, exercise_version_id: versionId })),
  );
  if (error) throw new Error("Duel catalogue reservation failed");
}

export async function getRandomExercise(duelId: number): Promise<{
  row: ExerciseRow;
  versionId: string;
  variables: Record<string, number>;
}> {
  assertDuelDatabaseEnvironment();
  const reserved = await supabase.from("duel_catalog_reservations").select("exercise_id,exercise_version_id").eq("duel_id", duelId);
  if (reserved.error) throw new Error("Duel catalogue reservations unavailable");
  let choice: { row: ExerciseRow; versionId: string } | undefined;
  if (reserved.data?.length) {
    const selected = reserved.data[Math.floor(Math.random() * reserved.data.length)];
    const { data, error } = await supabase.from("exercises").select(exerciseMetadataColumns()).eq("id", selected.exercise_id).single();
    if (error || !data) throw new Error("Reserved duel exercise unavailable");
    choice = { row: data as unknown as ExerciseRow, versionId: selected.exercise_version_id };
  } else {
    const items = await listEligibleDuelExercises();
    if (!items.length) throw new Error("No exercises available");
    choice = items[Math.floor(Math.random() * items.length)];
  }
  const row = choice.row;
  const variables = {};
  return { row, versionId: choice.versionId, variables };
}
