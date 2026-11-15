import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../app/components/ui/MathInput", () => ({ MathInput: (p: any) => <input value={p.value} disabled={p.disabled} onChange={e => p.onChange(e.target.value)}/> }));
vi.mock("../app/components/ui/MathText", () => ({ default: (p: any) => <span>{p.content}</span> }));
vi.mock("../app/hooks/useAudioFeedback", () => ({ useAudioFeedback: () => ({ playSuccess: vi.fn(), playError: vi.fn() }) }));
vi.mock("../app/lib/supabase", () => ({ supabase: {} }));
import QuestionRenderer from "../app/renderers/QuestionRenderer";
import MCQRenderer from "../app/renderers/MCQRenderer";
import { formatExpectedAnswer, formatUnitFactorsForDisplay, hasDuplicateDisplayOptions } from "../app/utils/mathDisplay";
let tree: ReactTestRenderer;
function renderedText(): string {
    const visit = (node: { children: Array<string | { children: unknown[] }> }): string =>
        node.children.map(child => typeof child === "string" ? child : visit(child as { children: Array<string | { children: unknown[] }> })).join("");
    return visit(tree.root as unknown as { children: Array<string | { children: unknown[] }> });
}
afterEach(() => { if (tree)
    act(() => tree.unmount()); vi.restoreAllMocks(); });
