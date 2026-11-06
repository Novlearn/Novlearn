import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: null as null | { id: string }, role: null as string | null, filters: [] as string[] }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: state.user }, error: null })) },
    from: (table: string) => {
      const query: any = {
        select: vi.fn(() => query),
        or: vi.fn((filter: string) => { state.filters.push(filter); return query; }),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({ data: table === "profiles" ? { role: state.role } : null, error: null })),
        single: vi.fn(async () => ({
          data: {
            id: 10, title: "Test", app_title: "Test", chapter: "Algebra", difficulty: "easy",
            competences: [], content: { elements: [{ type: "question", content: { correctAnswer: "42" } }] },
          }, error: null,
        })),
        order: vi.fn(async () => ({ data: [{ id: 10, title: "Test", app_title: "Test", chapter: "Algebra", difficulty: "easy", created_at: "2026-01-01" }], error: null })),
      };
      return query;
    },
  }),
}));

import { GET } from "../app/api/exercises/route";

describe("GET /api/exercises access control", () => {
  beforeEach(() => {
    state.filters = [];
    state.user = null;
    state.role = null;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  });

  it("rejects anonymous callers", async () => {
    const response = await GET(new Request("https://novlearn.test/api/exercises"));
    expect(response.status).toBe(401);
  });

  it("allows a student to read the metadata catalog without content", async () => {
    state.user = { id: "student-1" };
    state.role = "student";
    const response = await GET(new Request("https://novlearn.test/api/exercises", { headers: { authorization: "Bearer student-token" } }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.exercises[0]).not.toHaveProperty("content");
    expect(state.filters).toEqual(["catalog_id.is.null,active_version_id.not.is.null"]);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("does not return answer-bearing content to a student", async () => {
    state.user = { id: "student-1" };
    state.role = "student";
    const response = await GET(new Request("https://novlearn.test/api/exercises?id=10", { headers: { authorization: "Bearer student-token" } }));
    expect(response.status).toBe(403);
  });

  it("returns catalogue metadata to an admin without legacy content", async () => {
    state.user = { id: "admin-1" };
    state.role = "admin";
    const response = await GET(new Request("https://novlearn.test/api/exercises?id=10", { headers: { authorization: "Bearer admin-token" } }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.title).toBe("Test");
    expect(body.data).not.toHaveProperty("elements");
    expect(body.data).not.toHaveProperty("content");
  });
});
