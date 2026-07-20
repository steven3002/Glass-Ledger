"use client";

/**
 * The pool's level over time.
 *
 * One series, so there is no legend — the panel's own title names it, and a legend box for a single
 * line is furniture pretending to be information. The line is ink rather than emerald or amber
 * because on these pages those colours *mean* something: a healthy pool is not a "good" state to be
 * signalled, it is a quantity to be read, and spending the status palette on it would leave nothing
 * to say with when the fund is actually in trouble.
 *
 * The shape is a step, not a smooth curve. A balance does not glide between two figures — it sits at
 * one until a transaction moves it, and then it is at the other. Interpolating would draw money that
 * was never in the fund at moments it was never there, which is a small lie for a prettier line.
 */

import { useState } from "react";

import { Empty } from "./ui";
import { naira, when } from "@/lib/format";
import type { Entry } from "@/lib/ledger";

export type PoolPoint = { at: bigint; balance: bigint; entry: Entry };

const W = 640;
const H = 230;
const PAD = { top: 14, right: 14, bottom: 26, left: 66 };

/**
 * A top of scale a person would have chosen.
 *
 * Taking the peak itself puts the highest point exactly on the top rule and makes the midpoint an
 * arbitrary figure — ₦206.2k, which is half of something rather than a number anybody means. Rounding
 * up to a clean step gives the line room above it and gridlines that read as quantities.
 *
 * The axis still starts at zero. A balance truncated at the bottom exaggerates every movement, and a
 * fund that looks like it swings wildly when it does not is precisely the wrong impression for the
 * one number here that is meant to reassure.
 */
function niceCeiling(peak: number): number {
  if (peak <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  for (const step of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (step * magnitude >= peak) return step * magnitude;
  }
  return 10 * magnitude;
}

/** Whole naira, abbreviated — an axis is read at a glance and ₦400,000 is four characters too many. */
function short(value: bigint): string {
  const whole = Number(value / 10n ** 18n);
  if (whole >= 1_000_000) return `₦${(whole / 1_000_000).toFixed(whole % 1_000_000 === 0 ? 0 : 1)}m`;
  if (whole >= 1_000) return `₦${(whole / 1_000).toFixed(whole % 1_000 === 0 ? 0 : 1)}k`;
  return `₦${whole}`;
}

/**
 * The step path for a run of balances, in a box of any size.
 *
 * Shared by the full chart and the sparkline so the two can never draw the same fund differently —
 * a card on the overview showing a shape the commons page contradicts would be worse than showing
 * no shape at all.
 */
export function stepPath(points: PoolPoint[], x: (at: bigint) => number, y: (b: bigint) => number): string {
  let d = `M ${x(points[0].at)} ${y(points[0].balance)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${x(points[i].at)} ${y(points[i - 1].balance)} L ${x(points[i].at)} ${y(points[i].balance)}`;
  }
  return d;
}

/**
 * The pool's shape, small enough to sit inside a stat card.
 *
 * No axes, no labels, no hover — a sparkline answers one question ("which way has this been going")
 * and anything else on it is noise at this size. The figure it belongs to is printed beside it, so
 * the line never has to carry a number.
 */
