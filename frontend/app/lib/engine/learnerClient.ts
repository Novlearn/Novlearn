import { supabase } from "../supabase";
import type { ExerciseSession } from "./learnerTypes";
export class ExerciseRequestError extends Error {
    constructor(readonly status: number, readonly code?: "job-active" | "service-saturated" | "sampling-refused") {
        super(code === "job-active" ? "Un calcul est déjà en cours pour votre session. Attendez sa fin avant de relancer l’exercice."
            : code === "service-saturated" ? "Le service de calcul est temporairement saturé. Réessayez plus tard."
                : code === "sampling-refused" ? "Le graphe de cet exercice ne peut pas être préparé pour l’instant."
                    : "Le service d’exercices est momentanément indisponible. Votre réponse n’a pas été comptée. Réessayez plus tard.");
    }
}
export async function exerciseOperation(body: Record<string, unknown>): Promise<{
    kind: "engine";
    session: ExerciseSession;
}> {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch("/api/exercises", { method: "PATCH", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) }, body: JSON.stringify(body) });
    const value = await r.json();
    if (!r.ok) {
        const code = ["job-active", "service-saturated", "sampling-refused"].includes(value.code) ? value.code : undefined;
        throw new ExerciseRequestError(r.status, code);
    }
    return value;
}
