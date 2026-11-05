/** The existing duel screen displays one free-response flash question. */
export function supportsDuelElements(elements: unknown): boolean {
  if (!Array.isArray(elements)) return false;
  const allowed = new Set(["text", "section", "expression", "question", "hint", "explanation"]);
  return elements.every(e => e && allowed.has(e.type)) &&
    elements.filter(e => e.type === "question").length === 1;
}
