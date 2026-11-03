"use client";

/**
 * Chargement des donnees du tableau de bord d'administration.
 *
 * Regroupe l'etat des douze series affichees et la requete unique qui les
 * remplit, pour que la page ne porte plus que le rendu.
 */
import { useAuth } from "@/app/contexts/AuthContext";
import { supabase } from "@/app/lib/supabase";
import { useCallback, useEffect, useState } from "react";

import type {
  AttemptCorrPoint,
  DauPoint,
  EngagementPoint,
  FbCategoryPoint,
  SuccessRatePoint,
  UserGrowthPoint,
} from "./DetailedCharts";
import { CH_COLORS, FB_COLORS, RANGES, dd, ww } from "./constants";
import type {
  ChapterSlice,
  DailyAttempt,
  KpiData,
  TimeRange,
  WeeklyTrend,
} from "./types";

export function useDashboardData() {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState<KpiData>({
    exercises: 0,
    attempts: 0,
    feedbacks: 0,
    duels: 0,
  });
  const [daily, setDaily] = useState<DailyAttempt[]>([]);
  const [pie, setPie] = useState<ChapterSlice[]>([]);
  const [weekly, setWeekly] = useState<WeeklyTrend[]>([]);
  // detailed
  const [fbCat, setFbCat] = useState<FbCategoryPoint[]>([]);
  const [successRate, setSuccessRate] = useState<SuccessRatePoint[]>([]);
  const [attemptCorr, setAttemptCorr] = useState<AttemptCorrPoint[]>([]);
  // investor metrics
  const [dau, setDau] = useState<DauPoint[]>([]);
  const [dauNoAdmin, setDauNoAdmin] = useState<DauPoint[]>([]);
  const [userGrowth, setUserGrowth] = useState<UserGrowthPoint[]>([]);
  const [engagement, setEngagement] = useState<EngagementPoint[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [retentionPct, setRetentionPct] = useState(0);
  const [avgAttemptsPerUser, setAvgAttemptsPerUser] = useState(0);
  const [range, setRange] = useState<TimeRange>("30d");

  const fetchAll = useCallback(
    async (r: TimeRange = range) => {
      setLoading(true);
      try {
        const rangeItem = RANGES.find((x) => x.id === r)!;
        let days = rangeItem.days;
        let since = new Date();
        if (r === "all") {
          since = new Date(2026, 0, 31);
          days = Math.max(
            1,
            Math.ceil(
              (new Date().getTime() - since.getTime()) / (1000 * 3600 * 24),
            ) + 1,
          );
        } else {
          since.setDate(since.getDate() - (days - 1));
        }
        since.setHours(0, 0, 0, 0);
        const sinceIso = since.toISOString();
        const useDay = days <= 30;
        const monOf = (s: string) => {
          const d = new Date(s);
          const dw = d.getDay() === 0 ? 6 : d.getDay() - 1;
          d.setDate(d.getDate() - dw);
          d.setHours(0, 0, 0, 0);
          return d.toISOString().slice(0, 10);
        };
        const nW = Math.ceil(days / 7) + 1;
        const mkDay = <T,>(f: () => T) => {
          const m = new Map<string, T>();
          for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            m.set(d.toISOString().slice(0, 10), f());
          }
          return m;
        };
        const mkWeek = <T,>(f: () => T) => {
          const m = new Map<string, T>();
          for (let i = nW - 1; i >= 0; i--) {
            const d = new Date();
            const dw = d.getDay() === 0 ? 6 : d.getDay() - 1;
            d.setDate(d.getDate() - dw - i * 7);
            d.setHours(0, 0, 0, 0);
            m.set(d.toISOString().slice(0, 10), f());
          }
          return m;
        };
        const mkB = <T,>(f: () => T) => (useDay ? mkDay(f) : mkWeek(f));
        const gKey = (s: string, m: Map<string, any>) => {
          const k = useDay ? s.slice(0, 10) : monOf(s);
          return m.has(k) ? k : null;
        };
        const lbl = (iso: string) =>
          useDay ? dd(new Date(iso)) : ww(new Date(iso));
        const mkey = (s: string, m: Map<string, any>) => {
          const k = monOf(s);
          return m.has(k) ? k : null;
        };
        // KPIs (all-time)
        const [exR, attR, fbR, dR] = await Promise.all([
          supabase
            .from("exercises")
            .select("id", { count: "exact", head: true }),
          supabase
            .from("exercise_attempts")
            .select("id", { count: "exact", head: true }),
          supabase
            .from("feedbacks")
            .select("id", { count: "exact", head: true }),
          supabase.from("duels").select("id", { count: "exact", head: true }),
        ]);
        setKpi({
          exercises: exR.count ?? 0,
          attempts: attR.count ?? 0,
          feedbacks: fbR.count ?? 0,
          duels: dR.count ?? 0,
        });
        // attempts
        const { data: attRaw } = await supabase
          .from("exercise_attempts")
          .select("attempted_at,is_correct,user_id,exercise_id")
          .gte("attempted_at", sinceIso)
          .order("attempted_at", { ascending: true });
        const dMap = mkB(() => ({ t: 0, c: 0 }));
        (attRaw ?? []).forEach((a) => {
          const k = gKey(a.attempted_at, dMap);
          if (k) {
            const v = dMap.get(k)!;
            v.t++;
            if (a.is_correct) v.c++;
          }
        });
        setDaily(
          Array.from(dMap.entries()).map(([iso, v]) => ({
            date: lbl(iso),
            tentatives: v.t,
            reussies: v.c,
          })),
        );
        const cMap = mkB(() => ({ ok: 0, ko: 0 }));
        (attRaw ?? []).forEach((a) => {
          const k = gKey(a.attempted_at, cMap);
          if (k) {
            const v = cMap.get(k)!;
            if (a.is_correct) v.ok++;
            else v.ko++;
          }
        });
        setAttemptCorr(
          Array.from(cMap.entries()).map(([iso, v]) => ({
            date: lbl(iso),
            correctes: v.ok,
            incorrectes: v.ko,
          })),
        );
        // exercises pie (all-time)
        const { data: exRaw } = await supabase
          .from("exercises")
          .select("chapter");
        const chMap = new Map<string, number>();
        (exRaw ?? []).forEach((e) => {
          const c = e.chapter ?? "Autre";
          chMap.set(c, (chMap.get(c) ?? 0) + 1);
        });
        setPie(
          Array.from(chMap.entries()).map(([n, v], i) => ({
            name: n,
            value: v,
            color: CH_COLORS[n] ?? FB_COLORS[i % FB_COLORS.length],
          })),
        );
        // weekly trends chart
        const [waR, wdR, wfR] = await Promise.all([
          supabase
            .from("exercise_attempts")
            .select("attempted_at")
            .gte("attempted_at", sinceIso),
          supabase
            .from("duels")
            .select("created_at")
            .gte("created_at", sinceIso),
          supabase
            .from("feedbacks")
            .select("created_at")
            .gte("created_at", sinceIso),
        ]);
        const tMap = mkWeek(() => ({ tentatives: 0, duels: 0, feedbacks: 0 }));
        (waR.data ?? []).forEach((r) => {
          const k = mkey(r.attempted_at, tMap);
          if (k) tMap.get(k)!.tentatives++;
        });
        (wdR.data ?? []).forEach((r) => {
          const k = mkey(r.created_at, tMap);
          if (k) tMap.get(k)!.duels++;
        });
        (wfR.data ?? []).forEach((r) => {
          const k = mkey(r.created_at, tMap);
          if (k) tMap.get(k)!.feedbacks++;
        });
        setWeekly(
          Array.from(tMap.entries()).map(([iso, v]) => ({
            week: ww(new Date(iso)),
            ...v,
          })),
        );
        // feedback by category
        const { data: fbRaw } = await supabase
          .from("feedbacks")
          .select("created_at,category")
          .gte("created_at", sinceIso);
        const fbMap = mkB(() => ({
          bug: 0,
          suggestion: 0,
          content_error: 0,
          other: 0,
        }));
        (fbRaw ?? []).forEach((f) => {
          const k = gKey(f.created_at, fbMap);
          if (!k) return;
          const v = fbMap.get(k)!;
          if (f.category === "bug") v.bug++;
          else if (f.category === "suggestion" || f.category === "feature")
            v.suggestion++;
          else if (f.category === "content_error" || f.category === "content")
            v.content_error++;
          else v.other++;
        });
        setFbCat(
          Array.from(fbMap.entries()).map(([iso, v]) => ({
            date: lbl(iso),
            ...v,
          })),
        );
        // success rate + investor metrics
        const { data: allAtt } = await supabase
          .from("exercise_attempts")
          .select("exercise_id,is_correct,user_id,attempted_at")
          .gte("attempted_at", sinceIso);
        if (allAtt && allAtt.length > 0) {
          const exIds = [
            ...new Set(allAtt.map((a) => a.exercise_id).filter(Boolean)),
          ];
          const { data: exCh } = await supabase
            .from("exercises")
            .select("id,chapter")
            .in("id", exIds as number[]);
          const exChMap = new Map<number, string>(
            (exCh ?? []).map((e) => [e.id, e.chapter ?? "Autre"]),
          );
          const byChap = new Map<string, { ok: number; total: number }>();
          allAtt.forEach((a) => {
            const ch = exChMap.get(a.exercise_id) ?? "Autre";
            if (!byChap.has(ch)) byChap.set(ch, { ok: 0, total: 0 });
            const v = byChap.get(ch)!;
            v.total++;
            if (a.is_correct) v.ok++;
          });
          setSuccessRate(
            Array.from(byChap.entries())
              .map(([ch, v]) => ({
                chapter: ch.length > 14 ? ch.slice(0, 14) + "…" : ch,
                taux: v.total > 0 ? Math.round((v.ok / v.total) * 100) : 0,
                total: v.total,
              }))
              .sort((a, b) => b.taux - a.taux),
          );
          const dauMap = mkB(() => new Set<string>());
          allAtt.forEach((a) => {
            const k = gKey(a.attempted_at, dauMap);
            if (k && a.user_id) dauMap.get(k)!.add(a.user_id);
          });
          setDau(
            Array.from(dauMap.entries()).map(([iso, s]) => ({
              date: lbl(iso),
              dau: s.size,
            })),
          );
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id,created_at,role");
          const adminIds = new Set(
            (profiles ?? []).filter((p) => p.role === "admin").map((p) => p.id),
          );
          const dauNoAdminMap = mkB(() => new Set<string>());
          allAtt.forEach((a) => {
            const k = gKey(a.attempted_at, dauNoAdminMap);
            if (k && a.user_id && !adminIds.has(a.user_id))
              dauNoAdminMap.get(k)!.add(a.user_id);
          });
          setDauNoAdmin(
            Array.from(dauNoAdminMap.entries()).map(([iso, s]) => ({
              date: lbl(iso),
              dau: s.size,
            })),
          );
          const totalU = profiles?.length ?? 0;
          setTotalUsers(totalU);
          setAvgAttemptsPerUser(
            totalU > 0 ? Math.round(allAtt.length / totalU) : 0,
          );
          const s7 = new Date();
          s7.setDate(s7.getDate() - 6);
          s7.setHours(0, 0, 0, 0);
          const act30 = new Set(
            allAtt.filter((a) => a.user_id).map((a) => a.user_id),
          );
          const act7 = new Set(
            allAtt
              .filter((a) => a.attempted_at >= s7.toISOString() && a.user_id)
              .map((a) => a.user_id),
          );
          setRetentionPct(
            act30.size > 0 ? Math.round((act7.size / act30.size) * 100) : 0,
          );
          const gMap = mkWeek(() => ({ nouveaux: 0, cumul: 0 }));
          const eMap = mkWeek(() => ({
            attTotal: 0,
            okTotal: 0,
            users: new Set<string>(),
          }));
          (profiles ?? []).forEach((p) => {
            const k = mkey(p.created_at, gMap);
            if (k) gMap.get(k)!.nouveaux++;
          });
          let cum = (profiles ?? []).filter(
            (p) =>
              p.created_at < ([...gMap.keys()].sort()[0] ?? "") + "T00:00:00Z",
          ).length;
          [...gMap.keys()].sort().forEach((k) => {
            cum += gMap.get(k)!.nouveaux;
            gMap.get(k)!.cumul = cum;
          });
          setUserGrowth(
            [...gMap.keys()]
              .sort()
              .map((k) => ({ week: ww(new Date(k)), ...gMap.get(k)! })),
          );
          allAtt.forEach((a) => {
            const k = mkey(a.attempted_at, eMap);
            if (!k) return;
            const v = eMap.get(k)!;
            v.attTotal++;
            if (a.is_correct) v.okTotal++;
            if (a.user_id) v.users.add(a.user_id);
          });
          setEngagement(
            [...eMap.keys()].sort().map((k) => {
              const v = eMap.get(k)!;
              return {
                week: ww(new Date(k)),
                moyAttempts:
                  v.users.size > 0 ? Math.round(v.attTotal / v.users.size) : 0,
                tauxReussite:
                  v.attTotal > 0
                    ? Math.round((v.okTotal / v.attTotal) * 100)
                    : 0,
              };
            }),
          );
        }
      } catch (e) {
        console.error("[Dashboard]", e);
      } finally {
        setLoading(false);
      }
    },
    [range],
  );

  useEffect(() => {
    if (!authLoading && user) fetchAll(range);
  }, [authLoading, user, range, fetchAll]);

  return {
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
  };
}
