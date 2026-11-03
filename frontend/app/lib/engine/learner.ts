import "server-only";
import { randomUUID, randomInt } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { ExerciseInstance, JsonObject, JsonValue, PublicInstance } from "novlearn-exercise-engine";
import { NextResponse } from "next/server";
import { EngineError, engineConfiguration } from "./config";
import { runEngine } from "./runtime";
import { safeProjection, withEngineJob } from "./guards";
import type { ExerciseSession, QuestionResult } from "./learnerTypes";
import { GUEST_EXERCISE_LIMIT } from "../guestLimits";
import { ENGINE_ARTIFACT_SHA256 } from "./artifact";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, Origin" };
export async function learnerIdentity(request: Request) {
    const config = engineConfiguration();
    if (process.env.NOVLEARN_ENGINE_ENABLED !== "true")
        throw new EngineError(503, "Service d’exercices indisponible.");
    if ((request.headers.get("host") ?? new URL(request.url).host) !== new URL(config.origin).host ||
        (request.method !== "GET" && request.headers.get("origin") !== config.origin))
        throw new EngineError(403, "Origine refusée.");
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (request.headers.has("authorization") && !token)
        throw new EngineError(401, "Connexion invalide.");
    const global = { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) }) };
    const jar = token ? null : await cookies();
    const client = token ? createClient(config.supabaseUrl, config.key, { auth: { persistSession: false }, global: { ...global, headers: { Authorization: `Bearer ${token}` } } }) :
        createServerClient(config.supabaseUrl, config.key, { global, cookieOptions: { httpOnly: true, sameSite: "lax", secure: config.secureCookies, path: "/" }, cookies: { getAll: () => jar!.getAll(), setAll: values => { for (const v of values)
                    jar!.set(v.name, v.value, { ...v.options, httpOnly: true }); } } });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user)
        throw new EngineError(401, "Connexion requise.");
    const profile = await client.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
    if (profile.error)
        throw new EngineError(503, "Profil indisponible.");
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key)
        throw new EngineError(503, "Configuration serveur indisponible.");
    // The privileged key must match the environment selected above.
    if (key.startsWith("ey")) {
        const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
        if (claims.ref !== config.projectRef || claims.role !== "service_role")
            throw new EngineError(503, "Configuration serveur refusée.");
    }
    else if (!key.startsWith("sb_secret_"))
        throw new EngineError(503, "Configuration serveur refusée.");
    return { user: data.user, profile: profile.data, admin: createClient(config.supabaseUrl, key, { global, auth: { persistSession: false, autoRefreshToken: false } }) };
}
type Saved = {
    id: string;
    owner_id: string;
    exercise_id: number;
    exercise_version_id: string;
    official: ExerciseInstance;
    public_instance: PublicInstance;
    metadata: Record<string, unknown>;
    state: {
        questions: Record<string, QuestionResult>;
        correct?: boolean;
        responses?: {questionId:string;answer:JsonValue;state:string;code:string}[];
    };
    revision: number;
    status: string;
    expires_at: string;
};
const json = (v: unknown) => v as JsonValue;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f\d]{8}-([a-f\d]{4}-){3}[a-f\d]{12}$/i.test(v);
async function checkGuestLimit(admin:SupabaseClient,owner:string) {
    const attempts=await admin.from("exercise_attempts").select("id",{count:"exact",head:true}).eq("user_id",owner).eq("is_guest",true);
    if(attempts.error) throw new EngineError(503,"Vérification du parcours invité indisponible.");
    if((attempts.count??0)>=GUEST_EXERCISE_LIMIT) throw new EngineError(403,"La limite du parcours invité est atteinte.");
}
function checked<T>(r: {
    data: T;
    error: unknown;
}): T { if (r.error)
    throw new EngineError(503, "Enregistrement indisponible. Réessayez."); return r.data; }
