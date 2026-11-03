 "use client";

import { Zap } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Layout } from "../../../components/Layout";
import AvatarDisplay from "../../../components/account/AvatarDisplay";
import MathText from "../../../components/ui/MathText";
import { useAuth } from "../../../contexts/AuthContext";
import { getColyseusClient } from "../../../lib/colyseusClient";
import QuestionRenderer from "../../../renderers/QuestionRenderer";
import { Exercise, TextContent, VariableValues } from "../../../types/exercise";
import type { PublicInstance } from "novlearn-exercise-engine";
import type { GradeQuestion, QuestionResult } from "../../../lib/engine/learnerTypes";
import { sessionExercise } from "../../../lib/engine/exerciseView";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExerciseMsg {
  instance?:PublicInstance;
  exercise: {
    id: number;
    title: string;
    app_title?: string | null;
    chapter: string;
    difficulty: string;
    content: { variables: unknown[]; elements: unknown[] };
  };
  variables: VariableValues;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ActiveDuelPage() {
  const params = useParams();
  const router = useRouter();
  const { user, profile } = useAuth();
  const duelId = parseInt(params.id as string);

  const roomRef = useRef<any>(null);
  const engineInstanceRef=useRef<PublicInstance|null>(null);
  const answerRequests=useRef(new Map<string,(result:QuestionResult)=>void>());
  const [connected, setConnected] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phase, setPhase] = useState("waiting");
  const [p1Score, setP1Score] = useState(0);
  const [p2Score, setP2Score] = useState(0);
  const [p1Id, setP1Id] = useState("");
  const [p2Id, setP2Id] = useState("");
  const [p1Name, setP1Name] = useState("");
  const [p2Name, setP2Name] = useState("");
  const [p1AvatarId, setP1AvatarId] = useState<string | undefined>();
  const [p1AvatarColor, setP1AvatarColor] = useState<string | undefined>();
  const [p2AvatarId, setP2AvatarId] = useState<string | undefined>();
  const [p2AvatarColor, setP2AvatarColor] = useState<string | undefined>();
  const [winnerId, setWinnerId] = useState("");
  const [duelStartedAt, setDuelStartedAt] = useState(0);
  const [exStartedAt, setExStartedAt] = useState(0);
  const [duelDuration, setDuelDuration] = useState(300);
  const [exTimeout, setExTimeout] = useState(45);
  const [correctionSec, setCorrectionSec] = useState(5);

  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [variables] = useState<VariableValues>({});
  const [correction, setCorrection] = useState<string | null>(null);
  const exerciseCountRef = useRef(0);
  const submittingRef = useRef(false);

  // Grace / pause state
  const [graceRemaining, setGraceRemaining] = useState<number | null>(null);
  const graceDeadlineRef = useRef<number | null>(null);
  const [firstSolverId, setFirstSolverId] = useState<string | null>(null);

  // Skip state
  const [mySkipRequested, setMySkipRequested] = useState(false);
  const [opponentSkipRequested, setOpponentSkipRequested] = useState(false);

  const [globalRemaining, setGlobalRemaining] = useState(300);
  const [exRemaining, setExRemaining] = useState(45);

  // ─── Connect ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) { router.push("/auth/login"); return; }

    let cancelled = false;

    async function connect() {
      try {
        console.log("[Duel] connecting…", { duelId });
        const { supabase } = await import("../../../lib/supabase");
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Not authenticated");

        const client = getColyseusClient();

        const room = await client.joinOrCreate("duel_room", {
          token: session.access_token,
          duelId,
        });

        if (cancelled) { room.leave(); return; }
        roomRef.current = room;
        console.log("[Duel] joined room", {
          // Colyseus rooms expose id/sessionId at runtime, but TS types may not include them
          roomId: (room as any).id,
          sessionId: (room as any).sessionId,
        });

        // ── State sync ────────────────────────────────────────────────────
        room.onStateChange((state: any) => {
          if (!state) return;
          setPhase(state.phase);
          setP1Score(state.player1Score);
          setP2Score(state.player2Score);
          setP1Id(state.player1Id);
          setP2Id(state.player2Id);
          setP1Name(state.player1Name);
          setP2Name(state.player2Name);
          setWinnerId(state.winnerId);
          setDuelStartedAt(state.duelStartedAt);
          setExStartedAt(state.exerciseStartedAt);
          setDuelDuration(state.duelDurationSeconds);
          setExTimeout(state.exerciseTimeoutSeconds);
          setCorrectionSec(state.correctionDisplaySeconds);
        });

        // ── Exercise (sent by server when game starts and after each solve/timeout) ──
        const handleExercise = (msg: ExerciseMsg) => {
          console.log("[Duel] exercise received", {
            id: msg.exercise.id,
            title: msg.exercise.app_title || msg.exercise.title,
          });
          exerciseCountRef.current++;
          submittingRef.current = false;
          setCorrection(null);
          for(const resolve of answerRequests.current.values()) resolve({state:"error",attempts:0,finished:false});
          answerRequests.current.clear();engineInstanceRef.current=msg.instance??null;
          if(!msg.instance){setLoadError("Le duel nécessite une instance Engine.");setExercise(null);return;}
          setExercise(sessionExercise({sessionId:msg.instance.instanceId,exerciseId:String(msg.exercise.id),versionId:"",instance:msg.instance,metadata:{...msg.exercise,competences:[]},questions:{},status:"active",correct:false,expiresAt:""}));
          setConnected(true);
        };

        // New message name used by the rewritten duel-server
        room.onMessage("exercise", handleExercise);
        room.onMessage("answer_result",(msg:{requestId:string;instanceId:string;state:QuestionResult["state"];reveal?:QuestionResult["reveal"]})=>{
          if(msg.instanceId!==engineInstanceRef.current?.instanceId) return;
          const resolve=answerRequests.current.get(msg.requestId);
          if(resolve){answerRequests.current.delete(msg.requestId);resolve({state:msg.state,attempts:0,finished:msg.state==="correct",reveal:msg.reveal});}
        });

        // ── Someone scored ──────────────────────────────────────────────────
        room.onMessage(
          "point_scored",
          (msg: { scoredBy: string; graceSeconds?: number; isFirstSolver?: boolean }) => {
            console.log("[Duel] point_scored", msg);
            setFirstSolverId(msg.scoredBy);
            setMySkipRequested(false);
            setOpponentSkipRequested(false);

            if (msg.graceSeconds && msg.isFirstSolver) {
              const deadline = nowSec() + msg.graceSeconds;
              graceDeadlineRef.current = deadline;
              setGraceRemaining(msg.graceSeconds);

              const tick = () => {
                if (!graceDeadlineRef.current) return;
                const remaining = Math.max(0, graceDeadlineRef.current - nowSec());
                setGraceRemaining(remaining);
                if (remaining <= 0) {
                  graceDeadlineRef.current = null;
                } else {
                  requestAnimationFrame(tick);
                }
              };
              requestAnimationFrame(tick);
            } else {
              graceDeadlineRef.current = null;
              setGraceRemaining(null);
            }
          },
        );

        // ── Exercise timed out (nobody solved) ──────────────────────────────
        room.onMessage("exercise_timeout", (msg: { correctAnswer: { expression: string; elementId: number } | null }) => {
          console.log("[Duel] exercise_timeout");
          if (msg.correctAnswer?.expression) {
            const question=engineInstanceRef.current?.elements.find(e=>e.type==="question");
            setCorrection(question?.type==="question"&&question.response.format==="latex"?`$${msg.correctAnswer.expression}$`:msg.correctAnswer.expression);
          }
          setGraceRemaining(null);
          graceDeadlineRef.current = null;
          setMySkipRequested(false);
          setOpponentSkipRequested(false);
        });

        // Skip flow
        room.onMessage("skip_proposed", (msg: { by: string }) => {
          if (!user) return;
          const myId = user.id;
          if (msg.by === myId) {
            setMySkipRequested(true);
          } else {
            setOpponentSkipRequested(true);
          }
        });

        room.onMessage("exercise_skipped", () => {
          setMySkipRequested(false);
          setOpponentSkipRequested(false);
          setGraceRemaining(null);
          graceDeadlineRef.current = null;
        });

        room.onLeave((code: number) => {
          console.warn("[Duel] onLeave", { code });
        });

        room.onError((code: number, message?: string) => {
          console.error("[Duel] onError", { code, message });
          if (!cancelled) setLoadError(`Erreur serveur (${code}): ${message}`);
        });

        // Tell server we're ready (all handlers are registered)
        room.send("ready", {});
        console.log("[Duel] sent ready");

      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[Duel] connect error:", msg);
        if (msg.includes("404") || msg.includes("not found")) {
          router.push("/duel");
        } else {
          setLoadError(msg || "Impossible de rejoindre le duel.");
        }
      }
    }

    connect();
    return () => { cancelled = true; roomRef.current?.leave(); roomRef.current = null; };
  }, [duelId, user, router]);

  // ─── Timers ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!duelStartedAt || phase !== "playing") return;
    const tick = () => setGlobalRemaining(Math.max(0, duelDuration - (nowSec() - duelStartedAt)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [duelStartedAt, phase, duelDuration]);

  useEffect(() => {
    if (!exStartedAt || phase !== "playing") return;
    const tick = () => setExRemaining(Math.max(0, exTimeout - (nowSec() - exStartedAt)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [exStartedAt, phase, exTimeout]);

  useEffect(() => {
    if (!correction) return;
    const id = setTimeout(() => setCorrection(null), correctionSec * 1000);
    return () => clearTimeout(id);
  }, [correction, correctionSec]);

  // ─── Fetch avatars ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!p1Id || !p2Id) return;
    async function fetchAvatars() {
      const { supabase } = await import("../../../lib/supabase");
      const { data } = await supabase
        .from("profiles")
        .select("id, avatar_id, avatar_color")
        .in("id", [p1Id, p2Id]);
      if (!data) return;
      for (const p of data) {
        if (p.id === p1Id) { setP1AvatarId(p.avatar_id); setP1AvatarColor(p.avatar_color); }
        if (p.id === p2Id) { setP2AvatarId(p.avatar_id); setP2AvatarColor(p.avatar_color); }
      }
    }
    fetchAvatars();
  }, [p1Id, p2Id]);

  // ─── Submit ───────────────────────────────────────────────────────────────

  // ─── Derived ──────────────────────────────────────────────────────────────

  const isP1 = user?.id === p1Id;
  const myScore = isP1 ? p1Score : p2Score;
  const opponentScore = isP1 ? p2Score : p1Score;
  const myName = isP1 ? p1Name : p2Name;
  const opponentName = isP1 ? p2Name : p1Name;

  const safeGlobal = Math.max(0, globalRemaining);
  const mm = Math.floor(safeGlobal / 60);
  const ss = safeGlobal % 60;
  const formattedTime = `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
  const duelFinished = phase === "finished" || safeGlobal === 0;

  const handleSkipClick = useCallback(() => {
    const room = roomRef.current;
    if (!room || phase !== "playing" || duelFinished || mySkipRequested) return;
    room.send("skip", {});
    setMySkipRequested(true);
  }, [phase, duelFinished, mySkipRequested]);

  const exMm = Math.floor(Math.max(0, exRemaining) / 60);
  const exSs = Math.max(0, exRemaining) % 60;

  let finalTitle = "Duel terminé";
  let finalSub = "";
  if (myScore > opponentScore) { finalTitle = "Victoire !"; finalSub = "Bravo, tu as remporté ce duel."; }
  else if (myScore < opponentScore) { finalTitle = "Défaite"; finalSub = "Ce n'est que partie remise, retente ta chance !"; }
  else { finalTitle = "Égalité"; finalSub = "Vous êtes au coude-à-coude, qui gagnera la prochaine fois ?"; }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <p className="text-red-300 text-xl" style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600 }}>{loadError}</p>
            <button onClick={() => router.push("/duel")} className="px-6 py-3 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500" style={{ fontFamily: "'Fredoka', sans-serif" }}>Retour aux duels</button>
          </div>
        </div>
      </Layout>
    );
  }

  if (!connected || !exercise) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-blue-200" style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}>
              {phase === "waiting" ? "En attente de l'adversaire…" : "Connexion au duel…"}
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex-1 px-4 md:px-8 py-8">
        <div className="max-w-6xl mx-auto space-y-6">

          {/* Scoreboard */}
          <div className="bg-gradient-to-r from-purple-900/40 to-blue-900/40 backdrop-blur-sm rounded-3xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <AvatarDisplay
                  avatarId={isP1 ? p1AvatarId : p2AvatarId}
                  avatarColor={isP1 ? p1AvatarColor : p2AvatarColor}
                  size="md"
                />
                <div>
                  <p className="text-white text-lg" style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}>{myName || "Vous"}</p>
                  <p className="text-blue-200 text-3xl" style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}>{myScore}</p>
                </div>
              </div>
              <div className="text-center">
                <p className="text-white text-4xl" style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}>VS</p>
                <div className="flex flex-col items-center gap-1 mt-2 text-yellow-300">
                  <div className="flex items-center gap-2"><Zap className="w-5 h-5" /><p style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600 }}>{duelFinished ? "Duel terminé" : "En direct"}</p></div>
                  <p className="text-sm text-yellow-200" style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600 }}>Temps restant : {formattedTime}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 flex-row-reverse">
                <AvatarDisplay
                  avatarId={isP1 ? p2AvatarId : p1AvatarId}
                  avatarColor={isP1 ? p2AvatarColor : p1AvatarColor}
                  size="md"
                />
                <div className="text-right">
                  <p className="text-white text-lg" style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}>{opponentName || "Adversaire"}</p>
                  <p className="text-purple-200 text-3xl" style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}>{opponentScore}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Finished */}
          {duelFinished ? (
            <div className="relative overflow-hidden bg-slate-900/70 backdrop-blur-sm rounded-3xl p-8 shadow-[0_10px_40px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)]">
              {/* Win / lose animation */}
              <div
                className={`pointer-events-none absolute inset-0 opacity-60 mix-blend-screen ${
                  myScore > opponentScore
                    ? "bg-[radial-gradient(circle_at_top,_#22c55e40,_transparent_60%),radial-gradient(circle_at_bottom,_#38bdf840,_transparent_60%)] animate-pulse"
                    : myScore < opponentScore
                      ? "bg-[radial-gradient(circle_at_top,_#f9737340,_transparent_60%),radial-gradient(circle_at_bottom,_#fb718540,_transparent_60%)] animate-[pulse_2.5s_ease-in-out_infinite]"
                      : "bg-[radial-gradient(circle,_#38bdf840,_transparent_60%)]"
                }`}
              />
              <div className="relative z-10">
                <div className="text-center space-y-3">
                  <h2
                    className={`text-3xl text-white ${
                      myScore > opponentScore
                        ? "animate-[bounce_1.4s_ease-out_1]"
                        : myScore < opponentScore
                          ? "animate-[fadeIn_0.8s_ease-out_1]"
                          : ""
                    }`}
                    style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}
                  >
                    {finalTitle}
                  </h2>
                  <p className="text-slate-200" style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}>{finalSub}</p>
                </div>
                <div className="mt-6 flex items-center justify-center gap-10">
                  <div className={`text-center ${myScore > opponentScore ? "scale-110 drop-shadow-[0_0_25px_rgba(34,197,94,0.7)]" : ""}`}>
                    <p className="text-sm text-slate-300 mb-1">Vous</p>
                    <p className="text-3xl text-blue-200" style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}>{myScore}</p>
                  </div>
                  <div className="text-slate-400 text-lg">-</div>
                  <div className={`text-center ${myScore < opponentScore ? "scale-110 drop-shadow-[0_0_25px_rgba(248,113,113,0.7)]" : ""}`}>
                    <p className="text-sm text-slate-300 mb-1">{opponentName}</p>
                    <p className="text-3xl text-purple-200" style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}>{opponentScore}</p>
                  </div>
                </div>
                <div className="mt-8 flex justify-center">
                  <button
                    onClick={() => router.push("/duel")}
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-500 text-white font-semibold shadow-lg hover:scale-105 transition-transform"
                    style={{ fontFamily: "'Fredoka', sans-serif" }}
                  >
                    Retour aux duels
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Correction banner */}
              {correction && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-200" style={{ fontFamily: "'Fredoka', sans-serif" }}>
                  <p className="text-sm font-semibold text-amber-300 mb-1">Correction (exercice précédent)</p>
                  <p className="text-white">
                    <span className="text-amber-200/90">Bonne réponse : </span>
                    <MathText content={correction} variables={{}} autoLatex={true} />
                  </p>
                </div>
              )}

              {/* Exercise */}
              <div className="bg-slate-800/60 backdrop-blur-sm rounded-3xl p-8 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)]">
                <div className="mb-6">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <h2 className="text-white text-2xl" style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}>
                      {exercise.app_title || exercise.title}
                    </h2>
                    <span className="bg-amber-500/20 text-amber-200 px-3 py-1 rounded-full text-sm tabular-nums" style={{ fontFamily: "'Fredoka', sans-serif" }}>
                      Question : {exMm}:{exSs.toString().padStart(2, "0")}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="bg-blue-500/20 text-blue-200 px-3 py-1 rounded-full text-sm" style={{ fontFamily: "'Fredoka', sans-serif" }}>{exercise.chapter}</span>
                    <span className="bg-purple-500/20 text-purple-200 px-3 py-1 rounded-full text-sm" style={{ fontFamily: "'Fredoka', sans-serif" }}>{exercise.difficulty}</span>
                  </div>
                </div>

                <div className="space-y-6">
                  {/* Grace / pause banners */}
                  {graceRemaining !== null && graceRemaining > 0 && user && firstSolverId && (
                    <div className="mb-4 rounded-xl border border-amber-400/60 bg-amber-500/10 px-4 py-3 text-amber-100" style={{ fontFamily: "'Fredoka', sans-serif" }}>
                      {user.id === firstSolverId ? (
                        <p className="text-sm">
                          Ton adversaire a <span className="font-semibold tabular-nums">{Math.ceil(graceRemaining)}</span> secondes pour finir cet exercice.
                        </p>
                      ) : (
                        <p className="text-sm">
                          Ton adversaire a déjà réussi. Tu as{" "}
                          <span className="font-semibold tabular-nums">{Math.ceil(graceRemaining)}</span>{" "}
                          secondes pour terminer et obtenir l'égalité.
                        </p>
                      )}
                    </div>
                  )}

                  {exercise.elements.map((element) => {
                    if(element.type==="equation") return <div key={element.id} className="text-white text-lg"><MathText content={`$$${element.content.latex}$$`} variables={variables}/></div>;
                    if (element.type === "text") {
                      return (
                        <div key={element.id} className="text-white text-lg">
                          <MathText content={(element.content as TextContent).text} variables={variables} autoLatex={true} />
                        </div>
                      );
                    }
                    if (element.type === "question") {
                      const q = element.content as any;
                      const rawFormat = q.answerFormat ?? q.answerType ?? "number";
                      const answerFormat = rawFormat === "numeric" ? "number" : rawFormat;

                      return (
                        <QuestionRenderer
                          gradeAnswer={async(answer)=>{
                            const instance=engineInstanceRef.current!;
                            const question=instance.elements.find(e=>e.type==="question")!;
                            const requestId=crypto.randomUUID();
                            return new Promise<QuestionResult>((resolve)=>{
                              const timer=setTimeout(()=>{answerRequests.current.delete(requestId);resolve({state:"error",attempts:0,finished:false});},15000);
                              answerRequests.current.set(requestId,result=>{clearTimeout(timer);resolve(result);});
                              roomRef.current?.send("submitAnswer",{requestId,instanceId:instance.instanceId,questionId:question.id,rawAnswer:answer});
                            });
                          }}
                          key={`${exercise.id}-${element.id}`}
                          content={{ ...q, correctAnswer: "", answerFormat }}
                          variables={variables}
                          maxAttempts={999}
                          allowHint={false}
                        />
                      );
                    }
                    return null;
                  })}
                </div>
              </div>

              <div className="mt-4 flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={handleSkipClick}
                  disabled={mySkipRequested || !!(graceRemaining && graceRemaining > 0)}
                  className={`px-5 py-2 rounded-full text-sm font-semibold border transition-all ${
                    mySkipRequested
                      ? "border-slate-500 text-slate-300 bg-slate-800/60 cursor-not-allowed"
                      : "border-slate-600 text-slate-100 bg-slate-900/60 hover:bg-slate-800"
                  }`}
                  style={{ fontFamily: "'Fredoka', sans-serif" }}
                >
                  {mySkipRequested ? "En attente de la confirmation de ton adversaire..." : "Passer cet exercice"}
                </button>

                {opponentSkipRequested && !mySkipRequested && (
                  <p
                    className="text-amber-200 text-xs text-center max-w-xl"
                    style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}
                  >
                    Ton adversaire souhaite passer cet exercice. Si tu cliques aussi sur
                    « Passer cet exercice », vous passerez au suivant sans attribuer de points.
                  </p>
                )}

                <p className="text-blue-200 text-sm text-center" style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}>
                  {`Pendant ${Math.floor(duelDuration / 60)} min, enchaîne les exercices. Premier à répondre correctement = +1 point. Si vous répondez tous les deux correctement dans les 5 dernières secondes, l'exercice compte pour égalité.`}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
