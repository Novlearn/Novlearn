/** Palettes, styles de graphiques et fenetres temporelles du dashboard. */
import type { TimeRange } from "./types";

/** Couleur par chapitre, utilisee par le camembert et les legendes. */
export const CH_COLORS: Record<string, string> = {
  "Suites numériques": "#6366f1",
  "Limites et continuité": "#3b82f6",
  "Dérivation et Fonctions": "#22d3ee",
  "Logarithme néperien": "#10b981",
  "Primitives et équadiff": "#f59e0b",
  Convexité: "#f97316",
  Stats: "#ec4899",
  Probas: "#8b5cf6",
  Autre: "#64748b",
};

/** Palette cyclique pour les categories de feedback. */
export const FB_COLORS = [
  "#6366f1",
  "#3b82f6",
  "#22d3ee",
  "#10b981",
  "#f59e0b",
  "#f97316",
  "#ec4899",
  "#8b5cf6",
  "#64748b",
];

/** Police commune a tous les libelles de graphique. */
export const F = { fontFamily: "'Fredoka', sans-serif" };

/** Style des axes recharts. */
export const AX = {
  fill: "#94a3b8",
  fontSize: 11,
  fontFamily: "'Fredoka', sans-serif",
};

/** Etiquette de jour : JJ/MM. */
export function dd(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Etiquette de semaine : "3 mars". */
export function ww(d: Date) {
  return `${d.getDate()} ${d.toLocaleString("fr-FR", { month: "short" })}`;
}

export const RANGES: { id: TimeRange; label: string; days: number }[] = [
  { id: "7d", label: "Semaine", days: 7 },
  { id: "14d", label: "14 jours", days: 14 },
  { id: "30d", label: "Mois", days: 30 },
  { id: "60d", label: "2 mois", days: 60 },
  { id: "all", label: "Toujours", days: 180 },
];
