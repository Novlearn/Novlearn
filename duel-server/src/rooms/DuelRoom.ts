import { Room, Client } from "colyseus";
import { DuelState } from "./schema/DuelState";
import { engineRun, prepareEngineRound } from "../engine";
import {
  verifySupabaseToken,
  getDuel,
  getPlayerName,
  getRandomExercise,
  saveDuelResult,
  recordAttempt,
  ExerciseRow,
} from "../db";
import {
  DUEL_DURATION_SECONDS,
  EXERCISE_TIMEOUT_SECONDS,
  CORRECTION_DISPLAY_SECONDS,
} from "../config";

interface SubmitAnswerMsg {
  requestId?:string;
  instanceId?:string;
  questionId?:string;
  rawAnswer?:unknown;
}

interface PlayerAuth {
  userId: string;
  name: string;
}

export class DuelRoom extends Room {
  state = new DuelState();

  private get s(): DuelState { return this.state as DuelState; }

  private duelId!: number;
  private currentExercise: ExerciseRow | null = null;
  private currentVariables: Record<string, number> = {};
  private engineRound:Awaited<ReturnType<typeof prepareEngineRound>>|null=null;
  private advancing = false;
  private roundNumber=0;
  private gradingPlayers=new Set<string>();
  /** Players who solved the current exercise correctly (max 2). */
  private solvedPlayers = new Set<string>();
  private readyPlayers = new Set<string>();
  private gameStarted = false;
  private duelTimer: ReturnType<typeof setTimeout> | null = null;
  private exerciseTimer: ReturnType<typeof setTimeout> | null = null;
  /** 5‑second grace timer allowing the second player to finish. */
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Players who requested to skip the current exercise. */
  private skipRequests = new Set<string>();

  async onAuth(client: Client, options: { token: string; duelId: number }) {
    const { userId } = await verifySupabaseToken(options.token);
    const duel = await getDuel(options.duelId);
    if (duel.player1_id !== userId && duel.player2_id !== userId) {
      throw new Error("You are not a player of this duel");
    }
    if (duel.status !== "active") {
      throw new Error("Duel is not active yet");
    }
    const name = await getPlayerName(userId);
    console.log("[DuelRoom] onAuth OK", { userId: userId.slice(0, 8), name });
    return { userId, name } satisfies PlayerAuth;
  }

  async onCreate(options: { duelId: number }) {
    console.log("[DuelRoom] onCreate", { duelId: options.duelId });
    this.duelId = options.duelId;
    this.maxClients = 2;

    this.s.duelDurationSeconds = DUEL_DURATION_SECONDS;
    this.s.exerciseTimeoutSeconds = EXERCISE_TIMEOUT_SECONDS;
    this.s.correctionDisplaySeconds = CORRECTION_DISPLAY_SECONDS;

    const duel = await getDuel(this.duelId);
    this.s.player1Id = duel.player1_id;
    this.s.player2Id = duel.player2_id;

    const [name1, name2] = await Promise.all([
      getPlayerName(duel.player1_id),
      getPlayerName(duel.player2_id),
    ]);
    this.s.player1Name = name1;
    this.s.player2Name = name2;

    await this.loadNextExercise();

    this.onMessage("ready", (client: Client) => {
      const auth = client.userData as PlayerAuth;
      console.log("[DuelRoom] ready from", auth.userId.slice(0, 8));
      this.readyPlayers.add(auth.userId);
      this.tryStartGame();
    });

    this.onMessage("submitAnswer", (client: Client, msg: SubmitAnswerMsg) => {
      this.handleSubmitAnswer(client, msg).catch((err) =>
        console.error("[DuelRoom] submitAnswer error:", err),
      );
    });

    this.onMessage("skip", (client: Client) => {
      try {
        this.handleSkipRequest(client);
      } catch (err) {
        console.error("[DuelRoom] skip error:", err);
      }
    });
  }

  onJoin(client: Client, _options: unknown, auth: PlayerAuth) {
    client.userData = auth;
    console.log("[DuelRoom] onJoin", {
      userId: auth.userId.slice(0, 8),
      name: auth.name,
      clients: this.clients.length,
    });
  }

  onLeave(client: Client, _code?: number) {
    const auth = client.userData as PlayerAuth | undefined;
    console.log("[DuelRoom] onLeave", { userId: auth?.userId.slice(0, 8), code: _code });
  }

