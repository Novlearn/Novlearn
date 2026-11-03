import { createClient } from "@supabase/supabase-js";
import { supportsDuelElements } from "./engineEligibility";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

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
  id: number;
  title: string;
  app_title?: string | null;
  chapter: string;
  difficulty: string;
  content: {
    variables: VariableConfig[];
    elements: ExerciseElement[];
  };
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

export async function getRandomExercise(): Promise<{
  row: ExerciseRow;
  variables: Record<string, number>;
}> {
  const { data, error } = await supabase
    .from("exercises")
    .select("id, title, app_title, chapter, difficulty, content, catalog_id, active_version_id")
    // Service role bypasses RLS. Never admit an unpublished canonical draft.
    .or("and(catalog_id.not.is.null,active_version_id.not.is.null)")
    // For duels we only want "flash" exercises that do NOT require a calculator.
    // Column names follow the Supabase schema (case‑sensitive).
    .eq("Is_Flash", true)
    .eq("Need_Calculator", false);

  if (error || !data?.length) throw new Error("No exercises available");

  const canonical = data.filter(e => e.catalog_id && e.active_version_id);
  const eligibleIds = new Set<string>();
  if (canonical.length) {
    const versions = await supabase.from("exercise_versions")
      .select("id,exercise_id,editorial_status,elements:definition->elements")
      .in("id", canonical.map(e => e.active_version_id));
    if (versions.error) throw new Error("Duel exercise versions unavailable");
    for (const version of versions.data ?? []) {
      if (version.editorial_status === "published" && supportsDuelElements(version.elements) &&
          canonical.some(e => e.id === version.exercise_id && e.active_version_id === version.id))
        eligibleIds.add(version.id);
    }
  }
  const available = data.filter(e => e.catalog_id && eligibleIds.has(e.active_version_id));
  if (!available.length) throw new Error("No exercises available");
  const row = available[Math.floor(Math.random()*available.length)] as ExerciseRow;
  const variables = {};
  return { row, variables };
}