function view(s: Saved): ExerciseSession {
    return { sessionId: s.id, exerciseId: String(s.exercise_id), versionId: s.exercise_version_id, instance: s.public_instance, metadata: s.metadata,
        hints: Object.fromEntries(s.official.elements.filter(e=>e.type==='hint'&&e.questionId).map(e=>[e.type==='hint'?e.questionId!:"",feedback(s.official,"hint",e.type==='hint'?e.questionId!:"")])),
        questions: s.state.questions, status: s.status as ExerciseSession["status"], correct: s.state.correct ?? false, expiresAt: s.expires_at };
}
async function get(admin: SupabaseClient, owner: string, id: string) {
    const row = checked(await admin.from("engine_exercise_sessions").select("*").eq("id", id).eq("owner_id", owner).maybeSingle()) as Saved | null;
    if (!row)
        throw new EngineError(404, "Instance introuvable.");
    if (Date.parse(row.expires_at) <= Date.now())
        throw new EngineError(410, "Cette instance a expiré.");
    return row;
}
function feedback(official:ExerciseInstance,type:"hint"|"explanation",id:string) {
    return official.elements.filter(e=>e.type===type&&e.questionId===id).flatMap(e=>(e.type==='hint'||e.type==='explanation')?e.content.map(f=>f.type==='text'?f.text:f.display==='block'?`$$${f.latex}$$`:`$${f.latex}$`):[]).join("\n\n");
}
function reveal(official: ExerciseInstance, id: string) {
    const e = official.elements.find(e => e.id === id);
    const explanation=feedback(official,"explanation",id);
    if (e?.type === "question")
        return e.expected.kind === "text" ? { texts: e.expected.variants, explanation } : { latex: e.expected.math.displayLatex, explanation };
    if (e?.type === "mcq")
        return { optionIds: e.expected.optionIds, explanation };
    return undefined;
}
async function transition(admin: SupabaseClient, s: Saved, status: string) {
    const r = await admin.rpc("engine_transition_session", { p_id: s.id, p_owner: s.owner_id, p_revision: s.revision, p_state: s.state, p_status: status });
    if (r.error?.code === "40001")
        throw new EngineError(409, "La réponse a déjà été traitée. Rechargez l’exercice.");
    checked(r);
    s.status = status;
    s.revision++;
    return view(s);
}
export async function handleLearnerExercise(request: Request, authOnly = false) {
    try {
        const identity = await learnerIdentity(request);
        if (authOnly)
            return NextResponse.json({ user: identity.user, profile: identity.profile }, { headers });
        if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
            throw new EngineError(415, "Format JSON requis.");
        if (Number(request.headers.get("content-length") ?? 0) > 16384 || !request.body)
            throw new EngineError(413, "Requête trop volumineuse.");
        const reader = request.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
            for (;;) {
                const next = await reader.read();
                if (next.done)
                    break;
                bytes += next.value.length;
                if (bytes > 16384)
                    throw new EngineError(413, "Requête trop volumineuse.");
                chunks.push(next.value);
            }
        }
        finally {
            await reader.cancel();
        }
        let body;
        try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        }
        catch {
            throw new EngineError(400, "Requête JSON invalide.");
        }
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => !["action", "exerciseId", "sessionId", "questionId", "answer", "mode", "dsId", "countPoints", "trackAbandon"].includes(k)))
            throw new EngineError(400, "Requête invalide.");
        const { admin, user, profile } = identity;
        const execute = async () => {
            if (body.action === "open") {
                if (user.is_anonymous) {
                    await checkGuestLimit(admin,user.id);
                }
                if (!/^\d{1,18}$/.test(String(body.exerciseId)))
                    throw new EngineError(400, "Exercice invalide.");
                const parent = checked(await admin.from("exercises").select("id,title,app_title,chapter,difficulty,competences,catalog_id,active_version_id,admin_archived_at").eq("id", body.exerciseId).maybeSingle());
                if (!parent)
                    throw new EngineError(404, "Exercice introuvable.");
                if (!parent.catalog_id)
                    throw new EngineError(422, "Cet exercice doit être migré vers Engine.");
                const preview = !parent.active_version_id;
                if (parent.admin_archived_at || preview && profile?.role !== "admin")
                    throw new EngineError(404, "Exercice indisponible.");
                let query = admin.from("exercise_versions").select("id,definition,definition_sha256,editorial_status").eq("exercise_id", parent.id);
                query = preview ? query.order("revision", { ascending: false }).limit(1) : query.eq("id", parent.active_version_id);
                const versions = checked(await query);
                const version = versions?.[0];
                if (!version || (!preview && version.editorial_status !== "published"))
                    throw new EngineError(404, "Version indisponible.");
                const mode = ["practice", "placement", "ds"].includes(body.mode) ? body.mode : "practice";
                if (mode === "placement")
                    throw new EngineError(410, "Le positionnement n’est plus disponible.");
                if (mode === "ds") {
                    if (!uuid(body.dsId))
                        throw new EngineError(400, "DS invalide.");
                    const ds = checked(await admin.from("ds").select("id,deadline,competence_ids").eq("id", body.dsId).eq("user_id", user.id).maybeSingle());
                    if (!ds || Date.parse(ds.deadline) <= Date.now() || !parent.competences.some((c: string) => ds.competence_ids.includes(c)))
                        throw new EngineError(403, "Exercice hors du DS.");
                }
                const expired = checked(await admin.from("engine_exercise_sessions").select("*").eq("owner_id", user.id).eq("status", "active").lt("expires_at", new Date().toISOString()).limit(16)) as Saved[];
                for (const old of expired)
                    await transition(admin, old, "abandoned");
                const previous = checked(await admin.from("engine_exercise_sessions").select("*").eq("owner_id", user.id).eq("exercise_id", parent.id).eq("status", "active").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(10)) as Saved[];
                const existing = previous.find(s => s.metadata.engineArtifactSha256 === ENGINE_ARTIFACT_SHA256 && s.metadata.mode === mode && s.metadata.dsId === (body.dsId ?? null));
                if (existing)
                    return { kind: "engine", session: view(existing) };
                const capacity=await admin.from("engine_exercise_sessions").select("id",{count:"exact",head:true}).eq("owner_id",user.id).eq("status","active").gt("expires_at",new Date().toISOString());
                if(capacity.error) throw new EngineError(503,"Stockage des instances indisponible.");
                if((capacity.count??0)>=32) throw new EngineError(429,"Trop d’exercices sont ouverts. Terminez ou passez un exercice.");
                const id = randomUUID();
                const seed = randomInt(0, 0x100000000);
                const generated = await runEngine("instantiateExercise", { definition: version.definition, seed, instanceId: id }, request.signal) as unknown as {
                    ok: boolean;
                    value: ExerciseInstance;
                };
                if (!generated?.ok || generated.value?.instanceId !== id || generated.value.schemaVersion!==5 || generated.value.engineVersion!=="0.1.0" || generated.value.definition.id!==version.definition.id || generated.value.definition.revision!==version.definition.revision || generated.value.generation.version!=="mulberry32-rejection-v1")
                    throw new EngineError(422, "Cet exercice ne peut pas être généré.");
                const projected = await runEngine("projectPublicInstance", { official: json(generated.value), sampleGraphs: true }, request.signal);
                if (!safeProjection(projected))
                    throw new EngineError(422, "Rendu de cet exercice indisponible.");
                const metadata = { engineArtifactSha256: ENGINE_ARTIFACT_SHA256, title: parent.title, app_title: parent.app_title, chapter: parent.chapter, difficulty: parent.difficulty, competences: parent.competences ?? [], mode, dsId: body.dsId ?? null, preview, guest: !!user.is_anonymous, countPoints: !user.is_anonymous && body.countPoints === true, trackAbandon: body.trackAbandon === true };
                const saved = checked(await admin.from("engine_exercise_sessions").insert({ id, owner_id: user.id, exercise_id: parent.id, exercise_version_id: version.id, definition_sha256: version.definition_sha256, official: generated.value, public_instance: projected, metadata }).select("*").single()) as Saved;
                return { kind: "engine", session: view(saved) };
            }
            if (!uuid(body.sessionId))
                throw new EngineError(400, "Instance invalide.");
            const s = await get(admin, user.id, body.sessionId);
            if(body.action === "resume" && s.metadata.engineArtifactSha256 !== ENGINE_ARTIFACT_SHA256)
                throw new EngineError(409,"Cette instance utilise une ancienne version du moteur.");
            if (body.action === "resume")
                return { kind: "engine", session: view(s) };
            if (s.status !== "active")
                return { kind: "engine", session: view(s) };
            if (body.action === "skip")
                return { kind: "engine", session: await transition(admin, s, "skipped") };
            if (body.action !== "answer" || typeof body.questionId !== "string")
                throw new EngineError(400, "Réponse invalide.");
            if(s.metadata.engineArtifactSha256 !== ENGINE_ARTIFACT_SHA256)
                throw new EngineError(409, "Cette instance utilise une ancienne version du moteur. Passez cet exercice pour en ouvrir un nouveau.");
            if(user.is_anonymous) await checkGuestLimit(admin,user.id);
            const question = s.official.elements.find(e => e.id === body.questionId && (e.type === "question" || e.type === "mcq"));
            if (!question)
                throw new EngineError(400, "Question inconnue.");
            if (s.state.questions[question.id]?.finished)
                return { kind: "engine", session: view(s) };
            const grade = await runEngine("gradeAnswer", { official: json(s.official), submission: { schemaVersion: 5, instanceId: s.id, questionId: question.id, answer: body.answer } }, request.signal) as unknown as {
                schemaVersion:number;
                state: QuestionResult["state"];
                code: string;
                instanceId: string;
                questionId: string;
            };
            if (grade.schemaVersion!==5 || typeof grade.code!=="string" || grade.instanceId !== s.id || grade.questionId !== question.id && !(grade.questionId === "" && grade.state === "invalid" && grade.code === "submission-contract") || !["correct", "incorrect", "invalid", "indeterminate", "error"].includes(grade.state))
                throw new EngineError(503, "Correction indisponible.");
            const attempts = (s.state.questions[question.id]?.attempts ?? 0) + (grade.state === "incorrect" ? 1 : 0);
            const finished = grade.state === "correct" || grade.state === "incorrect" && (question.type === "mcq" || attempts >= 2);
            s.state.questions[question.id] = { state: grade.state, attempts, finished, answer: body.answer, ...(finished ? { reveal: reveal(s.official, question.id) } : {}) };
            // Private audit of counted submissions, retained with the official
            // replay. Neutral input is kept as the latest draft, never an attempt.
            if(grade.state==="correct"||grade.state==="incorrect") {
                (s.state.responses??=[]).push({questionId:question.id,answer:body.answer,state:grade.state,code:grade.code});
            }
            const questions = s.official.elements.filter(e => e.type === "question" || e.type === "mcq");
            const completed = questions.length > 0 && questions.every(e => s.state.questions[e.id]?.finished);
            s.state.correct = completed && questions.every(e => s.state.questions[e.id].state === "correct");
            return { kind: "engine", session: await transition(admin, s, completed ? "completed" : "active") };
        };
        const result=body.action==="resume"?await execute():await withEngineJob(user.id,execute);
        return NextResponse.json(result, { headers });
    }
    catch (e) {
        return NextResponse.json({ error: e instanceof EngineError ? e.message : "Service d’exercices indisponible." }, { status: e instanceof EngineError ? e.status : 503, headers });
    }
}
