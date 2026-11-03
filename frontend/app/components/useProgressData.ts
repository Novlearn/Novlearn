"use client";

/**
 * Chargement de la progression par chapitre et de la vue d'ensemble.
 *
 * Recharge aussi au retour sur l'onglet : l'utilisateur peut avoir resolu des
 * exercices dans une autre vue entre-temps.
 */
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { useTaxonomyStore } from "../store/useTaxonomyStore";
import { buildHistory, type CompetenceScore, type SubjectData } from "./progressUtils";

export function useProgressData() {
  const { user, loading: authLoading } = useAuth();
  const chapters = useTaxonomyStore((state) => state.chapters);
  const taxonomyCompetences = useTaxonomyStore((state) => state.competences);
  const [data, setData] = useState<SubjectData[]>([]);
  const [overview, setOverview] = useState<{
    totalAnswers: number;
    correctAnswers: number;
    distinctExercises: number;
  }>({ totalAnswers: 0, correctAnswers: 0, distinctExercises: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProgress = useCallback(async () => {
    if (!user) {
      setData(
        chapters.map((s) => ({
          subject: s,
          progress: 0,
          history: [],
          totalAnswers: 0,
          correctAnswers: 0,
          competences: [],
        })),
      );
      setOverview({ totalAnswers: 0, correctAnswers: 0, distinctExercises: 0 });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [
        { data: attemptsData, error: attemptsErr },
        { data: scoresData, error: scoresErr },
      ] = await Promise.all([
        supabase
          .from("exercise_attempts")
          .select("exercise_id, is_correct, attempted_at")
          .eq("user_id", user.id),
        supabase
          .from("user_competence_scores")
          .select("competence_id, points")
          .eq("user_id", user.id),
      ]);

      if (attemptsErr) {
        console.warn(
          "[ProgressPage] exercise_attempts query:",
          attemptsErr.message,
        );
      }
      const attempts = attemptsData ?? [];
      const exerciseIds = [
        ...new Set(attempts.map((a) => a.exercise_id).filter(Boolean)),
      ] as number[];
      let exercisesMap: Record<number, string> = {};
      if (exerciseIds.length > 0) {
        const { data: exData } = await supabase
          .from("exercises")
          .select("id, chapter")
          .in("id", exerciseIds);
        if (exData)
          exercisesMap = Object.fromEntries(
            exData.map((e) => [e.id, e.chapter ?? ""]),
          );
      }
      const totalAnswers = attempts.length;
      const correctAnswers = attempts.filter((a) => a.is_correct).length;
      const distinctExercises = exerciseIds.length;
      setOverview({ totalAnswers, correctAnswers, distinctExercises });

      const scoresByCompetence = new Map<string, number>();
      if (!scoresErr && scoresData) {
        scoresData.forEach((r) =>
          scoresByCompetence.set(r.competence_id, r.points),
        );
      }

      const byChapter = new Map<
        string,
        { is_correct: boolean; attempted_at: string }[]
      >();
      for (const a of attempts) {
        const chapter = exercisesMap[a.exercise_id] ?? "Autre";
        if (!byChapter.has(chapter)) byChapter.set(chapter, []);
        byChapter
          .get(chapter)!
          .push({ is_correct: a.is_correct, attempted_at: a.attempted_at });
      }

      const chapterToCompetences = new Map<string, CompetenceScore[]>();
      for (const c of taxonomyCompetences) {
        const points = scoresByCompetence.get(c.id) ?? 0;
        const comp: CompetenceScore = {
          id: c.id,
          name: c.name,
          points,
          max_points: c.max_points,
        };
        if (!chapterToCompetences.has(c.chapter))
          chapterToCompetences.set(c.chapter, []);
        chapterToCompetences.get(c.chapter)!.push(comp);
      }

      const chapterNames = [...chapters];
      const built: SubjectData[] = chapterNames.map((subject) => {
        const competences = chapterToCompetences.get(subject) ?? [];
        const chapterAttempts = byChapter.get(subject) ?? [];
        const history = buildHistory(chapterAttempts);
        const totalAnswers = chapterAttempts.length;
        const correctAnswers = chapterAttempts.filter(
          (a) => a.is_correct,
        ).length;
        // Progress = competence mastery (points earned / max points)
        const totalCompPoints = competences.reduce((sum, c) => sum + c.points, 0);
        const totalCompMax = competences.reduce((sum, c) => sum + c.max_points, 0);
        const masteryPct = totalCompMax > 0
          ? Math.round((totalCompPoints / totalCompMax) * 100)
          : 0;
        return {
          subject,
          progress: masteryPct,
          history,
          totalAnswers,
          correctAnswers,
          competences,
        };
      });

      setData(built);
    } catch (e) {
      console.error("[ProgressPage] fetchProgress:", e);
      setData(
        chapters.map((s) => ({
          subject: s,
          progress: 0,
          history: [],
          totalAnswers: 0,
          correctAnswers: 0,
          competences: [],
        })),
      );
      setOverview({ totalAnswers: 0, correctAnswers: 0, distinctExercises: 0 });
    } finally {
      setLoading(false);
    }
  }, [user, chapters, taxonomyCompetences]);

  useEffect(() => {
    if (authLoading) return;
    fetchProgress();
  }, [authLoading, fetchProgress]);

  // Refetch when user comes back to the tab (e.g. after solving an exercise elsewhere)
  useEffect(() => {
    const onFocus = () => user && fetchProgress();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [user, fetchProgress]);

  return {
    user,
    authLoading,
    chapters,
    data,
    overview,
    loading,
    error,
    refetch: fetchProgress,
  };
}
