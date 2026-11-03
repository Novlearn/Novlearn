/**
 * Tests unitaires pour app/lib/api.ts
 *
 * Stratégie :
 *   - app/lib/supabase est mocké directement (createBrowserClient de @supabase/ssr
 *     nécessite des vraies clés env — on contourne en remplaçant tout le module)
 *   - fetch est mocké via global.fetch pour intercepter les requêtes HTTP
 *   - On vérifie : URL correcte, méthode HTTP, corps JSON, réponse renvoyée
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

// Doit être hoisted avant les imports pour intercepter les imports de api.ts
vi.mock("../../app/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

import { supabase } from "../../app/lib/supabase";
import {
  friendsApi,
  duelsApi,
  dsApi,
  getRecommendedExercise,
} from "../../app/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockGetSession = supabase.auth.getSession as ReturnType<typeof vi.fn>;

function setupAuth(token = "test-access-token") {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token } },
    error: null,
  });
}

function setupAuthFailed() {
  mockGetSession.mockResolvedValue({
    data: { session: null },
    error: null,
  });
}

function setupFetch(data: unknown, ok = true, status = 200) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(data),
  });
}

function setupFetchError(status: number, detail: string) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({ detail }),
  });
}

function setupFetchNetworkError(message = "Failed to fetch") {
  (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
    new Error(message),
  );
}

function lastFetchCall() {
  const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
  if (!calls.length) throw new Error("fetch was not called");
  const [url, init] = calls[calls.length - 1];
  return { url: url as string, method: (init?.method as string) ?? "GET", body: init?.body as string | undefined };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
  setupAuth();
});

// ── Gestion des erreurs (apiRequest) ─────────────────────────────────────────

describe("Gestion des erreurs de apiRequest", () => {
  it("lève une erreur si la session est absente (non authentifié)", async () => {
    setupAuthFailed();
    await expect(friendsApi.getFriends()).rejects.toThrow("Not authenticated");
  });

  it("lève une erreur si la réponse HTTP n'est pas ok (4xx)", async () => {
    setupFetchError(404, "Resource not found");
    await expect(friendsApi.getFriends()).rejects.toThrow("Resource not found");
  });

  it("lève une erreur si la réponse HTTP n'est pas ok sans detail", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });
    await expect(friendsApi.getFriends()).rejects.toThrow("HTTP 500");
  });

  it("lève une erreur réseau avec message explicite", async () => {
    setupFetchNetworkError("Failed to fetch");
    await expect(friendsApi.getFriends()).rejects.toThrow(
      /Impossible de se connecter/,
    );
  });

  it("envoie le token dans le header Authorization", async () => {
    setupFetch({ friends: [] });
    await friendsApi.getFriends();
    const req = lastFetchCall();
    expect(req.url).toContain("/api/friends");
  });
});

// ── friendsApi ────────────────────────────────────────────────────────────────

describe("friendsApi", () => {
  it("getFriends — GET /api/friends", async () => {
    setupFetch({ friends: [] });
    const result = await friendsApi.getFriends();
    const req = lastFetchCall();
    expect(req.url).toMatch(/\/api\/friends$/);
    expect(req.method).toBe("GET");
    expect(result).toEqual({ friends: [] });
  });

  it("getFriendCode — GET /api/friends/code", async () => {
    setupFetch({ code: "ABC123", invite_link: "https://novlearn.fr/invite/ABC123" });
    const result = await friendsApi.getFriendCode();
    const req = lastFetchCall();
    expect(req.url).toContain("/api/friends/code");
    expect(result.code).toBe("ABC123");
  });

  it("getFriendRequests — GET /api/friends/requests", async () => {
    setupFetch({ requests: [] });
    const result = await friendsApi.getFriendRequests();
    const req = lastFetchCall();
    expect(req.url).toContain("/api/friends/requests");
    expect(req.method).toBe("GET");
  });

  it("addFriendByCode — POST /api/friends/add-by-code avec le code", async () => {
    setupFetch({ message: "Ami ajouté" });
    await friendsApi.addFriendByCode("XYZW1234");
    const req = lastFetchCall();
    expect(req.url).toContain("/api/friends/add-by-code");
    expect(req.method).toBe("POST");
    expect(JSON.parse(req.body!)).toEqual({ code: "XYZW1234" });
  });

  it("acceptFriendRequest — POST /api/friends/requests/:id/accept", async () => {
    setupFetch({ message: "Demande acceptée" });
    await friendsApi.acceptFriendRequest(42);
    const req = lastFetchCall();
    expect(req.url).toContain("/api/friends/requests/42/accept");
    expect(req.method).toBe("POST");
  });

  it("declineFriendRequest — POST /api/friends/requests/:id/decline", async () => {
    setupFetch({ message: "Demande refusée" });
    await friendsApi.declineFriendRequest(7);
    const req = lastFetchCall();
    expect(req.url).toContain("/api/friends/requests/7/decline");
    expect(req.method).toBe("POST");
  });

  it("removeFriend — DELETE /api/friends/:id", async () => {
    setupFetch({ message: "Ami supprimé" });
    await friendsApi.removeFriend("uid-bob");
    const req = lastFetchCall();
    expect(req.url).toContain("/api/friends/uid-bob");
    expect(req.method).toBe("DELETE");
  });
});

// ── duelsApi ──────────────────────────────────────────────────────────────────

describe("duelsApi", () => {
  it("createDuel — POST /api/duels/create avec friend_id", async () => {
    setupFetch({ message: "Duel créé", duel_id: 1, duel: {} });
    await duelsApi.createDuel("uid-alice");
    const req = lastFetchCall();
    expect(req.url).toContain("/api/duels/create");
    expect(req.method).toBe("POST");
    expect(JSON.parse(req.body!)).toEqual({ friend_id: "uid-alice" });
  });

  it("acceptDuel — POST /api/duels/:id/accept", async () => {
    setupFetch({ message: "Duel accepté", duel: {} });
    await duelsApi.acceptDuel(10);
    const req = lastFetchCall();
    expect(req.url).toContain("/api/duels/10/accept");
    expect(req.method).toBe("POST");
  });

  it("declineDuel — POST /api/duels/:id/decline", async () => {
    setupFetch({ message: "Duel refusé" });
    await duelsApi.declineDuel(5);
    const req = lastFetchCall();
    expect(req.url).toContain("/api/duels/5/decline");
    expect(req.method).toBe("POST");
  });

  it("getPendingDuels — GET /api/duels/pending", async () => {
    setupFetch({ duels: [] });
    const result = await duelsApi.getPendingDuels();
    const req = lastFetchCall();
    expect(req.url).toContain("/api/duels/pending");
    expect(req.method).toBe("GET");
    expect(result).toEqual({ duels: [] });
  });

  it("getActiveDuels — GET /api/duels/active", async () => {
    setupFetch({ duels: [] });
    await duelsApi.getActiveDuels();
    const req = lastFetchCall();
    expect(req.url).toContain("/api/duels/active");
    expect(req.method).toBe("GET");
  });

  it("getHistory — GET /api/duels/history", async () => {
    setupFetch({ history: [] });
    const result = await duelsApi.getHistory();
    const req = lastFetchCall();
    expect(req.url).toContain("/api/duels/history");
    expect(result).toEqual({ history: [] });
  });
});

// ── dsApi ─────────────────────────────────────────────────────────────────────

describe("dsApi", () => {
  it("createDS — POST /api/ds avec title, deadline, competence_ids", async () => {
    const fakeDs = { id: "ds-1", title: "DS Fonctions" };
    setupFetch(fakeDs);
    await dsApi.createDS("DS Fonctions", "2025-06-30T10:00:00", ["c1", "c2"]);
    const req = lastFetchCall();
    expect(req.url).toContain("/api/ds");
    expect(req.method).toBe("POST");
    const body = JSON.parse(req.body!);
    expect(body.title).toBe("DS Fonctions");
    expect(body.competence_ids).toEqual(["c1", "c2"]);
  });

  it("getDSList — GET /api/ds", async () => {
    setupFetch({ ds: [] });
    const result = await dsApi.getDSList();
    const req = lastFetchCall();
    expect(req.url).toMatch(/\/api\/ds$/);
    expect(req.method).toBe("GET");
    expect(result).toEqual({ ds: [] });
  });

  it("getDSDetail — GET /api/ds/:id", async () => {
    setupFetch({ id: "ds-1", title: "Mon DS", scores: [] });
    await dsApi.getDSDetail("ds-1");
    const req = lastFetchCall();
    expect(req.url).toContain("/api/ds/ds-1");
    expect(req.method).toBe("GET");
  });

  it("getDSRecommendation — GET /api/ds/:id/recommend", async () => {
    setupFetch({ exercise_id: 42 });
    await dsApi.getDSRecommendation("ds-abc");
    const req = lastFetchCall();
    expect(req.url).toContain("/api/ds/ds-abc/recommend");
    expect(req.method).toBe("GET");
  });

  it("deleteDS — DELETE /api/ds/:id", async () => {
    setupFetch({ message: "DS supprimé" });
    await dsApi.deleteDS("ds-xyz");
    const req = lastFetchCall();
    expect(req.url).toContain("/api/ds/ds-xyz");
    expect(req.method).toBe("DELETE");
  });

  it("submitDSAnswer — POST /api/ds/:id/submit avec les bons champs", async () => {
    setupFetch({ message: "Réponse enregistrée" });
    await dsApi.submitDSAnswer("ds-1", "receipt");
    const req = lastFetchCall();
    expect(req.url).toContain("/api/ds/ds-1/submit");
    expect(req.method).toBe("POST");
    const body = JSON.parse(req.body!);
    expect(body).toEqual({engine_session_id:"receipt"});
  });

  it("submitDSAnswer — encode l'id dans l'URL", async () => {
    setupFetch({ message: "ok" });
    await dsApi.submitDSAnswer("ds/special", "receipt");
    const req = lastFetchCall();
    expect(req.url).toContain("ds%2Fspecial");
  });
});

// ── getRecommendedExercise ────────────────────────────────────────────────────

describe("getRecommendedExercise", () => {
  it("retourne null si non authentifié", async () => {
    setupAuthFailed();
    const result = await getRecommendedExercise();
    expect(result).toBeNull();
  });

  it("retourne null en cas d'erreur HTTP", async () => {
    setupFetchError(404, "No exercise");
    const result = await getRecommendedExercise();
    expect(result).toBeNull();
  });

  it("retourne l'exercice recommandé", async () => {
    const exercise = { exercise_id: 7, competence_id: "c1", difficulty_level: 1, difficulty: "medium" };
    setupFetch(exercise);
    const result = await getRecommendedExercise("Fonctions");
    expect(result?.exercise_id).toBe(7);
  });

  it("inclut le chapitre dans la query string si fourni", async () => {
    setupFetch({ exercise_id: 1, difficulty_level: 0, difficulty: "easy" });
    await getRecommendedExercise("Suites numériques");
    const req = lastFetchCall();
    expect(req.url).toContain("chapter=");
  });

  it("n'inclut pas chapter si null", async () => {
    setupFetch({ exercise_id: 2, difficulty_level: 0, difficulty: "easy" });
    await getRecommendedExercise(null);
    const req = lastFetchCall();
    expect(req.url).not.toContain("chapter=");
  });
});
