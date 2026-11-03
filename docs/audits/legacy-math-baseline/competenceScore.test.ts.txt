/**
 * Tests pour frontend/app/lib/competenceScore.ts
 *
 * Couvre :
 *   - getBonusStreak : bonus selon la série de succès
 *   - computeNewScore : calcul des nouveaux points (avec cap)
 *   - difficultyToLevel : conversion difficulté DB → niveau numérique
 */
import { describe, it, expect } from "vitest";
import {
  getBonusStreak,
  computeNewScore,
  difficultyToLevel,
} from "../../app/lib/competenceScore";

// ── getBonusStreak ────────────────────────────────────────────────────────────

describe("getBonusStreak", () => {
  it("streak négatif → bonus 0", () => {
    expect(getBonusStreak(-5)).toBe(0);
    expect(getBonusStreak(-1)).toBe(0);
  });

  it("streak = 0 → bonus 0", () => {
    expect(getBonusStreak(0)).toBe(0);
  });

  it("streak 1 → bonus 1", () => {
    expect(getBonusStreak(1)).toBe(1);
  });

  it("streak 2 → bonus 1 (seuil < 3)", () => {
    expect(getBonusStreak(2)).toBe(1);
  });

  it("streak 3 → bonus 2 (seuil < 5)", () => {
    expect(getBonusStreak(3)).toBe(2);
  });

  it("streak 4 → bonus 2", () => {
    expect(getBonusStreak(4)).toBe(2);
  });

  it("streak 5 → bonus 3", () => {
    expect(getBonusStreak(5)).toBe(3);
  });

  it("streak élevé (10+) → bonus 3 (max)", () => {
    expect(getBonusStreak(10)).toBe(3);
    expect(getBonusStreak(100)).toBe(3);
  });
});

// ── computeNewScore ───────────────────────────────────────────────────────────

describe("computeNewScore", () => {
  it("facile (level=0) + streak=0 → +1 point", () => {
    expect(computeNewScore(0, 100, 0, 0)).toBe(1);
  });

  it("moyen (level=1) + streak=0 → +2 points", () => {
    expect(computeNewScore(0, 100, 1, 0)).toBe(2);
  });

  it("difficile (level=2) + streak=0 → +3 points", () => {
    expect(computeNewScore(0, 100, 2, 0)).toBe(3);
  });

  it("bonus streak s'ajoute au delta", () => {
    // level=0 (+1), streak=5 → bonus=3 → total +4
    expect(computeNewScore(0, 100, 0, 5)).toBe(4);
  });

  it("score cappé à maxPoints", () => {
    // currentPoints=9, maxPoints=10, level=2 → min(9+3, 10) = 10
    expect(computeNewScore(9, 10, 2, 0)).toBe(10);
  });

  it("score déjà au max reste au max", () => {
    expect(computeNewScore(10, 10, 2, 5)).toBe(10);
  });

  it("score dépasse le cap → retourne maxPoints exactement", () => {
    // 8 + (2+1) + 3 = 14 > 10 → 10
    expect(computeNewScore(8, 10, 2, 5)).toBe(10);
  });

  it("points de base 0, level=0, streak=1 → 2 points", () => {
    // delta = 0+1 = 1, bonus = 1 → total 2
    expect(computeNewScore(0, 100, 0, 1)).toBe(2);
  });

  it("ne descend jamais (score actuel > ce qui sera ajouté si maxPoints petit)", () => {
    // Si les points actuels sont déjà au max, on retourne max
    const result = computeNewScore(5, 5, 2, 3);
    expect(result).toBe(5); // cap à 5
  });
});

// ── difficultyToLevel ─────────────────────────────────────────────────────────

describe("difficultyToLevel", () => {
  // Valeurs DB (anglais)
  it("'easy' → 0", () => expect(difficultyToLevel("easy")).toBe(0));
  it("'medium' → 1", () => expect(difficultyToLevel("medium")).toBe(1));
  it("'hard' → 2", () => expect(difficultyToLevel("hard")).toBe(2));

  // Valeurs UI (français)
  it("'Facile' → 0", () => expect(difficultyToLevel("Facile")).toBe(0));
  it("'Moyen' → 1", () => expect(difficultyToLevel("Moyen")).toBe(1));
  it("'Difficile' → 2", () => expect(difficultyToLevel("Difficile")).toBe(2));

  // Casse insensible
  it("'EASY' → 0 (insensible à la casse)", () => expect(difficultyToLevel("EASY")).toBe(0));
  it("'HARD' → 2 (insensible à la casse)", () => expect(difficultyToLevel("HARD")).toBe(2));

  // Valeurs inconnues
  it("null → 0 (valeur par défaut)", () => expect(difficultyToLevel(null)).toBe(0));
  it("undefined string → 0 (valeur par défaut)", () => expect(difficultyToLevel("")).toBe(0));
  it("valeur inconnue → 0 (fallback)", () => expect(difficultyToLevel("extreme")).toBe(0));
});