const content = { question: "Question", correctAnswer: "private-never-delivered", answerFormat: "number" as const };
async function typeAndSubmit(source: string) { act(() => tree.root.findByType("input").props.onChange({ target: { value: source } })); await act(async () => { await tree.root.findByType("form").props.onSubmit({ preventDefault() { } }); }); }
it("presents revealed numeric intervals in French notation and reduces nested numeric fractions", () => {
    expect(formatExpectedAnswer(String.raw`\lbrack\sqrt{\frac{\frac{6}{1}}{\frac{40}{1}}}, \infty\rparen`)).toBe(String.raw`$[\sqrt{\frac{3}{20}}; +\infty[$`);
    expect(formatExpectedAnswer(String.raw`\lparen-\infty, \frac{1}{2}\rbrack`)).toBe(String.raw`$]-\infty; \frac{1}{2}]$`);
});
it("simplifies unit factors for QCM display and blocks a collision without changing option IDs", () => {
    const options = [String.raw`$u_n=1\times4^n$`, String.raw`$u_n=1n^4$`, String.raw`$u_n=4\times1^n$`];
    const displayed = options.map(formatUnitFactorsForDisplay);
    expect(displayed).toEqual([String.raw`$u_n=4^n$`, String.raw`$u_n=n^4$`, String.raw`$u_n=4$`]);
    expect(hasDuplicateDisplayOptions(displayed)).toBe(false);
    expect(hasDuplicateDisplayOptions([displayed[0]!, String.raw`$u_n=4^{n}$`])).toBe(true);
    const ids = ["correct", "distractor"];
    act(() => { tree = create(<MCQRenderer content={{ question: "Q", options: [{ text: options[0], correct: false }, { text: String.raw`$u_n=4^n$`, correct: false }] }} variables={{}} optionIds={ids} gradeAnswer={vi.fn()}/>); });
    expect(tree.root.findByProps({ role: "alert" }).children.join("")).toContain("plusieurs choix deviendraient identiques");
});
it("existing input sends raw MathLive input and trusts only the server verdict", async () => {
    const grade = vi.fn().mockResolvedValue({ state: "correct", attempts: 0, finished: true, reveal: { latex: "2" } });
    const submit = vi.fn();
    act(() => { tree = create(<QuestionRenderer content={content} variables={{}} gradeAnswer={grade} onSubmit={submit}/>); });
    expect(JSON.stringify(tree.toJSON())).not.toContain("private-never-delivered");
    await typeAndSubmit("1+1");
    expect(grade).toHaveBeenCalledWith({ format: "latex", source: "1+1" });
    expect(submit).toHaveBeenCalledWith("1+1", true);
    expect(tree.root.findByType("input").props.disabled).toBe(true);
});
it("invalid and unavailable corrections neither finish the question nor consume attempts", async () => {
    const grade = vi.fn().mockResolvedValueOnce({ state: "invalid", attempts: 0, finished: false }).mockRejectedValueOnce(Error("offline"));
    const submit = vi.fn();
    act(() => { tree = create(<QuestionRenderer content={content} variables={{}} gradeAnswer={grade} onSubmit={submit}/>); });
    await typeAndSubmit("(");
    expect(submit).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ role: "status" }).children.join("")).toContain("interprétée");
    await typeAndSubmit("2");
    expect(submit).not.toHaveBeenCalled();
    expect(tree.root.findByType("input").props.disabled).toBe(false);
});
it("states why a comparison is indeterminate without calling the answer wrong or asking for the same input", async () => {
    const grade = vi.fn().mockResolvedValue({ state: "indeterminate", feedbackCode: "indeterminate", attempts: 0, finished: false });
    act(() => { tree = create(<QuestionRenderer content={content} variables={{}} gradeAnswer={grade}/>); });
    await typeAndSubmit("x+1");
    const message = tree.root.findByProps({ role: "status" }).children.join("");
    expect(message).toContain("n’a pas permis de conclure");
    expect(message).toContain("pas comptée comme fausse");
    expect(message).not.toContain("Réessayez");
    expect(renderedText()).toContain("Essais comptés : 0/2 · restants : 2");
});
it("reports a correction outage without charging an attempt", async () => {
    const grade = vi.fn().mockResolvedValue({ state: "error", feedbackCode: "technical-error", attempts: 0, finished: false });
    act(() => { tree = create(<QuestionRenderer content={content} variables={{}} gradeAnswer={grade}/>); });
    await typeAndSubmit("x+1");
    expect(tree.root.findByProps({ role: "status" }).children.join("")).toContain("momentanément indisponible");
    expect(renderedText()).toContain("Essais comptés : 0/2 · restants : 2");
});
it("the first wrong answer keeps the existing retry, the second ends it", async () => {
    const grade = vi.fn().mockResolvedValueOnce({ state: "incorrect", attempts: 1, finished: false }).mockResolvedValueOnce({ state: "incorrect", attempts: 2, finished: true, reveal: { latex: "2" } });
    const submit = vi.fn();
    act(() => { tree = create(<QuestionRenderer content={content} variables={{}} gradeAnswer={grade} onSubmit={submit}/>); });
    await typeAndSubmit("8");
    expect(submit).not.toHaveBeenCalled();
    expect(renderedText()).toContain("Essais comptés : 1/2 · restants : 1");
    await typeAndSubmit("9");
    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith("9", false);
});
it("a resumed terminal result locks the same existing input", () => {
    act(() => { tree = create(<QuestionRenderer content={content} variables={{}} gradeAnswer={vi.fn()} initialResult={{ state: "correct", attempts: 1, finished: true, reveal: { latex: "2" } }}/>); });
    expect(tree.root.findByType("input").props.disabled).toBe(true);
    expect(JSON.stringify(tree.toJSON())).toContain("Bonne réponse");
});
it("the existing shuffled QCM submits stable option IDs", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const grade = vi.fn().mockResolvedValue({ state: "incorrect", attempts: 1, finished: true, reveal: { optionIds: ["a"] } });
    act(() => { tree = create(<MCQRenderer content={{ question: "Choisir", options: [{ text: "A", correct: false }, { text: "B", correct: false }] }} variables={{}} optionIds={["a", "b"]} gradeAnswer={grade}/>); });
    act(() => tree.root.findAllByType("button")[1].props.onClick());
    await act(async () => { await tree.root.findAllByType("button").find(b => b.children.includes("Valider"))!.props.onClick(); });
    expect(grade).toHaveBeenCalledWith({ format: "selection", optionIds: ["b"] });
});
