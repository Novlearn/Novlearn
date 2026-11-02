// Types pour les exercices mathématiques NovLearn

// Types de format de réponse supportés
export type AnswerFormat =
  | "number" // Valeur numérique simple (3, -2.5, 1/2)
  | "text" // Texte simple (comparaison exacte)
  | "expression" // Expression mathématique (dérivée, suite)
  | "interval" // Intervalle (]-∞;2], [1;5[, ]-3;+∞[)
  | "set" // Ensemble de valeurs ({-1, 2, 5})
  | "fraction" // Fraction irréductible
  | "complex"; // Nombre complexe

export interface Variable {
  id: number;
  name: string;
  type: "integer" | "decimal" | "choice" | "computed" | "doublet" | "triplet";
  // integer / decimal
  min?: number;
  max?: number;
  decimals?: number;
  /** Valeurs interdites (nombres ou expressions avec variables, ex: "0", "@a", "@a+1") */
  exclusions?: (string | number)[];
  // choice (scalaire) : tableau de valeurs
  // doublet / triplet mode "choice" : chaîne de n-uplets ex: "(1,2); (-1,3)"
  choices?: string[] | string;
  // computed
  expression?: string;
  // doublet / triplet
  mode?: "choice" | "perfect_square";
  /** Noms des variables produites, ex: ["p","q"] ou ["A","B","C"] */
  names?: string[];
}

export interface TextContent {
  text: string;
}

export interface VariationPoint {
  x: string;
  value: string;
  variation: "croissante" | "décroissante" | "";
}

export interface VariationTableContent {
  points: VariationPoint[];
}

export type GraphFunction = {
  color: string;
  expression: string;
  /** Si false, la formule n'est pas affichée dans la légende par défaut.
   *  Utile pour les exercices "identifier la courbe".
   *  L'étudiant peut la révéler via le bouton dédié. */
  showExpression?: boolean;
};

/** Borne d'un graphe : un nombre, une expression avec variables (ex: "@a - 1"),
 *  ou "auto" pour un calcul automatique basé sur les fonctions. */
export type GraphBound = number | string | "auto";

export interface GraphContent {
  xMin: GraphBound;
  xMax: GraphBound;
  yMin: GraphBound;
  yMax: GraphBound;
  showGrid: boolean;
  functions: GraphFunction[];
}

export interface SignPoint {
  x: string;
  sign: "+" | "-" | "0" | "||";
}

export interface SignTableContent {
  points: SignPoint[];
}

export interface DiscreteGraphContent {
  points?: Array<{ n: number; value: number }>;
}

export interface EquationContent {
  latex: string;
  answerType?: AnswerFormat;
  correctAnswer?: string;
  requireAnswer?: boolean;
  tolerance?: number;
}

export interface QuestionContent {
  question: string;
  answerFormat: AnswerFormat;
  correctAnswer: string;
  points?: number;
  hint?: string;
  explanation?: string;
}

export interface MCQOption {
  text: string;
  correct: boolean;
}

export interface MCQContent {
  question: string;
  options: MCQOption[];
  multipleChoice?: boolean;
  explanation?: string;
}

export interface SequenceContent {
  type: "explicit" | "recursive";
  formula: string;
  u0: string;
  relation?: string;
  reason?: string;
  showTerms: boolean;
  termsCount: number;
}

// Union de tous les types de contenu possibles
export type ElementContent =
  | TextContent
  | VariationTableContent
  | GraphContent
  | SignTableContent
  | DiscreteGraphContent
  | EquationContent
  | QuestionContent
  | MCQContent
  | SequenceContent;

// Union Discriminée pour typage strict
export type ExerciseElement =
  | { id:number; type:"value_table"; content:{columns:string[];rows:string[][]} }
  | { id: number; type: "text"; content: TextContent }
  | { id: number; type: "variation_table"; content: VariationTableContent }
  | { id: number; type: "graph"; content: GraphContent }
  | { id: number; type: "sign_table"; content: SignTableContent }
  | { id: number; type: "discrete_graph"; content: DiscreteGraphContent }
  | { id: number; type: "equation"; content: EquationContent }
  | { id: number; type: "question"; content: QuestionContent }
  | { id: number; type: "mcq"; content: MCQContent }
  | { id: number; type: "sequence"; content: SequenceContent };

export interface Exercise {
  id: number;
  title: string;
  app_title: string;
  chapter: string;
  difficulty: "Facile" | "Moyen" | "Difficile";
  /** Single competence this exercise trains (for score tracking). */
  competence_id?: string | null;
  competences: string[];
  variables: Variable[];
  elements: ExerciseElement[];
}

export type VariableValues = Record<string, number | string>;

export interface RendererProps<T = ElementContent> {
  content: T;
  variables: VariableValues;
}