export function PoolSpark({ points, className = "" }: { points: PoolPoint[]; className?: string }) {
  if (points.length < 2) return null;

  const w = 120;
  const h = 34;
  const t0 = Number(points[0].at);
  const span = Math.max(1, Number(points[points.length - 1].at) - t0);
  const peak = points.reduce((m, p) => (p.balance > m ? p.balance : m), 0n);
  const top = peak > 0n ? Number(peak / 10n ** 18n) : 1;

  // Inset by the stroke's own width at each edge. Mapped flush to 0 and w, the first and last steps
  // are drawn half outside the viewBox and clipped — and the last step here is the recovery, which is
  // the most important thing the line has to say.
  const x = (at: bigint) => 1.5 + ((Number(at) - t0) / span) * (w - 3);
  const y = (b: bigint) => 2 + (1 - Number(b / 10n ** 18n) / top) * (h - 4);
  const d = stepPath(points, x, y);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden preserveAspectRatio="none">
      <path d={`${d} L ${w - 1.5} ${h} L 1.5 ${h} Z`} fill="var(--color-ink-2)" opacity={0.1} />
      <path d={d} fill="none" stroke="var(--color-ink-2)" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function PoolChart({ points }: { points: PoolPoint[] }) {
  const [hover, setHover] = useState<number>();

  if (points.length < 2) {
    return <Empty>The pool has not moved enough times to draw a line yet.</Empty>;
  }

  const t0 = Number(points[0].at);
  const t1 = Number(points[points.length - 1].at);
  const span = Math.max(1, t1 - t0);
  const peak = points.reduce((m, p) => (p.balance > m ? p.balance : m), 0n);
  const ceiling = niceCeiling(peak > 0n ? Number(peak / 10n ** 18n) : 1);

  const x = (at: bigint) => PAD.left + ((Number(at) - t0) / span) * (W - PAD.left - PAD.right);
  const y = (balance: bigint) =>
    PAD.top + (1 - Number(balance / 10n ** 18n) / ceiling) * (H - PAD.top - PAD.bottom);

  // A step path: hold the level, then move. See the note above — this is the honest shape for a
  // balance, and it is also what makes a payout read as the cliff it was.
  const d = stepPath(points, x, y);
  const area = `${d} L ${x(points[points.length - 1].at)} ${H - PAD.bottom} L ${x(points[0].at)} ${H - PAD.bottom} Z`;

  const ticks = [0, 0.5, 1].map((f) => ({ f, value: BigInt(Math.round(ceiling * f)) * 10n ** 18n }));

  const shown = hover !== undefined ? points[hover] : undefined;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`The pool's balance over time, from ${short(points[0].balance)} to ${short(points[points.length - 1].balance)}`}
        onMouseLeave={() => setHover(undefined)}
      >
        {/* Grid, kept recessive: it is a ruler, not content. */}
        {ticks.map((tick) => {
          const ty = PAD.top + (1 - tick.f) * (H - PAD.top - PAD.bottom);
          return (
            <g key={tick.f}>
              <line x1={PAD.left} x2={W - PAD.right} y1={ty} y2={ty} stroke="var(--color-line)" strokeWidth={1} />
              <text x={PAD.left - 8} y={ty + 3} textAnchor="end" className="fill-faint" style={{ fontSize: 9 }}>
                {short(tick.value)}
              </text>
            </g>
          );
        })}

        <path d={area} fill="var(--color-ink-2)" opacity={0.08} />
        <path d={d} fill="none" stroke="var(--color-ink-2)" strokeWidth={2} strokeLinejoin="round" />

        {points.map((p, i) => (
          <circle
            key={p.entry.key}
            cx={x(p.at)}
            cy={y(p.balance)}
            r={hover === i ? 4.5 : 2.5}
            fill="var(--color-surface)"
            stroke="var(--color-ink-2)"
            strokeWidth={2}
          />
        ))}

        {shown && (
          <line
            x1={x(shown.at)}
            x2={x(shown.at)}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="var(--color-line-strong)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* Hit targets far wider than the marks, so a moment is reachable without precision aiming. */}
        {points.map((p, i) => {
          const half = (W - PAD.left - PAD.right) / points.length / 2;
          return (
            <rect
              key={`hit-${p.entry.key}`}
              x={x(p.at) - half}
              y={PAD.top}
              width={half * 2}
              height={H - PAD.top - PAD.bottom}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          );
        })}

        <text x={PAD.left} y={H - 8} className="fill-faint" style={{ fontSize: 9 }}>
          {when(points[0].at)}
        </text>
        <text x={W - PAD.right} y={H - 8} textAnchor="end" className="fill-faint" style={{ fontSize: 9 }}>
          {when(points[points.length - 1].at)}
        </text>
      </svg>

      <figcaption className="mt-2 min-h-[2.5rem] text-[0.72rem] leading-relaxed">
        {shown ? (
          <>
            <span className="font-semibold tabular-nums text-ink">{naira(shown.balance)}</span>{" "}
            <span className="text-faint">· {when(shown.at)}</span>
            <div className="text-mut">{shown.entry.sentence}</div>
          </>
        ) : (
          <span className="text-faint">
            Every point is a transaction that moved the fund. Hover one to read what it was.
          </span>
        )}
      </figcaption>
    </figure>
  );
}
