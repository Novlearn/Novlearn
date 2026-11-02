"use client";
import { useAuth } from "@/app/contexts/AuthContext";
import { supabase } from "@/app/lib/supabase";
import { useCallback } from "react";

import { GUEST_EXERCISE_LIMIT } from "../lib/guestLimits";
export { GUEST_EXERCISE_LIMIT } from "../lib/guestLimits";

export function useGuestMode() {
  const { user } = useAuth();

  // Un user anonyme Supabase a is_anonymous = true
  const isGuest = user?.is_anonymous === true;

  const startGuestSession = useCallback(async () => {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    return data.user;
  }, []);

  const getGuestAttemptCount = useCallback(async (): Promise<number> => {
    if (!user) return 0;
    const { count, error } = await supabase
      .from("exercise_attempts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_guest", true);
    if (error) return 0;
    return count ?? 0;
  }, [user]);

  const hasReachedLimit = useCallback(async (): Promise<boolean> => {
    const count = await getGuestAttemptCount();
    return count >= GUEST_EXERCISE_LIMIT;
  }, [getGuestAttemptCount]);

  // Conversion : même user_id, on attache email + password
  // La progression est automatiquement conservée
  const upgradeAccount = useCallback(
    async (
      email: string,
      password: string,
      firstName: string,
      lastName: string,
      birthDate: string,
    ) => {
      // 1. Attacher les credentials au compte anonyme
      const { data, error } = await supabase.auth.updateUser({
        email,
        password,
        data: {
          first_name: firstName,
          last_name: lastName,
          birth_date: birthDate,
        },
      });
      if (error) throw error;

      // 2. Créer le profil (qui n'existe pas pour les invités)
      if (data.user) {
        await supabase.from("profiles").insert({
          id: data.user.id,
          email,
          first_name: firstName,
          last_name: lastName || null,
          birth_date: birthDate,
          created_at: new Date().toISOString(),
          consent_date: new Date().toISOString(),
        });

        // 3. Marquer les tentatives invité comme régulières (pour les stats)
        await supabase
          .from("exercise_attempts")
          .update({ is_guest: false })
          .eq("user_id", data.user.id);
      }

      return data;
    },
    [],
  );

  return {
    isGuest,
    startGuestSession,
    getGuestAttemptCount,
    hasReachedLimit,
    upgradeAccount,
  };
}
