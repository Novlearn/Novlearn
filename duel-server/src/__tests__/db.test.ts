/**
 * Tests pour duel-server/src/db.ts
 *
 * Couvre :
 *   - generateVariables (via getRandomExercise, testé séparément sur les helpers)
 *   - isQcmExercise (logique de détection QCM)
 *   - randInt / roundTo (via les variables générées)
 *   - verifySupabaseToken, getDuel, getPlayerName, saveDuelResult, recordAttempt
 *     (avec client Supabase mocké via vi.hoisted + vi.mock)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock du client Supabase ───────────────────────────────────────────────────
// vi.hoisted garantit que ces variables sont disponibles dans la factory vi.mock.

const { mockFrom, mockSupabaseAuth } = vi.hoisted(() => {
  const mockChain = {
    select: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    // execute retourne par défaut une erreur vide + données vides
    execute: vi.fn().mockResolvedValue({ data: null, error: null }),
  } as Record<string, ReturnType<typeof vi.fn>>;

  // Chaque appel à .from() renvoie la même chaîne mockée
  const mockFrom = vi.fn(() => mockChain);

  const mockSupabaseAuth = {
    getUser: vi.fn(),
  };

  return { mockFrom, mockSupabaseAuth };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
    auth: mockSupabaseAuth,
  })),
}));

// Import APRÈS le mock pour que db.ts utilise le client mocké
import {
  getDuel,
  getPlayerName,
  getRandomExercise,
  recordAttempt,
  saveDuelResult,
  verifySupabaseToken,
} from "../db";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setFromResult(data: unknown, error: unknown = null) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    execute: vi.fn().mockResolvedValue({ data, error }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

// ── verifySupabaseToken ───────────────────────────────────────────────────────

describe("verifySupabaseToken", () => {
  it("retourne userId et email pour un token valide", async () => {
    mockSupabaseAuth.getUser.mockResolvedValue({
      data: { user: { id: "uid-123", email: "test@example.com" } },
      error: null,
    });
    const result = await verifySupabaseToken("valid-token");
    expect(result.userId).toBe("uid-123");
    expect(result.email).toBe("test@example.com");
  });

  it("lève une erreur pour un token invalide", async () => {
    mockSupabaseAuth.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("invalid token"),
    });
    await expect(verifySupabaseToken("bad-token")).rejects.toThrow(
      "Invalid or expired token",
    );
  });

  it("lève une erreur si user est null", async () => {
    mockSupabaseAuth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    await expect(verifySupabaseToken("token")).rejects.toThrow();
  });
});

// ── getDuel ───────────────────────────────────────────────────────────────────

describe("getDuel", () => {
  it("retourne le duel pour un id valide", async () => {
    const fakeDuel = {
      id: 42,
      player1_id: "p1",
      player2_id: "p2",
      status: "active",
    };
    setFromResult(fakeDuel);
    const duel = await getDuel(42);
    expect(duel.id).toBe(42);
    expect(duel.player1_id).toBe("p1");
    expect(duel.status).toBe("active");
  });

  it("lève une erreur si le duel n'existe pas", async () => {
    setFromResult(null, new Error("not found"));
    await expect(getDuel(9999)).rejects.toThrow("Duel 9999 not found");
  });

  it("lève une erreur si data est null sans erreur", async () => {
    setFromResult(null, null);
    await expect(getDuel(1)).rejects.toThrow();
  });
});

// ── getPlayerName ─────────────────────────────────────────────────────────────

describe("getPlayerName", () => {
  it("retourne prénom + nom si disponibles", async () => {
    setFromResult({ first_name: "Alice", last_name: "Martin", email: "alice@m.fr" });
    const name = await getPlayerName("uid-alice");
    expect(name).toBe("Alice Martin");
  });

  it("retourne email username si pas de nom", async () => {
    setFromResult({ first_name: "", last_name: "", email: "bob@novlearn.fr" });
    const name = await getPlayerName("uid-bob");
    expect(name).toBe("bob");
  });

  it("retourne les 8 premiers caractères de l'uid si pas de profil", async () => {
    setFromResult(null);
    const uid = "abcdefghijklmnop";
    const name = await getPlayerName(uid);
    expect(name).toBe(uid.slice(0, 8));
  });

  it("retourne prénom seul si pas de nom de famille", async () => {
    setFromResult({ first_name: "Charlie", last_name: "", email: "c@c.com" });
    const name = await getPlayerName("uid-charlie");
    expect(name).toBe("Charlie");
  });
});

// ── saveDuelResult ────────────────────────────────────────────────────────────

describe("saveDuelResult", () => {
  it("appelle from('duels').update() avec les bons champs", async () => {
    const updateMock = {
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    mockFrom.mockReturnValue({ update: vi.fn(() => updateMock) });

    await saveDuelResult(1, 3, 2, "player-winner-id");

    expect(mockFrom).toHaveBeenCalledWith("duels");
    const updateFn = mockFrom.mock.results[0].value.update;
    const updateArgs = updateFn.mock.calls[0][0];
    expect(updateArgs.status).toBe("finished");
    expect(updateArgs.player1_score).toBe(3);
    expect(updateArgs.player2_score).toBe(2);
    expect(updateArgs.winner_id).toBe("player-winner-id");
  });

  it("accepte null comme winnerId (match nul)", async () => {
    const updateMock = {
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    mockFrom.mockReturnValue({ update: vi.fn(() => updateMock) });
    // Ne doit pas lever d'exception
    await expect(saveDuelResult(2, 1, 1, null)).resolves.toBeUndefined();
  });
});

// ── getRandomExercise ─────────────────────────────────────────────────────────

/**
 * Crée un mock de chaîne Supabase awaitable (thenable).
 * getRandomExercise() await directement la chaîne .from().select().eq().eq()
 * sans appeler .single(), donc la chaîne doit implémenter .then().
 */
