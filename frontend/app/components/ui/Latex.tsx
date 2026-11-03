"use client";

import React, { useEffect, useRef } from "react";
import { VariableValues } from "../../types/exercise";
import { getKaTeX } from "./katexUtils";

interface LatexProps {
  /** Expression LaTeX */
  children: string;
  /** Variables à substituer */
  variables?: VariableValues;
  /** Mode display (bloc centré) */
  display?: boolean;
  /** Classes CSS */
  className?: string;
}

const Latex: React.FC<LatexProps> = ({
  children,
  display = false,
  className = "",
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const substituted = children;

  useEffect(() => {
    const katex = getKaTeX();
    if (!ref.current || !katex) return;

    try {
      katex.render(substituted, ref.current, {
        displayMode: display,
        throwOnError: false,
      });
    } catch {
      if (ref.current) {
        ref.current.textContent = substituted;
      }
    }
  }, [substituted, display]);

  return <span ref={ref} className={className} />;
};

export default Latex;
