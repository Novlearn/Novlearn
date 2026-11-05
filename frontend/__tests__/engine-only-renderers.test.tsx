import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../app/components/ui/MathInput", () => ({
  MathInput: (props: any) => <input {...props} />,
}));
vi.mock("../app/components/ui/MathText", () => ({ default: () => <span /> }));
vi.mock("../app/components/ui", () => ({ MathText: () => <span /> }));
vi.mock("../app/hooks/useAudioFeedback", () => ({
  useAudioFeedback: () => ({ playSuccess: vi.fn(), playError: vi.fn() }),
}));
import QuestionRenderer from "../app/renderers/QuestionRenderer";
import MCQRenderer from "../app/renderers/MCQRenderer";
import EquationRenderer from "../app/renderers/EquationRenderer";
import { interpolatePlot } from "../app/utils/graphPresentation";
let tree: ReactTestRenderer;
afterEach(() => {
  if (tree) act(() => tree.unmount());
});
it("never corrects a question locally when the Engine channel is absent", async () => {
  const submit = vi.fn();
  act(() => {
    tree = create(
      <QuestionRenderer
        content={{
          question: "Calculer",
          correctAnswer: "2",
          answerFormat: "number",
        }}
        variables={{}}
        onSubmit={submit}
      />,
    );
  });
  act(() => tree.root.findByType("input").props.onChange("2"));
  await act(async () =>
    tree.root.findByType("form").props.onSubmit({ preventDefault() {} }),
  );
  expect(submit).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain("indisponible");
});
it("ignores legacy QCM correctness fields without a server verdict", async () => {
  const submit = vi.fn();
  act(() => {
    tree = create(
      <MCQRenderer
        content={{
          question: "Choisir",
          options: [{ text: "A", correct: true }],
        }}
        variables={{}}
        onSubmit={submit}
      />,
    );
  });
  act(() => tree.root.findAllByType("button")[0].props.onClick());
  await act(async () => tree.root.findAllByType("button")[1].props.onClick());
  expect(submit).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain("indisponible");
});
it("an unverified displayed equation cannot declare success", () => {
  act(() => {
    tree = create(
      <EquationRenderer
        content={{ latex: "x=2", requireAnswer: true }}
        variables={{}}
      />,
    );
  });
  expect(tree.root.findAllByType("input")).toHaveLength(0);
});
it("only interpolates prepared coordinates, preserving gaps and steep jumps", () => {
  expect(interpolatePlot([0, 2, 4], 0.5, 0, 2, 10)).toBe(1);
  expect(interpolatePlot([1, null, 2], 1, 0, 2, 10)).toBeNaN();
  expect(interpolatePlot([-100, 100], 0.5, 0, 1, 10)).toBeNaN();
  expect(interpolatePlot([], 0, 0, 1, 10)).toBeNaN();
});
