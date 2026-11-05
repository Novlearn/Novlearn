import React from "react";
import { create, act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../app/components/ui/MathInput", () => ({MathInput: (props: any) => <input {...props} />}));
vi.mock("../app/components/ui/MathText", () => ({default: () => <span />}));
vi.mock("../app/components/ui", () => ({MathText: () => <span />}));
vi.mock("../app/hooks/useAudioFeedback", () => ({useAudioFeedback: () => ({playSuccess:vi.fn(),playError:vi.fn()})}));
import QuestionRenderer from "../app/renderers/QuestionRenderer";
import EquationRenderer from "../app/renderers/EquationRenderer";
import MCQRenderer from "../app/renderers/MCQRenderer";
const mounted: ReactTestRenderer[] = [];
function mount(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  act(() => { renderer=create(element); });
  mounted.push(renderer);
  return renderer;
}
afterEach(() => { for (const r of mounted.splice(0)) act(() => r.unmount()); vi.restoreAllMocks(); });
describe("L0 / real renderer callbacks, MathLive and presentation mocked", () => {
  const question = {question:"Synthetic",correctAnswer:"2",answerFormat:"number" as const,points:1};
  const answer = (r: ReactTestRenderer, value: string) => {
    act(() => r.root.findByType("input").props.onChange(value));
    act(() => r.root.findByType("form").props.onSubmit({preventDefault:vi.fn()}));
  };
  it("wrong then correct sends only a success callback", () => {
    const submit=vi.fn(); const r=mount(<QuestionRenderer content={question} variables={{}} onSubmit={submit}/>);
    answer(r,"3"); expect(submit).not.toHaveBeenCalled();
    answer(r,"2"); expect(submit.mock.calls).toEqual([["2",true]]);
  });
  it("two wrong answers send only the final failure", () => {
    const submit=vi.fn(); const r=mount(<QuestionRenderer content={question} variables={{}} onSubmit={submit}/>);
    answer(r,"3"); answer(r,"4"); expect(submit.mock.calls).toEqual([["4",false]]);
    answer(r,"2"); expect(submit).toHaveBeenCalledOnce();
  });
  it("one-attempt mode reports the first failure", () => {
    const submit=vi.fn(); const r=mount(<QuestionRenderer content={question} variables={{}} onSubmit={submit} maxAttempts={1}/>);
    answer(r,"3"); expect(submit.mock.calls).toEqual([["3",false]]);
  });
  it("empty submission does not consume the callback", () => {
    const submit=vi.fn(); const r=mount(<QuestionRenderer content={question} variables={{}} onSubmit={submit}/>);
    answer(r," "); expect(submit).not.toHaveBeenCalled();
  });
  it("an equation requiring an answer without an expected answer declares success", () => {
    const submit=vi.fn(); const r=mount(<EquationRenderer content={{latex:"x=2",requireAnswer:true}} variables={{}} onSubmit={submit}/>);
    act(() => r.root.findByType("input").props.onChange({target:{value:"wrong"}}));
    act(() => r.root.findAllByType("button")[0].props.onClick());
    expect(submit.mock.calls).toEqual([["wrong",true]]);
  });
  it("multi-answer QCM returns only one shuffled index despite two correct selections", () => {
    vi.spyOn(Math,"random").mockReturnValue(0.99);
    const submit=vi.fn();
    const r=mount(<MCQRenderer content={{question:"Synthetic",multipleChoice:true,options:[
      {text:"A",correct:true},{text:"B",correct:true},{text:"C",correct:false}]}} variables={{}} onSubmit={submit}/>);
    const buttons=r.root.findAllByType("button");
    act(() => buttons[0].props.onClick());
    act(() => r.root.findAllByType("button")[1].props.onClick());
    act(() => r.root.findAllByType("button")[3].props.onClick());
    expect(submit.mock.calls).toEqual([[0,true]]);
  });
});
