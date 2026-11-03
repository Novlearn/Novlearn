import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("colyseus", () => ({ Room: class { broadcast = vi.fn(); } }));
vi.mock("../../db", () => ({
  verifySupabaseToken: vi.fn(), getDuel: vi.fn(), getPlayerName: vi.fn(),
  getRandomExercise: vi.fn(), saveDuelResult: vi.fn(),
  recordAttempt: vi.fn().mockResolvedValue(undefined),
}));
import { recordAttempt } from "../../db";
import { DuelRoom } from "../DuelRoom";
import type { Client } from "colyseus";

function setup() {
  const room = new DuelRoom();
  room.state.phase = "playing";
  room.state.player1Id = "p1"; room.state.player2Id = "p2";
  // Test seam only: handler and scoring remain the real DuelRoom implementation.
  const internal = room as unknown as {
    duelId: number; currentExercise: unknown;
    handleSubmitAnswer: (client: Client, message: unknown) => Promise<void>;
  };
  internal.duelId = 1;
  internal.currentExercise = {id:10,content:{elements:[
    {id:1,type:"question",content:{correctAnswer:"2"}},
    {id:2,type:"question",content:{correctAnswer:"3"}},
  ]}};
  const client = {userData:{userId:"p1",name:"Synthetic"}} as Client;
  const submit = (overrides: Record<string,unknown> = {}) => internal.handleSubmitAnswer(client,
    {elementId:1,answer:"wrong",isCorrect:true,timeSpent:1,...overrides});
  return {room, submit};
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.mocked(recordAttempt).mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("L0 / real DuelRoom handler, transport and persistence mocked", () => {
  it("awards a point on a client assertion despite the wrong answer", async () => {
    const {room,submit} = setup(); await submit();
    expect(room.state.player1Score).toBe(1);
    expect(recordAttempt).toHaveBeenCalledWith(1,"p1",1,"wrong",true,1);
  });
  it("accepts an element identifier absent from the current exercise", async () => {
    const {room,submit} = setup(); await submit({elementId:999});
    expect(room.state.player1Score).toBe(1);
  });
  it("one answer awards the exercise point even for two questions", async () => {
    const {room,submit} = setup(); await submit({answer:"2"});
    expect(room.state.player1Score).toBe(1);
  });
  it("duplicate messages are persisted twice but scored once", async () => {
    const {room,submit} = setup(); await submit(); await submit();
    expect(room.state.player1Score).toBe(1);
    expect(recordAttempt).toHaveBeenCalledTimes(2);
  });
  it("ignores a submission after finish", async () => {
    const {room,submit} = setup(); room.state.phase="finished"; await submit();
    expect(room.state.player1Score).toBe(0);
    expect(recordAttempt).not.toHaveBeenCalled();
  });
  it("records a client-declared wrong answer without awarding a point", async () => {
    const {room,submit} = setup(); await submit({isCorrect:false});
    expect(room.state.player1Score).toBe(0);
    expect(recordAttempt).toHaveBeenCalledOnce();
  });
});
