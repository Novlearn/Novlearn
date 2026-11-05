import { supabase } from "../supabase";
import type { ExerciseSession } from "./learnerTypes";
export class ExerciseRequestError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}
export async function exerciseOperation(body: Record<string, unknown>): Promise<{
    kind: "engine";
    session: ExerciseSession;
}> {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch("/api/exercises", { method: "PATCH", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) }, body: JSON.stringify(body) });
    const value = await r.json();
    if (!r.ok)
        throw new ExerciseRequestError(r.status, value.error ?? "Exercice indisponible.");
    return value;
}
