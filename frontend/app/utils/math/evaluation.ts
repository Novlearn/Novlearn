import { evaluate as mathEvaluate, parse as mathParse } from "mathjs";
import { AnswerFormat, VariableValues } from "../../types/exercise";
import { substituteVariables } from "./parsing";

// ==========================================
// 1. TRADUCTEUR UNIVERSEL (Texte/LaTeX -> Math.js)
// ==========================================

export const toMathJsSyntax = (expression: string): string => {
  if (!expression) return "";
  let expr = expression;

  // Math.js veut simplement 'e'. On le remplace AVANT tout le reste.
  expr = expr.replace(/\\exponentialE/g, "e");

  // 1. Nettoyage extrême des balises de style et scories MathLive
  expr = expr.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " "); // Convertit les espaces invisibles en vrais espaces
  expr = expr.replace(/\\ /g, " ");
  expr = expr.replace(/\\[;:]/g, " "); // Supprime les espaces LaTeX (\; \:)
  expr = expr.replace(/\\quad/g, " ");
  expr = expr.replace(/\\mleft/g, ""); // Parenthèses invisibles MathLive
  expr = expr.replace(/\\mright/g, ""); // Parenthèses invisibles MathLive
  expr = expr.replace(/\\left/g, "");
  expr = expr.replace(/\\right\./g, ""); // Sécurité pour les points invisibles de MathLive
  expr = expr.replace(/\\right/g, "");
  expr = expr.replace(/\\displaystyle/g, "");

  // 2. Formatage des décimales
  expr = expr.replace(/\{,\}/g, ".");
  expr = expr.replace(/,/g, ".");
  expr = expr.replace(/\\,/g, ".");

  // 3. INFINI (Le point critique pour les limites)
  expr = expr.replace(/\\infty/g, "Infinity");
  expr = expr.replace(/\+\s*Infinity/g, "Infinity");

  // 4. Constantes
  expr = expr.replace(/\\pi/g, "pi");
  expr = expr.replace(/\\e/g, "e");
  expr = expr.replace(/\be\b(?![xp])/g, "e");

  // 5. Opérateurs
  expr = expr.replace(/\\times/g, "*");
  expr = expr.replace(/\\cdot/g, "*");
  expr = expr.replace(/\\div/g, "/");
  expr = expr.replace(/:/g, "/");

  // 6. FONCTIONS
  expr = expr.replace(/\\log/g, "log10");
  expr = expr.replace(/\blog\b/g, "log10");
  expr = expr.replace(/\\ln/g, "log");
  expr = expr.replace(/\bln\b/g, "log");
  expr = expr.replace(/\\exp/g, "exp");
  expr = expr.replace(/\\sqrt\[([^{}]+)\]\s*\{([^{}]+)\}/g, "nthRoot($2, $1)");
  expr = expr.replace(/\\sqrt\s*\{([^{}]+)\}/g, "sqrt($1)");
  ["sin", "cos", "tan", "arcsin", "arccos", "arctan", "abs"].forEach((fn) => {
    expr = expr.replace(new RegExp(`\\\\${fn}`, "g"), fn);
  });

  // 7. Puissances
  expr = expr.replace(/\*\*/g, "^");
  expr = expr.replace(/\^\{([^{}]+)\}/g, "^($1)");

  // 8. Fractions (Ultra-robuste : gère dfrac, cfrac, tfrac et les fractions sans accolades ex: \frac14)
  let prevExpr = "";
  while (expr !== prevExpr) {
    prevExpr = expr;
    // On utilise une regex intelligente qui prend les arguments qu'ils soient entre { } ou qu'ils soient un caractère unique
    expr = expr.replace(
      /\\(?:d|c|t)?frac\s*(?:\{([^{}]+)\}|([a-zA-Z0-9]))\s*(?:\{([^{}]+)\}|([a-zA-Z0-9]))/g,
      (match, nBrace, nChar, dBrace, dChar) => {
        const num = nBrace || nChar;
        const den = dBrace || dChar;
        return `((${num})/(${den}))`;
      },
    );
  }

  // 9. Multiplication Implicite (ex: 2x -> 2*x)
  expr = expr.replace(/(\d)\s*([a-zA-Z])/g, "$1*$2");
  expr = expr.replace(/(\d)\s*\(/g, "$1*(");
  expr = expr.replace(/\)\s*([a-zA-Z])/g, ")*$1");
  expr = expr.replace(/\)\s*\(/g, ")*(");

  return expr;
};

// ==========================================
// 2. MOTEUR D'ÉVALUATION
// ==========================================

