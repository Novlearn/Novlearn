import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { engineConfiguration, STAGING_REF, PRODUCTION_REF } from "../app/lib/engine/config";

const configured = (environment: string, ref: string, origin: string) => ({
    NODE_ENV: "production", APP_ENV: environment, NOVLEARN_ENGINE_ENABLED: "true",
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test_only_key",
    NEXT_PUBLIC_SITE_URL: origin,
} as NodeJS.ProcessEnv);
describe("explicit database environments", () => {
    it("accepts a production Next server connected to staging", () => {
        const result = engineConfiguration(configured("staging", STAGING_REF, "https://staging.novlearn.fr"));
        expect(result.projectRef).toBe(STAGING_REF);
        expect(result.secureCookies).toBe(true);
    });
    it("accepts only the production project on the production site", () => {
        expect(engineConfiguration(configured("production", PRODUCTION_REF, "https://novlearn.fr")).projectRef).toBe(PRODUCTION_REF);
        expect(() => engineConfiguration(configured("production", STAGING_REF, "https://novlearn.fr"))).toThrow();
        expect(() => engineConfiguration(configured("staging", PRODUCTION_REF, "https://staging.novlearn.fr"))).toThrow();
    });
    it("refuses missing environment, foreign domains and production credentials in development", () => {
        const env = configured("staging", STAGING_REF, "https://staging.novlearn.fr");
        delete env.APP_ENV;
        expect(() => engineConfiguration(env)).toThrow();
        expect(() => engineConfiguration(configured("staging", STAGING_REF, "https://other.example"))).toThrow();
        expect(() => engineConfiguration(configured("development", PRODUCTION_REF, "http://localhost:3000"))).toThrow();
    });
    it("refuses privileged keys and public keys belonging to another project", () => {
        const env = configured("staging", STAGING_REF, "https://staging.novlearn.fr");
        const key = (role: string, ref: string) => `header.${Buffer.from(JSON.stringify({ role, ref })).toString("base64url")}.signature`;
        expect(() => engineConfiguration({ ...env, NEXT_PUBLIC_SUPABASE_ANON_KEY: key("service_role", STAGING_REF) })).toThrow();
        expect(() => engineConfiguration({ ...env, NEXT_PUBLIC_SUPABASE_ANON_KEY: key("anon", PRODUCTION_REF) })).toThrow();
    });
});
