"use client";

import { ArrowLeft, BookOpen, Loader2, Sparkles } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExerciseLoader } from "../../../components/Exercise/ExerciseLoader";
import { Layout } from "../../../components/Layout";
import { useAuth } from "../../../contexts/AuthContext";
import { dsApi, DSRecommendation } from "../../../lib/api";

function DSExercicesPage() {
  const params = useParams();
  const dsId = params.id as string;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [recommendation, setRecommendation] = useState<DSRecommendation | null>(null);
  const [recommendLoading, setRecommendLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState(0);
  const [currentExerciseTitle, setCurrentExerciseTitle] = useState<string | null>(null);

  // Garde la recommandation courante pour la soumission (ref pour éviter les closures)
  const currentRecommendation = useRef<DSRecommendation | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) router.push("/auth/login");
  }, [user, authLoading, router]);

  // Charge la première recommandation
  useEffect(() => {
    if (!user || authLoading) return;
    let cancelled = false;
    setRecommendLoading(true);
    setError(null);
    dsApi
      .getDSRecommendation(dsId)
      .then((rec) => {
        if (cancelled) return;
        setRecommendation(rec);
        currentRecommendation.current = rec;
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || "Impossible de charger un exercice");
      })
      .finally(() => {
        if (!cancelled) setRecommendLoading(false);
      });
    return () => { cancelled = true; };
  }, [dsId, user, authLoading]);

  const handleNextClick = useCallback(
    async (hasErrors: boolean,engineSessionId?:string) => {
      const rec = currentRecommendation.current;
      if (!rec) return;

      // Soumet la réponse au backend DS
      try {
        await dsApi.submitDSAnswer(
          dsId,
          String(rec.exercise_id),
          rec.competences,
          !hasErrors,
          rec.difficulty,
          engineSessionId,
        );
      } catch (e) {
        console.error("[DS Exercices] submitDSAnswer error:", e);
        if(engineSessionId) {
          setError("La réponse n’a pas pu être enregistrée. Réessayez.");
          throw e;
        }
      }

      // Charge la prochaine recommandation
      setRecommendLoading(true);
      setError(null);
      try {
        const next = await dsApi.getDSRecommendation(dsId);
        setRecommendation(next);
        currentRecommendation.current = next;
        setNextKey((k) => k + 1);
      } catch (e: any) {
        setError(e.message || "Impossible de charger le prochain exercice");
      } finally {
        setRecommendLoading(false);
      }
    },
    [dsId],
  );

  if (authLoading || (!user && !error)) {
    return (
      <div className="flex-1 flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col px-4 md:px-8 py-6 max-w-[1400px] mx-auto w-full">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push(`/ds/${dsId}`)}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors mb-4 w-fit"
          style={{ fontFamily: "'Fredoka', sans-serif" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Retour au DS
        </button>

        <div className="flex items-center justify-center gap-3 mb-3">
          <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
            <BookOpen className="w-6 h-6 text-white" />
          </div>
          <h1
            className="text-4xl md:text-5xl tracking-tight bg-gradient-to-r from-white via-violet-100 to-indigo-100 bg-clip-text text-transparent drop-shadow-[0_2px_8px_rgba(139,92,246,0.5)]"
            style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}
          >
            Entraînement DS
          </h1>
        </div>
        <p
          className="text-center text-violet-200 text-base"
          style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}
        >
          Exercices ciblés sur vos compétences sélectionnées
        </p>
      </div>

      {/* Zone exercice */}
      <div className="flex-1">
        <div className="bg-slate-800/60 backdrop-blur-sm rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)] p-6 md:p-8">
          {recommendLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-violet-200">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}>
                Recommandation en cours…
              </span>
            </div>
          ) : error ? (
            error.toLowerCase().includes("aucun exercice") ? (
              <div className="flex flex-col items-center gap-4 py-12">
                <div className="text-5xl">🎉</div>
                <p
                  className="text-violet-200 text-xl font-semibold text-center"
                  style={{ fontFamily: "'Fredoka', sans-serif" }}
                >
                  Toutes les compétences sont maîtrisées !
                </p>
                <p
                  className="text-slate-400 text-center text-sm"
                  style={{ fontFamily: "'Fredoka', sans-serif" }}
                >
                  Il n'y a plus d'exercices disponibles pour ce DS.
                </p>
                <button
                  onClick={() => router.push(`/ds/${dsId}`)}
                  className="mt-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl transition-colors"
                  style={{ fontFamily: "'Fredoka', sans-serif" }}
                >
                  Voir ma progression
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 py-12">
                <p
                  className="text-red-300 text-center"
                  style={{ fontFamily: "'Fredoka', sans-serif" }}
                >
                  ❌ {error}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setError(null);
                      setRecommendLoading(true);
                      dsApi.getDSRecommendation(dsId)
                        .then((rec) => { setRecommendation(rec); currentRecommendation.current = rec; })
                        .catch((e) => setError(e.message || "Impossible de charger un exercice"))
                        .finally(() => setRecommendLoading(false));
                    }}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl transition-colors"
                    style={{ fontFamily: "'Fredoka', sans-serif" }}
                  >
                    Réessayer
                  </button>
                  <button
                    onClick={() => router.push(`/ds/${dsId}`)}
                    className="text-slate-400 hover:text-white transition-colors"
                    style={{ fontFamily: "'Fredoka', sans-serif" }}
                  >
                    ← Retour au DS
                  </button>
                </div>
              </div>
            )
          ) : recommendation ? (
            <ExerciseLoader
              dsId={dsId}
              key={`ds-exo-${recommendation.exercise_id}-${nextKey}`}
              exerciseId={String(recommendation.exercise_id)}
              competenceId={recommendation.competence_id}
              competences={recommendation.competences}
              shouldCountPoints={false}
              trackAbandon={true}
              mode="recommendation"
              onNextClick={handleNextClick}
              onLoad={(exercise) =>
                setCurrentExerciseTitle(exercise.app_title || exercise.title || null)
              }
            />
          ) : null}
        </div>
      </div>

      {/* Info card */}
      {recommendation && !recommendLoading && (
        <div className="mt-4 bg-gradient-to-br from-violet-500/10 to-indigo-500/10 backdrop-blur-sm rounded-xl p-3 border border-violet-500/20">
          <div className="flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-violet-400 flex-shrink-0 mt-0.5" />
            <p
              className="text-violet-200 text-xs leading-relaxed"
              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}
            >
              {currentExerciseTitle || "Exercice"} · {recommendation.difficulty} · Recommandation DS
            </p>
          </div>
        </div>
      )}

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(51, 65, 85, 0.3);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(139, 92, 246, 0.5);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(139, 92, 246, 0.7);
        }
      `}</style>
    </div>
  );
}

export default function DSExercicesPageWrapper() {
  return (
    <Layout>
      <DSExercicesPage />
    </Layout>
  );
}
