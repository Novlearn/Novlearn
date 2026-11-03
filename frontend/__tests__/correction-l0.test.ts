import { describe, expect, it } from "vitest";
import corpus from "./fixtures/correction-reference.json";
import { checkAnswer, evaluate } from "../app/utils/math/evaluation";
import type { AnswerFormat, VariableValues } from "../app/types/exercise";

describe("L0 / current behavior, never a mathematical oracle", () => {
  for (const c of corpus.cases) {
    it(c.id, () => {
      expect(checkAnswer(c.input, c.expected, c.variables as VariableValues, c.format as AnswerFormat)).toBe(c.observed);
    });
  }
});

describe("L0 / proposed mathematical reference", () => {
  for (const c of corpus.cases) {
    if (c.reference === null) {
      it.todo(c.id + " / decision pending: " + c.reason);
    } else if (c.reference !== c.observed) {
      // Expected failures are visible debt: if the defect changes, Vitest requires review.
      it.fails(c.id + " / known gap: " + c.reason, () => {
        expect(checkAnswer(c.input, c.expected, c.variables as VariableValues, c.format as AnswerFormat)).toBe(c.reference);
      });
    } else {
      it(c.id + " / " + c.reason, () => {
        expect(checkAnswer(c.input, c.expected, c.variables as VariableValues, c.format as AnswerFormat)).toBe(c.reference);
      });
    }
  }
});

describe("L0 / deterministic algebra properties", () => {
  it("equivalent integer fractions for 77 bounded numerator/denominator pairs", () => {
    for (let n = -5; n <= 5; n++) for (let d = 1; d <= 7; d++) {
      expect(checkAnswer(`${2*n}/${2*d}`, `${n}/${d}`, {}, "number")).toBe(true);
      expect(checkAnswer(`${n+1}/${d}`, `${n}/${d}`, {}, "number")).toBe(false);
    }
  });
  it("distributivity for 20 bounded pairs, with independent integer coefficients", () => {
    for (let a = 1; a <= 5; a++) for (let b = 1; b <= 4; b++) {
      expect(checkAnswer(`${a}(x+${b})`, `${a}x+${a*b}`, {}, "expression")).toBe(true);
    }
  });
  it("characterizes comma normalization inside max (not correct function evaluation)", () => {
    expect(evaluate("max(1,2)")).toBe(1.2);
  });
  it.fails("mathematical max(1,2) = 2", () => {
    expect(evaluate("max(1,2)")).toBe(2);
  });
});
