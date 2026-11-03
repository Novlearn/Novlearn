/** Types du tableau de bord d'administration. */

export interface KpiData {
  exercises: number;
  attempts: number;
  feedbacks: number;
  duels: number;
}

export interface DailyAttempt {
  date: string;
  tentatives: number;
  reussies: number;
}

export interface ChapterSlice {
  name: string;
  value: number;
  color: string;
}

export interface WeeklyTrend {
  week: string;
  tentatives: number;
  duels: number;
  feedbacks: number;
}

export type TimeRange = "7d" | "14d" | "30d" | "60d" | "all";
