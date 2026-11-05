"use client";

import { BookOpen, Loader2, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { ExerciseLoader } from "../components/Exercise/ExerciseLoader";
import { GuestConversionModal } from "../components/GuestLock/GuestConversionModal";
import { Layout } from "../components/Layout";
import { Exercise } from "../types/exercise";
import { getRecommendedExercise, postChapterTestNext } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { useGuestMode } from "../hooks/useGuestMode";

// Composant qui lit l'URL
function ExercisePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idFromUrl = searchParams.get("id") || undefined;
  const chapterFromUrl = searchParams.get("chapter") || undefined;
  const recommendationKey = chapterFromUrl ?? "";
  const { user, loading: authLoading, isGuest } = useAuth();
  const { hasReachedLimit } = useGuestMode();
  const [error, setError] = useState<string | null>(null);
  const [showConversionModal, setShowConversionModal] = useState(false);
  const [guestLimitReached, setGuestLimitReached] = useState(false);
  const [recommendedId, setRecommendedId] = useState<string | undefined>(
    undefined,
  );
  const [recommendedCompetenceId, setRecommendedCompetenceId] = useState<string | null | undefined>(undefined);
  const [recommendedCompetences, setRecommendedCompetences] = useState<string[] | undefined>(undefined);
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [resolvedRecommendationKey, setResolvedRecommendationKey] = useState<string | null>(null);
  const [mode, setMode] = useState<'test' | 'recommendation' | undefined>(undefined);
  const [testChapter, setTestChapter] = useState<string | undefined>(undefined);
  const [nextKey, setNextKey] = useState(0);
  const [currentExerciseTitle, setCurrentExerciseTitle] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) router.push("/accueil");
  }, [user, authLoading, router]);

  // Vérifier la limite invité au chargement de la page
  useEffect(() => {
    if (!isGuest || authLoading) return;
    hasReachedLimit().then((reached) => {
      if (reached) {
        setGuestLimitReached(true);
        setShowConversionModal(true);
      }
    });
  }, [isGuest, authLoading, hasReachedLimit]);

  // Sans id dans l'URL : on demande une recommandation (optionnellement par chapitre)
  useEffect(() => {
    if (idFromUrl) {
      setRecommendedId(undefined);
      setRecommendedCompetenceId(undefined);
      setMode(undefined);
      setTestChapter(undefined);
      setRecommendLoading(false);
      setResolvedRecommendationKey(null);
      return;
    }
    let cancelled = false;
    setRecommendLoading(true);
    getRecommendedExercise(chapterFromUrl || null)
      .then((res) => {
        if (cancelled) return;
        if (res) {
          setRecommendedId(String(res.exercise_id));
          // Use competences array if available, otherwise fallback to competence_id
          const competencesArray = res.competences && Array.isArray(res.competences) && res.competences.length > 0
            ? res.competences
            : (res.competence_id ? [res.competence_id] : []);
          setRecommendedCompetences(competencesArray);
          setRecommendedCompetenceId(competencesArray[0] ?? null); // Keep for backward compatibility
          setMode(res.mode ?? 'recommendation');
          setTestChapter(res.chapter);
          console.log(`[ExercisePage] Loaded: mode=${res.mode ?? 'recommendation'} chapter=${res.chapter ?? '-'} exo=${res.exercise_id} competences=${JSON.stringify(competencesArray)}`, res);
          if (competencesArray.length === 0) {
            console.warn(`[ExercisePage] ⚠️ WARNING: Backend returned no competences for exercise ${res.exercise_id}. Points will not be counted!`);
          }
        } else {
          setRecommendedId(undefined);
          setRecommendedCompetenceId(undefined);
          setRecommendedCompetences(undefined);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRecommendLoading(false);
          setResolvedRecommendationKey(recommendationKey);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [idFromUrl, chapterFromUrl, recommendationKey]);

  const exerciseId = idFromUrl ?? recommendedId;
  const recommendationPending = !idFromUrl &&
    (recommendLoading || resolvedRecommendationKey !== recommendationKey);
  
  // Debug: log shouldCountPoints value
  useEffect(() => {
    if (exerciseId) {
      const shouldCount = !idFromUrl && (mode === undefined || mode === 'recommendation');
      console.log(`[ExercisePage] exerciseId=${exerciseId}, idFromUrl=${idFromUrl}, mode=${mode}, shouldCountPoints=${shouldCount}`);
    }
  }, [exerciseId, idFromUrl, mode]);

  // Fetch next exercise when in test or recommendation mode (no id in URL)
  const handleNextClick = useCallback(
    async (hasErrors: boolean,engineSessionId?:string) => {
      if (idFromUrl) return;
      const lastSuccess = !hasErrors;
      const applyNext = (id: string, m: 'test' | 'recommendation', ch?: string, competencesArray?: string[]) => {
        setRecommendedId(id);
        setRecommendedCompetences(competencesArray);
        setRecommendedCompetenceId(competencesArray?.[0] ?? null); // Keep for backward compatibility
        setMode(m);
        setTestChapter(ch);
        setNextKey((k) => k + 1);
      };
      if (mode === 'test' && testChapter) {
        const res = await postChapterTestNext(testChapter, lastSuccess,engineSessionId);
        if (res?.completed) {
          console.log('[ExercisePage] Chapter test completed, switching to recommendation');
          const next = await getRecommendedExercise(chapterFromUrl || null);
          if (next) {
            const nextCompetences = next.competences && Array.isArray(next.competences) && next.competences.length > 0
              ? next.competences
              : (next.competence_id ? [next.competence_id] : []);
            applyNext(String(next.exercise_id), next.mode ?? 'recommendation', next.chapter, nextCompetences);
          } else setNextKey((k) => k + 1);
        } else if (res?.exercise_id) {
          const competencesArray = res.competences && Array.isArray(res.competences) && res.competences.length > 0
            ? res.competences
            : (res.competence_id ? [res.competence_id] : []);
          applyNext(String(res.exercise_id), 'test', res.chapter ?? testChapter, competencesArray);
        } else {
          const next = await getRecommendedExercise(chapterFromUrl || null);
          if (next) {
            const nextCompetences = next.competences && Array.isArray(next.competences) && next.competences.length > 0
              ? next.competences
              : (next.competence_id ? [next.competence_id] : []);
            applyNext(String(next.exercise_id), next.mode ?? 'recommendation', next.chapter, nextCompetences);
          } else setNextKey((k) => k + 1);
        }
      } else {
        const next = await getRecommendedExercise(chapterFromUrl || null);
        if (next) {
          const nextCompetences = next.competences && Array.isArray(next.competences) && next.competences.length > 0
            ? next.competences
            : (next.competence_id ? [next.competence_id] : []);
          applyNext(String(next.exercise_id), next.mode ?? 'recommendation', next.chapter, nextCompetences);
        } else {
          console.warn('[ExercisePage] getRecommendedExercise returned null, forcing reload');
          setNextKey((k) => k + 1);
        }
      }
    },
    [idFromUrl, mode, testChapter, chapterFromUrl]
  );

  const handleLoad = useCallback((exercise: Exercise) => {
    setError(null);
    // Keep track of the public title for display (fallback to internal title if needed)
    setCurrentExerciseTitle(exercise.app_title || exercise.title || null);
  }, []);

  const handleError = useCallback((err: Error) => {
    console.error("[ExercisePage] Load error:", err.message);
    setError(err.message);
  }, []);

  const handleElementSubmit = useCallback((_elementId: number, _answer: unknown, _isCorrect: boolean) => {
    // Element submitted
  }, []);

  if (authLoading || !user) {
    return (
      <div className="flex-1 flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3 text-blue-200">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span
            style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}
          >
            {authLoading ? "Chargement…" : "Redirection…"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col px-4 md:px-8 py-6 max-w-[1400px] mx-auto w-full">
      {isGuest && (
        <GuestConversionModal
          isOpen={showConversionModal}
          onClose={() => { if (!guestLimitReached) setShowConversionModal(false); }}
          canClose={!guestLimitReached}
        />
      )}
      {/* En-tête */}
      <div className="mb-6">
        <div className="flex items-center justify-center gap-3 mb-3">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
            <BookOpen className="w-6 h-6 text-white" />
          </div>
          <h1
            className="text-4xl md:text-5xl tracking-tight bg-gradient-to-r from-white via-blue-100 to-purple-100 bg-clip-text text-transparent drop-shadow-[0_2px_8px_rgba(59,130,246,0.5)]"
            style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}
          >
            Exercice de mathématiques
          </h1>
        </div>
        <p
          className="text-center text-blue-200 text-base"
          style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}
        >
          Résolvez l'exercice ci-dessous
        </p>
      </div>

      {/* Zone d'exercice */}
      <div className="flex-1">
        <div className="bg-slate-800/60 backdrop-blur-sm rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)] p-6 md:p-8">
          {recommendationPending ? (
            <div className="flex items-center justify-center gap-2 py-12 text-blue-200">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span
                style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}
              >
                Recommandation en cours…
              </span>
            </div>
          ) : (
          <ExerciseLoader
            key={`exo-${exerciseId ?? 'loading'}-${nextKey}`}
            exerciseId={exerciseId}
            competenceId={!idFromUrl ? recommendedCompetenceId : undefined}
            competences={!idFromUrl ? recommendedCompetences : undefined}
            onLoad={handleLoad}
            onError={handleError}
            onElementSubmit={handleElementSubmit}
            shouldCountPoints={!idFromUrl && (mode === undefined || mode === 'recommendation')}
            trackAbandon={!idFromUrl}
            mode={mode}
            onNextClick={!idFromUrl ? handleNextClick : undefined}
            onGuestLimitReached={isGuest ? () => { setGuestLimitReached(true); setShowConversionModal(true); } : undefined}
          />
          )}

          {error && (
            <div className="mt-4 p-4 bg-red-500/20 border border-red-500/50 rounded-xl">
              <p
                className="text-red-200 text-sm"
                style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}
              >
                ❌ {error}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Info card */}
      <div className="mt-4 bg-gradient-to-br from-blue-500/10 to-purple-500/10 backdrop-blur-sm rounded-xl p-3 border border-blue-500/20">
        <div className="flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
          <p className="text-blue-200 text-xs leading-relaxed" style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}>
            {mode === 'test'
              ? "Test de placement : évalue ton niveau pour des recommandations adaptées"
              : currentExerciseTitle
                ? `${currentExerciseTitle}${mode === 'recommendation' ? ' (recommandation)' : ''}`
                : exerciseId
                  ? "Mode découverte (exercice aléatoire)"
                  : "Mode découverte (exercice aléatoire)"}
          </p>
        </div>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(51, 65, 85, 0.3);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(59, 130, 246, 0.5);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(59, 130, 246, 0.7);
        }
      `}</style>
    </div>
  );
}

// Export principal avec Suspense (OBLIGATOIRE pour lire l'URL)
export default function ExercicesPage() {
  return (
    <Layout>
      <Suspense
        fallback={
          <div className="text-white text-center p-10">
            Chargement de la page...
          </div>
        }
      >
        <ExercisePageContent />
      </Suspense>
    </Layout>
  );
}

