"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Lightbulb,
  XCircle,
} from "lucide-react";
import React, { useMemo, useState } from "react";
import { MathInput } from "../components/ui/MathInput";
import MathText from "../components/ui/MathText";
import { useAudioFeedback } from "../hooks/useAudioFeedback";
import { QuestionContent, VariableValues } from "../types/exercise";
import { checkAnswer } from "../utils/math/evaluation";
import { simplifyLatexExpression } from "../utils/math/simplification";

interface QuestionRendererProps {
  content: QuestionContent;
  variables: VariableValues;
  onSubmit?: (answer: string, isCorrect: boolean) => void;
  /** Max wrong attempts before marking as finished (default 2). Use a high number for unlimited (e.g. duel mode). */
  maxAttempts?: number;
  /** Whether to show the hint button and content (default true). Set false for duel mode. */
  allowHint?: boolean;
}

const QuestionRenderer: React.FC<QuestionRendererProps> = ({
  content,
  variables,
  onSubmit,
  maxAttempts = 2,
  allowHint = true,
}) => {
  const { playSuccess, playError } = useAudioFeedback();
  const [value, setValue] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [status, setStatus] = useState<"idle" | "correct" | "incorrect">(
    "idle",
  );

  const [showHint, setShowHint] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);

  const simplifiedCorrectAnswer = useMemo(() => {
    return simplifyLatexExpression(content.correctAnswer, variables);
  }, [content.correctAnswer, variables]);

  // Génère le placeholder adapté au format de réponse
  const getPlaceholder = (): string => {
    if (isFinished) {
      return status === "correct" ? "Réponse validée" : "Terminé";
    }
    switch (content.answerFormat) {
      case "interval":
        return "Ex: ]-∞; 2] ou [1; 5[";
      case "set":
        return "Ex: {-1; 2; 5}";
      case "expression":
        return "Ex: 2x + 1";
      case "fraction":
        return "Ex: 3/4";
      default:
        return "Votre réponse...";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || isFinished) return;

    const currentAttempt = attempts + 1;
    setAttempts(currentAttempt);

    const isCorrect = checkAnswer(
      value,
      content.correctAnswer,
      variables,
      content.answerFormat,
    );

    if (isCorrect) {
      setStatus("correct");
      setIsFinished(true);
      setShowExplanation(true);
      playSuccess();
      if (onSubmit) onSubmit(value, true);
    } else {
      setStatus("incorrect");
      playError();
      if (currentAttempt >= maxAttempts) {
        setIsFinished(true);
        if (onSubmit) onSubmit(value, false);
      }
    }
  };

  const formatForDisplay = (latex: string) => {
    if (!latex) return "";
    return latex.includes("$") ? latex : `$${latex}$`;
  };

  return (
    <div
      className={`my-6 p-6 rounded-xl shadow-sm border transition-all duration-500 ${
        isFinished && status === "correct"
          ? "bg-green-50/30 border-green-200"
          : isFinished && status === "incorrect"
            ? "bg-red-50/30 border-red-200"
            : "bg-white border-slate-200"
      }`}
    >
      {/* --- EN-TÊTE QUESTION --- */}
      <div className="flex gap-3 mb-6">
        <div
          className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full font-bold text-sm transition-colors
          ${
            isFinished && status === "correct"
              ? "bg-green-100 text-green-700"
              : isFinished && status === "incorrect"
                ? "bg-red-100 text-red-700"
                : "bg-indigo-100 text-indigo-600"
          }`}
        >
          {isFinished ? (status === "correct" ? "✓" : "✗") : "?"}
        </div>
        <div className="flex-grow pt-1">
          <MathText
            content={content.question}
            variables={variables}
            className="font-medium text-lg text-slate-800"
          />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 ml-0 md:ml-11">
        {/* --- ZONE DE SAISIE --- */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-start max-w-2xl">
          <div className="flex-grow">
            <MathInput
              value={value}
              onChange={(val) => {
                setValue(val);
                if (!isFinished && status === "incorrect") setStatus("idle");
              }}
              placeholder={getPlaceholder()}
              disabled={isFinished}
              className="w-full"
            />
          </div>

          <button
            type="submit"
            disabled={!value || isFinished}
            className={`px-6 py-2.5 text-white font-medium rounded-lg transition-all shadow-md active:scale-95 flex-shrink-0 h-fit
              ${
                isFinished
                  ? "bg-slate-400 cursor-not-allowed opacity-50 shadow-none"
                  : "bg-indigo-600 hover:bg-indigo-700 hover:shadow-lg"
              }`}
          >
            {isFinished ? "Validé" : attempts > 0 ? "Réessayer" : "Valider"}
          </button>
        </div>

        {/* --- FEEDBACK wrong answer (no finish yet or last attempt) --- */}
        {!isFinished && status === "incorrect" && (
          <div className="animate-in fade-in slide-in-from-left-2 space-y-3 p-3 bg-orange-50 rounded-lg border border-orange-100">
            <div className="flex items-center gap-2 text-orange-700">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium">
                {maxAttempts <= 2 && maxAttempts - attempts <= 1
                  ? "Ce n'est pas tout à fait ça. Il vous reste un essai !"
                  : "Ce n'est pas tout à fait ça. Réessayez !"}
              </span>
            </div>
            {allowHint &&
              content.hint &&
              (!showHint ? (
                <button
                  type="button"
                  onClick={() => setShowHint(true)}
                  className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-medium hover:underline pl-7"
                >
                  <HelpCircle className="w-4 h-4" />
                  Besoin d'un indice ?
                </button>
              ) : (
                <div className="ml-7 p-3 bg-white text-slate-700 text-sm rounded-lg border border-orange-200 flex gap-2 animate-in fade-in shadow-sm">
                  <HelpCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-indigo-500" />
                  <div>
                    <span className="font-bold block text-xs uppercase mb-1 text-indigo-500">
                      Indice :
                    </span>
                    <MathText content={content.hint} variables={variables} />
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* --- RÉSULTAT FINAL --- */}
        {isFinished && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div
              className={`flex items-center gap-2 text-lg font-bold
              ${status === "correct" ? "text-green-600" : "text-red-600"}`}
            >
              {status === "correct" ? (
                <>
                  <CheckCircle2 className="w-6 h-6" />
                  <span>Excellent ! Bonne réponse.</span>
                </>
              ) : (
                <>
                  <XCircle className="w-6 h-6" />
                  <span>Mince, c'est raté pour cette fois.</span>
                </>
              )}
            </div>

            {/* --- CORRECTION SIMPLIFIÉE --- */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 shadow-sm">
              <span className="font-bold text-sm uppercase text-slate-500 tracking-wider">
                Réponse attendue :
              </span>
              <span className="font-bold text-xl text-slate-800">
                {/* On passe simplifiedCorrectAnswer au lieu de content.correctAnswer */}
                <MathText
                  content={formatForDisplay(simplifiedCorrectAnswer)}
                  variables={{}} // On vide les variables car elles sont déjà substituées
                  displayMode={false}
                />
              </span>
            </div>

            {content.explanation && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowExplanation(!showExplanation)}
                  className="group flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-indigo-600 transition-colors"
                >
                  <div
                    className={`p-1 rounded-full bg-slate-100 group-hover:bg-indigo-100 transition-colors`}
                  >
                    {showExplanation ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </div>
                  {showExplanation
                    ? "Masquer l'explication"
                    : "Voir l'explication de la correction"}
                </button>

                {showExplanation && (
                  <div className="mt-3 p-5 rounded-xl bg-blue-50/50 border border-blue-100 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-start gap-3">
                      <div className="mt-1 p-1.5 bg-blue-100 text-blue-600 rounded-lg">
                        <Lightbulb className="w-5 h-5" />
                      </div>
                      <div className="space-y-1 flex-1">
                        <p className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-1">
                          Détails du raisonnement
                        </p>
                        <div className="text-slate-800 text-base leading-relaxed">
                          <MathText
                            content={content.explanation}
                            variables={variables}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
};

export default QuestionRenderer;