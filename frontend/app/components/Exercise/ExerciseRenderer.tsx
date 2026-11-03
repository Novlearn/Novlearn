import React, { useMemo } from "react";
// Assurez-vous que le chemin d'import pointe bien vers votre dossier renderers
import EquationRenderer from "../../renderers/EquationRenderer";
import GraphRenderer from "../../renderers/GraphRenderer";
import MCQRenderer from "../../renderers/MCQRenderer";
import QuestionRenderer from "../../renderers/QuestionRenderer";
import SignTableRenderer from "../../renderers/SignTableRenderer";
import TextRenderer from "../../renderers/TextRenderer";
import VariationTableRenderer from "../../renderers/VariationTableRenderer";
import MathText from "../ui/MathText";
import type { ExerciseSession, GradeQuestion } from "../../lib/engine/learnerTypes";

import {
  EquationContent,
  Exercise,
  ExerciseElement,
  GraphContent,
  MCQContent,
  QuestionContent,
  SignTableContent,
  // Types spécifiques
  TextContent,
  VariableValues,
  VariationTableContent,
} from "../../types/exercise";

interface ExerciseRendererProps {
  exercise: Exercise;
  onElementSubmit?: (
    elementId: number,
    answer: unknown,
    isCorrect: boolean,
  ) => void;
  preGeneratedVariables?: VariableValues;
  engineSession?: ExerciseSession;
  onGrade?: (questionId:string,answer:Parameters<GradeQuestion>[0])=>ReturnType<GradeQuestion>;
}

interface ElementRendererProps {
  element: ExerciseElement;
  variables: VariableValues;
  // Callback unifié : la réponse + est-ce correct
  onChildSubmit?: (answer: unknown, isCorrect: boolean) => void;
  gradeAnswer?: GradeQuestion;
  initialResult?: import("../../lib/engine/learnerTypes").QuestionResult;
  optionIds?:string[];
}

/**
 * Composant dispatcher : choisit le bon renderer selon le type
 */
const ElementRenderer: React.FC<ElementRendererProps> = ({
  element,
  variables,
  onChildSubmit,
  gradeAnswer,initialResult,optionIds,
}) => {
  switch (element.type) {
    case "value_table":return <div className="overflow-x-auto"><table className="w-full border-collapse text-slate-800"><thead><tr>{element.content.columns.map((column,i)=><th key={i} className="border border-slate-200 p-3 text-left">{column}</th>)}</tr></thead><tbody>{element.content.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j} className="border border-slate-200 p-3"><MathText content={cell}/></td>)}</tr>)}</tbody></table></div>;
    case "text":
      return (
        <TextRenderer
          content={element.content as TextContent}
          variables={variables}
        />
      );

    case "equation":
      return (
        <EquationRenderer
          content={element.content as EquationContent}
          variables={variables}
        />
      );

    case "variation_table":
      return (
        <VariationTableRenderer
          content={element.content as VariationTableContent}
          variables={variables}
        />
      );

    case "sign_table":
      return (
        <SignTableRenderer
          content={element.content as SignTableContent}
          variables={variables}
        />
      );

    case "graph":
      return (
        <GraphRenderer
          content={element.content as GraphContent}
          variables={variables}
        />
      );

    case "question":
      return (
        <QuestionRenderer
          gradeAnswer={gradeAnswer}
          initialResult={initialResult}
          content={element.content as QuestionContent}
          variables={variables}
          onSubmit={onChildSubmit} // QuestionRenderer attend maintenant onSubmit
        />
      );

    case "mcq":
      return (
        <MCQRenderer
          gradeAnswer={gradeAnswer}
          initialResult={initialResult}
          optionIds={optionIds}
          content={element.content as MCQContent}
          variables={variables}
          onSubmit={onChildSubmit} // MCQRenderer attend onSubmit
        />
      );

    default:
      return (
        <div className="p-4 border border-dashed border-red-200 bg-red-50 text-red-600 rounded">
          Type non supporté : {(element as any).type}
        </div>
      );
  }
};

/**
 * Composant principal
 */
export const ExerciseRenderer: React.FC<ExerciseRendererProps> = ({
  exercise,
  onElementSubmit,
  preGeneratedVariables,
  engineSession,onGrade,
}) => {
  // Si les variables ne sont pas fournies, on pourrait les générer ici,
  // mais idéalement elles viennent du ExerciseLoader via preGeneratedVariables.
  const variables = useMemo(
    () => preGeneratedVariables || {},
    [preGeneratedVariables],
  );

  return (
    <div className="space-y-6" data-engine-instance={engineSession?.instance.instanceId}>
      {exercise.elements.map((element,index) => (
        <ElementRenderer
          key={element.id}
          element={element}
          variables={variables}
          gradeAnswer={engineSession&&onGrade?(answer)=>onGrade(engineSession.instance.elements[index].id,answer):undefined}
          initialResult={engineSession?.questions[engineSession.instance.elements[index].id]}
          optionIds={engineSession?.instance.elements[index].type==="mcq"?(engineSession.instance.elements[index] as Extract<import("novlearn-exercise-engine").PublicElement,{type:"mcq"}>).options.map(o=>o.id):undefined}
          // On injecte l'ID de l'élément ici, comme ça l'enfant n'a pas besoin de le savoir
          onChildSubmit={(answer, isCorrect) =>
            onElementSubmit?.(element.id, answer, isCorrect)
          }
        />
      ))}
    </div>
  );
};

export default ExerciseRenderer;