  onDispose() {
    console.log("[DuelRoom] onDispose", { duelId: this.duelId });
    this.clearAllTimers();
    this.s.phase="finished";
    this.engineRound=null;
  }

  // ─── Game flow ─────────────────────────────────────────────────────────────

  private tryStartGame() {
    if (this.gameStarted) return;
    if (this.readyPlayers.size < 2) return;
    this.gameStarted = true;

    console.log("[DuelRoom] startGame", { duelId: this.duelId });

    const now = Math.floor(Date.now() / 1000);
    this.s.phase = "playing";
    this.s.duelStartedAt = now;
    this.s.exerciseStartedAt = now;

    this.broadcastExercise();

    this.duelTimer = setTimeout(() => this.finishDuel(), DUEL_DURATION_SECONDS * 1000);
    this.startExerciseTimer();
  }

  private startExerciseTimer() {
    this.clearExerciseTimer();
    this.exerciseTimer = setTimeout(async () => {
      if (this.s.phase !== "playing") return;
      console.log("[DuelRoom] exercise timeout", { duelId: this.duelId });

      this.broadcast("exercise_timeout", {
        correctAnswer: this.getCorrectAnswerPayload(),
      });

      await this.advanceToNextExercise();
    }, EXERCISE_TIMEOUT_SECONDS * 1000);
  }

  private async advanceToNextExercise() {
    if (this.advancing || this.s.phase !== "playing") return;
    this.advancing = true;
    try {
      this.engineRound = null;
      this.clearExerciseTimer();
      this.clearGraceTimer();
      this.solvedPlayers.clear();
      this.skipRequests.clear();
      await this.loadNextExercise();
      if (this.s.phase !== "playing") return;
      this.s.exerciseStartedAt = Math.floor(Date.now() / 1000);
      this.broadcastExercise();
      this.startExerciseTimer();
    } finally {
      this.advancing = false;
    }
  }

  private async handleSubmitAnswer(client: Client, msg: SubmitAnswerMsg) {
    if (this.s.phase !== "playing") return;
    const auth = client.userData as PlayerAuth;
    const round=this.engineRound;
    if (!round) {
      client.send("answer_result", {requestId:msg.requestId,instanceId:msg.instanceId,state:"error"});
      return;
    }
    let correct = false;
    if(round) {
      if(this.gradingPlayers.has(auth.userId)||this.solvedPlayers.has(auth.userId)||msg.instanceId!==round.id||msg.questionId!==round.questionId||typeof msg.requestId!=="string"||msg.requestId.length>80) return;
      this.gradingPlayers.add(auth.userId);
      try {
        const verdict=await engineRun("gradeAnswer",{official:round.official,submission:{schemaVersion:5,instanceId:round.id,questionId:round.questionId,answer:msg.rawAnswer}});
        if(this.engineRound!==round||this.s.phase!=="playing") return;
        if(verdict.instanceId!==round.id||verdict.questionId!==round.questionId||!["correct","incorrect","invalid","indeterminate","error"].includes(verdict.state)) throw new Error("Invalid Engine verdict");
        const q=round.official.elements.find((e:any)=>e.id===round.questionId);
        const reveal=verdict.state==="correct"?{latex:q?.expected?.math?.displayLatex,texts:q?.expected?.variants}:undefined;
        if(verdict.state!=="correct"&&verdict.state!=="incorrect") {
          client.send("answer_result",{requestId:msg.requestId,instanceId:round.id,state:verdict.state});return;
        }
        await recordAttempt(this.duelId,auth.userId,1,JSON.stringify(msg.rawAnswer),verdict.state==="correct",Math.max(0,Date.now()-this.s.exerciseStartedAt*1000),round.id);
        if(this.engineRound!==round||this.s.phase!=="playing") return;
        client.send("answer_result",{requestId:msg.requestId,instanceId:round.id,state:verdict.state,reveal});
        correct=verdict.state==="correct";
      }catch {client.send("answer_result",{requestId:msg.requestId,instanceId:round.id,state:"error"});return;}
      finally {this.gradingPlayers.delete(auth.userId);}
    }

    if (!correct) return;
    // Already solved by this player for this exercise.
    if (this.solvedPlayers.has(auth.userId)) return;

    this.solvedPlayers.add(auth.userId);

    const isFirstSolver = this.solvedPlayers.size === 1;
    const isP1 = auth.userId === this.s.player1Id;
    if (isP1) this.s.player1Score++;
    else this.s.player2Score++;

    console.log("[DuelRoom] point scored", {
      userId: auth.userId.slice(0, 8),
      p1Score: this.s.player1Score,
      p2Score: this.s.player2Score,
    });

    // Inform clients who scored and whether we are in a 5‑second grace period.
    this.broadcast("point_scored", {
      scoredBy: auth.userId,
      graceSeconds: 5,
      isFirstSolver,
    });

    // First solver: start 5‑second grace for the opponent.
    if (isFirstSolver) {
      this.clearExerciseTimer();
      this.startGraceTimer();
      return;
    }

    // Second solver within the grace window: move on immediately.
    this.clearGraceTimer();
    await this.advanceToNextExercise();
  }

