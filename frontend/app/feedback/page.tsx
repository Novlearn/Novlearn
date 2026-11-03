"use client";

import { Layout } from "@/app/components/Layout";
import { useAuth } from "@/app/contexts/AuthContext";
import { supabase } from "@/app/lib/supabase";
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  Filter,
  Loader2,
  MessageSquare,
  RefreshCw,
  Star,
  Trash2,
  Calendar,
  Activity,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface Feedback {
  id: string;
  created_at: string;
  message: string;
  category: string;
  difficulty_rating?: number | null;
  exercise_id?: number | null;
  user_id: string | null;
  profiles?: {
    first_name: string;
    last_name: string;
  };
}

interface ExerciseInfo {
  id: number;
  title: string | null;
  app_title: string | null;
}

type FilterType =
  | "all"
  | "rating"
  | "bug"
  | "content_error"
  | "suggestion"
  | "other";

export default function FeedbackDashboard() {
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [exercisesMap, setExercisesMap] = useState<Map<number, string>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [selectedExerciseId, setSelectedExerciseId] = useState<number | null>(
    null,
  );
  const [exerciseFilterOpen, setExerciseFilterOpen] = useState(false);
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/auth/login");
    } else if (user) {
      fetchFeedbacks();
    }
  }, [user, authLoading, router]);

  const fetchFeedbacks = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("feedbacks")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      // Author names use the explicit social projection, including for tutors.
      const authors = new Map<string, { first_name: string; last_name: string }>();
      const authorIds = [...new Set<string>((data || [])
        .map((item: Feedback) => item.user_id)
        .filter((id: string | null): id is string => typeof id === "string"))];
      for (let offset = 0; offset < authorIds.length; offset += 100) {
        const { data: profiles, error: profileError } = await supabase.rpc("get_public_profiles", {
          p_ids: authorIds.slice(offset, offset + 100),
        });
        if (profileError) throw profileError;
        for (const profile of profiles || []) authors.set(profile.id, profile);
      }
      setFeedbacks((data || []).map((item: Feedback) => ({
        ...item, profiles: item.user_id ? authors.get(item.user_id) : undefined,
      })));

      // Récupérer les noms des exercices associés
      const exerciseIds = [
        ...new Set(
          (data || []).filter((f) => f.exercise_id).map((f) => f.exercise_id),
        ),
      ];
      if (exerciseIds.length > 0) {
        const { data: exercisesData } = await supabase
          .from("exercises")
          .select("id, title, app_title")
          .in("id", exerciseIds);

        if (exercisesData) {
          const map = new Map<number, string>();
          exercisesData.forEach((ex: ExerciseInfo) => {
            const publicTitle = ex.app_title ?? ex.title ?? "Exercice";
            map.set(ex.id, publicTitle);
          });
          setExercisesMap(map);
        }
      }
    } catch (error) {
      console.error("Erreur chargement feedbacks:", error);
      toast.error("Impossible de charger les feedbacks.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer ce feedback ?"))
      return;

    try {
      const { error } = await supabase.from("feedbacks").delete().eq("id", id);
      if (error) throw error;
      setFeedbacks((prev) => prev.filter((f) => f.id !== id));
      toast.success("Feedback supprimé");
    } catch (error) {
      console.error("Erreur suppression:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const ratingFeedbacks = feedbacks.filter((f) => f.difficulty_rating !== null);

  // Exercices distincts présents dans les feedbacks avec note
  const exercisesWithRatings = [
    ...new Map(
      ratingFeedbacks
        .filter((f) => f.exercise_id)
        .map((f) => [f.exercise_id, f.exercise_id]),
    ).values(),
  ] as number[];

  const filteredFeedbacks = feedbacks.filter((item) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "rating") {
      if (item.difficulty_rating === null) return false;
      if (selectedExerciseId !== null)
        return item.exercise_id === selectedExerciseId;
      return true;
    }
    return item.category === activeFilter;
  });

  // --- STATS COMPUTATION ---
  const now = new Date();
  
  // Début du mois
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  
  // Début de la semaine (lundi)
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // ajustement pour lundi
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), diff);
  startOfWeek.setHours(0, 0, 0, 0);

  const feedbacksThisMonth = feedbacks.filter(
    (f) => new Date(f.created_at) >= startOfMonth
  ).length;
  
  const feedbacksThisWeek = feedbacks.filter(
    (f) => new Date(f.created_at) >= startOfWeek
  ).length;

  // --- UI HELPERS ---
  const getCategoryBadge = (category: string) => {
    const style =
      "px-3 py-1 rounded-full text-xs font-bold border uppercase tracking-wider flex items-center gap-1";
    switch (category) {
      case "bug":
        return (
          <span
            className={`${style} bg-red-500/20 text-red-300 border-red-500/30`}
          >
            🐛 Bug
          </span>
        );
      case "feature":
      case "suggestion":
        return (
          <span
            className={`${style} bg-blue-500/20 text-blue-300 border-blue-500/30`}
          >
            💡 Suggestion
          </span>
        );
      case "content":
      case "content_error":
        return (
          <span
            className={`${style} bg-purple-500/20 text-purple-300 border-purple-500/30`}
          >
            📝 Contenu
          </span>
        );
      default:
        return (
          <span
            className={`${style} bg-slate-700 text-slate-300 border-slate-600`}
          >
            Autre
          </span>
        );
    }
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`w-4 h-4 ${star <= rating ? "fill-yellow-400 text-yellow-400" : "text-slate-600"}`}
          />
        ))}
      </div>
    );
  };

  if (authLoading)
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="animate-spin text-white" />
      </div>
    );

  return (
    <Layout>
      <div className="flex-1 px-4 md:px-8 pb-8 overflow-y-auto bg-slate-900">
        <div className="max-w-6xl mx-auto pt-8">
          {/* Header */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                <MessageSquare className="text-indigo-500" />
                Dashboard Feedbacks
              </h1>
              <p className="text-slate-400 mt-1">
                {feedbacks.length} retours reçus au total
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row items-center gap-4 self-start lg:self-auto">
              {/* Stats Cards */}
              <div className="flex gap-3">
                <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 flex items-center gap-3">
                  <div className="p-2 bg-indigo-500/10 rounded-lg">
                    <Activity className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs font-medium uppercase">Cette semaine</p>
                    <p className="text-white font-bold text-lg leading-tight">{feedbacksThisWeek}</p>
                  </div>
                </div>
                <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/10 rounded-lg">
                    <Calendar className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs font-medium uppercase">Ce mois-ci</p>
                    <p className="text-white font-bold text-lg leading-tight">{feedbacksThisMonth}</p>
                  </div>
                </div>
              </div>

              <button
                onClick={fetchFeedbacks}
                className="p-3 bg-slate-800 hover:bg-slate-700 rounded-xl border border-slate-700 transition-colors"
                title="Rafraîchir"
              >
                <RefreshCw
                  className={`w-5 h-5 text-white ${loading ? "animate-spin" : ""}`}
                />
              </button>
            </div>
          </div>

          {/* Filtres */}
          <div className="flex flex-wrap gap-2 mb-6">
            <FilterButton
              label="Tout"
              active={activeFilter === "all"}
              onClick={() => {
                setActiveFilter("all");
                setSelectedExerciseId(null);
                setExerciseFilterOpen(false);
              }}
              count={feedbacks.length}
            />
            <FilterButton
              label="Notes Difficulté"
              active={activeFilter === "rating"}
              onClick={() => {
                setActiveFilter("rating");
                setSelectedExerciseId(null);
                setExerciseFilterOpen(false);
              }}
              count={
                feedbacks.filter((f) => f.difficulty_rating !== null).length
              }
            />
            <FilterButton
              label="Erreurs Contenu"
              active={activeFilter === "content_error"}
              onClick={() => {
                setActiveFilter("content_error");
                setSelectedExerciseId(null);
                setExerciseFilterOpen(false);
              }}
              count={
                feedbacks.filter((f) => f.category === "content_error").length
              }
            />
            <FilterButton
              label="Suggestions"
              active={activeFilter === "suggestion"}
              onClick={() => {
                setActiveFilter("suggestion");
                setSelectedExerciseId(null);
                setExerciseFilterOpen(false);
              }}
              count={
                feedbacks.filter((f) => f.category === "suggestion").length
              }
            />
            <FilterButton
              label="Bugs"
              active={activeFilter === "bug"}
              onClick={() => {
                setActiveFilter("bug");
                setSelectedExerciseId(null);
                setExerciseFilterOpen(false);
              }}
              count={feedbacks.filter((f) => f.category === "bug").length}
            />
          </div>

          {/* Sous-filtre par exercice (visible uniquement pour les notes de difficulté) */}
          {activeFilter === "rating" && exercisesWithRatings.length > 0 && (
            <div className="mb-6">
              <button
                onClick={() => setExerciseFilterOpen((o) => !o)}
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors mb-2"
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform duration-200 ${
                    exerciseFilterOpen ? "rotate-180" : ""
                  }`}
                />
                Filtrer par exercice
                {selectedExerciseId !== null && (
                  <span className="ml-1 px-2 py-0.5 rounded-full bg-indigo-600/30 text-indigo-300 text-xs border border-indigo-500/40">
                    #{selectedExerciseId}
                  </span>
                )}
              </button>

              {exerciseFilterOpen && (
                <div className="flex flex-wrap gap-2 pl-2 border-l-2 border-indigo-500/40">
                  <button
                    onClick={() => setSelectedExerciseId(null)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border flex items-center gap-1.5 ${
                      selectedExerciseId === null
                        ? "bg-indigo-600/30 text-indigo-200 border-indigo-500/50"
                        : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700"
                    }`}
                  >
                    <BookOpen className="w-3 h-3" />
                    Tous les exercices
                  </button>
                  {exercisesWithRatings.map((exId) => (
                    <button
                      key={exId}
                      onClick={() => setSelectedExerciseId(exId)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border flex items-center gap-1.5 ${
                        selectedExerciseId === exId
                          ? "bg-indigo-600/30 text-indigo-200 border-indigo-500/50"
                          : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700"
                      }`}
                    >
                      <BookOpen className="w-3 h-3" />
                      {exercisesMap.get(exId) || "Exercice"}
                      <span className="ml-1 text-xs px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-500">
                        {
                          ratingFeedbacks.filter((f) => f.exercise_id === exId)
                            .length
                        }
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Liste */}
          {loading ? (
            <div className="text-center py-12">
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto" />
            </div>
          ) : filteredFeedbacks.length === 0 ? (
            <div className="text-center py-12 bg-slate-800/50 rounded-2xl border border-slate-700">
              <AlertCircle className="w-12 h-12 text-slate-500 mx-auto mb-3" />
              <p className="text-slate-400">
                Aucun feedback dans cette catégorie.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {filteredFeedbacks.map((item) => (
                <div
                  key={item.id}
                  className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-sm hover:border-slate-600 transition-all relative group"
                >
                  {/* En-tête de la carte */}
                  <div className="flex flex-col md:flex-row justify-between gap-4 mb-4">
                    <div className="flex items-center flex-wrap gap-3">
                      {/* Badge Catégorie */}
                      {getCategoryBadge(item.category)}

                      {/* Badge Exercice ID + Nom */}
                      {item.exercise_id && (
                        <div className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border border-indigo-500/30 bg-indigo-500/10 text-indigo-300">
                          <BookOpen className="w-3 h-3" />
                          {exercisesMap.get(item.exercise_id) ||
                            "Exercice"}
                        </div>
                      )}

                      <span className="text-slate-500 text-sm">
                        {new Date(item.created_at).toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="text-slate-600 hover:text-red-400 hover:bg-red-400/10 p-2 rounded-lg transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100"
                        title="Supprimer"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {/* Contenu principal */}
                  <div className="mb-4">
                    {/* Affichage spécial si c'est juste une note */}
                    {item.difficulty_rating ? (
                      <div className="flex items-center gap-3 mb-2 bg-slate-900/50 p-3 rounded-lg border border-slate-700/50 w-fit">
                        <span className="text-slate-300 text-sm font-medium">
                          Difficulté ressentie :
                        </span>
                        {renderStars(item.difficulty_rating)}
                        <span className="text-slate-500 text-xs font-bold">
                          ({item.difficulty_rating}/5)
                        </span>
                      </div>
                    ) : null}

                    {/* Message */}
                    {item.message && (
                      <p className="text-slate-200 text-lg whitespace-pre-wrap leading-relaxed">
                        {item.message}
                      </p>
                    )}
                  </div>

                  {/* Footer : Utilisateur */}
                  <div className="flex items-center justify-between border-t border-slate-700/50 pt-4 mt-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-xs">
                        {item.profiles?.first_name?.[0] || "?"}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-white text-sm font-medium">
                          {item.profiles?.first_name
                            ? `${item.profiles.first_name} ${item.profiles.last_name || ""}`
                            : "Inconnu"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

// Petit composant pour les boutons de filtre
function FilterButton({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border flex items-center gap-2 ${
        active
          ? "bg-indigo-600 text-white border-indigo-500"
          : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200"
      }`}
    >
      {active && <Filter className="w-3 h-3" />}
      {label}
      <span
        className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${active ? "bg-indigo-500 text-white" : "bg-slate-700 text-slate-500"}`}
      >
        {count}
      </span>
    </button>
  );
}