export const evaluate = (
  expression: string,
  variables: VariableValues = {},
): number => {
  if (!expression) return NaN;

  const safeExpr = substituteVariables(expression.toString(), variables);
  const mathJsExpr = toMathJsSyntax(safeExpr);

  try {
    const scope = variables.x !== undefined ? { x: Number(variables.x) } : {};
    const result = mathEvaluate(mathJsExpr, scope);

    if (result === Infinity || result === -Infinity) return result;
    if (typeof result === "object" && "re" in result) return NaN;
    if (!isFinite(result)) return NaN;

    return Number(result);
  } catch (e) {
    return NaN;
  }
};

// ==========================================
// 3. VÉRIFICATION AVANCÉE (Multi-format)
// ==========================================

export const checkAnswer = (
  userInput: string,
  correctAnswer: string,
  variables: VariableValues,
  format: AnswerFormat = "number",
): boolean => {
  if (!userInput || !userInput.trim()) return false;
  if (!correctAnswer || !correctAnswer.trim()) return false;

  switch (format) {
    case "text":
      return (
        userInput.trim().toLowerCase() === correctAnswer.trim().toLowerCase()
      );
    case "expression":
      return checkExpression(userInput, correctAnswer, variables);
    case "interval":
      return checkInterval(userInput, correctAnswer, variables);
    case "fraction":
      return checkFraction(userInput, correctAnswer, variables);
    case "complex":
      return (
        normalizeExpression(userInput) === normalizeExpression(correctAnswer)
      );
    case "set":
      if (correctAnswer.includes(";")) {
        return checkSet(userInput, correctAnswer, variables);
      }
      return checkExpression(userInput, correctAnswer, variables);
    case "number":
    default:
      return checkNumberAnswer(userInput, correctAnswer, variables);
  }
};

const checkNumberAnswer = (
  userInput: string,
  correctAnswer: string,
  variables: VariableValues,
): boolean => {
  const expectedVal = evaluate(correctAnswer, variables);
  const userVal = evaluate(userInput, variables);

  if (isNaN(expectedVal) || isNaN(userVal)) return false;

  if (!isFinite(expectedVal)) return userVal === expectedVal;
  if (!isFinite(userVal)) return false;

  const TOLERANCE = 0.0001;
  if (Math.abs(userVal - expectedVal) < TOLERANCE) return true;

  const testX = 1.618;
  const varsWithX = { ...variables, x: testX };
  const expectedFunc = evaluate(correctAnswer, varsWithX);
  const userFunc = evaluate(userInput, varsWithX);

  if (
    !isNaN(expectedFunc) &&
    !isNaN(userFunc) &&
    isFinite(expectedFunc) &&
    isFinite(userFunc)
  ) {
    return Math.abs(userFunc - expectedFunc) < TOLERANCE;
  }

  return false;
};

export const toLatex = (value: string | number | undefined | null): string => {
  if (value === undefined || value === null) return "";
  if (value === Infinity) return "+\\infty";
  if (value === -Infinity) return "-\\infty";
  return String(value).replace(".", ",");
};

/**
 * Convertit une expression MathJS (ou LaTeX) en LaTeX lisible.
 * Substitue d'abord les variables @nom, puis utilise mathjs parse().toTex().
 */
export const mathJsExprToLatex = (
  expr: string,
  variables: VariableValues = {},
): string => {
  if (!expr) return "";
  try {
    const substituted = substituteVariables(expr, variables);
    return mathParse(toMathJsSyntax(substituted)).toTex();
  } catch {
    return substituteVariables(expr, variables);
  }
};

// ==========================================
// 4. VALIDATION D'EXPRESSIONS MATHÉMATIQUES
// ==========================================

const normalizeExpression = (expr: string): string => {
  if (!expr) return "";
  let normalized = expr.trim().toLowerCase().replace(/\s+/g, "");
  normalized = normalized.replace(
    /\\left|\\right|\\displaystyle|\\,|\\mleft|\\mright/g,
    "",
  );
  normalized = normalized.replace(/\\times|\\cdot/g, "*");
  normalized = normalized.replace(/\+\\infty|\\infty/g, "+inf");
  normalized = normalized.replace(/-\\infty/g, "-inf");
  return normalized;
};

