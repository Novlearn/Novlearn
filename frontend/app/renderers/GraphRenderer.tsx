"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GraphContent, RendererProps } from "../types/exercise";
import { interpolatePlot } from "../utils/graphPresentation";
import Latex from "../components/ui/Latex";

// Rapport hauteur / largeur du graphe (paysage mathématique standard)
const ASPECT = 2 / 3;

const GraphRenderer: React.FC<RendererProps<GraphContent>> = ({
  content,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const curves = useMemo(() => (content.functions ?? []).map(fn => ({
    sampleAt: fn.samples ? (x:number) => interpolatePlot(fn.samples!, x, content.xMin, content.xMax, content.yMax-content.yMin) : null,
    color: fn.color || "#3b82f6", showExpression: fn.showExpression !== false, rawExpression: fn.expression,
  })),[content]);
  const bounds = useMemo(() => {
    const {xMin,xMax,yMin,yMax}=content;
    return [xMin,xMax,yMin,yMax].every(Number.isFinite)&&xMax>xMin&&yMax>yMin ? {xMin,xMax,yMin,yMax} : null;
  },[content]);

  // ── ResizeObserver ────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = () => {
      const w = container.getBoundingClientRect().width;
      if (w > 0) setContainerWidth(w);
    };
    const ro = new ResizeObserver(updateWidth);
    ro.observe(container);
    updateWidth();
    return () => ro.disconnect();
  }, []);

  // ── Dessin statique (fond + grille + axes + courbes) ─────────────────────
  useEffect(() => {
    const sc = staticRef.current;
    const oc = overlayRef.current;
    if (!sc || !oc || !containerWidth || !bounds) return;
    const ctx = sc.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.floor(containerWidth);
    const cssH = Math.round(cssW * ASPECT);

    for (const c of [sc, oc]) {
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;
    }

    const { xMin, xMax, yMin, yMax } = bounds;
    const { showGrid } = content;

    ctx.save();
    ctx.scale(dpr, dpr);

    const scaleX = cssW / (xMax - xMin);
    const scaleY = cssH / (yMax - yMin);
    const toX = (x: number) => (x - xMin) * scaleX;
    const toY = (y: number) => cssH - (y - yMin) * scaleY;

    // ── Fond ──
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssW, cssH);

    // ── Pas de grille adaptatif ──
    const niceStep = (range: number) => {
      const target = range / 10;
      const mag = Math.pow(10, Math.floor(Math.log10(target)));
      const norm = target / mag;
      const step =
        norm >= 5 ? 5 * mag : norm >= 2 ? 2 * mag : norm >= 1 ? 1 * mag : mag;
      return step;
    };
    const stepX = niceStep(xMax - xMin);
    const stepY = niceStep(yMax - yMin);
    const fmtTick = (v: number, step: number) => {
      if (step >= 1) return Math.round(v).toString();
      const decimals = Math.max(0, -Math.floor(Math.log10(step)));
      return v.toFixed(decimals);
    };

    // ── Grille ──
    if (showGrid) {
      ctx.strokeStyle = "#f0f0f0";
      ctx.lineWidth = 1;
      for (let x = Math.ceil(xMin / stepX) * stepX; x <= xMax; x += stepX) {
        ctx.beginPath();
        ctx.moveTo(toX(x), 0);
        ctx.lineTo(toX(x), cssH);
        ctx.stroke();
      }
      for (let y = Math.ceil(yMin / stepY) * stepY; y <= yMax; y += stepY) {
        ctx.beginPath();
        ctx.moveTo(0, toY(y));
        ctx.lineTo(cssW, toY(y));
        ctx.stroke();
      }
    }

    const yZero = toY(0);
    const xZero = toX(0);
    const ARROW = 8;

    // ── Axes ──
    ctx.strokeStyle = "#374151";
    ctx.fillStyle = "#374151";
    ctx.lineWidth = 1.5;

    // Si l'origine sort de la fenêtre, on dessine les axes sur les bords
    const xAxisY = yZero >= 0 && yZero <= cssH ? yZero : cssH;
    const yAxisX = xZero >= 0 && xZero <= cssW ? xZero : 0;
    const xAxisOnBorder = !(yZero >= 0 && yZero <= cssH);
    const yAxisOnBorder = !(xZero >= 0 && xZero <= cssW);

    // Axe X
    ctx.beginPath();
    ctx.moveTo(0, xAxisY);
    ctx.lineTo(cssW - ARROW, xAxisY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cssW, xAxisY);
    ctx.lineTo(cssW - ARROW, xAxisY - ARROW / 2);
    ctx.lineTo(cssW - ARROW, xAxisY + ARROW / 2);
    ctx.closePath();
    ctx.fill();

    // Axe Y
    ctx.beginPath();
    ctx.moveTo(yAxisX, cssH);
    ctx.lineTo(yAxisX, ARROW);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(yAxisX, 0);
    ctx.lineTo(yAxisX - ARROW / 2, ARROW);
    ctx.lineTo(yAxisX + ARROW / 2, ARROW);
    ctx.closePath();
    ctx.fill();

    // ── Graduations + labels ──
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "#6b7280";
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "#9ca3af";

    // Graduations X
    ctx.textAlign = "center";
    const labelBelowX = xAxisY < cssH * 0.85;
    ctx.textBaseline = labelBelowX ? "top" : "bottom";
    const labelOffsetXdir = labelBelowX ? 5 : -5;
    for (
      let x = Math.ceil(xMin / stepX) * stepX;
      x <= xMax + 1e-9;
      x += stepX
    ) {
      if (Math.abs(x) < stepX / 2) continue;
      const cx = toX(x);
      if (cx < 4 || cx > cssW - 4) continue;
      ctx.beginPath();
      ctx.strokeStyle = "#9ca3af";
      ctx.moveTo(cx, xAxisY - 4);
      ctx.lineTo(cx, xAxisY + 4);
      ctx.stroke();
      ctx.fillStyle = "#6b7280";
      ctx.fillText(fmtTick(x, stepX), cx, xAxisY + labelOffsetXdir);
    }

    // Graduations Y
    const labelRightY = yAxisX > cssW * 0.15;
    ctx.textAlign = labelRightY ? "right" : "left";
    ctx.textBaseline = "middle";
    const labelOffsetYdir = labelRightY ? -6 : 6;
    for (
      let y = Math.ceil(yMin / stepY) * stepY;
      y <= yMax + 1e-9;
      y += stepY
    ) {
      if (Math.abs(y) < stepY / 2) continue;
      const cy = toY(y);
      if (cy < 4 || cy > cssH - 4) continue;
      ctx.beginPath();
      ctx.strokeStyle = "#9ca3af";
      ctx.moveTo(yAxisX - 4, cy);
      ctx.lineTo(yAxisX + 4, cy);
      ctx.stroke();
      ctx.fillStyle = "#6b7280";
      ctx.fillText(fmtTick(y, stepY), yAxisX + labelOffsetYdir, cy);
    }

    // Origine "O" si les deux axes sont visibles dans la zone
    if (!xAxisOnBorder && !yAxisOnBorder) {
      ctx.textAlign = labelRightY ? "right" : "left";
      ctx.textBaseline = "top";
      ctx.fillText("O", yAxisX + labelOffsetYdir, xAxisY + 4);
    }

    // ── Courbes ──
    const yMargin = (yMax - yMin) * 0.5;
    curves.forEach(({ sampleAt, color }) => {
      if (!sampleAt) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      let started = false;
      let prevY: number | null = null;

      for (let px = 0; px <= cssW; px++) {
        const x = xMin + px / scaleX;
        const y = sampleAt(x);
        const valid = typeof y === "number" && isFinite(y);
        const inBounds = valid && y >= yMin - yMargin && y <= yMax + yMargin;

        if (inBounds) {
          const jump =
            prevY !== null && Math.abs(y - prevY) > (yMax - yMin) * 0.5;
          if (!started || jump) {
            ctx.moveTo(toX(x), toY(y));
            started = true;
          } else {
            ctx.lineTo(toX(x), toY(y));
          }
          prevY = y;
        } else {
          started = false;
          prevY = null;
        }
      }
      ctx.stroke();
    });

    ctx.restore();
  }, [containerWidth, content, curves, bounds]);

  // ── Overlay interactif ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !containerWidth || !bounds) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (hoverX === null) return;

    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;
    const { xMin, xMax, yMin, yMax } = bounds;
    const scaleX = cssW / (xMax - xMin);
    const scaleY = cssH / (yMax - yMin);
    const toX = (x: number) => (x - xMin) * scaleX;
    const toY = (y: number) => cssH - (y - yMin) * scaleY;

    ctx.save();
    ctx.scale(dpr, dpr);
    const cx = toX(hoverX);

    ctx.strokeStyle = "rgba(107,114,128,0.4)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, cssH);
    ctx.stroke();
    ctx.setLineDash([]);

    curves.forEach(({ sampleAt, color }) => {
      if (!sampleAt) return;
      const y = sampleAt(hoverX);
      if (typeof y !== "number" || !isFinite(y)) return;
      const cy = toY(y);
      if (cy < -10 || cy > cssH + 10) return;

      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fillStyle = "white";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      const fmt = (v: number) =>
        Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2);
      const label = `(${fmt(hoverX)} ; ${fmt(y)})`;
      ctx.font = "bold 12px sans-serif";
      const tw = ctx.measureText(label).width;
      const pad = 7;
      const bw = tw + pad * 2;
      const bh = 24;
      let bx = cx + 14;
      let by = cy - bh / 2;
      if (bx + bw > cssW - 4) bx = cx - bw - 14;
      if (by < 4) by = 4;
      if (by + bh > cssH - 4) by = cssH - bh - 4;

      ctx.shadowColor = "rgba(0,0,0,0.18)";
      ctx.shadowBlur = 6;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 5);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(label, bx + pad, by + bh / 2);
    });

    ctx.restore();
  }, [hoverX, containerWidth, curves, bounds]);

  // ── Gestion souris ────────────────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!bounds) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const xNorm = (e.clientX - rect.left) / rect.width;
      setHoverX(bounds.xMin + xNorm * (bounds.xMax - bounds.xMin));
    },
    [bounds],
  );

  const handleMouseLeave = useCallback(() => setHoverX(null), []);

  // ── Légende ──────────────────────────────────────────────────────────────
  const visibleFunctions = curves.filter((f) => f.showExpression);

  return (
    <div className="p-5 bg-white rounded-2xl shadow-sm border border-gray-100">
      <div className="max-w-lg mx-auto">
        <div
          ref={containerRef}
          className="relative overflow-hidden rounded-xl border border-gray-200 bg-white"
          style={{ paddingBottom: `${ASPECT * 100}%` }}
        >
          <canvas ref={staticRef} className="absolute inset-0" />
          <canvas
            ref={overlayRef}
            className="absolute inset-0 cursor-crosshair"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />
        </div>

        {visibleFunctions.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {visibleFunctions.map((fn) => {
              const globalIdx = curves.indexOf(fn);
              return (
                <span
                  key={globalIdx}
                  className="flex items-center gap-1.5 text-sm font-medium"
                  style={{ color: fn.color }}
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: fn.color }}
                  />
                  <span className="text-gray-600">
                    {curves.length > 1 ? (
                      <>
                        f<sub>{globalIdx + 1}</sub>(x) ={" "}
                      </>
                    ) : (
                      <>f(x) = </>
                    )}
                  </span>
                  <Latex>
                    {fn.rawExpression}
                  </Latex>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default GraphRenderer;
