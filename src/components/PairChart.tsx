import { useMemo, useRef, useState } from "react";
import type { Direction } from "../../shared/types";

interface Props {
  series: { t: number; r: number }[];
  from: string;
  to: string;
  baseline?: number;
  trigger?: number;
  direction: Direction;
}

const W = 720;
const H = 250;
const M = { top: 14, right: 92, bottom: 26, left: 58 };

const fmtTime = (t: number, spanS: number) => {
  const d = new Date(t * 1000);
  return spanS > 36 * 3600
    ? d.toLocaleDateString([], { month: "short", day: "numeric" })
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export function PairChart({ series, from, to, baseline, trigger, direction }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    if (series.length < 2) return null;
    const t0 = series[0].t;
    const t1 = series[series.length - 1].t;
    const vals = series.map((p) => p.r).concat(baseline ?? [], trigger ?? []);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const pad = (hi - lo || hi * 0.01) * 0.12;
    lo -= pad;
    hi += pad;
    const x = (t: number) => M.left + ((t - t0) / (t1 - t0 || 1)) * (W - M.left - M.right);
    const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * (H - M.top - M.bottom);
    const path = series.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.r).toFixed(1)}`).join("");
    const yTicks = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 4);
    const xTicks = Array.from({ length: 4 }, (_, i) => t0 + ((t1 - t0) * i) / 3);
    return { x, y, lo, hi, t0, t1, path, yTicks, xTicks };
  }, [series, baseline, trigger]);

  if (!geo) {
    return (
      <div className="chart-empty">
        Collecting Pyth history for {to}/{from}. A new point is recorded every 30 seconds.
      </div>
    );
  }

  const { x, y, path, yTicks, xTicks, t0, t1 } = geo;
  const last = series[series.length - 1];
  const digits = last.r < 1 ? 5 : last.r < 10 ? 4 : 3;
  const hp = hover !== null ? series[hover] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    let bestD = Infinity;
    series.forEach((p, i) => {
      const d = Math.abs(x(p.t) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  };

  // Shade the region where the switch fires.
  const zone =
    trigger !== undefined
      ? direction === "cheaper"
        ? { y: y(trigger), h: H - M.bottom - y(trigger) }
        : { y: M.top, h: y(trigger) - M.top }
      : null;

  return (
    <div className="chart-wrap">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${to} price in ${from} shares over time, currently ${last.r.toFixed(digits)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {zone && zone.h > 0 && <rect x={M.left} width={W - M.left - M.right} y={zone.y} height={zone.h} fill="var(--accent-soft)" />}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={M.left - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--ink-3)" fontFamily="var(--mono)">
              {v.toFixed(digits)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={t} x={x(t)} y={H - 6} textAnchor={i === 0 ? "start" : i === 3 ? "end" : "middle"} fontSize={11} fill="var(--ink-3)">
            {fmtTime(t, t1 - t0)}
          </text>
        ))}

        {baseline !== undefined && (
          <g>
            <line x1={M.left} x2={W - M.right} y1={y(baseline)} y2={y(baseline)} stroke="var(--ink-3)" strokeDasharray="4 4" strokeWidth={1} />
            <text x={W - M.right + 8} y={y(baseline) + 4} fontSize={11} fill="var(--ink-2)">
              Baseline <tspan fontFamily="var(--mono)">{baseline.toFixed(digits)}</tspan>
            </text>
          </g>
        )}
        {trigger !== undefined && (
          <g>
            <line x1={M.left} x2={W - M.right} y1={y(trigger)} y2={y(trigger)} stroke="var(--accent)" strokeWidth={1} />
            <text x={W - M.right + 8} y={y(trigger) + 4} fontSize={11} fill="var(--ink)" fontWeight={600}>
              Switch <tspan fontFamily="var(--mono)">{trigger.toFixed(digits)}</tspan>
            </text>
          </g>
        )}

        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.t)} cy={y(last.r)} r={4.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />

        {hp && (
          <g>
            <line x1={x(hp.t)} x2={x(hp.t)} y1={M.top} y2={H - M.bottom} stroke="var(--ink-3)" strokeWidth={1} />
            <circle cx={x(hp.t)} cy={y(hp.r)} r={4.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
        <rect x={M.left} y={M.top} width={W - M.left - M.right} height={H - M.top - M.bottom} fill="transparent" />
      </svg>
      {hp && (
        <div className="tooltip" style={{ left: `${(x(hp.t) / W) * 100}%`, top: `${(y(hp.r) / H) * 100}%`, marginTop: -10 }}>
          <div className="muted" style={{ color: "inherit", opacity: 0.75 }}>
            {new Date(hp.t * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
          1 {to} = <span className="mono">{hp.r.toFixed(digits)}</span> {from}
          {baseline !== undefined && (
            <span className="mono"> ({((hp.r / baseline - 1) * 100 >= 0 ? "+" : "") + ((hp.r / baseline - 1) * 100).toFixed(2)}%)</span>
          )}
        </div>
      )}
    </div>
  );
}
