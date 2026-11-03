import React from "react";
import { create, act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  operation: vi.fn(),
  from: vi.fn(),
  stored: new Map<string, string>(),
}));
vi.mock("../app/lib/supabase", () => ({ supabase: { from: state.from } }));
vi.mock("../app/contexts/AuthContext", () => ({
  useAuth: () => ({ isGuest: false, user: { id: "owner" } }),
}));
vi.mock("../app/hooks/useGuestMode", () => ({
  GUEST_EXERCISE_LIMIT: 5,
  useGuestMode: () => ({ getGuestAttemptCount: vi.fn() }),
}));
vi.mock("../app/lib/engine/learnerClient", () => ({
  exerciseOperation: state.operation,
  ExerciseRequestError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("../app/components/ui/FeedbackModal", () => ({
  FeedbackModal: () => null,
}));
vi.mock("../app/components/ui/HelpModal", () => ({ HelpModal: () => null }));
vi.mock("../app/components/Exercise/ExerciseRenderer", () => ({
  default: (props: any) => <div data-testid="renderer" {...props} />,
}));
import ExerciseLoader from "../app/components/Exercise/ExerciseLoader";
import { ExerciseRequestError } from "../app/lib/engine/learnerClient";
const session = {
  sessionId: "session",
  exerciseId: "18",
  versionId: "version",
  instance: {
    schemaVersion: 5,
    instanceId: "instance",
    title: "Suite",
    elements: [
      {
        id: "q",
        type: "question",
        text: "Calculer",
        response: { format: "latex", kind: "real" },
      },
    ],
  },
  metadata: { difficulty: "Facile" },
  questions: {},
  status: "active",
  correct: false,
  expiresAt: "",
};
let tree: ReactTestRenderer;
beforeEach(() => {
  state.operation.mockReset();
  state.from.mockReset();
  state.stored.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => state.stored.get(k) ?? null,
    setItem: (k: string, v: string) => state.stored.set(k, v),
    removeItem: (k: string) => state.stored.delete(k),
  });
  state.operation.mockResolvedValue({
    kind: "engine",
    session: structuredClone(session),
  });
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
  vi.unstubAllGlobals();
});
async function mount(props: Record<string, unknown> = {}) {
  await act(async () => {
    tree = create(<ExerciseLoader exerciseId="18" {...props} />);
  });
  return tree.root.findByProps({ "data-testid": "renderer" });
}
it("opens the exercise through the server and never reads private exercise content", async () => {
  await mount({ trackAbandon: true, shouldCountPoints: true });
  expect(state.operation).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "open",
      exerciseId: "18",
      trackAbandon: true,
      countPoints: true,
    }),
  );
  expect(state.from).not.toHaveBeenCalled();
});
it("a child callback cannot save a result or finish the exercise locally", async () => {
  const renderer = await mount();
  act(() => renderer.props.onElementSubmit(1, "forged", true));
  expect(state.operation).toHaveBeenCalledTimes(1);
  expect(state.from).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).not.toContain("Validé !");
});
it("submits raw input and follows the server completion result", async () => {
  const renderer = await mount();
  state.operation.mockResolvedValueOnce({
    kind: "engine",
    session: {
      ...session,
      status: "completed",
      correct: true,
      questions: { q: { state: "correct", attempts: 1, finished: true } },
    },
  });
  await act(async () =>
    renderer.props.onGrade("q", { format: "latex", source: "4/2" }),
  );
  expect(state.operation).toHaveBeenLastCalledWith({
    action: "answer",
    sessionId: "session",
    questionId: "q",
    answer: { format: "latex", source: "4/2" },
  });
  expect(JSON.stringify(tree.toJSON())).toContain("Validé !");
  expect(state.from).not.toHaveBeenCalled();
});
it("Passer uses the server session and preserves the existing next callback", async () => {
  const next = vi.fn();
  await mount({ trackAbandon: true, onNextClick: next });
  const skip = tree.root
    .findAllByType("button")
    .find((b) => b.children.includes("Passer"))!;
  await act(async () => skip.props.onClick());
  expect(state.operation).toHaveBeenLastCalledWith({
    action: "skip",
    sessionId: "session",
  });
  expect(next).toHaveBeenCalledWith(false, "session");
  expect(state.from).not.toHaveBeenCalled();
});
it("opens a fresh instance after the server refuses a stale saved session", async () => {
  state.stored.set("novlearn-engine:owner:18:practice", "old");
  state.operation.mockRejectedValueOnce(
    new ExerciseRequestError(409, "Ancienne archive"),
  );
  await mount();
  expect(state.operation).toHaveBeenNthCalledWith(1, {
    action: "resume",
    sessionId: "old",
  });
  expect(state.operation).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ action: "open", exerciseId: "18" }),
  );
});
