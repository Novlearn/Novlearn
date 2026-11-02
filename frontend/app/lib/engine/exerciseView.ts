import type { ExerciseSession } from "./learnerTypes";
import type { Exercise } from "../../types/exercise";
/** Presentation adapter only: Engine already substituted every displayed value. */
export function sessionExercise(s: ExerciseSession): Exercise {
    const m = s.metadata;
    return { id: Number(s.exerciseId), title: String(m.title ?? s.instance.title), app_title: String(m.app_title ?? m.title ?? s.instance.title), chapter: String(m.chapter ?? ""), difficulty: String(m.difficulty ?? "Facile") as Exercise["difficulty"], competences: m.competences as string[] ?? [], variables: [],
        elements: s.instance.elements.map((e, index) => {
            const id = index + 1;
            switch (e.type) {
                case "text":
                case "section": return { id, type: "text", content: { text: e.text } };
                case "expression": return { id, type: "equation", content: { latex: e.latex, requireAnswer: false } };
                case "question": return { id, type: "question", content: { question: e.text, correctAnswer: "", answerFormat: e.response.format === "text" ? "text" : e.response.kind === "expression" ? "expression" : e.response.kind === "set" ? "set" : e.response.kind === "intervals" ? "interval" : "number" } };
                case "mcq": return { id, type: "mcq", content: { question: e.text, multipleChoice: e.mode === "multiple", options: e.options.map(o => ({ text: o.content.format === "latex" ? `$${o.content.latex}$` : o.content.text, correct: false })) } };
                case "value-table": return { id, type: "value_table", content: { columns: e.columns, rows: e.rows.map(row => row.map(c => c.kind === "text" ? c.text : c.kind === "math" ? `$${c.latex}$` : `$${c.value.latex}$`)) } };
                default: throw new Error(`Rendu non pris en charge : ${e.type}`);
            }
        }) };
}
