"use client";
import React from "react";
import { MathText } from "../components/ui";
import { EquationContent, RendererProps } from "../types/exercise";
// Answerable equations are canonical Engine questions, rendered by QuestionRenderer.
const EquationRenderer: React.FC<RendererProps<EquationContent>> = ({ content }) => (
  <div className="p-5 bg-white/95 rounded-2xl shadow-md border border-gray-100 dark:bg-slate-800/95 dark:border-slate-700">
    <div className="bg-blue-50 rounded-xl p-6 flex justify-center mb-4 dark:bg-blue-950/20">
      <MathText content={content.latex} displayMode className="text-xl text-gray-800 dark:text-slate-200" />
    </div>
  </div>
);
export default EquationRenderer;
