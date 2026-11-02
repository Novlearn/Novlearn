import { AVAILABLE_EXERCISES_FILTER } from "../../lib/exerciseAvailability";
import {
  ArrowRight,
  CheckCircle2,
  Flag,
  HelpCircle,
  MessageSquare,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../contexts/AuthContext";
import { GUEST_EXERCISE_LIMIT, useGuestMode } from "../../hooks/useGuestMode";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { computeNewScore, difficultyToLevel } from "../../lib/competenceScore";
import { supabase } from "../../lib/supabase";
import { useTaxonomyStore } from "../../store/useTaxonomyStore";
import { Exercise, VariableValues } from "../../types/exercise";
import { generateVariables } from "../../utils/variableGenerator";
import { FeedbackModal } from "../ui/FeedbackModal";
import { HelpModal } from "../ui/HelpModal";
import ExerciseRenderer from "./ExerciseRenderer";
import { exerciseOperation, ExerciseRequestError } from "../../lib/engine/learnerClient";
import { sessionExercise } from "../../lib/engine/exerciseView";
import type { ExerciseSession, GradeQuestion } from "../../lib/engine/learnerTypes";

async function updateCompetenceScore(
  userId: string,
  competenceId: string,
  difficulty: string,
  isCorrect: boolean,
): Promise<void> {
  try {
    const competenceConfig = useTaxonomyStore
      .getState()
      .getCompetenceById(competenceId);
    const maxPoints = competenceConfig?.max_points ?? 10;

    const { data: scoreRow, error: selectError } = await supabase
      .from("user_competence_scores")
      .select("points, streak")
      .eq("user_id", userId)
      .eq("competence_id", competenceId)
      .maybeSingle();

    if (selectError) throw selectError;

    const currentPoints = scoreRow?.points ?? 0;
    const currentStreak = scoreRow?.streak ?? 0;

    const newStreak = isCorrect ? currentStreak + 1 : 0;
    const newPoints = isCorrect
      ? computeNewScore(
          currentPoints,
          maxPoints,
          difficultyToLevel(difficulty),
          currentStreak,
        )
      : currentPoints;

    const { error: upsertError } = await supabase
      .from("user_competence_scores")
      .upsert(
        {
          user_id: userId,
          competence_id: competenceId,
          points: newPoints,
          streak: newStreak,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,competence_id" },
      );

    if (upsertError) throw upsertError;
  } catch (e) {
    console.error("[updateCompetenceScore] ❌ ERROR:", e);
    throw e;
  }
}

interface ExerciseLoaderProps {
  exerciseId?: string;
  competenceId?: string | null;
  competences?: string[];
  onLoad?: (exercise: Exercise) => void;
  onElementSubmit?: (
    elementId: number,
    answer: unknown,
    isCorrect: boolean,
  ) => void;
  onError?: (error: Error) => void;
  shouldCountPoints?: boolean;
  /** Si true, enregistre immédiatement une tentative fausse au chargement.
   *  Quitter sans finir conserve ce false en base (abandon = faux).
   *  Compléter l'exercice met à jour la ligne avec le vrai résultat.
   *  Cliquer "Passer" supprime la ligne (le skip ne compte pas). */
  trackAbandon?: boolean;
  mode?: "test" | "recommendation";
  onNextClick?: (hasErrors: boolean,engineSessionId?:string) => Promise<void>;
  dsId?:string;
  onGuestLimitReached?: () => void;
}

export const ExerciseLoader: React.FC<ExerciseLoaderProps> = ({
  exerciseId,
  competenceId: competenceIdFromProps,
  competences: competencesFromProps,
  onLoad,
  onElementSubmit,
  onError,
  shouldCountPoints = false,
  trackAbandon = false,
  mode,
  onNextClick,
  onGuestLimitReached,
  dsId,
}) => {
  const router = useRouter();
  const { isGuest,user } = useAuth();
  const storageKey=`novlearn-engine:${user?.id??"anonymous"}:${exerciseId}:${dsId??mode??"practice"}`;
  const { getGuestAttemptCount } = useGuestMode();
  const normalizeCompetenceId = useTaxonomyStore(
    (state) => state.normalizeCompetenceId,
  );

  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [engineSession,setEngineSession]=useState<ExerciseSession|null>(null);
  const engineRef=useRef<ExerciseSession|null>(null);
  const engineLoadRef=useRef<{key:string;request:ReturnType<typeof exerciseOperation>}|null>(null);
  const [variables, setVariables] = useState<VariableValues>({});
  const [loading, setLoading] = useState(true);
  const [isTakingLong, setIsTakingLong] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [completedElements, setCompletedElements] = useState<Set<number>>(
    new Set(),
  );
  const [isExerciseFinished, setIsExerciseFinished] = useState(false);
  const [hasErrors, setHasErrors] = useState(false);

  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [pendingNextAction, setPendingNextAction] = useState<
    (() => void | Promise<void>) | null
  >(null);
  const [isFeedbackDifficultyOnly, setIsFeedbackDifficultyOnly] =
    useState(false);

  const [lastSaveStatus, setLastSaveStatus] = useState<
    "idle" | "saved" | "no_session" | "error"
  >("idle");
  const [isNextLoading, setIsNextLoading] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const slowTimerRef = useRef<NodeJS.Timeout | null>(null);
  const feedbackPendingRef = useRef(false);
  const exerciseSavedRef = useRef(false); // Empêche les doubles sauvegardes
  // ID de la ligne exercise_attempts insérée au chargement (mode trackAbandon).
  // null = pas encore insérée ou déjà traitée.
  const attemptIdRef = useRef<number | null>(null);

  const totalQuestions = useMemo(() => {
    if (!exercise) return 0;
    return exercise.elements.filter(
      (el) =>
        ["question", "mcq", "equation"].includes(el.type) &&
        (el.type !== "equation" || (el.content as any).requireAnswer),
    ).length;
  }, [exercise]);

  useEffect(() => {
    if (isFeedbackOpen || feedbackPendingRef.current) return;

    if (abortControllerRef.current) abortControllerRef.current.abort();
    if (slowTimerRef.current) clearTimeout(slowTimerRef.current);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const loadExercise = async () => {
      setLoading(true);
      setError(null);
      setIsTakingLong(false);
      setIsExerciseFinished(false);
      setCompletedElements(new Set());
      setHasErrors(false);
      setLastSaveStatus("idle");
      exerciseSavedRef.current = false;
      attemptIdRef.current = null;
      engineRef.current=null;setEngineSession(null);

      slowTimerRef.current = setTimeout(() => {
        if (!abortController.signal.aborted) setIsTakingLong(true);
      }, 3000);
      const applySession=(s:ExerciseSession)=>{
        engineRef.current=s;setEngineSession(s);sessionStorage.setItem(storageKey,s.sessionId);
        const e=sessionExercise(s);setExercise(e);setVariables({});onLoad?.(e);exerciseSavedRef.current=true;
        setIsExerciseFinished(s.status==="completed");setHasErrors(s.status==="completed"&&!s.correct);
        setLastSaveStatus(s.status==="completed"?"saved":"idle");
      };
      const loadEngine=(body:Record<string,unknown>)=>{
        // React Strict Mode replays effects. Share only that owner's in-flight
        // load so the first, cancelled effect cannot make the second fail 429.
        const key=`${user?.id??""}:${JSON.stringify(body)}`;
        if(engineLoadRef.current?.key===key) return engineLoadRef.current.request;
        const request=exerciseOperation(body);engineLoadRef.current={key,request};
        const clear=()=>{if(engineLoadRef.current?.request===request)engineLoadRef.current=null;};
        void request.then(clear,clear);return request;
      };
      const openEngine=(id:string)=>loadEngine({action:"open",exerciseId:id,mode:dsId?"ds":mode==="test"?"placement":"practice",dsId:dsId??null,countPoints:shouldCountPoints,trackAbandon});

      try {
        if(process.env.NEXT_PUBLIC_ENGINE_ENABLED==="true") {
          let result:Awaited<ReturnType<typeof exerciseOperation>>|undefined;
          const previous=sessionStorage.getItem(storageKey);
          if(previous) {
            try {result=await loadEngine({action:"resume",sessionId:previous});}
            catch(e) {
              if(!(e instanceof ExerciseRequestError)||![404,410].includes(e.status)) throw e;
              sessionStorage.removeItem(storageKey);
            }
          }
          if(!result&&exerciseId) result=await openEngine(exerciseId);
          if(abortController.signal.aborted) return;
          if(result?.kind==="engine") {
            applySession(result.session);
            return;
          }
        }
        let data = null;
        let dbError = null;

        if (exerciseId) {
          const result = await supabase
            .from("exercises")
            .select("*")
            .or(AVAILABLE_EXERCISES_FILTER)
            .is("catalog_id",null)
            .eq("id", exerciseId)
            .maybeSingle();
          data = result.data;
          dbError = result.error;
        } else {
          const { count, error: countError } = await supabase
            .from("exercises")
            .select("*", { count: "exact", head: true })
            .or(AVAILABLE_EXERCISES_FILTER);
          if (countError) throw countError;
          const total = count || 0;

          if (total > 0) {
            const randomOffset = Math.floor(Math.random() * total);
            const result = await supabase
              .from("exercises")
              .select("id,catalog_id")
              .or(AVAILABLE_EXERCISES_FILTER)
              .range(randomOffset, randomOffset)
              .maybeSingle();
            data = result.data;
            dbError = result.error;
          } else {
            throw new Error("La base d'exercices est vide.");
          }
        }

        if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
        if (abortController.signal.aborted) return;
        if (dbError) throw dbError;
        if (!data) throw new Error("Exercice introuvable.");
        if(data.catalog_id) {
          if(process.env.NEXT_PUBLIC_ENGINE_ENABLED!=="true") throw new Error("Cet exercice nécessite Engine.");
          const result=await openEngine(String(data.id));
          if(abortController.signal.aborted) return;
          if(result.kind!=="engine") throw new Error("Version d’exercice modifiée. Réessayez.");
          applySession(result.session);return;
        }
        if(!exerciseId) {
          const legacy=await supabase.from("exercises").select("*").or(AVAILABLE_EXERCISES_FILTER).is("catalog_id",null).eq("id",data.id).maybeSingle();
          if(legacy.error||!legacy.data) throw new Error("Exercice indisponible.");data=legacy.data;
        }

        const content = data.content || {};
        const effectiveCompetences =
          competencesFromProps &&
          Array.isArray(competencesFromProps) &&
          competencesFromProps.length > 0
            ? competencesFromProps
            : competenceIdFromProps
              ? [competenceIdFromProps]
              : (data.competences ?? []);

        const fullExercise = {
          ...content,
          id: data.id,
          title: data.title,
          app_title: data.app_title,
          chapter: data.chapter,
          difficulty: data.difficulty,
          competence_id: effectiveCompetences[0] ?? null,
          competences: effectiveCompetences,
          variables: content.variables || [],
          elements: content.elements || [],
        } as unknown as Exercise;

        setExercise(fullExercise);
        setVariables(generateVariables(fullExercise.variables));
        if (onLoad) onLoad(fullExercise);

        // Enregistre une tentative "abandonnée" dès le chargement.
        // Elle sera mise à jour si l'utilisateur complète l'exercice,
        // ou supprimée s'il clique "Passer".
        if (trackAbandon && !isGuest) {
          const exerciseIdNum = Number(fullExercise.id);
          if (!Number.isNaN(exerciseIdNum)) {
            const { data: { user: currentUser } } = await supabase.auth.getUser();
            if (currentUser) {
              const { data: insertedRow } = await supabase
                .from("exercise_attempts")
                .insert({
                  user_id: currentUser.id,
                  exercise_id: exerciseIdNum,
                  is_correct: false,
                  is_abandoned: true,
                  is_guest: false,
                })
                .select("id")
                .single();
              attemptIdRef.current = insertedRow?.id ?? null;
            }
          }
        }
      } catch (err) {
        if (abortController.signal.aborted) return;
        const msg = err instanceof Error ? err.message : "Erreur de chargement";
        setError(msg);
        if (onError) onError(err instanceof Error ? err : new Error(msg));
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
          setIsTakingLong(false);
        }
      }
    };

    loadExercise();
    return () => abortController.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseId, competenceIdFromProps, refreshTrigger,user?.id]);

  const handleElementSubmit = useCallback(
    (elementId: number, answer: unknown, isCorrect: boolean) => {
      // Callback externe pour le parent (si besoin)
      if (onElementSubmit) onElementSubmit(elementId, answer, isCorrect);

      // Marquer si erreur
      if (!isCorrect) setHasErrors(true);

      // Ajouter l'élément à la liste des complétés et vérifier si exercice terminé
      setCompletedElements((prev) => {
        const next = new Set(prev).add(elementId);
        if (exercise && next.size >= totalQuestions && totalQuestions > 0) {
          setIsExerciseFinished(true);
        }
        return next;
      });
    },
    [exercise, totalQuestions, onElementSubmit],
  );

  // Sauvegarde finale de l'exercice en BDD (une seule ligne par exercice)
  useEffect(() => {
    if (!isExerciseFinished || exerciseSavedRef.current || !exercise || engineRef.current) return;

    const saveExerciseAttempt = async () => {
      exerciseSavedRef.current = true;
      setLastSaveStatus("idle");

      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();

      if (!currentUser) {
        setLastSaveStatus("no_session");
        return;
      }

      const exerciseIdNum = Number(exercise.id);
      if (Number.isNaN(exerciseIdNum)) return;

      // L'exercice est correct uniquement si TOUTES les questions sont justes
      const isExerciseCorrect = !hasErrors;

      let saveError: unknown = null;

      if (attemptIdRef.current !== null) {
        // Ligne déjà insérée au chargement (trackAbandon) → on la met à jour
        const { error } = await supabase
          .from("exercise_attempts")
          .update({ is_correct: isExerciseCorrect, is_abandoned: false })
          .eq("id", attemptIdRef.current);
        saveError = error;
        attemptIdRef.current = null;
      } else {
        // Pas de ligne pré-insérée → INSERT classique
        const { error } = await supabase.from("exercise_attempts").insert({
          user_id: currentUser.id,
          exercise_id: exerciseIdNum,
          is_correct: isExerciseCorrect,
          time_spent: null,
          is_guest: isGuest,
        });
        saveError = error;
      }

      setLastSaveStatus(saveError ? "error" : "saved");

      // Vérifier si l'invité a atteint sa limite
      if (isGuest && !saveError) {
        const count = await getGuestAttemptCount();
        if (count >= GUEST_EXERCISE_LIMIT) {
          onGuestLimitReached?.();
        }
      }

      // Mise à jour des scores de compétences (une seule fois, à la fin)
      const effectiveCompetences = competencesFromProps?.length
        ? competencesFromProps
        : (exercise.competences ?? []);

      if (effectiveCompetences.length > 0 && shouldCountPoints) {
        const normalizedIds = effectiveCompetences
          .map((c) => normalizeCompetenceId(c))
          .filter((id): id is string => id !== null);
        await Promise.all(
          normalizedIds.map((id) =>
            updateCompetenceScore(
              currentUser.id,
              id,
              exercise.difficulty,
              isExerciseCorrect,
            ),
          ),
        );
      }
    };

    saveExerciseAttempt();
  }, [
    isExerciseFinished,
    exercise,
    hasErrors,
    shouldCountPoints,
    competencesFromProps,
    normalizeCompetenceId,
    isGuest,
    getGuestAttemptCount,
    onGuestLimitReached,
  ]);

  const proceedToNext = useCallback(() => {
    feedbackPendingRef.current = false; // Libération du verrou
    if (exerciseId) {
      router.push("/exercices");
    } else {
      setRefreshTrigger((prev) => prev + 1);
    }
  }, [exerciseId, router]);

  const handleNextExercise = async () => {
    const shouldAskFeedback = Math.random() < 0.15;

    // Définir l'action de base à effectuer (onNextClick ou rechargement local)
    const nextAction = async () => {
      if (onNextClick) {
        setIsNextLoading(true);
        try {
          if(engineRef.current) await onNextClick(hasErrors,engineRef.current.sessionId);
          else await onNextClick(hasErrors);
          if(engineRef.current) sessionStorage.removeItem(storageKey);
        } catch (e) {
          console.error(e);
        } finally {
          setIsNextLoading(false);
          feedbackPendingRef.current = false;
        }
      } else {
        if(engineRef.current) sessionStorage.removeItem(storageKey);
        proceedToNext();
      }
    };

    if (shouldAskFeedback) {
      feedbackPendingRef.current = true; // Activer le verrouillage
      setPendingNextAction(() => nextAction); // Stocker l'action
      setIsFeedbackDifficultyOnly(true);
      setIsFeedbackOpen(true); // Ouvrir la modale
    } else {
      await nextAction();
    }
  };

  const handleModalClose = () => {
    setIsFeedbackOpen(false);

    // On n'exécute l'action de suite pour éviter un conflit de rendu
    if (pendingNextAction) {
      // Un petit délai assure que l'état de la modale est bien traité par React
      setTimeout(() => {
        pendingNextAction();
        setPendingNextAction(null);
      }, 100);
    } else {
      feedbackPendingRef.current = false;
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-6 sm:p-12 min-h-[300px]">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-600 font-medium">Chargement de l'exercice...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-5 sm:p-8 flex flex-col items-center justify-center text-center bg-red-50 border border-red-100 rounded-xl min-h-[300px]">
        <h3 className="text-red-800 font-bold mb-2">Oups !</h3>
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={() => setRefreshTrigger((p) => p + 1)}
          className="px-4 py-2 bg-white border border-red-200 text-red-700 rounded-lg"
        >
          Réessayer
        </button>
      </div>
    );
  }

  if (!exercise) return null;

  return (
    <div className="space-y-3 sm:space-y-6 animate-in fade-in duration-500 pb-6 sm:pb-12">
      <FeedbackModal
        isOpen={isFeedbackOpen}
        onClose={handleModalClose}
        exerciseId={exercise.id}
        exerciseTitle={exercise.app_title || exercise.title}
        onlyDifficulty={isFeedbackDifficultyOnly}
      />

      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />

      <div className="flex items-center justify-between flex-wrap gap-2 sm:gap-4 bg-white p-3 sm:p-4 rounded-xl shadow-sm border border-slate-100">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h2 className="text-base sm:text-2xl font-bold text-slate-800">
              {exercise.app_title || exercise.title}
            </h2>
            {mode && (
              <span
                className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide border ${mode === "test" ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-indigo-50 text-indigo-700 border-indigo-100"}`}
              >
                {mode === "test" ? "Mode test" : "Recommandation"}
              </span>
            )}
          </div>
          <div className="flex gap-2 text-sm text-gray-500">
            {exercise.chapter && (
              <span className="bg-gray-100 px-2 py-0.5 rounded text-xs uppercase tracking-wide font-semibold">
                {exercise.chapter}
              </span>
            )}
            <span
              className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide ${exercise.difficulty === "Difficile" ? "bg-red-50 text-red-700" : exercise.difficulty === "Moyen" ? "bg-yellow-50 text-yellow-700" : "bg-green-50 text-green-700"}`}
            >
              {exercise.difficulty}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* Bouton Passer visible tant que l'exercice n'est pas fini */}
          {!isExerciseFinished && (
            <button
              onClick={async () => {
                if(engineRef.current) {
                  const r=await exerciseOperation({action:"skip",sessionId:engineRef.current.sessionId});
                  if(r.kind!=="engine") return;
                  engineRef.current=r.session;setEngineSession(r.session);
                  sessionStorage.removeItem(storageKey);
                }
                // Supprime la tentative pré-insérée : "Passer" ne compte pas faux
                if (attemptIdRef.current !== null) {
                  const idToDelete = attemptIdRef.current;
                  attemptIdRef.current = null;
                  // fire & forget — pas d'await pour ne pas bloquer la navigation
                  supabase
                    .from("exercise_attempts")
                    .delete()
                    .eq("id", idToDelete)
                    .then(() => {});
                }

                if (onNextClick) {
                  setIsNextLoading(true);
                  try {
                    if(engineRef.current) await onNextClick(hasErrors,engineRef.current.sessionId);
                    else await onNextClick(hasErrors);
                  } catch (e) {
                    console.error(e);
                  } finally {
                    setIsNextLoading(false);
                    feedbackPendingRef.current = false;
                  }
                } else {
                  proceedToNext();
                }
              }}
              disabled={isNextLoading || isFeedbackOpen}
              className="group flex items-center gap-1 sm:gap-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-gradient-to-r from-gray-500 to-gray-700 text-white rounded-lg font-bold shadow hover:shadow-lg transition-all disabled:opacity-70 text-xs sm:text-sm"
              style={{ minHeight: 0 }}
            >
              Passer
            </button>
          )}
          <button
            onClick={() => setIsHelpOpen(true)}
            className="p-1.5 sm:p-2 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors"
            title="Aide - Comment répondre ?"
          >
            <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          <button
            onClick={() => {
              setIsFeedbackDifficultyOnly(false);
              setIsFeedbackOpen(true);
            }}
            className="p-1.5 sm:p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            title="Signaler un problème"
          >
            <Flag className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          {isExerciseFinished && (
            <div
              className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full border animate-in zoom-in ${hasErrors ? "text-orange-600 bg-orange-50 border-orange-100" : "text-green-600 bg-green-50 border-green-100"}`}
            >
              {hasErrors ? (
                <Flag className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
              )}
              <span className="font-bold text-xs sm:text-sm">
                {hasErrors ? "Terminé" : "Validé !"}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-lg p-3 sm:p-6 border border-slate-100 relative">
        <ExerciseRenderer
          exercise={exercise}
          preGeneratedVariables={variables}
          onElementSubmit={handleElementSubmit}
          engineSession={engineSession??undefined}
          onGrade={async(questionId,answer)=>{
            const current=engineRef.current;if(!current) throw new Error("Instance indisponible");
            const r=await exerciseOperation({action:"answer",sessionId:current.sessionId,questionId,answer});
            if(r.kind!=="engine") throw new Error("Correction indisponible");
            engineRef.current=r.session;setEngineSession(r.session);
            setIsExerciseFinished(r.session.status==="completed");setHasErrors(r.session.status==="completed"&&!r.session.correct);
            if(r.session.status==="completed") {
              setLastSaveStatus("saved");
              if(isGuest && await getGuestAttemptCount()>=GUEST_EXERCISE_LIMIT) onGuestLimitReached?.();
            }
            return r.session.questions[questionId];
          }}
        />

        {isExerciseFinished && (
          <div className="mt-4 sm:mt-8 flex flex-col sm:flex-row justify-between items-center gap-3 animate-in slide-in-from-bottom-4 fade-in duration-500 border-t pt-4 sm:pt-6 border-slate-100">
            <button
              onClick={() => {
                setIsFeedbackDifficultyOnly(false);
                setIsFeedbackOpen(true);
              }}
              className="text-slate-500 hover:text-indigo-600 text-xs sm:text-sm font-medium flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-2 rounded-lg transition-colors"
            >
              <MessageSquare className="w-4 h-4" /> Donner mon avis sur cet
              exercice
            </button>

            <div className="flex gap-3">
              <button
                onClick={handleNextExercise}
                disabled={isNextLoading || isFeedbackOpen}
                className="group flex items-center gap-2 px-4 py-2.5 sm:px-6 sm:py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-xl font-bold shadow-lg hover:shadow-xl transition-all disabled:opacity-70 text-sm sm:text-base"
              >
                {isNextLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />{" "}
                    Chargement…
                  </>
                ) : (
                  <>
                    Exercice Suivant{" "}
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExerciseLoader;
