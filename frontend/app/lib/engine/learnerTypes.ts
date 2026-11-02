import type { AnswerSubmission, CorrectionState, PublicInstance } from "novlearn-exercise-engine";
export type QuestionResult = {
    state: CorrectionState;
    attempts: number;
    finished: boolean;
    answer?: AnswerSubmission["answer"];
    reveal?: {
        latex?: string;
        texts?: string[];
        optionIds?: string[];
        explanation?: string;
    };
};
export type ExerciseSession = {
    sessionId: string;
    exerciseId: string;
    versionId: string;
    instance: PublicInstance;
    metadata: Record<string, unknown>;
    hints?: Record<string,string>;
    questions: Record<string, QuestionResult>;
    status: "active" | "completed" | "skipped" | "abandoned";
    correct: boolean;
    expiresAt: string;
};
export type GradeQuestion = (answer: AnswerSubmission["answer"]) => Promise<QuestionResult>;
