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
import { describe, it, expect, vi, beforeEach } from "vitest";

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
function setExercisesResult(exercises: unknown[], error: unknown = null) {
  const result = { data: exercises, error };
  const chain = {
    select: vi.fn().mockReturnThis(),
    or: vi.fn((filter: string) => {
      expect(filter).toBe("catalog_id.is.null,active_version_id.not.is.null");
      result.data = exercises?.filter((row: any) => row.catalog_id == null || row.active_version_id != null);
      return chain;
    }),
    eq: vi.fn().mockReturnThis(),
    then: (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled),
    catch: (onRejected: (e: unknown) => unknown) =>
      Promise.resolve(result).catch(onRejected),
    finally: (cb: () => void) => Promise.resolve(result).finally(cb),
  };
  mockFrom.mockReturnValue(chain as any);
}

describe("getRandomExercise", () => {
  const validExercise = {
    id: 1,
    title: "Exercice test",
    chapter: "Fonctions",
    difficulty: "easy",
    content: {
      variables: [{ id: 1, name: "a", type: "integer", min: 1, max: 10 }],
      elements: [{ id: 1, type: "text", content: {} }],
    },
  };

  it("retourne un exercice et ses variables générées", async () => {
    setExercisesResult([validExercise]);
    const result = await getRandomExercise();
    expect(result.row.id).toBe(1);
    expect(typeof result.variables).toBe("object");
    expect("a" in result.variables).toBe(true);
  });

  it("exclut un brouillon canonique à chaque tirage privilégié", async () => {
    setExercisesResult([validExercise, { ...validExercise, id: 2, catalog_id: "draft", active_version_id: null }]);
    for (let i = 0; i < 100; i++) expect((await getRandomExercise()).row.id).toBe(1);
    expect(mockFrom.mock.results.at(-1)?.value.or).toHaveBeenCalled();
  });

  it("conserve un canonique actif dans la sélection", async () => {
    setExercisesResult([{ ...validExercise, catalog_id: "canonical", active_version_id: "published" }]);
    expect((await getRandomExercise()).row.id).toBe(1);
  });

  it("refuse une sélection ne contenant que des brouillons", async () => {
    setExercisesResult([{ ...validExercise, catalog_id: "draft", active_version_id: null }]);
    await expect(getRandomExercise()).rejects.toThrow("No exercises available");
  });

  it("génère une variable entière dans l'intervalle [min, max]", async () => {
    setExercisesResult([validExercise]);
    for (let i = 0; i < 20; i++) {
      const { variables } = await getRandomExercise();
      expect(variables["a"]).toBeGreaterThanOrEqual(1);
      expect(variables["a"]).toBeLessThanOrEqual(10);
      expect(Number.isInteger(variables["a"])).toBe(true);
    }
  });

  it("génère une variable décimale", async () => {
    const decimalExercise = {
      ...validExercise,
      content: {
        variables: [{ id: 2, name: "x", type: "decimal", min: 0, max: 1, decimals: 2 }],
        elements: [],
      },
    };
    setExercisesResult([decimalExercise]);
    const { variables } = await getRandomExercise();
    expect(variables["x"]).toBeGreaterThanOrEqual(0);
    expect(variables["x"]).toBeLessThanOrEqual(1);
  });

  it("lève une erreur si aucun exercice disponible", async () => {
    setExercisesResult([]);
    await expect(getRandomExercise()).rejects.toThrow("No exercises available");
  });

  it("lève une erreur en cas d'erreur Supabase", async () => {
    setExercisesResult(null as any, new Error("DB error"));
    await expect(getRandomExercise()).rejects.toThrow("No exercises available");
  });

  it("filtre les exercices QCM (titre contenant QCM)", async () => {
    const qcmExercise = { ...validExercise, id: 99, title: "QCM — Fonctions" };
    const normalExercise = { ...validExercise, id: 1 };
    setExercisesResult([qcmExercise, normalExercise]);
    const { row } = await getRandomExercise();
    expect(row.id).toBe(1);
  });

  it("filtre les exercices avec un élément de type mcq", async () => {
    const mcqExercise = {
      ...validExercise,
      id: 88,
      content: { variables: [], elements: [{ id: 1, type: "mcq", content: {} }] },
    };
    const normalExercise = { ...validExercise, id: 2 };
    setExercisesResult([mcqExercise, normalExercise]);
    const { row } = await getRandomExercise();
    expect(row.id).toBe(2);
  });

  it("utilise tous les exercices si tous sont QCM (fallback)", async () => {
    const qcmExercise = { ...validExercise, id: 77, title: "QCM test" };
    setExercisesResult([qcmExercise]);
    const { row } = await getRandomExercise();
    expect(row.id).toBe(77);
  });

  it("ignore les variables sans nom", async () => {
    const exoSansNom = {
      ...validExercise,
      content: {
        variables: [{ id: 1, name: "", type: "integer", min: 0, max: 10 }],
        elements: [],
      },
    };
    setExercisesResult([exoSansNom]);
    const { variables } = await getRandomExercise();
    expect(Object.keys(variables)).toHaveLength(0);
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
