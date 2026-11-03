"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MathText } from "../components/ui";
import {
  AnswerFormat,
  EquationContent,
  RendererProps,
} from "../types/exercise";
import { checkAnswer } from "../utils/math/evaluation";
import { simplifyLatexExpression } from "../utils/math/simplification";

interface EquationRendererProps extends RendererProps<EquationContent> {
  onSubmit?: (answer: string, isCorrect: boolean) => void;
}

const EquationRenderer: React.FC<EquationRendererProps> = ({
  content,
  variables,
  onSubmit,
}) => {
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "warning" | "info";
    message: string;
  } | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  // Réponse attendue simplifiée (pour l'affichage)
  const simplifiedCorrectAnswer = useMemo(() => {
    if (!content.correctAnswer) return "";
    return simplifyLatexExpression(content.correctAnswer, variables);
  }, [content.correctAnswer, variables]);

  useEffect(() => {
    setAnswer("");
    setFeedback(null);
    setIsSubmitted(false);
    setIsCorrect(false);
  }, [variables]);

  const handleSubmit = useCallback(() => {
    if (!answer.trim()) {
      setFeedback({ type: "warning", message: "Veuillez entrer une réponse." });
      return;
    }

    if (content.requireAnswer && content.correctAnswer) {
      // Mapping de l'ancien format "numeric" vers "number" pour rétrocompatibilité
      let format: AnswerFormat = content.answerType || "number";
      if ((format as string) === "numeric") format = "number";

      // Vérification avec le format approprié
      const correct = checkAnswer(
        answer,
        content.correctAnswer,
        variables,
        format,
      );

      setIsCorrect(correct);
      setFeedback({
        type: correct ? "success" : "error",
        message: correct ? "✓ Bravo ! Bonne réponse !" : "✗ Incorrect.",
      });
      setIsSubmitted(true);
      onSubmit?.(answer, correct);
    } else {
      setFeedback({ type: "info", message: "Réponse enregistrée." });
      onSubmit?.(answer, true);
    }
  }, [answer, content, variables, onSubmit]);

  return (
    <div className="p-5 bg-white/95 rounded-2xl shadow-md border border-gray-100 dark:bg-slate-800/95 dark:border-slate-700">
      <div className="bg-blue-50 rounded-xl p-6 flex justify-center mb-4 dark:bg-blue-950/20">
        <MathText
          content={`$$${content.latex}$$`}
          variables={variables}
          displayMode={true}
          className="text-xl text-gray-800 dark:text-slate-200"
        />
      </div>

      {content.requireAnswer && (
        <>
          <div className="flex gap-3 items-center flex-wrap">
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && !isSubmitted && handleSubmit()
              }
              disabled={isSubmitted}
              className="flex-1 min-w-[200px] px-4 py-3 rounded-xl border-2 border-gray-200
                         focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200
                         disabled:opacity-50 transition-all
                         dark:bg-slate-700 dark:border-slate-600 dark:text-slate-200 dark:placeholder-slate-400 dark:focus:border-blue-400 dark:focus:ring-blue-900/40"
              placeholder={
                content.answerType === "set"
                  ? "Ex: {1; 2}"
                  : content.answerType === "interval"
                    ? "Ex: ]-∞; 2] ou [1; 5["
                    : content.answerType === "expression"
                      ? "Ex: 2x + 1"
                      : content.answerType === "fraction"
                        ? "Ex: 3/4"
                        : "Votre réponse..."
              }
            />
            <button
              onClick={handleSubmit}
              disabled={isSubmitted}
              className="px-6 py-3 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              Vérifier
            </button>
          </div>

          {feedback && (
            <div
              className={`mt-4 p-4 rounded-xl border ${
                feedback.type === "success"
                  ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/30 dark:border-green-800/60 dark:text-green-300"
                  : feedback.type === "error"
                    ? "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800/60 dark:text-red-300"
                    : "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/30 dark:border-blue-800/60 dark:text-blue-300"
              }`}
            >
              <p>{feedback.message}</p>
              {/* Affichage de la réponse attendue si incorrect */}
              {feedback.type === "error" && simplifiedCorrectAnswer && (
                <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200 dark:bg-slate-700 dark:border-slate-600">
                  <span className="font-bold text-sm uppercase text-slate-500 tracking-wider dark:text-slate-400">
                    Réponse attendue :
                  </span>
                  <span className="ml-2 font-bold text-lg text-slate-800 dark:text-slate-200">
                    <MathText
                      content={`$${simplifiedCorrectAnswer}$`}
                      variables={{}}
                      displayMode={false}
                    />
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default EquationRenderer;
