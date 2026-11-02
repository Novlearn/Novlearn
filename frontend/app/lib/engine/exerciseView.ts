import type { ExerciseSession } from "./learnerTypes";
import type { Exercise } from "../../types/exercise";
/** Presentation adapter only: Engine already substituted every displayed value. */
export function sessionExercise(s: ExerciseSession): Exercise {
    const m = s.metadata;
    const difficultyLabels: Record<string, Exercise["difficulty"]> = {easy:"Facile",medium:"Moyen",hard:"Difficile",Facile:"Facile",Moyen:"Moyen",Difficile:"Difficile"};
    return { id: Number(s.exerciseId), title: String(m.title ?? s.instance.title), app_title: String(m.app_title ?? m.title ?? s.instance.title), chapter: String(m.chapter ?? ""), difficulty: difficultyLabels[String(m.difficulty)] ?? "Facile", competences: m.competences as string[] ?? [], variables: [],
        elements: s.instance.elements.map((e, index) => {
            const id = index + 1;
            switch (e.type) {
                case "text":
                case "section": return { id, type: "text", content: { text: e.text } };
                case "expression": return { id, type: "equation", content: { latex: e.latex, requireAnswer: false } };
                case "question": return { id, type: "question", content: { question: e.text, hint:s.hints?.[e.id], correctAnswer: "", answerFormat: e.response.format === "text" ? "text" : ["expression", "rational-expression", "log-affine-positive", "geometric-expression", "elementary-positive"].includes(e.response.kind) ? "expression" : e.response.kind === "set" ? "set" : e.response.kind === "intervals" ? "interval" : "number" } };
                case "mcq": return { id, type: "mcq", content: { question: e.text, multipleChoice: e.mode === "multiple", options: e.options.map(o => ({ text: o.content.format === "latex" ? `$${o.content.latex}$` : o.content.text, correct: false })) } };
                case "value-table": return { id, type: "value_table", content: { columns: e.columns, rows: e.rows.map(row => row.map(c => c.kind === "text" ? c.text : c.kind === "math" ? `$${c.latex}$` : `$${c.value.latex}$`)) } };
                case "function-graph": {
                    if(e.variable !== "x") throw new Error("Variable graphique non prise en charge.");
                    // Decode the prescribed viewport only; no generation or grading here.
                    const bound=(n:typeof e.window.xMin)=>n.numerator/n.denominator;
                    return {id,type:"graph",content:{xMin:bound(e.window.xMin),xMax:bound(e.window.xMax),yMin:bound(e.window.yMin),yMax:bound(e.window.yMax),showGrid:e.showGrid,functions:e.functions.map(f=>({color:f.color,expression:f.latex,showExpression:f.showExpression}))}};
                }
                default: throw new Error(`Rendu non pris en charge : ${e.type}`);
            }
        }) };
}