const detectFreeVariables = (expr: string): string[] => {
  const variables: Set<string> = new Set();
  // On retire les variables template "@xxx" avant la détection pour éviter
  // que le "u" de "@u" soit confondu avec la variable libre u.
  let cleaned = expr
    .replace(/@[a-zA-Z]\w*/g, " ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}()\[\]]/g, " ");

  const commonVars = ["n", "x", "t", "k", "i", "j", "m", "p", "u", "v"];
  for (const v of commonVars) {
    if (new RegExp(`(?<![a-zA-Z@])${v}(?![a-zA-Z])`, "g").test(cleaned)) {
      variables.add(v);
    }
  }
  return Array.from(variables);
};

const getTestValuesForVariable = (varName: string): number[] => {
  if (["n", "k", "i", "j", "m", "p"].includes(varName)) {
    return [0, 1, 2, 3, 4, 5, 6, 7, 10, 15];
  }
  return [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, -1, -0.5, 0.1, 0.25];
};

const safeEvaluateWithVars = (
  expr: string,
  baseVariables: VariableValues,
  testVars: Record<string, number>,
): number => {
  const allVars = { ...baseVariables, ...testVars };
  let safeExpr = expr;
  for (const [varName, value] of Object.entries(testVars)) {
    // Le lookbehind exclut "@" pour ne pas casser les variables template "@u".
    safeExpr = safeExpr.replace(
      new RegExp(`(?<![a-zA-Z@])${varName}(?![a-zA-Z])`, "g"),
      `(${value})`,
    );
  }
  const result = evaluate(safeExpr, allVars);
  if (isNaN(result) || !isFinite(result)) return NaN;
  return result;
};

export const checkExpression = (
  userInput: string,
  correctAnswer: string,
  variables: VariableValues,
): boolean => {
  if (normalizeExpression(userInput) === normalizeExpression(correctAnswer))
    return true;

  const allFreeVars = [
    ...new Set([
      ...detectFreeVariables(userInput),
      ...detectFreeVariables(correctAnswer),
    ]),
  ];

  if (allFreeVars.length === 0) {
    const userVal = evaluate(userInput, variables);
    const correctVal = evaluate(correctAnswer, variables);
    if (isNaN(userVal) || isNaN(correctVal)) return false;
    return Math.abs(userVal - correctVal) < 0.0001;
  }

  const TOLERANCE = 0.0001;
  const MIN_VALID_TESTS = 5;
  const mainVar = allFreeVars.includes("n") ? "n" : allFreeVars[0];
  const testValues = getTestValuesForVariable(mainVar);

  let matchCount = 0;
  let validTests = 0;

  for (const testVal of testValues) {
    const testVars: Record<string, number> = { [mainVar]: testVal };
    for (const v of allFreeVars) if (v !== mainVar) testVars[v] = 1;

    const expectedVal = safeEvaluateWithVars(
      correctAnswer,
      variables,
      testVars,
    );
    const userVal = safeEvaluateWithVars(userInput, variables, testVars);

    if (isNaN(expectedVal)) continue;
    if (isNaN(userVal)) {
      continue;
    }

    validTests++;
    if (Math.abs(userVal - expectedVal) < TOLERANCE) {
      matchCount++;
    }
  }

  return validTests >= MIN_VALID_TESTS && matchCount === validTests;
};

// ==========================================
// 5. VALIDATION D'INTERVALLES
// ==========================================

interface ParsedInterval {
  leftOpen: boolean;
  rightOpen: boolean;
  left: number;
  right: number;
}

const parseInterval = (
  intervalStr: string,
  variables: VariableValues,
): ParsedInterval | null => {
  if (!intervalStr) return null;

  // 1. Nettoyage profond des balises MathLive et LaTeX
  let str = intervalStr.trim();

  // Supprime TOUTES les balises de taille et les points invisibles (\left, \right, \right., \middle, etc.)
  // On utilise une regex large pour attraper les variantes avec espaces
  str = str.replace(/\\left[.\s]*|\\right[.\s]*|\\middle[.\s]*/g, "");
  str = str.replace(/\\lbrack/g, "[").replace(/\\rbrack/g, "]");

  // Suppression des espaces invisibles/LaTeX
  str = str.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ");
  str = str.replace(/\\ /g, " ").replace(/\s+/g, "");

  // 2. Détection des crochets (doit être fait APRÈS le nettoyage)
  const leftOpen = str.startsWith("]");
  const rightOpen = str.endsWith("[");

  // 3. Extraction du contenu entre les crochets extrêmes
  // On retire le premier et le dernier caractère
  const content = str.substring(1, str.length - 1);

  // Découpage par le point-virgule (plus sûr que la virgule pour les fractions)
  const parts = content.split(";");
  if (parts.length !== 2) return null;

  const parseValue = (val: string): number => {
    const trimmed = val
      .trim()
      .replace(/\\infty|infty|∞/gi, "Infinity")
      .replace(/\+Infinity/g, "Infinity");

    if (trimmed === "Infinity") return Infinity;
    if (trimmed === "-Infinity" || trimmed === "-∞") return -Infinity;

    // Appel à evaluate pour calculer la valeur numérique de la borne (ex: sqrt(10/63))
    return evaluate(trimmed, variables);
  };

  const left = parseValue(parts[0]);
  const right = parseValue(parts[1]);

  if (isNaN(left) || isNaN(right)) return null;
  return { leftOpen, rightOpen, left, right };
};

export const checkInterval = (
  userInput: string,
  correctAnswer: string,
  variables: VariableValues,
): boolean => {
  const userInterval = parseInterval(userInput, variables);
  const correctInterval = parseInterval(correctAnswer, variables);

  if (!userInterval || !correctInterval) return false;

  const compareValues = (a: number, b: number): boolean => {
    if (!isFinite(a) && !isFinite(b)) return a === b;
    if (!isFinite(a) || !isFinite(b)) return false;
    return Math.abs(a - b) < 0.0001;
  };

  return (
    userInterval.leftOpen === correctInterval.leftOpen &&
    userInterval.rightOpen === correctInterval.rightOpen &&
    compareValues(userInterval.left, correctInterval.left) &&
    compareValues(userInterval.right, correctInterval.right)
  );
};

// ==========================================
// 6. VALIDATION D'ENSEMBLES
// ==========================================

const parseSet = (
  setStr: string,
  variables: VariableValues,
): number[] | null => {
  if (!setStr) return null;
  let str = setStr.trim();

  if (
    [
      "∅",
      "\\emptyset",
      "{}",
      "\\{\\}",
      "vide",
      "aucune solution",
      "pas de solution",
      "impossible",
      "aucune",
    ].some((p) => str.toLowerCase() === p.toLowerCase())
  ) {
    return [];
  }

  str = str
    .replace(/^[a-zA-Z]\s*[=∈]\s*/i, "")
    .replace(/^solutions?\s*[:=]\s*/i, "");

  const setNotationRegex = /^\\?\{([\s\S]*)\\?\}$/;
  const match = str.match(setNotationRegex);
  let content = match ? match[1].trim() : str;

  if (!content) return [];

  const parts = content.split(/;|\s{2,}/);
  const values: number[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const val = evaluate(trimmed, variables);
    if (isNaN(val)) return null;
    values.push(val);
  }

  return [...new Set(values)].sort((a, b) => a - b);
};

export const checkSet = (
  userInput: string,
  correctAnswer: string,
  variables: VariableValues,
): boolean => {
  const userSet = parseSet(userInput, variables);
  const correctSet = parseSet(correctAnswer, variables);

  if (userSet === null || correctSet === null) return false;
  if (userSet.length !== correctSet.length) return false;
  if (userSet.length === 0 && correctSet.length === 0) return true;

  // Trier les deux ensembles pour être indépendant de l'ordre
  const sortedUser = [...userSet].sort((a, b) => a - b);
  const sortedCorrect = [...correctSet].sort((a, b) => a - b);

  for (let i = 0; i < sortedUser.length; i++) {
    if (Math.abs(sortedUser[i] - sortedCorrect[i]) > 0.0001) return false;
  }
  return true;
};

// ==========================================
// 7. VALIDATION DE FRACTIONS
// ==========================================

interface ParsedFraction {
  numerator: number;
  denominator: number;
}

const parseFraction = (
  fractionStr: string,
  variables: VariableValues,
): ParsedFraction | null => {
  if (!fractionStr) return null;
  let str = fractionStr.trim();

  // === Gestion vitale du signe MOINS devant la fraction ===
  let sign = 1;
  if (str.startsWith("-")) {
    sign = -1;
    str = str.substring(1).trim();
  } else if (str.startsWith("+")) {
    str = str.substring(1).trim();
  }

  // Le `^` et le `$` s'assurent que c'est bien une fraction isolée
  // La Regex accepte les arguments avec OU sans accolades intelligemment
  const latexMatch = str.match(
    /^\\(?:d|c|t)?frac\s*(?:\{([^}]+)\}|([a-zA-Z0-9]))\s*(?:\{([^}]+)\}|([a-zA-Z0-9]))$/,
  );

  if (latexMatch) {
    const numStr = latexMatch[1] || latexMatch[2];
    const denStr = latexMatch[3] || latexMatch[4];

    const num = evaluate(numStr, variables);
    const den = evaluate(denStr, variables);
    if (isNaN(num) || isNaN(den) || den === 0) return null;
    return { numerator: sign * num, denominator: den };
  }

  const parts = str.split("/");
  if (parts.length === 2) {
    const num = evaluate(parts[0], variables);
    const den = evaluate(parts[1], variables);
    if (isNaN(num) || isNaN(den) || den === 0) return null;
    return { numerator: sign * num, denominator: den };
  }

  const val = evaluate(str, variables);
  if (!isNaN(val)) return { numerator: sign * val, denominator: 1 };

  return null;
};

export const checkFraction = (
  userInput: string,
  correctAnswer: string,
  variables: VariableValues,
): boolean => {
  const userFrac = parseFraction(userInput, variables);
  const correctFrac = parseFraction(correctAnswer, variables);

  if (!userFrac || !correctFrac) return false;

  const userValue = userFrac.numerator / userFrac.denominator;
  const correctValue = correctFrac.numerator / correctFrac.denominator;

  return Math.abs(userValue - correctValue) < 0.0001;
};