function setExercisesResult(exercises: unknown[], error: unknown = null, versions: unknown[] = []) {
  const result = { data: exercises, error };
  const chain = {
    select: vi.fn().mockReturnThis(),
    or: vi.fn((filter: string) => {
      expect(filter).toBe("and(catalog_id.not.is.null,active_version_id.not.is.null)");
      result.data = exercises?.filter((row: any) => row.catalog_id != null && row.active_version_id != null);
      return chain;
    }),
    eq: vi.fn().mockReturnThis(),
    then: (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled),
    catch: (onRejected: (e: unknown) => unknown) =>
      Promise.resolve(result).catch(onRejected),
    finally: (cb: () => void) => Promise.resolve(result).finally(cb),
  };
  const versionChain = {select:vi.fn().mockReturnThis(), in:vi.fn().mockResolvedValue({data:versions,error:null})};
  mockFrom.mockImplementation((table?: string) => (table === "exercise_versions" ? versionChain : chain) as any);
}

describe("getRandomExercise / Engine only",()=>{
  const row={id:1,title:"Exercice",catalog_id:"catalog",active_version_id:"v1",content:{}};
  const version={id:"v1",exercise_id:1,editorial_status:"published",elements:[{type:"question"}]};
  it("selects a published canonical exercise without generating browser variables",async()=>{
    setExercisesResult([row],null,[version]);
    expect(await getRandomExercise()).toEqual({row,variables:{}});
  });
  it("rejects legacy and unpublished rows even when Engine flag is disabled",async()=>{
    vi.stubEnv("NOVLEARN_ENGINE_ENABLED","false");
    for(const candidate of [{...row,catalog_id:null},{...row,active_version_id:null}]){
      setExercisesResult([candidate],null,[version]);
      await expect(getRandomExercise()).rejects.toThrow("No exercises available");
    }
  });
  it("refuses incompatible elements and non-published versions",async()=>{
    for(const candidate of [{...version,elements:[{type:"mcq"}]},{...version,editorial_status:"draft"}]){
      setExercisesResult([row],null,[candidate]);
      await expect(getRandomExercise()).rejects.toThrow("No exercises available");
    }
  });
  it("fails closed when version lookup fails",async()=>{
    setExercisesResult([row],null,[]);
    await expect(getRandomExercise()).rejects.toThrow("No exercises available");
  });
  it("rejects empty catalogues and database errors",async()=>{
    setExercisesResult([]);await expect(getRandomExercise()).rejects.toThrow();
    setExercisesResult([],Error("DB"));await expect(getRandomExercise()).rejects.toThrow();
  });
});

// ── recordAttempt ─────────────────────────────────────────────────────────────

describe("recordAttempt", () => {
  it("insère une tentative avec les bons champs", async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue({ insert: insertMock });

    await recordAttempt(10, "player-1", 5, "42", true, 3000);

    expect(mockFrom).toHaveBeenCalledWith("duel_attempts");
    const inserted = insertMock.mock.calls[0][0];
    expect(inserted.duel_id).toBe(10);
    expect(inserted.player_id).toBe("player-1");
    expect(inserted.element_id).toBe(5);
    expect(inserted.answer).toBe("42");
    expect(inserted.is_correct).toBe(true);
  });

  it("borne le temps passé à 600 000 ms max", async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue({ insert: insertMock });

    await recordAttempt(1, "p", 1, "x", false, 999_999_999);

    const inserted = insertMock.mock.calls[0][0];
    expect(inserted.time_spent).toBeLessThanOrEqual(600_000);
  });

  it("borne le temps passé à 0 ms min (valeurs négatives)", async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue({ insert: insertMock });

    await recordAttempt(1, "p", 1, "x", false, -500);

    const inserted = insertMock.mock.calls[0][0];
    expect(inserted.time_spent).toBeGreaterThanOrEqual(0);
  });
});
