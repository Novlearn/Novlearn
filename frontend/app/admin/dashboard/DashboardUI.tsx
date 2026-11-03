/** Micro-composants de presentation du dashboard : squelettes, tooltip, KPI. */
import type React from "react";

import { F } from "./constants";

/** Squelette de carte KPI pendant le chargement. */
export function SkCard() {
  return (
    <div className="bg-slate-800/60 rounded-2xl p-6 border border-slate-700/50 animate-pulse h-36" />
  );
}

/** Squelette de graphique pendant le chargement. */
export function SkChart({ h = 260 }: { h?: number }) {
  return (
    <div
      className="bg-slate-800/60 rounded-2xl border border-slate-700/50 animate-pulse"
      style={{ height: h }}
    />
  );
}

/** Tooltip recharts commun a tous les graphiques du dashboard. */
export function CT({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900/95 border border-slate-700 rounded-xl px-4 py-3 shadow-xl text-sm">
      <p className="text-slate-400 mb-1" style={F}>
        {label}
      </p>
      {payload.map((p: any) => (
        <p
          key={p.dataKey}
          className="font-bold"
          style={{ color: p.color, ...F }}
        >
          {p.name} : {p.value}
        </p>
      ))}
    </div>
  );
}

/** Carte d'indicateur cle avec halo colore. */
export function KpiCard({
  label,
  value,
  icon,
  grad,
  border,
  sub,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  grad: string;
  border: string;
  sub?: string;
}) {
  return (
    <div
      className={`relative bg-slate-800/60 backdrop-blur-sm rounded-2xl p-6 border ${border} overflow-hidden hover:scale-[1.02] transition-transform`}
    >
      <div
        className={`absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-20 blur-2xl ${grad}`}
      />
      <div className="relative z-10">
        <div
          className={`inline-flex p-3 rounded-xl ${grad} bg-opacity-20 mb-4`}
        >
          {icon}
        </div>
        <p
          className="text-4xl font-bold text-white"
          style={{ ...F, fontWeight: 700 }}
        >
          {value.toLocaleString("fr-FR")}
        </p>
        <p className="text-sm text-slate-400 mt-1" style={F}>
          {label}
        </p>
        {sub && (
          <p className="text-xs text-slate-500 mt-0.5" style={F}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}
