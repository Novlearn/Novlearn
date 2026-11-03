"use client";

import { Layout } from "@/app/components/Layout";
import {
  Activity,
  BookOpen,
  Download,
  MessageSquare,
  RefreshCw,
  Swords,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DetailedCharts } from "./DetailedCharts";

import { AX, F, RANGES } from "./constants";
import { CT, KpiCard, SkCard, SkChart } from "./DashboardUI";
import { useDashboardData } from "./useDashboardData";
import { useDashboardPdfExport } from "./useDashboardPdfExport";

// ── Main ──────────────────────────────────────────────────────
export default function AdminDashboard() {
  const {
    authLoading,
    loading,
    kpi,
    daily,
    pie,
    weekly,
    fbCat,
    successRate,
    attemptCorr,
    dau,
    dauNoAdmin,
    userGrowth,
    engagement,
    totalUsers,
    retentionPct,
    avgAttemptsPerUser,
    range,
    setRange,
    refetch: fetchAll,
  } = useDashboardData();
  const { printRef, exporting, exportPdf } = useDashboardPdfExport();


  if (authLoading)
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-10 h-10 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin" />
        </div>
      </Layout>
    );

  return (
    <Layout>
      <div className="flex-1 pb-12 overflow-y-auto">
        <div
          ref={printRef}
          className="max-w-7xl mx-auto px-6 md:px-10 pt-8 pb-8 space-y-8 bg-[#020817]"
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1
                  id="dashboard-admin-title"
                  className="text-4xl font-bold bg-gradient-to-r from-white via-blue-200 to-indigo-300 bg-clip-text text-transparent"
                  style={{ ...F, fontWeight: 700 }}
                >
                  Dashboard Admin
                </h1>
                <p className="text-slate-400 mt-1 text-sm" style={F}>
                  Suivi en temps réel des indicateurs Novlearn
                </p>
              </div>
              <div id="dashboard-admin-buttons" className="flex gap-3">
                <button
                  onClick={() => fetchAll(range)}
                  disabled={loading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-slate-700/80 hover:bg-slate-600/80 disabled:opacity-50 rounded-xl border border-slate-600/50 transition-all text-white text-sm"
                  style={F}
                >
                  <RefreshCw
                    className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
                  />{" "}
                  Actualiser
                </button>
                <button
                  onClick={exportPdf}
                  disabled={exporting || loading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600/80 hover:bg-indigo-500/80 disabled:opacity-50 rounded-xl border border-indigo-500/50 transition-all text-white text-sm shadow-lg shadow-indigo-900/30"
                  style={F}
                >
                  <Download
                    className={`w-4 h-4 ${exporting ? "animate-bounce" : ""}`}
                  />
                  {exporting ? "Export..." : "Exporter PDF"}
                </button>
              </div>
            </div>
            {/* Range selector */}
            <div className="flex gap-1 bg-slate-800/80 rounded-xl p-1 border border-slate-700/50 w-fit">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRange(r.id)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${range === r.id ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900/40" : "text-slate-400 hover:text-white hover:bg-slate-700/50"}`}
                  style={F}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {loading ? (
              <>
                <SkCard />
                <SkCard />
                <SkCard />
                <SkCard />
              </>
            ) : (
              <>
                <KpiCard
                  label="Exercices créés"
                  value={kpi.exercises}
                  icon={<BookOpen className="w-5 h-5 text-indigo-300" />}
                  grad="bg-indigo-500"
                  border="border-indigo-500/30"
                  sub="Total dans la base"
                />
                <KpiCard
                  label="Tentatives totales"
                  value={kpi.attempts}
                  icon={<Zap className="w-5 h-5 text-cyan-300" />}
                  grad="bg-cyan-500"
                  border="border-cyan-500/30"
                  sub="Toutes sessions"
                />
                <KpiCard
                  label="Feedbacks reçus"
                  value={kpi.feedbacks}
                  icon={<MessageSquare className="w-5 h-5 text-emerald-300" />}
                  grad="bg-emerald-500"
                  border="border-emerald-500/30"
                  sub="Retours utilisateurs"
                />
                <KpiCard
                  label="Duels lancés"
                  value={kpi.duels}
                  icon={<Swords className="w-5 h-5 text-pink-300" />}
                  grad="bg-pink-500"
                  border="border-pink-500/30"
                  sub="Défis entre joueurs"
                />
              </>
            )}
          </div>

          {/* Row 1 : bar + pie */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 bg-slate-800/60 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-6">
              <div className="flex items-center gap-2 mb-5">
                <Activity className="w-5 h-5 text-cyan-400" />
                <h2
                  className="text-lg font-bold text-white"
                  style={{ ...F, fontWeight: 700 }}
                >
                  Tentatives –{" "}
                  {RANGES.find((r) => r.id === range)?.label ?? range}
                </h2>
              </div>
              {loading ? (
                <SkChart />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={daily} barGap={2}>
                    <defs>
                      <linearGradient id="gT" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="#22d3ee"
                          stopOpacity={0.9}
                        />
                        <stop
                          offset="100%"
                          stopColor="#0e7490"
                          stopOpacity={0.6}
                        />
                      </linearGradient>
                      <linearGradient id="gO" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="#34d399"
                          stopOpacity={0.9}
                        />
                        <stop
                          offset="100%"
                          stopColor="#065f46"
                          stopOpacity={0.6}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#334155"
                      strokeOpacity={0.5}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={AX}
                      tickLine={false}
                      axisLine={false}
                      interval={Math.max(
                        0,
                        Math.floor(
                          (RANGES.find((r) => r.id === range)?.days ?? 30) / 8,
                        ) - 1,
                      )}
                    />
                    <YAxis
                      tick={AX}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={<CT />}
                      cursor={{ fill: "rgba(148,163,184,0.08)" }}
                    />
                    <Legend
                      wrapperStyle={{ ...F, fontSize: 13, paddingTop: 12 }}
                      iconType="circle"
                    />
                    <Bar
                      dataKey="tentatives"
                      name="Tentatives"
                      fill="url(#gT)"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="reussies"
                      name="Réussies"
                      fill="url(#gO)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="bg-slate-800/60 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-6">
              <div className="flex items-center gap-2 mb-5">
                <BookOpen className="w-5 h-5 text-indigo-400" />
                <h2
                  className="text-lg font-bold text-white"
                  style={{ ...F, fontWeight: 700 }}
                >
                  Exercices par chapitre
                </h2>
              </div>
              {loading ? (
                <SkChart />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={pie}
                      cx="50%"
                      cy="45%"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {pie.map((e, i) => (
                        <Cell key={i} fill={e.color} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0];
                        return (
                          <div className="bg-slate-900/95 border border-slate-700 rounded-xl px-3 py-2 text-sm shadow-xl">
                            <p className="font-bold text-white" style={F}>
                              {d.name}
                            </p>
                            <p className="text-slate-300" style={F}>
                              {d.value} exercices
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Legend
                      wrapperStyle={{ ...F, fontSize: 11, paddingTop: 8 }}
                      iconType="circle"
                      iconSize={8}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Row 2 : weekly multi-line */}
          <div className="bg-slate-800/60 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-6">
            <div className="flex items-center gap-2 mb-5">
              <TrendingUp className="w-5 h-5 text-amber-400" />
              <h2
                className="text-lg font-bold text-white"
                style={{ ...F, fontWeight: 700 }}
              >
                Tendances – {RANGES.find((r) => r.id === range)?.label ?? range}
              </h2>
            </div>
            {loading ? (
              <SkChart h={300} />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={weekly}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#334155"
                    strokeOpacity={0.5}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="week"
                    tick={AX}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={AX}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    content={<CT />}
                    cursor={{
                      stroke: "#475569",
                      strokeWidth: 1,
                      strokeDasharray: "4 4",
                    }}
                  />
                  <Legend
                    wrapperStyle={{ ...F, fontSize: 13, paddingTop: 16 }}
                    iconType="circle"
                  />
                  <Line
                    type="monotone"
                    dataKey="tentatives"
                    name="Tentatives"
                    stroke="#22d3ee"
                    strokeWidth={3}
                    dot={{
                      r: 4,
                      fill: "#22d3ee",
                      strokeWidth: 2,
                      stroke: "#0f172a",
                    }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="duels"
                    name="Duels"
                    stroke="#f472b6"
                    strokeWidth={3}
                    dot={{
                      r: 4,
                      fill: "#f472b6",
                      strokeWidth: 2,
                      stroke: "#0f172a",
                    }}
                    activeDot={{ r: 6 }}
                    strokeDasharray="6 3"
                  />
                  <Line
                    type="monotone"
                    dataKey="feedbacks"
                    name="Feedbacks"
                    stroke="#34d399"
                    strokeWidth={3}
                    dot={{
                      r: 4,
                      fill: "#34d399",
                      strokeWidth: 2,
                      stroke: "#0f172a",
                    }}
                    activeDot={{ r: 6 }}
                    strokeDasharray="2 4"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Detailed section */}
          {!loading && (
            <DetailedCharts
              fbCategory={fbCat}
              successRate={successRate}
              attemptCorr={attemptCorr}
              dau={dau}
              dauNoAdmin={dauNoAdmin}
              userGrowth={userGrowth}
              engagement={engagement}
              totalUsers={totalUsers}
              retentionPct={retentionPct}
              avgAttemptsPerUser={avgAttemptsPerUser}
            />
          )}

          <p className="text-center text-slate-600 text-xs pb-4" style={F}>
            Données en direct depuis Supabase · Réservé aux administrateurs
          </p>
        </div>
      </div>
    </Layout>
  );
}