  // ─── Grace timer (second player has 5s to finish) ────────────────────────────

  private startGraceTimer() {
    this.clearGraceTimer();
    this.graceTimer = setTimeout(async () => {
      if (this.s.phase !== "playing") return;
      // If only one player solved when grace expires, just move on.
      await this.advanceToNextExercise();
    }, 5 * 1000);
  }

  private clearGraceTimer() {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  private finishDuel() {
    if (this.s.phase === "finished") return;
    console.log("[DuelRoom] finishDuel", {
      duelId: this.duelId,
      p1: this.s.player1Score,
      p2: this.s.player2Score,
    });
    this.clearAllTimers();
    this.s.phase = "finished";

    const p1 = this.s.player1Score;
    const p2 = this.s.player2Score;
    if (p1 > p2) this.s.winnerId = this.s.player1Id;
    else if (p2 > p1) this.s.winnerId = this.s.player2Id;

    saveDuelResult(this.duelId, p1, p2, this.s.winnerId || null)
      .catch((err) => console.error("[DuelRoom] saveDuelResult failed:", err));
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async loadNextExercise() {
    const { row, variables } = await getRandomExercise();
    this.currentExercise = row;
    this.currentVariables = variables;
    if(!row.catalog_id)throw new Error("Canonical Engine exercise required");
    this.engineRound=await prepareEngineRound(row,this.duelId,++this.roundNumber);
    this.solvedPlayers.clear();
    this.skipRequests.clear();
    console.log("[DuelRoom] loadNextExercise", {
      id: row.id,
      title: row.app_title || row.title,
    });
  }

  private broadcastExercise() {
    if (!this.currentExercise) return;
    this.broadcast("exercise", {
      exercise: {...this.currentExercise,content:{variables:[],elements:[]}},
      variables: this.currentVariables,
      ...(this.engineRound?{instance:this.engineRound.projected}:{}),
    });
  }

  private getCorrectAnswerPayload(): { expression: string; elementId: number } | null {
    if(this.engineRound) {
      const q=this.engineRound.official.elements.find((e:any)=>e.id===this.engineRound!.questionId);
      return {expression:q?.expected?.math?.displayLatex??q?.expected?.variants?.[0]??"",elementId:1};
    }
    return null;
  }

  private clearExerciseTimer() {
    if (this.exerciseTimer) { clearTimeout(this.exerciseTimer); this.exerciseTimer = null; }
  }

  private clearAllTimers() {
    this.clearExerciseTimer();
    this.clearGraceTimer();
    if (this.duelTimer) { clearTimeout(this.duelTimer); this.duelTimer = null; }
  }

  // ─── Skip handling ──────────────────────────────────────────────────────────

  /** Called when a player clicks "Passer" on the frontend. */
  private handleSkipRequest(client: Client) {
    if (this.s.phase !== "playing") return;
    if (!this.currentExercise) return;

    const auth = client.userData as PlayerAuth;
    // If someone already solved, we no longer allow skipping this exercise.
    if (this.solvedPlayers.size > 0) return;

    if (this.skipRequests.has(auth.userId)) return;
    this.skipRequests.add(auth.userId);

    // Notify the other player that a skip was requested.
    this.broadcast("skip_proposed", { by: auth.userId });

    // Both players agreed to skip → move to next exercise with no points awarded.
    if (this.skipRequests.size >= 2) {
      this.clearExerciseTimer();
      this.clearGraceTimer();
      this.skipRequests.clear();
      this.solvedPlayers.clear();
      this.broadcast("exercise_skipped", {});
      this.advanceToNextExercise().catch((err) =>
        console.error("[DuelRoom] advanceToNextExercise after skip failed:", err),
      );
    }
  }
}
