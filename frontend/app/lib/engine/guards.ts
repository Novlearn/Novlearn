import "server-only";
import type { PublicInstance } from "novlearn-exercise-engine";
import { EngineError } from "./config";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const privateKeys = new Set(["definition", "generation", "expected", "expectedLatex", "expectedTexts", "expectedOptionIds", "policy", "optionMath", "mathFields", "extensions", "math", "source", "substituted", "syntax"]);
const supported = new Set(["text", "section", "expression", "question", "mcq", "value-table"]);
export function safeProjection(value: unknown): value is PublicInstance {
    if (!object(value) || value.schemaVersion !== 5 || typeof value.title !== "string" || typeof value.instanceId !== "string" || !Array.isArray(value.elements) || Object.keys(value).sort().join(",") !== "elements,instanceId,schemaVersion,title")
        return false;
    const pending: unknown[] = [value];
    while (pending.length) {
        const item = pending.pop();
        if (Array.isArray(item))
            pending.push(...item);
        else if (object(item)) {
            if (Object.keys(item).some(k => privateKeys.has(k)))
                return false;
            pending.push(...Object.values(item));
        }
    }
    return value.elements.every(e => object(e) && typeof e.id === "string" && supported.has(String(e.type)));
}
const registry = globalThis as typeof globalThis & {
    engineJobs?: Set<string>;
};
const jobs = registry.engineJobs ??= new Set();
export async function withEngineJob<T>(owner: string, task: () => Promise<T>): Promise<T> {
    if (jobs.has(owner) || jobs.size >= 2)
        throw new EngineError(429, "Un calcul est déjà en cours. Réessayez après sa fin.");
    jobs.add(owner);
    try {
        return await task();
    }
    finally {
        jobs.delete(owner);
    }
}
