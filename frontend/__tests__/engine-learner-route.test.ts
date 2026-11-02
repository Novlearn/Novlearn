import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExerciseInstance, JsonObject } from "novlearn-exercise-engine";
import definition from "./fixtures/engine-pilot-definition.json";
import definitions from "./fixtures/engine-pilots.json";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ owner: "owner", role: "user", authError: false, active: true, canonical: true, index: 0, seed: 42, rows: [] as any[], official: null as ExerciseInstance | null, calls: 0 }));
vi.mock("node:crypto", async (original) => ({ ...await original<typeof import("node:crypto")>(), randomInt: () => state.seed }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: vi.fn() }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: state.authError ? null : { id: state.owner } }, error: null }) },
        from: (table: string) => {
            const filters: Record<string, any> = {};
            let insertion: any;
            const data = () => {
                if (table === "profiles")
                    return { role: state.role };
                if (table === "exercises")
                    return { id: 122, title: "[PILOTE ADMIN M1-01] Test", catalog_id: state.canonical ? "catalog" : null, active_version_id: state.active ? "version" : null, competences: [], difficulty: "Facile" };
                if (table === "exercise_versions")
                    return [{ id: "version", definition: definitions[state.index] ?? definition, definition_sha256: "a".repeat(64), editorial_status: state.active ? "published" : "draft" }];
                if (insertion) {
                    const row = { ...insertion, state: { questions: {} }, revision: 0, status: "active", expires_at: new Date(Date.now() + 86400000).toISOString() };
                    state.rows.push(row);
                    insertion = null;
                    return row;
                }
                return state.rows.filter(row => Object.entries(filters).every(([k, v]) => k === "gt" ? row.expires_at > v : k === "lt" ? row.expires_at < v : String(row[k]) === String(v)));
            };
            const q: any = { select: () => q, eq: (k: string, v: any) => { filters[k] = v; return q; }, gt: (_k: string, v: any) => { filters.gt = v; return q; }, lt: (_k: string, v: any) => { filters.lt = v; return q; }, order: () => q, limit: () => q, insert: (v: any) => { insertion = v; return q; }, single: async () => ({ data: data(), error: null }), maybeSingle: async () => { const v = data(); return { data: Array.isArray(v) ? v[0] ?? null : v, error: null }; }, then: (resolve: any) => resolve({ data: data(), error: null }) };
            return q;
        }, rpc: async (_name: string, args: any) => { const row = state.rows.find(r => r.id === args.p_id && r.owner_id === args.p_owner); if (!row || row.revision !== args.p_revision)
            return { error: { code: "40001" } }; row.state = structuredClone(args.p_state); row.status = args.p_status; row.revision++; return { data: {}, error: null }; }
    }) }));
vi.mock("../app/lib/engine/runtime", () => ({ runEngine: async (op: string, p: JsonObject) => {
        state.calls++;
        const e = await vi.importActual<typeof import("novlearn-exercise-engine")>("novlearn-exercise-engine");
        if (op === "instantiateExercise") {
            const r = e.instantiateExercise(p.definition, { seed: Number(p.seed), instanceId: String(p.instanceId) });
            if (r.ok)
                state.official = r.value;
            return r;
        }
        if (op === "projectPublicInstance")
            return e.projectPublicInstance(p.official as unknown as ExerciseInstance);
        return e.gradeAnswer(p.official as unknown as ExerciseInstance, p.submission);
    } }));
