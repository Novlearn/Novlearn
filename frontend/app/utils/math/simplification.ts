import { evaluate as mathEvaluate, parse, simplify, fraction } from "mathjs";
import { VariableValues } from "../../types/exercise";
import { toMathJsSyntax } from "./evaluation";
import { substituteVariables } from "./parsing";

// ==========================================
// OUTILS ET CONSTANTES
// ==========================================

const PRESERVE_FUNCTIONS = [
  "ln", "log", "exp", "sqrt", "sin", "cos", "tan", 
  "arcsin", "arccos", "arctan", "pi", "e"
];

const containsPreservedFunction = (expr: string): boolean => {
  return PRESERVE_FUNCTIONS.some((fn) => {
    return new RegExp(`\\\\${fn}\\b|\\b${fn}\\s*\\(|\\b${fn}\\b`, "i").test(expr);
  });
};

const gcd = (a: number, b: number): number => {
  a = Math.abs(a);
  b = Math.abs(b);
  return b === 0 ? a : gcd(b, a % b);
};

// ==========================================
// ÉVALUATION NUMÉRIQUE EXACTE
// ==========================================

const evaluateNumericOnly = (expr: string): number | null => {
  try {
    if (containsPreservedFunction(expr)) return null;
    const mathJsExpr = toMathJsSyntax(expr);
    if (/[a-df-hj-oq-wyzA-DF-HJ-OQ-WYZ]/.test(mathJsExpr.replace(/log10|Infinity|sqrt|nthRoot/g, ""))) {
      return null;
    }
    const result = mathEvaluate(mathJsExpr);
    return (typeof result === "number" && isFinite(result)) ? result : null;
  } catch {
    return null;
  }
};

const toSimpleFraction = (num: number): string | null => {
  try {
    const f = fraction(num) as any; 
    if (f.d > 1000) return null; 
    
    // Simplification native si le dénominateur est 1
    if (f.d === 1) return String(f.s * f.n);
    
    const sign = f.s < 0 ? "-" : "";
    return `${sign}\\frac{${f.n}}{${f.d}}`;
  } catch {
    return null;
  }
};

const formatNumberForLatex = (num: number): string => {
  if (num === Infinity) return "+\\infty";
  if (num === -Infinity) return "-\\infty";
  
  const frac = toSimpleFraction(num);
  if (frac) return frac;
  
  const rounded = Math.round(num * 10000000) / 10000000;
  if (Number.isInteger(rounded)) return String(rounded);
  
  return parseFloat(rounded.toFixed(4)).toString();
};

// ==========================================
// SIMPLIFICATION INTERNE
// ==========================================

const simplifyNumericParts = (expr: string): string => {
  let result = expr;

  const simplifyFraction = (num: number, denom: number, match: string) => {
    if (denom === 0) return match;
    if (Number.isInteger(num) && Number.isInteger(denom)) {
      let sNum = num;
      let sDenom = denom;
      // Remonte le signe moins au numérateur pour éviter les dénominateurs négatifs
      if (sDenom < 0) {
        sNum = -sNum;
        sDenom = -sDenom;
      }
      const gcdVal = gcd(sNum, sDenom);
      sNum = sNum / gcdVal;
      sDenom = sDenom / gcdVal;

      if (sDenom === 1) return String(sNum);
      
      const sign = sNum < 0 ? "-" : "";
      return `${sign}\\frac{${Math.abs(sNum)}}{${sDenom}}`;
    }
    const res = num / denom;
    return isFinite(res) ? formatNumberForLatex(res) : match;
  };

  // 1. Gérer a / b
  result = result.replace(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/g, (match, n, d) => simplifyFraction(parseFloat(n), parseFloat(d), match));

  // 2. Gérer \frac{a}{b} avec prise en charge de dfrac, cfrac et tolérance des espaces
  result = result.replace(/\\(?:d|c|t)?frac\s*\{\s*(-?\d+(?:\.\d+)?)\s*\}\s*\{\s*(-?\d+(?:\.\d+)?)\s*\}/g, (match, n, d) => simplifyFraction(parseFloat(n), parseFloat(d), match));

  // 3. Gérer a * b
  result = result.replace(/(-?\d+(?:\.\d+)?)\s*\*\s*(-?\d+(?:\.\d+)?)/g, (match, a, b) => {
    const res = parseFloat(a) * parseFloat(b);
    return isFinite(res) ? formatNumberForLatex(res) : match;
  });

  return result;
};

