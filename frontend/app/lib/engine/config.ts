import "server-only";
export class EngineError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}
export const STAGING_REF = "tksvbkvfusrnxulpahky";
export function engineConfiguration(env: NodeJS.ProcessEnv = process.env) {
    const unavailable = () => new EngineError(503, "Le service Engine Staging est désactivé.");
    if (env.NODE_ENV !== "development" || env.VERCEL || env.NOVLEARN_ENGINE_ENABLED !== "true")
        throw unavailable();
    try {
        const supabaseUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
        const app = new URL(env.NEXT_PUBLIC_SITE_URL ?? "");
        const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
        if (supabaseUrl.href !== `https://${STAGING_REF}.supabase.co/` ||
            !["http://127.0.0.1:3000/", "http://localhost:3000/"].includes(app.href))
            throw unavailable();
        if (key.startsWith("sb_publishable_") && key.length < 512) {
            return { supabaseUrl: supabaseUrl.origin, key, origin: app.origin };
        }
        const parts = key.split(".");
        if (parts.length !== 3)
            throw unavailable();
        const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        if (claims.ref !== STAGING_REF || claims.role !== "anon")
            throw unavailable();
        return { supabaseUrl: supabaseUrl.origin, key, origin: app.origin };
    }
    catch {
        throw unavailable();
    }
}