import { handleLearnerExercise } from "../app/lib/engine/learner";
import {withEngineJob} from "../app/lib/engine/guards";
const req = (body: any, origin = "http://127.0.0.1:3000") => new Request("http://127.0.0.1:3000/api/exercises", { method: "PATCH", headers: { origin, authorization: "Bearer synthetic", "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", ""); vi.stubEnv("NOVLEARN_ENGINE_PILOTS_ENABLED", "true"); vi.stubEnv("NOVLEARN_ENGINE_ENABLED", "true"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://tksvbkvfusrnxulpahky.supabase.co"); vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3000"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_synthetic"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJub25lIn0." + Buffer.from(JSON.stringify({ ref: "tksvbkvfusrnxulpahky", role: "service_role" })).toString("base64url") + ".synthetic"); state.rows = []; state.calls = 0; state.owner = "owner"; state.role = "user"; state.authError = false; state.active = true; state.canonical = true; });
afterEach(() => vi.unstubAllEnvs());
it.each([
    ["NODE_ENV","production"],
    ["VERCEL","1"],
    ["NOVLEARN_ENGINE_ENABLED","false"],
    ["NEXT_PUBLIC_SUPABASE_URL","https://abwipnppcrghdhwriyjp.supabase.co"],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY","sb_secret_refused"]
])("refuses the unqualified environment %s=%s before Engine executes",async(name,value)=>{
    vi.stubEnv(name,value);expect((await handleLearnerExercise(req({action:"open",exerciseId:"122"}))).status).toBe(503);expect(state.calls).toBe(0);
});
it("refuses oversized streamed bodies even with a small declared length",async()=>{
    const request=new Request("http://127.0.0.1:3000/api/exercises",{method:"PATCH",headers:{origin:"http://127.0.0.1:3000",authorization:"Bearer synthetic","content-type":"application/json","content-length":"1"},body:JSON.stringify({action:"open",exerciseId:"122",answer:"x".repeat(20000)})});
    expect((await handleLearnerExercise(request)).status).toBe(413);expect(state.calls).toBe(0);
});
beforeEach(() => { state.index = 0; state.seed = 42; });
it("keeps legacy catalogue delivery explicit without passing it through a guessed conversion", async () => { state.canonical = false; const r = await handleLearnerExercise(req({ action: "open", exerciseId: "122" })); expect(await r.json()).toEqual({ kind: "legacy" }); expect(state.calls).toBe(0); });
it("refuses draft access by a student and forged verdict/snapshot fields", async () => { state.active = false; expect((await handleLearnerExercise(req({ action: "open", exerciseId: "122" }))).status).toBe(404); expect((await handleLearnerExercise(req({ action: "open", exerciseId: "122", official: {} }))).status).toBe(400); });
it("refuses foreign origins and invalid authentication", async () => { expect((await handleLearnerExercise(req({ action: "open", exerciseId: "122" }, "https://other.test"))).status).toBe(403); state.authError = true; expect((await handleLearnerExercise(req({ action: "open", exerciseId: "122" }))).status).toBe(401); });
it("generates once, exposes only the projection and restores the stored instance", async () => {
    const r = await handleLearnerExercise(req({ action: "open", exerciseId: "122" }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.session.instance.instanceId).toBe(body.session.sessionId);
    expect(JSON.stringify(body)).not.toMatch(/"(official|definition|expected|policy|generation)":/);
    const calls = state.calls;
    const again = await handleLearnerExercise(req({ action: "resume", sessionId: body.session.sessionId }));
    expect((await again.json()).session.instance).toEqual(body.session.instance);
    expect(state.calls).toBe(calls);
    state.owner = "other";
    expect((await handleLearnerExercise(req({ action: "resume", sessionId: body.session.sessionId }))).status).toBe(404);
});
it("restores an instance while that owner already has a calculation in progress",async()=>{
    const opened=await(await handleLearnerExercise(req({action:"open",exerciseId:"122"}))).json();
    await withEngineJob("owner",async()=>{
        const response=await handleLearnerExercise(req({action:"resume",sessionId:opened.session.sessionId}));
        expect(response.status).toBe(200);expect((await response.json()).session.instance).toEqual(opened.session.instance);
    });
});
it("preserves invalid input, two tries and a terminal verdict without client correctness", async () => {
    const opened = await (await handleLearnerExercise(req({ action: "open", exerciseId: "122" }))).json();
    const sessionId = opened.session.sessionId;
    const question = state.official!.elements.find(e => e.type === "question")!;
    const answer = async (source: string) => { const r = await handleLearnerExercise(req({ action: "answer", sessionId, questionId: question.id, answer: { format: "latex", source } })); expect(r.status).toBe(200); return (await r.json()).session; };
    const invalid = await answer("");
    expect(invalid.questions[question.id].state).toBe("invalid");
    expect(invalid.questions[question.id].attempts).toBe(0);
    const wrong = await answer("999999");
    expect(wrong.questions[question.id].finished).toBe(false);
    expect(wrong.questions[question.id].reveal).toBeUndefined();
    const expected = (question as any).expected.math.displayLatex;
    const correct = await answer(expected);
    expect(correct.status).toBe("completed");
    expect(correct.correct).toBe(true);
    expect(correct.questions[question.id].reveal.latex).toBe(expected);
    expect(state.rows[0].state.responses).toHaveLength(2);
    expect(JSON.stringify(correct)).not.toContain('"responses":');
    const calls = state.calls;
    await answer("999999");
    expect(state.calls).toBe(calls);
});
it.each(definitions.flatMap((_, index) => [0, 1, 42].map(seed => [index, seed] as const)))("existing delivery API: pilot %i seed %i, correct/incorrect/invalid and replay", async (index, seed) => {
    state.index = index;
    state.seed = seed;
    const opened = await (await handleLearnerExercise(req({ action: "open", exerciseId: "122" }))).json();
    const sessionId = opened.session.sessionId;
    for (const q of state.official!.elements.filter(e => e.type === "question" || e.type === "mcq")) {
        const send = async (answer: unknown) => { const r = await handleLearnerExercise(req({ action: "answer", sessionId, questionId: q.id, answer })); expect(r.status).toBe(200); return (await r.json()).session; };
        const invalid = await send(q.type === "mcq" ? { format: "selection", optionIds: [] } : { format: "latex", source: "" });
        expect(invalid.questions[q.id].state).toBe("invalid");
        expect(invalid.questions[q.id].attempts).toBe(0);
        if (q.type === "question") {
            const wrong = await send({ format: q.response.format, source: "999999" });
            expect(wrong.questions[q.id].finished).toBe(false);
            expect(wrong.questions[q.id].reveal).toBeUndefined();
        }
        const correct = q.type === "mcq" ? { format: "selection", optionIds: q.expected.optionIds } : q.expected.kind === "text" ? { format: "text", source: q.expected.variants[0] } : { format: "latex", source: q.expected.math.displayLatex };
        const result = await send(correct);
        expect(result.questions[q.id].state).toBe("correct");
    }
    const resumed = await (await handleLearnerExercise(req({ action: "resume", sessionId }))).json();
    expect(resumed.session.status).toBe("completed");
    expect(resumed.session.correct).toBe(true);
    expect(resumed.session.instance).toEqual(opened.session.instance);
});
