import "server-only";
import { randomUUID } from "node:crypto";
import type { JsonObject, JsonValue } from "novlearn-exercise-engine";
import { createRemoteHost } from "novlearn-exercise-engine/remote-host";
import type { EngineOperation } from "novlearn-exercise-engine/node-host";
import { EngineError, engineConfiguration } from "./config";
import { ENGINE_ARTIFACT_SHA256 } from "./artifact";
/** The isolated host receives an operation, never application database credentials. */
export async function runEngine(operation: EngineOperation, payload: JsonObject, signal?: AbortSignal): Promise<JsonValue> {
    const config = engineConfiguration();
    const local = config.environment === "development" && !process.env.ENGINE_URL;
    const url = process.env.ENGINE_URL || (local ? process.env.NOVLEARN_ENGINE_LOCAL_URL : undefined);
    const token = process.env.ENGINE_TOKEN || (local ? process.env.NOVLEARN_ENGINE_LOCAL_CAPABILITY : undefined);
    if (!url || !token) throw new EngineError(503, "Le host Engine n'est pas configuré.");
    try {
        const host = createRemoteHost({ url, token, archiveSha256: ENGINE_ARTIFACT_SHA256 });
        try {
            const result = await host.run(JSON.stringify({ protocolVersion: 1, requestId: randomUUID(), operation, payload }), { signal });
            if (!result.ok) {
                console.error("[Engine] Remote operation failed", {
                    operation, error: result.error, requestId: result.requestId,
                    elapsedMs: result.metrics.elapsedMs, queuedMs: result.metrics.queuedMs,
                });
                if (result.error === "busy")
                    throw new EngineError(429, "Le service d’exercices est occupé. Réessayez dans quelques instants.");
                if (result.error === "timeout")
                    throw new EngineError(504, "Le calcul de l’exercice a pris trop de temps. Réessayez.");
                if (result.error === "protocol-error")
                    throw new EngineError(502, "La réponse du service d’exercices est invalide. Réessayez plus tard.");
                throw new EngineError(503, "Engine est indisponible ou a interrompu le calcul.");
            }
            return result.value;
        } finally { await host.close(); }
    } catch (error) {
        if (error instanceof EngineError) throw error;
        throw new EngineError(503, "Configuration du host Engine indisponible.");
    }
}

