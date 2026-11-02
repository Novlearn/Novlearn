import "server-only";
import { randomUUID } from "node:crypto";
import type { JsonObject, JsonValue } from "novlearn-exercise-engine";
import { createNodeHost, type EngineOperation, type NodeHost } from "novlearn-exercise-engine/node-host";
import { EngineError, engineConfiguration } from "./config";
import { ENGINE_ARTIFACT_SHA256 } from "./artifact";
let host: NodeHost | undefined;
/** Only the official bounded host evaluates maths; a missing host fails closed. */
export async function runEngine(operation: EngineOperation, payload: JsonObject, signal?: AbortSignal): Promise<JsonValue> {
    engineConfiguration();
    const requestId = randomUUID();
    const body = JSON.stringify({ protocolVersion: 1, requestId, operation, payload });
    if (Buffer.byteLength(body) > 1048576)
        throw new EngineError(413, "Exercice trop volumineux.");
    if (process.platform === "linux" && !process.env.NOVLEARN_ENGINE_LOCAL_URL) {
        host ??= createNodeHost({ maxConcurrent: 1, maxQueued: 4 });
        const result = await host.run(body, { signal });
        if (!result.ok)
            throw new EngineError(503, "Engine est indisponible ou a interrompu le calcul.");
        return result.value;
    }
    // Development-only private loopback bridge to the same Linux host. No remote
    // URL, redirects, browser Origin, database credentials or fallback evaluator.
    if (process.env.NOVLEARN_ENGINE_LOCAL_URL !== "http://127.0.0.1:3151/run" ||
        process.env.NOVLEARN_ENGINE_ARCHIVE_SHA256 !== ENGINE_ARTIFACT_SHA256 ||
        !/^[a-f0-9]{64}$/.test(process.env.NOVLEARN_ENGINE_LOCAL_CAPABILITY ?? "")) {
        throw new EngineError(503, "Le host Engine local n’est pas démarré.");
    }
    try {
        const response = await fetch(process.env.NOVLEARN_ENGINE_LOCAL_URL, {
            method: "POST", body, redirect: "error", cache: "no-store",
            headers: { "content-type": "application/json", authorization: `Bearer ${process.env.NOVLEARN_ENGINE_LOCAL_CAPABILITY}` },
            signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10000)]),
        });
        if (!response.ok || !response.body)
            throw new Error("host");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
            for (;;) {
                const next = await reader.read();
                if (next.done)
                    break;
                bytes += next.value.byteLength;
                if (bytes > 2099200)
                    throw new Error("limit");
                chunks.push(next.value);
            }
        }
        finally {
            await reader.cancel();
        }
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (result.requestId !== requestId || result.ok !== true || !Object.hasOwn(result, "value"))
            throw new Error("protocol");
        return result.value;
    }
    catch {
        throw new EngineError(503, "Engine est indisponible ou a interrompu le calcul.");
    }
}
