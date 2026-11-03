import { randomUUID, randomInt } from "node:crypto";
import { supabase, type ExerciseRow } from "./db";
import { supportsDuelElements } from "./engineEligibility";
import { ENGINE_ARTIFACT_SHA256 } from "./engineArtifact";
/** Private server transport to the same bounded official host as training. */
export async function engineRun(operation: string, payload: unknown): Promise<any> {
    const environment = process.env.APP_ENV ?? 'development';
    const expectedRef = environment === 'production' ? 'abwipnppcrghdhwriyjp' : 'tksvbkvfusrnxulpahky';
    const url = process.env.ENGINE_URL ?? (environment === 'development' ? process.env.NOVLEARN_ENGINE_LOCAL_URL : undefined);
    const token = process.env.ENGINE_TOKEN ?? (environment === 'development' ? process.env.NOVLEARN_ENGINE_LOCAL_CAPABILITY : undefined);
    if (!['development', 'staging', 'production'].includes(environment) ||
        new URL(process.env.SUPABASE_URL ?? '').origin !== `https://${expectedRef}.supabase.co` ||
        process.env.NOVLEARN_ENGINE_ENABLED !== 'true' || !url || !/^[a-f0-9]{64}$/.test(token ?? ''))
        throw new Error("Engine host unavailable");
    const endpoint = new URL(url);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/run' ||
        (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1','localhost'].includes(endpoint.hostname))))
        throw new Error("Engine host configuration unavailable");
    const requestId = randomUUID();
    const body = JSON.stringify({ protocolVersion: 1, requestId, operation, payload });
    if (Buffer.byteLength(body) > 1048576)
        throw new Error("Engine input too large");
    const response = await fetch(endpoint, { method: "POST", body, redirect: "error", headers: { "Content-Type": "application/json", "x-engine-archive-sha256": ENGINE_ARTIFACT_SHA256, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok || !response.body || response.headers.get("x-engine-archive-sha256") !== ENGINE_ARTIFACT_SHA256)
        throw new Error("Engine unavailable");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = response.body.getReader();
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done)
                break;
            bytes += next.value.length;
            if (bytes > 2099200)
                throw new Error("Engine response too large");
            chunks.push(next.value);
        }
    }
    finally {
        await reader.cancel();
    }
    const result = JSON.parse(Buffer.concat(chunks).toString());
    if (!result.ok || result.requestId !== requestId)
        throw new Error("Engine operation failed");
    return result.value;
}
export async function prepareEngineRound(row: ExerciseRow, duelId: number, round: number) {
    const engineArchiveSha256=ENGINE_ARTIFACT_SHA256;
    if(!/^[a-f0-9]{64}$/.test(engineArchiveSha256??"")) throw new Error("Engine archive identity unavailable");
    const parent = await supabase.from("exercises").select("active_version_id").eq("id", row.id).single();
    if (parent.error || !parent.data?.active_version_id)
        throw new Error("Unpublished exercise");
    const version = await supabase.from("exercise_versions").select("id,definition,editorial_status").eq("id", parent.data.active_version_id).eq("exercise_id", row.id).single();
    if (version.error || version.data?.editorial_status !== "published")
        throw new Error("Unpublished version");
    if (!supportsDuelElements(version.data.definition?.elements))
        throw new Error("Exercise incompatible with duel presentation");
    const id = randomUUID();
    const seed = randomInt(0, 0x100000000);
    const generated = await engineRun("instantiateExercise", { definition: version.data.definition, seed, instanceId: id });
    if (!generated.ok || generated.value?.instanceId !== id)
        throw new Error("Generation failed");
    const official = generated.value;
    const projected = await engineRun("projectPublicInstance", { official });
    // The current duel UI supports one free-response flash question. Keep that
    // contract; never drop extra questions and award an exercise for just one.
    const questions = projected.elements.filter((e: any) => e.type === "question" || e.type === "mcq");
    if (questions.length !== 1 || questions[0].type !== "question" || projected.elements.some((e: any) => !["text", "section", "expression", "question"].includes(e.type)))
        throw new Error("Exercise incompatible with duel presentation");
    const saved = await supabase.from("duel_exercise_instances").insert({ id, duel_id: duelId, round_number: round, exercise_id: row.id, exercise_version_id: version.data.id, instance_seed: official.generation.seed, generation_version: official.generation.version, replay_data: { official, engineArchiveSha256 } });
    if (saved.error)
        throw new Error("Round persistence failed");
    return { id, official, projected, questionId: questions[0].id };
}