const getPerfectSquareRoot = (num: number): number | null => {
  if (num < 0) return null;
  const sqrt = Math.sqrt(num);
  return Number.isInteger(sqrt) ? sqrt : null;
};

const simplifyInnerExpression = (expr: string): string => {
  const cleaned = expr.trim();
  const numResult = evaluateNumericOnly(cleaned);
  if (numResult !== null) return formatNumberForLatex(numResult);
  return simplifyNumericParts(cleaned);
};

const simplifyFunctionArguments = (expr: string): string => {
  let result = expr;

  result = result.replace(/\\sqrt\s*\{([^{}]+)\}/g, (match, innerContent) => {
    const simplified = simplifyInnerExpression(innerContent);
    const numValue = evaluateNumericOnly(simplified);

    if (numValue !== null) {
      const sqrtValue = getPerfectSquareRoot(numValue);
      if (sqrtValue !== null) return String(sqrtValue);
      return `\\sqrt{${formatNumberForLatex(numValue)}}`;
    }
    return `\\sqrt{${simplified}}`;
  });

  ['ln', 'exp'].forEach(fn => {
    result = result.replace(new RegExp(`(?:\\\\)?${fn}\\s*\\(([^()]+)\\)`, "g"), (match, innerContent) => {
      const simplified = simplifyInnerExpression(innerContent);
      const numValue = evaluateNumericOnly(simplified);
      return numValue !== null ? `\\${fn}(${formatNumberForLatex(numValue)})` : `\\${fn}(${simplified})`;
    });
  });

  ["sin", "cos", "tan", "arcsin", "arccos", "arctan"].forEach((fn) => {
    result = result.replace(new RegExp(`(?:\\\\)?${fn}\\s*\\(([^()]+)\\)`, "g"), (match, innerContent) => {
      const simplified = simplifyInnerExpression(innerContent);
      const numValue = evaluateNumericOnly(simplified);
      return numValue !== null ? `\\${fn}(${formatNumberForLatex(numValue)})` : `\\${fn}(${simplified})`;
    });
  });

  result = result.replace(/\^\{([^{}]+)\}/g, (match, innerContent) => {
    const simplified = simplifyInnerExpression(innerContent);
    const numValue = evaluateNumericOnly(simplified);
    return numValue !== null ? `^{${formatNumberForLatex(numValue)}}` : `^{${simplified}}`;
  });

  result = result.replace(/\\(?:d|c|t)?frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, (match, num, denom) => {
    const simplifiedNum = simplifyInnerExpression(num);
    const simplifiedDenom = simplifyInnerExpression(denom);

    const numValue = evaluateNumericOnly(simplifiedNum);
    const denomValue = evaluateNumericOnly(simplifiedDenom);

    if (numValue !== null && denomValue !== null && denomValue !== 0) {
      if (Number.isInteger(numValue) && Number.isInteger(denomValue)) {
        let sNum = numValue;
        let sDenom = denomValue;
        if (sDenom < 0) {
          sNum = -sNum;
          sDenom = -sDenom;
        }
        const gcdVal = gcd(sNum, sDenom);
        sNum = sNum / gcdVal;
        sDenom = sDenom / gcdVal;

        if (sDenom === 1) return String(sNum);
        
        const sign = sNum < 0 ? "-" : "";
        return `${sign}\\frac{${Math.abs(sNum)}}{${sDenom}}`;
      }

      const divResult = numValue / denomValue;
      if (Number.isInteger(divResult)) return String(divResult);
      
      return `\\frac{${formatNumberForLatex(numValue)}}{${formatNumberForLatex(denomValue)}}`;
    }
    return `\\frac{${simplifiedNum}}{${simplifiedDenom}}`;
  });

  return result;
};

// ==========================================
// RENDU FINAL ET VÉRIFICATION
// ==========================================

