/**
 * API client for Novlearn backend
 *
 * In production, API_URL should be empty so requests go through Apache proxy.
 * In development, set NEXT_PUBLIC_API_URL=http://localhost:8010
 */

import { supabase } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

async function getAuthHeaders(): Promise<HeadersInit> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    if(process.env.NEXT_PUBLIC_ENGINE_ENABLED==="true") return {"Content-Type":"application/json"};
    throw new Error("Not authenticated");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = await getAuthHeaders();
  const url = `${API_URL}${endpoint}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...headers,
        ...options.headers,
      },
    });
  } catch (fetchError: any) {
    clearTimeout(timeoutId);
    if (fetchError.name === "AbortError") {
      throw new Error(
        "Request timeout: Le serveur ne répond pas. Vérifiez que le backend est lancé sur http://localhost:8010",
      );
    }
    if (
      fetchError.message?.includes("Failed to fetch") ||
      fetchError.message?.includes("NetworkError") ||
      fetchError.message?.includes("Network request failed")
    ) {
      throw new Error(
        "Impossible de se connecter au backend. Vérifiez que le serveur est lancé sur http://localhost:8010",
      );
    }
    throw fetchError;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

// ============================================
// RECOMMENDATION API
// ============================================

export interface RecommendExerciseResponse {
  exercise_id: number;
  competence_id: string | null; // Keep for backward compatibility
  competences?: string[]; // Array of competences (preferred)
  difficulty_level: number;
  difficulty: string;
  mode?: "test" | "recommendation";
  chapter?: string;
}

/**
 * Recommande un exercice pour l'utilisateur connecté.
 * chapter (optionnel) : limiter au chapitre (streak et exos de ce chapitre).
 * Retourne null si non connecté, 404 ou erreur (fallback = exercice aléatoire côté Loader).
 * Si test de placement non complété, retourne un exo de test (mode: "test").
 */
export async function getRecommendedExercise(
  chapter?: string | null,
): Promise<RecommendExerciseResponse | null> {
  try {
    const endpoint = chapter
      ? `/api/recommend-exercise?chapter=${encodeURIComponent(chapter)}`
      : "/api/recommend-exercise";
    return await apiRequest<RecommendExerciseResponse>(endpoint);
  } catch {
    return null;
  }
}

export interface ChapterTestNextResponse {
  exercise_id?: number;
  competence_id?: string;
  competences?: string[];
  difficulty_level?: number;
  difficulty?: string;
  mode?: "test";
  chapter?: string;
  completed?: boolean;
}

/**
 * Récupère le prochain exercice du test de placement après complétion.
 * Body: { chapter, last_success }.
 */
export async function postChapterTestNext(
  chapter: string,
  lastSuccess: boolean,
  engineSessionId?:string,
): Promise<ChapterTestNextResponse | null> {
  try {
    return await apiRequest<ChapterTestNextResponse>(
      "/api/chapter-test/next",
      {
        method: "POST",
        body: JSON.stringify({ chapter, last_success: lastSuccess,...(engineSessionId?{engine_session_id:engineSessionId}:{}) }),
      },
    );
  } catch {
    return null;
  }
}

// ============================================
// FRIENDS API
// ============================================

export interface FriendCode {
  code: string;
  invite_link: string;
}

export interface Friend {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  created_at: string | null;
  exercises_completed: number;
  avatar_id?: string;
  avatar_color?: string;
}

export interface FriendRequest {
  id: number;
  from_user_id: string;
  from_user_name: string;
  created_at: string;
}

export const friendsApi = {
  async getFriendCode(): Promise<FriendCode> {
    return apiRequest<FriendCode>("/api/friends/code");
  },

  async addFriendByCode(code: string): Promise<{ message: string }> {
    return apiRequest("/api/friends/add-by-code", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  },

  async getFriends(): Promise<{ friends: Friend[] }> {
    return apiRequest<{ friends: Friend[] }>("/api/friends");
  },

  async getFriendRequests(): Promise<{ requests: FriendRequest[] }> {
    return apiRequest("/api/friends/requests");
  },

  async acceptFriendRequest(requestId: number): Promise<{ message: string }> {
    return apiRequest(`/api/friends/requests/${requestId}/accept`, {
      method: "POST",
    });
  },

  async declineFriendRequest(requestId: number): Promise<{ message: string }> {
    return apiRequest(`/api/friends/requests/${requestId}/decline`, {
      method: "POST",
    });
  },

  async removeFriend(friendId: string): Promise<{ message: string }> {
    return apiRequest(`/api/friends/${encodeURIComponent(friendId)}`, {
      method: "DELETE",
    });
  },
};

// ============================================
// DUELS API
// ============================================

/** Minimal duel row returned by lobby/redirect endpoints (not the live game state). */
export interface DuelLobby {
  id: number;
  player1_id: string;
  player2_id: string;
  status: "waiting" | "active" | "finished";
  created_at: string;
}

export interface DuelRequest {
  id: number;
  from_user_id: string;
  from_user_name: string;
  from_user_avatar_id?: string;
  from_user_avatar_color?: string;
  exercise_title: string;
  created_at: string;
}

export interface DuelHistoryItem {
  id: number;
  opponent_id: string;
  opponent_name: string;
  my_score: number;
  opponent_score: number;
  result: "win" | "loss" | "draw";
  created_at: string | null;
  finished_at: string | null;
}

export const duelsApi = {
  async createDuel(
    friendId: string,
  ): Promise<{ message: string; duel_id: number; duel: DuelLobby }> {
    return apiRequest("/api/duels/create", {
      method: "POST",
      body: JSON.stringify({ friend_id: friendId }),
    });
  },

  async acceptDuel(
    duelId: number,
  ): Promise<{ message: string; duel: DuelLobby }> {
    return apiRequest(`/api/duels/${duelId}/accept`, { method: "POST" });
  },

  async declineDuel(duelId: number): Promise<{ message: string }> {
    return apiRequest(`/api/duels/${duelId}/decline`, { method: "POST" });
  },

  async getPendingDuels(): Promise<{ duels: DuelRequest[] }> {
    return apiRequest("/api/duels/pending");
  },

  async getActiveDuels(): Promise<{ duels: DuelLobby[] }> {
    return apiRequest("/api/duels/active");
  },

  async getHistory(): Promise<{ history: DuelHistoryItem[] }> {
    return apiRequest("/api/duels/history");
  },
};

// ============================================
// DS (DEVOIRS SURVEILLÉS) API
// ============================================

export interface DS {
  id: string;
  title: string;
  deadline: string;
  status: "active" | "expired";
  competence_ids: string[];
  current_streak: number;
  created_at: string;
}

export interface DSCompetenceScore {
  competence_id: string;
  points: number;
  max_points: number;
  updated_at: string;
}

export interface DSDetail extends DS {
  scores: DSCompetenceScore[];
}

export interface DSRecommendation {
  exercise_id: number;
  competence_id: string;
  competences: string[];
  difficulty: string;
  difficulty_level: number;
}

export const dsApi = {
  async createDS(
    title: string,
    deadline: string,
    competenceIds: string[],
  ): Promise<DS> {
    return apiRequest("/api/ds", {
      method: "POST",
      body: JSON.stringify({
        title,
        deadline,
        competence_ids: competenceIds,
      }),
    });
  },

  async getDSList(): Promise<{ ds: DS[] }> {
    return apiRequest("/api/ds");
  },

  async getDSDetail(dsId: string): Promise<DSDetail> {
    return apiRequest(`/api/ds/${encodeURIComponent(dsId)}`);
  },

  async getDSRecommendation(dsId: string): Promise<DSRecommendation> {
    return apiRequest(`/api/ds/${encodeURIComponent(dsId)}/recommend`);
  },

  async deleteDS(dsId: string): Promise<{ message: string }> {
    return apiRequest(`/api/ds/${encodeURIComponent(dsId)}`, {
      method: "DELETE",
    });
  },

  async submitDSAnswer(
    dsId: string,
    exerciseId: string,
    competenceIds: string[],
    isCorrect: boolean,
    difficulty: string,
    engineSessionId?:string,
  ): Promise<{ message: string }> {
    return apiRequest(`/api/ds/${encodeURIComponent(dsId)}/submit`, {
      method: "POST",
      body: JSON.stringify({
        exercise_id: exerciseId,
        competence_ids: competenceIds,
        is_correct: isCorrect,
        difficulty,
        ...(engineSessionId?{engine_session_id:engineSessionId}:{}),
      }),
    });
  },
};
