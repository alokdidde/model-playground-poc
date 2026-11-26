"use client";

import { useState } from "react";

export interface ScatterPoint {
  model: string;
  label: string;
  x: number;
  y: number;
  /** CSS color, e.g. var(--series-1): fixed per model, so it matches across charts. */
  color: string;
  xText: string;
  yText: string;
}

const W = 420;
const H = 260;
const PAD = { top: 16, right: 24, bottom: 40, left: 44 };

/**
 * A small dot plot for "quality vs X". One dot per model, direct-labelled,
 * with a legend underneath and a hover tooltip. Axes start at zero so
 * distances are honest; the "better" corner is named in the caption.
 */
export function ScatterChart({
  title,
  caption,
  xLabel,
  yLabel,
  points,
  formatX,
  yMax = 10,
}: {
  title: string;
  caption: string;
  xLabel: string;
  yLabel: string;
  points: ScatterPoint[];
  formatX: (x: number) => string;
  yMax?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  if (points.length === 0) return null;
  const xMax = Math.max(...points.map((p) => p.x)) * 1.15 || 1;
  const sx = (x: number) => PAD.left + (x / xMax) * (W - PAD.left - PAD.right);
  const sy = (y: number) => H - PAD.bottom - (y / yMax) * (H - PAD.top - PAD.bottom);
  const yTicks = [0, yMax / 2, yMax];
  const xTicks = [0, xMax / 2, xMax];
  const active = points.find((p) => p.model === hover);

  // Direct labels: to the left of dots near the right edge, and nudged down
  // when two labels would overlap.
  const placed: { x: number; y: number }[] = [];
  const labels = new Map(
    [...points]
      .sort((a, b) => b.y - a.y)
      .map((p) => {
        const right = sx(p.x) > W * 0.62;
        const x = right ? sx(p.x) - 9 : sx(p.x) + 9;
        const width = p.label.length * 6;
        const [left, rightEdge] = right ? [x - width, x] : [x, x + width];
        // A label that would run through another model's dot goes under its own dot instead.
        const hitsDot = (y: number) =>
          points.some((o) => o !== p && sx(o.x) > left - 6 && sx(o.x) < rightEdge + 6 && Math.abs(sy(o.y) - (y - 3)) < 13);
        let y = sy(p.y) - 8;
        if (hitsDot(y)) y = sy(p.y) + 18;
        while (placed.some((q) => Math.abs(q.y - y) < 12 && Math.abs(q.x - x) < 110)) y += 12;
        placed.push({ x, y });
        return [p.model, { x, y, anchor: right ? ("end" as const) : ("start" as const) }];
      }),
  );

  return (
    <figure className="min-w-0 max-w-[520px] space-y-2">
      <figcaption>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-muted-foreground text-xs">{caption}</div>
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}. ${caption}`}>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} className="stroke-border" strokeWidth={1} />
              <text x={PAD.left - 6} y={sy(t) + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
                {t}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text key={t} x={sx(t)} y={H - PAD.bottom + 14} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} className="fill-muted-foreground text-[10px]">
              {formatX(t)}
            </text>
          ))}
          <text x={(PAD.left + W - PAD.right) / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
            {xLabel}
          </text>
          <text x={12} y={(PAD.top + H - PAD.bottom) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(PAD.top + H - PAD.bottom) / 2})`} className="fill-muted-foreground text-[11px]">
            {yLabel}
          </text>
          {points.map((p) => (
            <g key={p.model} onMouseEnter={() => setHover(p.model)} onMouseLeave={() => setHover(null)} className="cursor-default">
              {/* Bigger invisible hit target than the dot. */}
              <circle cx={sx(p.x)} cy={sy(p.y)} r={14} fill="transparent" />
              <circle cx={sx(p.x)} cy={sy(p.y)} r={hover === p.model ? 7 : 5.5} fill={p.color} className="stroke-card" strokeWidth={2} />
              <text x={labels.get(p.model)!.x} y={labels.get(p.model)!.y} textAnchor={labels.get(p.model)!.anchor} className="fill-foreground text-[10px]">
                {p.label}
              </text>
            </g>
          ))}
        </svg>
        {active && (
          <div
            className="bg-popover text-popover-foreground pointer-events-none absolute z-10 rounded-md border px-2 py-1 text-xs shadow-sm"
            style={{ left: `${(sx(active.x) / W) * 100}%`, top: `${(sy(active.y) / H) * 100}%`, transform: "translate(-50%, -130%)" }}
          >
            <div className="font-medium">{active.label}</div>
            <div>
              {yLabel}: {active.yText}
            </div>
            <div>
              {xLabel}: {active.xText}
            </div>
          </div>
        )}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {points.map((p) => (
          <li key={p.model} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ background: p.color }} />
            {p.label}
          </li>
        ))}
      </ul>
    </figure>
  );
}
