import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../app/components/ui/MathInput", () => ({ MathInput: (p: any) => <input value={p.value} disabled={p.disabled} onChange={e => p.onChange(e.target.value)}/> }));
vi.mock("../app/components/ui/MathText", () => ({ default: (p: any) => <span>{p.content}</span> }));
vi.mock("../app/hooks/useAudioFeedback", () => ({ useAudioFeedback: () => ({ playSuccess: vi.fn(), playError: vi.fn() }) }));
import QuestionRenderer from "../app/renderers/QuestionRenderer";
import MCQRenderer from "../app/renderers/MCQRenderer";
let tree: ReactTestRenderer;
afterEach(() => { if (tree)
    act(() => tree.unmount()); vi.restoreAllMocks(); });
const content = { question: "Question", correctAnswer: "private-never-delivered", answerFormat: "number" as const };
async function typeAndSubmit(source: string) { act(() => tree.root.findByType("input").props.onChange({ target: { value: source } })); await act(async () => { await tree.root.findByType("form").props.onSubmit({ preventDefault() { } }); }); }
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
    expect(tree.root.findByProps({ role: "status" }).children.join("")).toContain("invalide");
    await typeAndSubmit("2");
    expect(submit).not.toHaveBeenCalled();
    expect(tree.root.findByType("input").props.disabled).toBe(false);
});
it("the first wrong answer keeps the existing retry, the second ends it", async () => {
    const grade = vi.fn().mockResolvedValueOnce({ state: "incorrect", attempts: 1, finished: false }).mockResolvedValueOnce({ state: "incorrect", attempts: 2, finished: true, reveal: { latex: "2" } });
    const submit = vi.fn();
    act(() => { tree = create(<QuestionRenderer content={content} variables={{}} gradeAnswer={grade} onSubmit={submit}/>); });
    await typeAndSubmit("8");
    expect(submit).not.toHaveBeenCalled();
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
