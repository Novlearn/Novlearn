"use client";

/**
 * Flashcards du chapitre selectionne : chargement et navigation circulaire.
 *
 * Le paquet est recharge (et remis a la premiere carte, face question) a
 * chaque changement de chapitre ou d'onglet.
 */
import { useEffect, useState } from "react";

import { supabase } from "../lib/supabase";

export interface FlashCard {
  id: string;
  question: string;
  answer: string;
  chapter: string;
}

export function useFlashcards(
  selectedChapter: string | null,
  selectedTab: "exercises" | "course" | null,
) {
  const [flashcards, setFlashcards] = useState<FlashCard[]>([]);
  const [flashcardsLoading, setFlashcardsLoading] = useState(false);
  const [currentFlashCardIndex, setCurrentFlashCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  useEffect(() => {
    if (!selectedChapter || selectedTab !== "course") {
      setFlashcards([]);
      return;
    }

    let cancelled = false;
    setFlashcardsLoading(true);
    setCurrentFlashCardIndex(0);
    setIsFlipped(false);

    (async () => {
      const { data, error } = await supabase
        .from("flashcards")
        .select("*")
        .eq("chapter", selectedChapter); // selectedChapter = nom du chapitre en DB

      if (cancelled) return;
      setFlashcardsLoading(false);

      if (error) {
        console.error("Erreur flashcards:", error);
        return;
      }
      if (data) {
        setFlashcards(data);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedChapter, selectedTab]);

  const handleNextCard = () => {
    if (flashcards.length > 0) {
      setCurrentFlashCardIndex((prev) => (prev + 1) % flashcards.length);
      setIsFlipped(false);
    }
  };

  const handlePrevCard = () => {
    if (flashcards.length > 0) {
      setCurrentFlashCardIndex(
        (prev) => (prev - 1 + flashcards.length) % flashcards.length,
      );
      setIsFlipped(false);
    }
  };


  /** Revient a la premiere carte, face question. */
  const resetCards = () => {
    setCurrentFlashCardIndex(0);
    setIsFlipped(false);
  };

  return {
    flashcards,
    flashcardsLoading,
    currentFlashCardIndex,
    isFlipped,
    setIsFlipped,
    handleNextCard,
    handlePrevCard,
    resetCards,
  };
}
