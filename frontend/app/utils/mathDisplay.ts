function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

function simplifyNumericFractions(latex: string): string {
  return latex
    .replace(/\\frac\{(-?\d{1,18})\}\{1\}/g, "$1")
    .replace(/\\frac\{(-?\d{1,18})\}\{(-?\d{1,18})\}/g, (fraction, rawNumerator: string, rawDenominator: string) => {
      let numerator = BigInt(rawNumerator);
      let denominator = BigInt(rawDenominator);
      if (denominator === 0n) return fraction;
      if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
      const divisor = gcd(numerator, denominator);
      numerator /= divisor;
      denominator /= divisor;
      return denominator === 1n ? numerator.toString() : `\\frac{${numerator}}{${denominator}}`;
    });
}

function frenchIntervals(latex: string): string {
  const intervals: Record<string, string> = {
    "\\lbrack": "[",
    "\\lparen": "]",
    "\\rbrack": "]",
    "\\rparen": "[",
  };
  const tokens = Object.keys(intervals);
  let output = "";
  let active = false;
  let braces = 0;
  let parentheses = 0;
  for (let index = 0; index < latex.length;) {
    const token = tokens.find(candidate => latex.startsWith(candidate, index));
    if (token) {
      output += intervals[token];
      active = token === "\\lbrack" || token === "\\lparen";
      braces = 0;
      parentheses = 0;
      index += token.length;
      continue;
    }
    const char = latex[index]!;
    if (active && char === "," && braces === 0 && parentheses === 0) {
      output += ";";
    } else if (active && latex.startsWith("\\infty", index)) {
      const previous = output.at(-1);
      output += previous === "+" || previous === "-" ? "\\infty" : "+\\infty";
      index += "\\infty".length;
      continue;
    } else {
      output += char;
      if (active && char === "{") braces++;
      else if (active && char === "}") braces = Math.max(0, braces - 1);
      else if (active && char === "(") parentheses++;
      else if (active && char === ")") parentheses = Math.max(0, parentheses - 1);
    }
    index++;
  }
  return output;
}

export function formatExpectedAnswer(latex: string): string {
  if (!latex) return "";
  const formatted = frenchIntervals(simplifyNumericFractions(latex));
  return formatted.includes("$") ? formatted : `$${formatted}$`;
}

export function formatUnitFactorsForDisplay(text: string): string {
  return text
    .replace(/(^|[^\w])1\s*\\(?:times|cdot)\s*/g, "$1")
    .replace(/(^|[=+\-({\s])1(?=[a-zA-Z])/g, "$1")
    .replace(/\\(?:times|cdot)\s*1\s*\^\s*\{?n\}?/g, "")
    .replace(/1\s*\^\s*\{?n\}?/g, "1");
}

export function hasDuplicateDisplayOptions(options: readonly string[]): boolean {
  const normalized = options.map(text => text
    .replace(/\$+/g, "")
    .replace(/\\(?:left|right)\b/g, "")
    .replace(/\\(?:times|cdot)\b/g, "×")
    .replace(/\^\{([A-Za-z0-9])\}/g, "^$1")
    .replace(/\s+/g, "")
    .toLowerCase());
  return new Set(normalized).size !== normalized.length;
}
