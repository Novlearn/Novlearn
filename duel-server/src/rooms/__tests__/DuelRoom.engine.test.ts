import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("colyseus", () => ({ Room: class {
        broadcast = vi.fn();
    } }));
vi.mock("../../db", () => ({ verifySupabaseToken: vi.fn(), getDuel: vi.fn(), getPlayerName: vi.fn(), getRandomExercise: vi.fn(), saveDuelResult: vi.fn(), recordAttempt: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../engine", () => ({ engineRun: vi.fn(), prepareEngineRound: vi.fn() }));
import { engineRun } from "../../engine";
import { recordAttempt } from "../../db";
import { DuelRoom } from "../DuelRoom";
function setup() {
    const room = new DuelRoom();
    const internal = room as any;
    room.state.phase = "playing";
    room.state.player1Id = "p1";
    room.state.player2Id = "p2";
    internal.duelId = 1;
    internal.engineRound = { id: "instance", questionId: "q", official: { elements: [{ id: "q", expected: { math: { displayLatex: "2" } } }] } };
    const client = { userData: { userId: "p1" }, send: vi.fn() };
    const submit = (overrides: Record<string, unknown> = {}) => internal.handleSubmitAnswer(client, { requestId: "r", instanceId: "instance", questionId: "q", rawAnswer: { format: "latex", source: "999" }, isCorrect: true, ...overrides });
    return { room, internal, client, submit };
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.spyOn(console, "log").mockImplementation(() => { }); vi.mocked(engineRun).mockResolvedValue({ instanceId: "instance", questionId: "q", state: "incorrect" }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
it("ignores a forged client success and grades the official snapshot", async () => { const { room, submit } = setup(); await submit(); expect(room.state.player1Score).toBe(0); expect(engineRun).toHaveBeenCalledOnce(); expect(recordAttempt).toHaveBeenCalledWith(1, "p1", 1, expect.any(String), false, expect.any(Number), "instance"); });
it("awards one point for the server success even when client says false", async () => { vi.mocked(engineRun).mockResolvedValue({ instanceId: "instance", questionId: "q", state: "correct" }); const { room, submit } = setup(); await submit({ isCorrect: false }); await submit(); expect(room.state.player1Score).toBe(1); expect(recordAttempt).toHaveBeenCalledOnce(); });
it("refuses stale instance and unknown question IDs", async () => { const { submit } = setup(); await submit({ instanceId: "old" }); await submit({ questionId: "other" }); expect(engineRun).not.toHaveBeenCalled(); });
it("keeps invalid/error verdicts neutral", async () => { vi.mocked(engineRun).mockResolvedValue({ instanceId: "instance", questionId: "q", state: "invalid" }); const { room, submit } = setup(); await submit(); expect(room.state.player1Score).toBe(0); expect(recordAttempt).not.toHaveBeenCalled(); });
it("discards a late correction after the round changes", async () => { let resolve!: (v: unknown) => void; vi.mocked(engineRun).mockImplementation(() => new Promise(r => resolve = r)); const { room, internal, submit } = setup(); const pending = submit(); internal.engineRound = null; resolve({ instanceId: "instance", questionId: "q", state: "correct" }); await pending; expect(room.state.player1Score).toBe(0); expect(recordAttempt).not.toHaveBeenCalled(); });