const uniformizeLatex = (latex: string): string => {
  let result = latex;

  result = result.replace(/\s*\*\s*/g, " \\cdot ");
  result = result.replace(/\\times/g, "\\cdot");
  result = result.replace(/\s+/g, " ").trim();
  
  result = result.replace(/\\left\./g, "");
  result = result.replace(/\\right\./g, "");
  result = result.replace(/\\left\s*\\?lbrack/g, "\\lbrack");
  result = result.replace(/\\right\s*\\?rbrack/g, "\\rbrack");
  result = result.replace(/\\left\s*\\?rbrack/g, "\\rbrack");
  result = result.replace(/\\right\s*\\?lbrack/g, "\\lbrack");

  result = result.replace(/(?<![\d.])1\s*\\cdot\s*/g, "");
  result = result.replace(/\\cdot\s*1(?![0-9])/g, "");

  result = result.replace(/[+-]\s*0(?![0-9.])/g, "");
  result = result.replace(/^\s*0\s*([+-])/, "$1"); 

  result = result.replace(/--/g, "+");
  result = result.replace(/\+-/g, "-");
  result = result.replace(/-\+/g, "-");
  result = result.replace(/^\s*\+/, "");

  result = result.replace(/\\?ln\s*\(/g, "\\ln(");
  result = result.replace(/\\?exp\s*\(/g, "\\exp(");
  result = result.replace(/\\?sqrt\s*\{/g, "\\sqrt{");

  if (latex.trim() !== "" && result.trim() === "") return "0";

  return result.trim();
};

// === LE NETTOYEUR FINAL EXPLICITE ===
const removeDivisionByOne = (str: string): string => {
  let res = str;
  let prev = "";
  while (res !== prev) {
    prev = res;
    // Retire \frac{A}{1} -> A (avec ou sans espace, et tolère un niveau d'accolades interne)
    res = res.replace(/\\(?:d|c|t)?frac\s*\{([^{}]+)\}\s*\{\s*1\s*\}/g, "$1");
    res = res.replace(/\\(?:d|c|t)?frac\s*\{((?:[^{}]|\{[^{}]*\})*)\}\s*\{\s*1\s*\}/g, "$1");
    
    // Retire \frac{A}{-1} -> -(A)
    res = res.replace(/\\(?:d|c|t)?frac\s*\{([^{}]+)\}\s*\{\s*-1\s*\}/g, "-($1)");
    res = res.replace(/\\(?:d|c|t)?frac\s*\{((?:[^{}]|\{[^{}]*\})*)\}\s*\{\s*-1\s*\}/g, "-($1)");
  }
  // Retire bêtement le format texte classique "/ 1" ou "/1"
  res = res.replace(/\s*\/\s*1(?![0-9.])/g, "");
  return res;
};

export const simplifyLatexExpression = (
  latex: string,
  variables: VariableValues,
): string => {
  if (!latex) return "";

  let safeExpr = substituteVariables(latex, variables).replace(/\$/g, "");

  const intervalRegex = /^\s*([\]\[])\s*(.+?)\s*[;,]\s*(.+?)\s*([\]\[])\s*$/;
  const intervalMatch = safeExpr.match(intervalRegex);
  if (intervalMatch) {
    const leftBracket = intervalMatch[1];
    const leftVal = simplifyLatexExpression(intervalMatch[2], {}); 
    const rightVal = simplifyLatexExpression(intervalMatch[3], {});
    const rightBracket = intervalMatch[4];
    return removeDivisionByOne(`${leftBracket}${leftVal}; ${rightVal}${rightBracket}`);
  }

  if (safeExpr.includes(';')) {
    const parts = safeExpr.split(/\s*;\s*/);
    const simplifiedParts = parts.map(p => simplifyLatexExpression(p, {}));
    return removeDivisionByOne(simplifiedParts.join(' ; '));
  }

  const setRegex = /^\s*\\?\{\s*(.*?)\s*\\?\}\s*$/;
  const setMatch = safeExpr.match(setRegex);
  if (setMatch) {
    const content = setMatch[1].trim();
    if (content === "") return "\\emptyset";
    return removeDivisionByOne(`\\{${simplifyLatexExpression(content, {})}\\}`);
  }

  const numericResult = evaluateNumericOnly(safeExpr);
  if (numericResult !== null) {
    return removeDivisionByOne(formatNumberForLatex(numericResult));
  }

  let finalResult = "";

  if (containsPreservedFunction(safeExpr)) {
    let result = simplifyFunctionArguments(safeExpr);
    result = simplifyNumericParts(result);
    finalResult = uniformizeLatex(result);
  } else {
    try {
      const mathJsSyntax = toMathJsSyntax(safeExpr);
      const node = parse(mathJsSyntax);
      const simplifiedNode = simplify(node);
      finalResult = uniformizeLatex(simplifiedNode.toTex());
    } catch {
      finalResult = uniformizeLatex(simplifyNumericParts(safeExpr));
    }
  }

  // === DERNIÈRE VÉRIFICATION AVANT L'AFFICHAGE ===
  return removeDivisionByOne(finalResult);
};