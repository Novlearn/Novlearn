import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { runEngine } from "../app/lib/engine/runtime";
import { ENGINE_ARTIFACT_SHA256 } from "../app/lib/engine/artifact";

const remoteFetch = vi.fn();
const metrics = { elapsedMs: 25, queuedMs: 2 };
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("NOVLEARN_ENGINE_ENABLED", "true");
  vi.stubEnv("APP_ENV", "staging");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://tksvbkvfusrnxulpahky.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_synthetic");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://staging.novlearn.fr");
  vi.stubEnv("ENGINE_URL", "http://127.0.0.1:3151/run");
  vi.stubEnv("ENGINE_TOKEN", "a".repeat(64));
  vi.stubGlobal("fetch", remoteFetch);
  remoteFetch.mockReset();
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function reply(result: Record<string, unknown>, fingerprint = ENGINE_ARTIFACT_SHA256, status = 200) {
  remoteFetch.mockImplementationOnce(async (_url, init) => {
    const { requestId } = JSON.parse(init.body);
    return new Response(JSON.stringify({ requestId, metrics, ...result }), {
      status,
      headers: { "x-engine-archive-sha256": fingerprint },
    });
  });
}

it("returns a verified remote result without retrying the calculation", async () => {
  reply({ ok: true, value: { ok: true } });
  expect(await runEngine("parseMathInput", { source: "2" })).toEqual({ ok: true });
  expect(remoteFetch).toHaveBeenCalledTimes(1);
  expect(log).not.toHaveBeenCalled();
});

it.each([
  ["busy", 429, "occupé"],
  ["timeout", 504, "trop de temps"],
  ["protocol-error", 502, "invalide"],
  ["crash", 503, "indisponible"],
  ["unavailable", 503, "indisponible"],
  ["worker-error", 503, "indisponible"],
])("reports %s with an appropriate status and safe diagnostic context", async (error, status, message) => {
  reply({ ok: false, error });
  await expect(runEngine("parseMathInput", { source: "2" })).rejects.toMatchObject({
    status, message: expect.stringContaining(message as string),
  });
  expect(remoteFetch).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith("[Engine] Remote operation failed", expect.objectContaining({
    operation: "parseMathInput", error, requestId: expect.any(String), ...metrics,
  }));
  expect(JSON.stringify(log.mock.calls)).not.toContain("a".repeat(64));
  expect(JSON.stringify(log.mock.calls)).not.toContain("source");
});

it("refuses a host running a different archive instead of accepting its result", async () => {
  reply({ ok: true, value: { private: "must not be returned" } }, "b".repeat(64));
  await expect(runEngine("parseMathInput", {})).rejects.toMatchObject({ status: 502 });
  expect(log).toHaveBeenCalledWith("[Engine] Remote operation failed", expect.objectContaining({ error: "protocol-error" }));
});

it("preserves an upstream HTTP 429 as a busy error", async () => {
  reply({}, ENGINE_ARTIFACT_SHA256, 429);
  await expect(runEngine("parseMathInput", {})).rejects.toMatchObject({ status: 429 });
});

it("keeps network failures unavailable", async () => {
  remoteFetch.mockRejectedValueOnce(new Error("synthetic connection failure"));
  await expect(runEngine("parseMathInput", {})).rejects.toMatchObject({ status: 503 });
});
