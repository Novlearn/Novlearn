"use client";

import {
  Award,
  Loader2,
  LogIn,
  MessageSquare,
  TrendingUp,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";

import {
  formatChartDate,
  getScoreColor,
  type SubjectData,
} from "./progressUtils";
import { useProgressData } from "./useProgressData";

export function ProgressPage() {
  const router = useRouter();
  const [selectedSubject, setSelectedSubject] = useState<SubjectData | null>(
    null,
  );
  const {
    user,
    authLoading,
    chapters,
    data,
    overview,
    loading,
    error,
    refetch: fetchProgress,
  } = useProgressData();

  // Custom tick pour rendre les labels cliquables
  const CustomAngleAxisTick = ({ payload, x, y, cx, cy }: any) => {
    const subject = data.find((d) => d.subject === payload.value);

    return (
      <g>
        <text
          x={x}
          y={y}
          dy={16}
          textAnchor={x > cx ? "start" : x < cx ? "end" : "middle"}
          className="cursor-pointer hover:opacity-80 transition-opacity text-white"
          onClick={() => subject && setSelectedSubject(subject)}
          style={{
            fontSize: "16px",
            fontFamily: "'Fredoka', sans-serif",
            fontWeight: 700,
            fill: "white",
          }}
        >
          {payload.value}
        </text>
      </g>
    );
  };

  if (selectedSubject) {
    const color = getScoreColor(selectedSubject.progress);
    const hasCompetences = selectedSubject.competences.length > 0;

    return (
      <div className="flex-1 flex items-center justify-center px-4 md:px-8 pb-8">
        <div className="max-w-6xl w-full space-y-4">
          <div className="text-center">
            <h2
              className="text-4xl md:text-5xl tracking-tight bg-gradient-to-r from-white via-blue-100 to-white bg-clip-text text-transparent drop-shadow-[0_2px_8px_rgba(59,130,246,0.5)]"
              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}
            >
              {selectedSubject.subject}
            </h2>
            <p
              className="text-blue-200 mt-2 drop-shadow-md"
              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}
            >
              {hasCompetences
                ? "Score par compétence (moyenne du chapitre)"
                : "Historique des tentatives"}
            </p>
          </div>

          <div className="bg-slate-800/60 backdrop-blur-sm rounded-3xl p-8 md:p-12 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)]">
            <div className="flex items-center justify-between mb-6">
              <button
                onClick={() => setSelectedSubject(null)}
                className="flex items-center gap-2 bg-slate-700/50 hover:bg-slate-600/60 rounded-xl px-4 py-2 transition-all"
              >
                <X className="w-5 h-5 text-white" />
                <span
                  className="text-white"
                  style={{
                    fontFamily: "'Fredoka', sans-serif",
                    fontWeight: 600,
                  }}
                >
                  Retour
                </span>
              </button>
              <div
                className={`${color.text} text-xl`}
                style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}
              >
                Score chapitre : {selectedSubject.progress}/100
              </div>
            </div>

            {hasCompetences ? (
              <div className="space-y-4">
                {selectedSubject.competences.map((comp) => {
                  const pct =
                    comp.max_points > 0
                      ? Math.round((comp.points / comp.max_points) * 100)
                      : 0;
                  const compColor = getScoreColor(pct);
                  return (
                    <div
                      key={comp.id}
                      className="bg-slate-900/40 rounded-2xl p-4 shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className="text-blue-100"
                          style={{
                            fontFamily: "'Fredoka', sans-serif",
                            fontWeight: 600,
                          }}
                        >
                          {comp.name}
                        </span>
                        <span
                          className={compColor.text}
                          style={{
                            fontFamily: "'Fredoka', sans-serif",
                            fontWeight: 700,
                            fontSize: "1.125rem",
                          }}
                        >
                          {comp.points}/{comp.max_points}
                        </span>
                      </div>
                      <div className="relative h-3 bg-slate-700/50 rounded-full overflow-hidden">
                        <div
                          className={`absolute top-0 left-0 h-full rounded-full transition-all duration-500 ${compColor.bg}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-900/40 rounded-xl p-4 text-center">
                  <p
                    className="text-blue-200 mb-1"
                    style={{
                      fontFamily: "'Fredoka', sans-serif",
                      fontWeight: 500,
                    }}
                  >
                    Score (tentatives)
                  </p>
                  <p
                    className={color.text}
                    style={{
                      fontFamily: "'Fredoka', sans-serif",
                      fontWeight: 700,
                      fontSize: "1.5rem",
                    }}
                  >
                    {selectedSubject.progress}
                  </p>
                </div>
                <div className="bg-slate-900/40 rounded-xl p-4 text-center">
                  <p
                    className="text-blue-200 mb-1"
                    style={{
                      fontFamily: "'Fredoka', sans-serif",
                      fontWeight: 500,
                    }}
                  >
                    Exercices
                  </p>
                  <p
                    className="text-white"
                    style={{
                      fontFamily: "'Fredoka', sans-serif",
                      fontWeight: 700,
                      fontSize: "1.5rem",
                    }}
                  >
                    {selectedSubject.totalAnswers}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (authLoading || loading) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 md:px-8 pb-8">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
          <p
            className="text-blue-200"
            style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600 }}
          >
            Chargement de votre progression...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 md:px-8 pb-8">
        <div className="max-w-md w-full text-center bg-slate-800/60 backdrop-blur-sm rounded-3xl p-8 md:p-12 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)]">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-slate-700/60 flex items-center justify-center">
            <MessageSquare className="w-10 h-10 text-blue-400" />
          </div>
          <h2
            className="text-2xl md:text-3xl text-white mb-2"
            style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}
          >
            Connectez-vous pour voir votre progression
          </h2>
          <p
            className="text-blue-200 mb-6"
            style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}
          >
            Vos réponses et votre taux de réussite seront enregistrés et
            affichés ici.
          </p>
          <button
            onClick={() => router.push("/auth/login")}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-b from-blue-500 to-blue-700 text-white shadow-lg hover:scale-105 transition-transform"
            style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}
          >
            <LogIn className="w-5 h-5" />
            Se connecter
          </button>
        </div>
      </div>
    );
  }

  const correctRatePct =
    overview.totalAnswers > 0
      ? Math.round((overview.correctAnswers / overview.totalAnswers) * 100)
      : 0;
  const overviewColor = getScoreColor(correctRatePct);

  return (
    <div className="flex-1 flex items-center justify-center px-4 md:px-8 pb-8">
      <div className="max-w-6xl w-full space-y-8">
        <div className="text-center">
          <h2
            className="text-4xl md:text-5xl tracking-tight bg-gradient-to-r from-white via-blue-100 to-white bg-clip-text text-transparent drop-shadow-[0_2px_8px_rgba(59,130,246,0.5)]"
            style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}
          >
            Ma progression
          </h2>
          <p
            className="text-blue-200 mt-2 drop-shadow-md"
            style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}
          >
            Suivi par matière - Cliquez sur un chapitre
          </p>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-2xl p-4 text-center">
            <p
              className="text-red-200"
              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 500 }}
            >
              {error}
            </p>
          </div>
        )}

        {/* Overview cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-800/60 backdrop-blur-sm rounded-2xl p-5 shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-5 h-5 text-green-400" />
              <span
                className="text-blue-200"
                style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600 }}
              >
                Taux de réussite
              </span>
            </div>
            <p
              className={`text-2xl ${overviewColor.text}`}
              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}
            >
              {correctRatePct}%
            </p>
          </div>
          <div className="bg-slate-800/60 backdrop-blur-sm rounded-2xl p-5 shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="flex items-center gap-2 mb-2">
              <Award className="w-5 h-5 text-yellow-400" />
              <span
                className="text-blue-200"
                style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 600 }}
              >
                Exercices
              </span>
            </div>
            <p
              className="text-white text-2xl"
              style={{ fontFamily: "'Fredoka', sans-serif", fontWeight: 700 }}
            >
              {overview.distinctExercises}
            </p>
          </div>
        </div>

        <div className="bg-slate-800/60 backdrop-blur-sm rounded-3xl p-8 md:p-12 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)]">
          <div className="bg-slate-900/40 rounded-2xl p-2 md:p-4">
            {/* Graphique radar */}
            <ResponsiveContainer width="100%" height={500}>
              <RadarChart data={data} outerRadius="65%">
                <defs>
                  {data.map((item, index) => {
                    const color = getScoreColor(item.progress);
                    return (
                      <linearGradient
                        key={index}
                        id={`gradient-${index}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor={color.stroke}
                          stopOpacity={0.8}
                        />
                        <stop
                          offset="100%"
                          stopColor={color.stroke}
                          stopOpacity={0.3}
                        />
                      </linearGradient>
                    );
                  })}
                </defs>

                <PolarGrid
                  stroke="#475569"
                  strokeWidth={1.5}
                  strokeOpacity={0.5}
                />

                <PolarAngleAxis
                  dataKey="subject"
                  tick={CustomAngleAxisTick}
                  tickLine={false}
                />

                <PolarRadiusAxis
                  angle={90}
                  domain={[0, 100]}
                  tick={{
                    fill: "#94a3b8",
                    fontSize: 12,
                    fontFamily: "'Fredoka', sans-serif",
                  }}
                  tickCount={6}
                  stroke="#475569"
                  strokeOpacity={0.5}
                />

                {/* Progression de l'utilisateur */}
                <Radar
                  name="Ma progression"
                  dataKey="progress"
                  stroke="#3b82f6"
                  strokeWidth={3}
                  fill="url(#gradient-0)"
                  fillOpacity={0.5}
                  dot={(props: any) => {
                    const item = data.find(
                      (d) => d.subject === props.payload.subject,
                    );
                    const color = item
                      ? getScoreColor(item.progress)
                      : { stroke: "#3b82f6" };
                    return (
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={6}
                        fill={color.stroke}
                        strokeWidth={3}
                        stroke="#fff"
                      />
                    );
                  }}
                />

                <Legend
                  wrapperStyle={{
                    fontFamily: "'Fredoka', sans-serif",
                    fontWeight: 600,
                    fontSize: "14px",
                    paddingTop: "20px",
                  }}
                  iconType="circle"
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Liste détaillée des progressions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
            {data.map((item, index) => {
              const color = getScoreColor(item.progress);
              return (
                <div
                  key={index}
                  onClick={() => setSelectedSubject(item)}
                  className="bg-slate-900/40 backdrop-blur-sm rounded-2xl p-4 shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)] cursor-pointer hover:bg-slate-800/60 transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className="text-blue-100"
                      style={{
                        fontFamily: "'Fredoka', sans-serif",
                        fontWeight: 600,
                      }}
                    >
                      {item.subject}
                    </span>
                    <span
                      className={color.text}
                      style={{
                        fontFamily: "'Fredoka', sans-serif",
                        fontWeight: 700,
                        fontSize: "1.125rem",
                      }}
                    >
                      {item.progress}/100
                    </span>
                  </div>
                  <div className="relative h-3 bg-slate-700/50 rounded-full overflow-hidden">
                    <div
                      className={`absolute top-0 left-0 h-full rounded-full transition-all duration-500 ${color.bg}`}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
