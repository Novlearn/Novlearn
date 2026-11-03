"use client";

import {
  ArrowLeft,
  Book,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useFlashcards } from "./useFlashcards";
import { useAuth } from "../contexts/AuthContext";
import {
  dbToUiDifficulty,
  uiToDbDifficulty,
  type DifficultyUi,
  type ExerciseListItem,
} from "../lib/exerciseUtils";
import { supabase } from "../lib/supabase";
import { useTaxonomyStore } from "../store/useTaxonomyStore";
// ON SUPPRIME L'IMPORT DE flashcardsData ICI
// import { flashCardsData } from "../lib/flashcardsData";
import MathText from "../components/ui/MathText";

interface Chapter {
  id: string;
  name: string;
  emoji: string;
  notSeenYet: boolean;
}

// Interface pour la DB
export function TrainingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const chapters_list = useTaxonomyStore((state) => state.chapters);
  const chapterEmojis = useTaxonomyStore((state) => state.chapterEmojis);

  // Construction dynamique de la liste des chapitres basée sur le store
  const chapters: Chapter[] = useMemo(() => {
    return chapters_list.map((name) => ({
      id: name,
      name: name,
      emoji: chapterEmojis[name] ?? "📚",
      notSeenYet: false,
    }));
  }, [chapters_list, chapterEmojis]);

  // chapterStates[id] = true signifie "pas encore vu" (caché des reco)
  const [chapterStates, setChapterStates] = useState<Record<string, boolean>>({});
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<"exercises" | "course" | null>(
    null,
  );
  const [selectedExerciseType, setSelectedExerciseType] = useState<
    "flash" | "long" | null
  >(null);

  // États exercices...
  const [chapterHasExercises, setChapterHasExercises] = useState<
    Record<string, boolean>
  >({});
  const [chapterExercises, setChapterExercises] = useState<ExerciseListItem[]>(
    [],
  );
  const [chapterExercisesLoading, setChapterExercisesLoading] = useState(false);
  const [selectedDifficulty, setSelectedDifficulty] =
    useState<DifficultyUi | null>(null);
  const [isSearchingExercise, setIsSearchingExercise] = useState(false);

  const {
    flashcards,
    flashcardsLoading,
    currentFlashCardIndex,
    isFlipped,
    setIsFlipped,
    handleNextCard,
    handlePrevCard,
    resetCards,
  } = useFlashcards(selectedChapter, selectedTab);


  // Charger les chapitres "pas encore vus" depuis le profil utilisateur
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("hidden_chapters")
        .eq("id", user.id)
        .single();
      if (cancelled || error || !data) return;
      const hidden: string[] = data.hidden_chapters ?? [];
      setChapterStates(
        hidden.reduce((acc, name) => ({ ...acc, [name]: true }), {} as Record<string, boolean>),
      );
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Vérifier quels chapitres ont des exercices en base
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("exercises")
        .select("chapter");
      if (cancelled || error) return;
      const chapterNames = new Set(
        (data || []).map((r) => (r.chapter || "").trim()).filter(Boolean),
      );
      const byId: Record<string, boolean> = {};
      chapters.forEach((c) => {
        // La comparaison se fait maintenant directement sur le nom du chapitre
        byId[c.id] = chapterNames.has(c.name);
      });
      setChapterHasExercises(byId);
    })();
    return () => {
      cancelled = true;
    };
  }, [chapters]);

  // Charger les exercices du chapitre sélectionné
  useEffect(() => {
    if (!selectedChapter || selectedTab !== "exercises") {
      setChapterExercises([]);
      return;
    }
    // selectedChapter est ici le nom du chapitre (car id = name)
    const chapterNameInDb = selectedChapter;

    let cancelled = false;
    setChapterExercisesLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("exercises")
        .select("id, title, app_title, chapter, difficulty")
        .eq("chapter", chapterNameInDb);
      if (cancelled) return;
      setChapterExercisesLoading(false);
      if (error) {
        setChapterExercises([]);
        return;
      }
      const list: ExerciseListItem[] = (data || []).map((r: any) => ({
        id: r.id,
        // Always use public app_title when available
        title: (r.app_title as string | null) ?? (r.title as string | null) ?? null,
        chapter: r.chapter ?? "",
        difficulty: r.difficulty ?? "",
      }));
      setChapterExercises(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedChapter, selectedTab]);


  const handleToggleNotSeen = async (chapterId: string) => {
    const newState = !chapterStates[chapterId];
    const newStates = { ...chapterStates, [chapterId]: newState };
    setChapterStates(newStates);

    if (!user) return;
    const hiddenList = Object.entries(newStates)
      .filter(([, hidden]) => hidden)
      .map(([name]) => name);
    await supabase
      .from("profiles")
      .update({ hidden_chapters: hiddenList })
      .eq("id", user.id);
  };

  const handleChapterClick = (chapterId: string) => {
    setSelectedChapter(chapterId);
    setSelectedTab(null);
    setSelectedExerciseType(null);
    setSelectedDifficulty(null);
    resetCards();
  };

  const handleBack = () => {
    if (selectedExerciseType) {
      setSelectedExerciseType(null);
    } else if (selectedTab) {
      setSelectedTab(null);
    } else {
      setSelectedChapter(null);
    }
  };

  const handleStartChapterExercise = async () => {
    if (!selectedChapter) return;
    setIsSearchingExercise(true);

    try {
      if (selectedDifficulty) {
        // Difficulty selected: random exercise in that level
        const chapterNameInDb = selectedChapter;
        let query = supabase
          .from("exercises")
          .select("id")
          .eq("chapter", chapterNameInDb);

        const dbDiff = uiToDbDifficulty(selectedDifficulty);
        query = query.or(
          `difficulty.eq.${dbDiff},difficulty.eq.${selectedDifficulty}`,
        );

        const { data, error } = await query;
        if (error) throw error;

        if (!data || data.length === 0) {
          alert(`Aucun exercice ${selectedDifficulty} pour ce chapitre.`);
          setIsSearchingExercise(false);
          return;
        }

        const randomIndex = Math.floor(Math.random() * data.length);
        const randomExerciseId = data[randomIndex].id;
        router.push(`/exercices?id=${randomExerciseId}`);
      } else {
        // No difficulty: use recommendation (placement test + adaptive exo)
        router.push(
          `/exercices?chapter=${encodeURIComponent(selectedChapter)}`,
        );
      }
    } catch (err) {
      console.error("Erreur lors de la recherche d'exercice :", err);
      alert("Impossible de charger un exercice pour le moment.");
    } finally {
      setIsSearchingExercise(false);
    }
  };

  // ----------------------------------------------------------------------------------
  // RENDER : ASTUCES (Flashcards)
  // ----------------------------------------------------------------------------------
  if (selectedChapter && selectedTab === "course") {
    const currentChapter = chapters.find((c) => c.id === selectedChapter);
    const currentCard = flashcards[currentFlashCardIndex];

    return (
      <div className="flex-1 flex items-center justify-center px-4 md:px-8 pb-8">
        <div className="max-w-4xl w-full space-y-6">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 bg-slate-700/50 hover:bg-slate-600/60 rounded-xl px-4 py-3 transition-all"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
            <span
              className="text-white"
              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600 }}
            >
              Retour
            </span>
          </button>

          <div className="text-center">
            <h2
              className="text-4xl md:text-5xl tracking-tight bg-gradient-to-r from-white via-blue-100 to-white bg-clip-text text-transparent drop-shadow-[0_2px_8px_rgba(59,130,246,0.5)]"
              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}
            >
              Astuces - {currentChapter?.name}
            </h2>
          </div>

          {flashcardsLoading ? (
            <div className="bg-slate-800/60 backdrop-blur-sm rounded-3xl p-12 text-center shadow-md">
              <Loader2 className="w-10 h-10 text-blue-400 animate-spin mx-auto" />
              <p className="text-blue-200 mt-4">Chargement des astuces...</p>
            </div>
          ) : flashcards.length === 0 ? (
            <div className="bg-slate-800/60 backdrop-blur-sm rounded-3xl p-12 md:p-16 text-center shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)]">
              <p
                className="text-blue-200 text-xl md:text-2xl"
                style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}
              >
                Les fiches d'astuces pour ce chapitre arrivent bientôt.
              </p>
              <p
                className="text-slate-400 mt-2"
                style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 400 }}
              >
                À venir
              </p>
            </div>
          ) : (
            <div className="bg-slate-800/60 backdrop-blur-sm rounded-3xl p-8 md:p-12 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)]">
              <div className="flex items-center justify-between mb-6">
                <button
                  onClick={handlePrevCard}
                  className="p-3 bg-slate-700/50 hover:bg-slate-600/60 rounded-xl transition-all"
                >
                  <ChevronLeft className="w-6 h-6 text-white" />
                </button>

                <span
                  className="text-blue-200"
                  style={{
                    fontFamily: "'Fredoka', sans-serif",
                    fontWeight: 600,
                  }}
                >
                  {currentFlashCardIndex + 1} / {flashcards.length}
                </span>

                <button
                  onClick={handleNextCard}
                  className="p-3 bg-slate-700/50 hover:bg-slate-600/60 rounded-xl transition-all"
                >
                  <ChevronRight className="w-6 h-6 text-white" />
                </button>
              </div>

              <div
                onClick={() => setIsFlipped(!isFlipped)}
                className="bg-gradient-to-br from-blue-500 to-purple-600 rounded-3xl p-8 md:p-12 min-h-[300px] flex items-center justify-center cursor-pointer hover:scale-105 transition-transform shadow-2xl relative"
                style={{ perspective: "1000px" }}
              >
                {/* UTILISATION DE MATHTEXT POUR LE LATEX 
                   On change la couleur du texte en blanc via une classe ou un style wrapper
                */}
                <div className="text-white text-center text-xl md:text-2xl font-semibold select-none w-full">
                  <MathText
                    content={
                      isFlipped ? currentCard.answer : currentCard.question
                    }
                    className="text-white"
                  />
                </div>
              </div>

              <p
                className="text-blue-200 text-center mt-4"
                style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}
              >
                Cliquez sur la carte pour voir{" "}
                {isFlipped ? "la question" : "la réponse"}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------------------------
  // RENDER : SELECTION EXERCICE
  // ----------------------------------------------------------------------------------
  if (selectedChapter && selectedTab === "exercises") {
    const currentChapter = chapters.find((c) => c.id === selectedChapter);
    const difficulties: (DifficultyUi | null)[] = [
      null,
      "Facile",
      "Moyen",
      "Difficile",
    ];
    const filteredExercises = selectedDifficulty
      ? chapterExercises.filter(
          (ex) => dbToUiDifficulty(ex.difficulty) === selectedDifficulty,
        )
      : chapterExercises;

    return (
      <div className="flex-1 flex items-center justify-center px-4 md:px-8 pb-8">
        <div className="max-w-4xl w-full space-y-6">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 bg-slate-700/50 hover:bg-slate-600/60 rounded-xl px-4 py-3 transition-all"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
            <span
              className="text-white"
              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600 }}
            >
              Retour
            </span>
          </button>

          <div className="text-center">
            <h2
              className="text-4xl md:text-5xl tracking-tight bg-gradient-to-r from-white via-blue-100 to-white bg-clip-text text-transparent drop-shadow-[0_2px_8px_rgba(59,130,246,0.5)]"
              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}
            >
              Exercices - {currentChapter?.name}
            </h2>
          </div>

          {/* Difficulty filter */}
          <div className="flex flex-wrap justify-center gap-2">
            {difficulties.map((d) => (
              <button
                key={d ?? "all"}
                onClick={() => setSelectedDifficulty(d)}
                className={`px-4 py-2 rounded-xl font-semibold transition-all ${
                  selectedDifficulty === d
                    ? "bg-blue-500 text-white"
                    : "bg-slate-700/60 text-blue-200 hover:bg-slate-600/60"
                }`}
                style={{ fontFamily: "'Fredoka', sans-serif" }}
              >
                {d ?? "Tous"}
              </button>
            ))}
          </div>

          {/* Random exercise button */}
          <div className="bg-slate-800/60 backdrop-blur-sm rounded-3xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)]">
            <button
              onClick={handleStartChapterExercise}
              disabled={isSearchingExercise || filteredExercises.length === 0}
              className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSearchingExercise ? (
                <Loader2 className="w-6 h-6 text-white animate-spin" />
              ) : (
                <span className="text-2xl">⚡</span>
              )}
              <span
                className="text-white text-xl font-bold"
                style={{ fontFamily: "'Fredoka', sans-serif" }}
              >
                {isSearchingExercise
                  ? "Chargement..."
                  : `Lancer un exercice aléatoire${
                      selectedDifficulty ? ` (${selectedDifficulty})` : ""
                    }`}
              </span>
            </button>
            {filteredExercises.length === 0 && !chapterExercisesLoading && (
              <p className="text-blue-200/80 text-sm mt-2 text-center">
                Aucun exercice pour ce filtre.
              </p>
            )}
          </div>

          {/* List of exercises */}
          <div className="space-y-3">
            <h3
              className="text-white text-lg font-bold"
              style={{ fontFamily: "'Fredoka', sans-serif" }}
            >
              Ou choisir un exercice
            </h3>
            {chapterExercisesLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
              </div>
            ) : filteredExercises.length === 0 ? (
              <p className="text-blue-200/80 text-sm">
                Aucun exercice disponible pour ce chapitre
                {selectedDifficulty ? ` en ${selectedDifficulty}` : ""}.
              </p>
            ) : (
              <ul className="space-y-2">
                {filteredExercises.map((ex) => {
                  const uiDiff = dbToUiDifficulty(ex.difficulty);
                  return (
                    <li key={ex.id}>
                      <button
                        onClick={() => router.push(`/exercices?id=${ex.id}`)}
                        className="w-full text-left bg-slate-800/60 hover:bg-slate-700/60 rounded-xl px-4 py-3 flex items-center justify-between gap-2 transition-all"
                      >
                        <span className="text-white truncate">
                          {ex.title ?? "Exercice"}
                        </span>
                        {uiDiff && (
                          <span
                            className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-bold ${
                              uiDiff === "Difficile"
                                ? "bg-red-500/20 text-red-200"
                                : uiDiff === "Moyen"
                                  ? "bg-yellow-500/20 text-yellow-200"
                                  : "bg-green-500/20 text-green-200"
                            }`}
                          >
                            {uiDiff}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Placeholder: long exercise */}
          <button
            onClick={() => setSelectedExerciseType("long")}
            className="w-full bg-slate-800/40 rounded-2xl p-4 flex items-center gap-3 opacity-70"
          >
            <span className="text-3xl">📝</span>
            <span
              className="text-blue-200/80 text-lg font-semibold"
              style={{ fontFamily: "'Fredoka', sans-serif" }}
            >
              Exercice long (bientôt)
            </span>
          </button>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------------------------
  // RENDER : PLACEHOLDER EXERCICE LONG
  // ----------------------------------------------------------------------------------
  if (
    selectedChapter &&
    selectedTab === "exercises" &&
    selectedExerciseType === "long"
  ) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 md:px-8 pb-8">
        <div className="max-w-4xl w-full space-y-6">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 bg-slate-700/50 hover:bg-slate-600/60 rounded-xl px-4 py-3 transition-all"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
            <span
              className="text-white"
              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600 }}
            >
              Retour
            </span>
          </button>
          <div className="bg-slate-800/60 backdrop-blur-sm rounded-3xl p-12 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)]">
            <p
              className="text-white text-center text-xl"
              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600 }}
            >
              Cette option n'est pas encore disponible
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------------------------
  // RENDER : SELECTION TAB (Exercices vs Astuces)
  // ----------------------------------------------------------------------------------
  if (selectedChapter) {
    const currentChapter = chapters.find((c) => c.id === selectedChapter);
    const isNotSeen = chapterStates[selectedChapter];

    return (
      <div className="flex-1 flex items-center justify-center px-4 md:px-8 pb-8">
        <div className="max-w-4xl w-full space-y-6">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 bg-slate-700/50 hover:bg-slate-600/60 rounded-xl px-4 py-3 transition-all"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
            <span
              className="text-white"
              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600 }}
            >
              Retour
            </span>
          </button>

          <div className="text-center">
            <h2
              className="text-4xl md:text-5xl tracking-tight bg-gradient-to-r from-white via-blue-100 to-white bg-clip-text text-transparent drop-shadow-[0_2px_8px_rgba(59,130,246,0.5)]"
              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}
            >
              {currentChapter?.emoji} {currentChapter?.name}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <button
              onClick={() => setSelectedTab("exercises")}
              className="bg-slate-800/60 backdrop-blur-sm rounded-3xl p-12 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)] hover:scale-105 transition-transform"
            >
              <div className="text-center">
                <Dumbbell className="w-16 h-16 mx-auto mb-4 text-blue-400" />
                <h3
                  className="text-white text-2xl"
                  style={{
                    fontFamily: "'Fredoka', sans-serif",
                    fontWeight: 700,
                  }}
                >
                  Exercices
                </h3>
              </div>
            </button>

            <button
              onClick={() => setSelectedTab("course")}
              className="bg-slate-800/60 backdrop-blur-sm rounded-3xl p-12 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)] hover:scale-105 transition-transform"
            >
              <div className="text-center">
                <Book className="w-16 h-16 mx-auto mb-4 text-purple-400" />
                <h3
                  className="text-white text-2xl"
                  style={{
                    fontFamily: "'Fredoka', sans-serif",
                    fontWeight: 700,
                  }}
                >
                  Astuces
                </h3>
              </div>
            </button>
          </div>

          <button
            onClick={() => handleToggleNotSeen(selectedChapter)}
            className={`w-full flex items-center gap-3 rounded-2xl p-4 transition-all shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)] ${
              isNotSeen
                ? "bg-purple-900/40 border border-purple-500/40"
                : "bg-slate-800/60 hover:bg-slate-700/60"
            }`}
          >
            {isNotSeen ? (
              <EyeOff className="w-5 h-5 text-purple-300 flex-shrink-0" />
            ) : (
              <Eye className="w-5 h-5 text-slate-400 flex-shrink-0" />
            )}
            <span
              className={`${isNotSeen ? "text-purple-200" : "text-slate-300"}`}
              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600 }}
            >
              {isNotSeen ? "Pas encore vu — cliquer pour marquer comme vu" : "Je n'ai pas encore vu ce chapitre"}
            </span>
          </button>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------------------------
  // RENDER : ACCUEIL (Liste des chapitres)
  // ----------------------------------------------------------------------------------
  return (
    <div className="flex-1 flex items-center justify-center px-4 md:px-8 pb-8">
      <div className="max-w-6xl w-full space-y-6">
        <div className="text-center">
          <h2
            className="text-4xl md:text-5xl tracking-tight bg-gradient-to-r from-white via-blue-100 to-white bg-clip-text text-transparent drop-shadow-[0_2px_8px_rgba(59,130,246,0.5)]"
            style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}
          >
            S'entraîner
          </h2>
          <p
            className="text-blue-200 mt-2 drop-shadow-md"
            style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}
          >
            Choisissez un chapitre pour commencer
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {chapters.map((chapter) => {
            const hasExercises = chapterHasExercises[chapter.id];
            const isNotSeen = !!chapterStates[chapter.id];
            return (
              <div key={chapter.id} className="relative group">
                <button
                  onClick={() => handleChapterClick(chapter.id)}
                  className={`w-full bg-slate-800/60 backdrop-blur-sm rounded-3xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)] hover:scale-105 transition-transform ${
                    isNotSeen ? "opacity-50" : ""
                  }`}
                >
                  <div className="text-center">
                    <div className="text-5xl mb-3">{chapter.emoji}</div>
                    <h3
                      className="text-white"
                      style={{
                        fontFamily: "'Fredoka', sans-serif",
                        fontWeight: 700,
                        fontSize: "1.125rem",
                      }}
                    >
                      {chapter.name}
                    </h3>
                    {isNotSeen ? (
                      <p className="text-purple-300/80 text-xs mt-1 font-semibold">
                        Pas encore vu
                      </p>
                    ) : !hasExercises ? (
                      <p className="text-blue-200/80 text-xs mt-1">
                        (Astuces seulement)
                      </p>
                    ) : null}
                  </div>
                </button>
                {/* Toggle "pas encore vu" — coin supérieur droit */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleNotSeen(chapter.id);
                  }}
                  title={isNotSeen ? "Marquer comme vu" : "Marquer comme pas encore vu"}
                  className={`absolute top-3 right-3 p-1.5 rounded-full transition-all ${
                    isNotSeen
                      ? "bg-purple-500/30 text-purple-300 opacity-100"
                      : "bg-slate-700/50 text-slate-400 opacity-0 group-hover:opacity-100"
                  }`}
                >
                  {isNotSeen ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
