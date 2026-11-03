/**
 * Types et helpers purs de la page de progression.
 */

export function getScoreColor(score: number) {
  if (score >= 90)
    return {
      text: "text-green-400",
      bg: "bg-gradient-to-r from-green-500 to-green-400",
      stroke: "#22c55e",
    };
  if (score >= 75)
    return {
      text: "text-blue-400",
      bg: "bg-gradient-to-r from-blue-500 to-blue-400",
      stroke: "#3b82f6",
    };
  if (score >= 51)
    return {
      text: "text-yellow-400",
      bg: "bg-gradient-to-r from-yellow-500 to-yellow-400",
      stroke: "#eab308",
    };
  if (score >= 31)
    return {
      text: "text-orange-400",
      bg: "bg-gradient-to-r from-orange-500 to-orange-400",
      stroke: "#f97316",
    };
  return {
    text: "text-red-400",
    bg: "bg-gradient-to-r from-red-500 to-red-400",
    stroke: "#ef4444",
  };
}

export interface HistoryEntry {
  date: string;
  score: number;
  exerciseNumber: number;
}

export interface CompetenceScore {
  id: string;
  name: string;
  points: number;
  max_points: number;
}

export interface SubjectData {
  subject: string;
  progress: number;
  history: HistoryEntry[];
  totalAnswers: number;
  correctAnswers: number;
  competences: CompetenceScore[];
}

export function formatChartDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function buildHistory(
  attempts: { attempted_at: string; is_correct: boolean }[],
): HistoryEntry[] {
  if (attempts.length === 0) return [];
  const byDate = new Map<string, { correct: number; total: number }>();
  for (const a of attempts) {
    const date = a.attempted_at.slice(0, 10);
    const cur = byDate.get(date) ?? { correct: 0, total: 0 };
    cur.total += 1;
    if (a.is_correct) cur.correct += 1;
    byDate.set(date, cur);
  }
  const sortedDates = Array.from(byDate.keys()).sort();
  let cumCorrect = 0;
  let cumTotal = 0;
  const history: HistoryEntry[] = [];
  for (const date of sortedDates) {
    const { correct, total } = byDate.get(date)!;
    cumCorrect += correct;
    cumTotal += total;
    const score = cumTotal > 0 ? Math.round((cumCorrect / cumTotal) * 100) : 0;
    history.push({
      date: formatChartDate(date),
      score,
      exerciseNumber: cumTotal,
    });
  }
  return history;
}
