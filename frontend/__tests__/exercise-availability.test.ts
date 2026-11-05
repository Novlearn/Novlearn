import { describe, expect, it, vi } from "vitest";
import { AVAILABLE_EXERCISES_FILTER } from "../app/lib/exerciseAvailability";

describe("student availability, real installed Supabase builder / intercepted HTTP", () => {
  it("keeps eligibility with chapter, both difficulty labels and exact counts", async () => {
    const { createClient } = await vi.importActual<typeof import("@supabase/supabase-js")>("@supabase/supabase-js");
    const requests: URL[] = [];
    const client = createClient("http://127.0.0.1:1", "synthetic-only", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (input) => {
        requests.push(new URL(String(input)));
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json", "Content-Range": "*/0" } });
      } },
    });
    await client.from("exercises").select("id").or(AVAILABLE_EXERCISES_FILTER)
      .eq("chapter", "Chapter").in("difficulty", ["Facile", "easy"]);
    await client.from("exercises").select("*", { count: "exact", head: true }).or(AVAILABLE_EXERCISES_FILTER);
    await client.from("exercises").select("*").or(AVAILABLE_EXERCISES_FILTER).eq("id", 9).maybeSingle();
    await client.from("exercises").select("*").or(AVAILABLE_EXERCISES_FILTER).range(0, 0).maybeSingle();
    expect(requests).toHaveLength(4);
    for (const request of requests) {
      expect(request.searchParams.get("or")).toBe("(catalog_id.is.null,active_version_id.not.is.null)");
    }
    expect(requests[0].searchParams.get("chapter")).toBe("eq.Chapter");
    expect(requests[0].searchParams.get("difficulty")).toBe("in.(Facile,easy)");
    expect(requests[2].searchParams.get("id")).toBe("eq.9");
  });
});
