import "server-only";
export class EngineError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}
export const STAGING_REF = "tksvbkvfusrnxulpahky";
export const PRODUCTION_REF = "abwipnppcrghdhwriyjp";
export function engineConfiguration(env: NodeJS.ProcessEnv = process.env) {
    const unavailable = () => new EngineError(503, "Configuration du service Engine indisponible.");
    if (env.NOVLEARN_ENGINE_ENABLED !== "true" || env.VERCEL) throw unavailable();
    const environment = env.APP_ENV ?? (env.NODE_ENV === "development" ? "development" : undefined);
    if (!["development", "staging", "production"].includes(environment ?? "")) throw unavailable();
    const projectRef = environment === "production" ? PRODUCTION_REF : STAGING_REF;
    try {
        const supabase = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
        const app = new URL(env.NEXT_PUBLIC_SITE_URL ?? "");
        const origins = environment === "development" ? ["http://127.0.0.1:3000", "http://localhost:3000"] :
            environment === "staging" ? ["https://staging.novlearn.fr"] : ["https://novlearn.fr"];
        if (supabase.href !== `https://${projectRef}.supabase.co/` || app.pathname !== "/" ||
            app.username || app.password || app.search || app.hash || !origins.includes(app.origin)) throw unavailable();
        const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
        if (key.startsWith("sb_publishable_") && key.length > 16 && key.length < 512)
            return { supabaseUrl: supabase.origin, key, origin: app.origin, projectRef, environment, secureCookies: app.protocol === "https:" };
        const parts = key.split(".");
        if (parts.length !== 3) throw unavailable();
        const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        if (claims.ref !== projectRef || claims.role !== "anon") throw unavailable();
        return { supabaseUrl: supabase.origin, key, origin: app.origin, projectRef, environment, secureCookies: app.protocol === "https:" };
    } catch { throw unavailable(); }
}
