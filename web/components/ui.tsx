/**
 * The pieces every surface is built from.
 *
 * One rule governs all of them: a person who has never read a contract has to be able to read the
 * screen. No label is a field name, no state is an enum, and no number appears without the sentence
 * that says what it means. The ledger is only public if it is legible.
 *
 * The look is light and layered: each of these is a white surface that floats above a soft ground.
 * Semantic colour is spent sparingly and always means something — amber is the shop's own signal,
 * emerald is proven, red is defaulted — so a glance across the page reads as state, not decoration.
 */

import type { CSSProperties, ReactNode } from "react";

import { TrendDownIcon, TrendUpIcon } from "./icons";

type Tone = "plain" | "alarm" | "warn" | "good";

const PANEL_TINT: Record<Tone, string> = {
  plain: "",
  alarm: "border-[color-mix(in_oklab,var(--color-bad-fill)_45%,var(--color-line))]",
  warn: "border-[color-mix(in_oklab,var(--color-accent-fill)_45%,var(--color-line))]",
  good: "border-[color-mix(in_oklab,var(--color-good-fill)_45%,var(--color-line))]",
};

const PANEL_GLOW: Record<Tone, CSSProperties | undefined> = {
  plain: undefined,
  alarm: { background: "linear-gradient(180deg, color-mix(in oklab, var(--color-bad-fill) 5%, white), white)" },
  warn: { background: "linear-gradient(180deg, color-mix(in oklab, var(--color-accent-fill) 6%, white), white)" },
  good: { background: "linear-gradient(180deg, color-mix(in oklab, var(--color-good-fill) 5%, white), white)" },
};

export function Panel({
  title,
  hint,
  children,
  tone = "plain",
}: {
  title?: string;
  hint?: string;
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <section className={`card p-5 sm:p-6 ${PANEL_TINT[tone]}`} style={PANEL_GLOW[tone]}>
      {title && (
        <header className="mb-4 flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-mut">{title}</h2>
            {hint && <p className="mt-1.5 text-sm leading-relaxed text-mut">{hint}</p>}
          </div>
        </header>
      )}
      {children}
    </section>
  );
}

const STAT_INK: Record<"plain" | "alarm" | "good", string> = {
  plain: "text-ink",
  alarm: "text-bad",
  good: "text-good",
};

export function Stat({
  label,
  value,
  note,
  tone = "plain",
  hero = false,
  delta,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  tone?: "plain" | "alarm" | "good";
  /** The one figure a panel is built around: bigger, tighter, and given room. */
  hero?: boolean;
  /** An optional pill to the right of the value — a change, a status, a qualifier. */
  delta?: ReactNode;
}) {
  return (
    <div>
      <div className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span
          className={`font-semibold tabular-nums ${hero ? "text-4xl tracking-[-0.02em]" : "text-2xl"} ${STAT_INK[tone]}`}
        >
          {value}
        </span>
        {delta}
      </div>
      {note && <div className="mt-1.5 text-xs leading-relaxed text-mut">{note}</div>}
    </div>
  );
}

const BADGE_TONES = {
  plain: "border-line-strong bg-raised text-ink-2",
  good: "border-[color-mix(in_oklab,var(--color-good-fill)_40%,white)] bg-[color-mix(in_oklab,var(--color-good-fill)_10%,white)] text-good",
  warn: "border-[color-mix(in_oklab,var(--color-accent-fill)_45%,white)] bg-[color-mix(in_oklab,var(--color-accent-fill)_12%,white)] text-accent",
  alarm: "border-[color-mix(in_oklab,var(--color-bad-fill)_40%,white)] bg-[color-mix(in_oklab,var(--color-bad-fill)_10%,white)] text-bad",
  quiet: "border-line bg-sunken text-faint",
} as const;

const DOT_TONES = {
  plain: "bg-mut",
  good: "bg-good-fill",
  warn: "bg-accent-fill",
  alarm: "bg-bad-fill",
  quiet: "bg-faint",
} as const;

export function Badge({
  children,
  tone = "plain",
  dot = false,
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}
    >
      {dot && <span className={`size-1.5 rounded-full ${DOT_TONES[tone]}`} aria-hidden />}
      {children}
    </span>
  );
}

/** A change or qualifier beside a number: a caret, a word, tinted by direction. */
export function Delta({
  children,
  tone = "plain",
}: {
  children: ReactNode;
  tone?: "plain" | "good" | "warn" | "alarm";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
        tone === "good"
          ? "bg-[color-mix(in_oklab,var(--color-good-fill)_12%,white)] text-good"
          : tone === "alarm"
            ? "bg-[color-mix(in_oklab,var(--color-bad-fill)_12%,white)] text-bad"
            : tone === "warn"
              ? "bg-[color-mix(in_oklab,var(--color-accent-fill)_14%,white)] text-accent"
              : "bg-sunken text-mut"
      }`}
    >
      {children}
    </span>
  );
}

const SEG_FILL: Record<string, string> = {
  neutral: "var(--color-faint)",
  ink: "var(--color-ink-2)",
  accent: "var(--color-accent-fill)",
  good: "var(--color-good-fill)",
  warn: "var(--color-accent-fill)",
  alarm: "var(--color-bad-fill)",
};

/**
 * A distribution meter: one track, filled left-to-right by segments given as percentages.
 *
 * The segments carry meaning by colour and are named in a legend beside the bar, never by colour
 * alone. Widths are percentages the caller has already worked out, because only the caller knows the
 * denominator the bar is drawn against.
 */
export function Meter({
  segments,
}: {
  segments: { pct: number; tone: keyof typeof SEG_FILL; label?: string }[];
}) {
  return (
    <div className="meter" role="img">
      {segments.map((s, i) =>
        s.pct > 0 ? (
          <span
            key={`${s.label ?? s.tone}-${i}`}
            style={{ width: `${Math.min(100, Math.max(0, s.pct))}%`, background: SEG_FILL[s.tone] }}
            title={s.label}
          />
        ) : null,
      )}
    </div>
  );
}

/** A hash or an address, shown as what it is: bytes a reader can compare with their own eyes. */
export function Bytes({ children }: { children: ReactNode }) {
  return <code className="font-mono text-xs break-all text-mut">{children}</code>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-faint">{children}</p>;
}

/** A greyed placeholder in the shape of the answer, for the moment before the chain has spoken. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/**
 * A summary tile with a trend line — ported from the reference dashboard's "Total income" card.
 * The trend is a fact about state, not a forecast: up is emerald, down is red, and it names what moved.
 */
export function StatCard({
  label,
  value,
  trend,
  trendTone = "plain",
  note,
}: {
  label: string;
  value: ReactNode;
  trend?: string;
  trendTone?: "good" | "alarm" | "plain";
  note?: string;
}) {
  return (
    <div className="card flex flex-col justify-center p-5">
      <p className="text-sm font-medium text-mut">{label}</p>
      <h3 className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</h3>
      {trend && (
        <div
          className={`mt-2 flex items-center gap-1 text-xs font-semibold ${
            trendTone === "good" ? "text-good" : trendTone === "alarm" ? "text-bad" : "text-mut"
          }`}
        >
          {trendTone === "good" ? (
            <TrendUpIcon className="size-3.5" />
          ) : trendTone === "alarm" ? (
            <TrendDownIcon className="size-3.5" />
          ) : null}
          <span>{trend}</span>
          {note && <span className="ml-1 font-normal text-faint">{note}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * A half-circle gauge — ported from the reference's "Financial health" widget. The arc is drawn once as
 * a track and once as the fill, and `pathLength={100}` lets the dash array be a plain percentage.
 */
export function Gauge({
  pct,
  tone = "good",
  caption,
}: {
  pct: number;
  tone?: "good" | "alarm" | "warn";
  caption?: ReactNode;
}) {
  const fill = tone === "good" ? "var(--color-good-fill)" : tone === "alarm" ? "var(--color-bad-fill)" : "var(--color-accent-fill)";
  const value = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-24 w-48 overflow-hidden">
        <svg viewBox="0 0 100 50" className="h-full w-full">
          <path d="M 8 50 A 42 42 0 0 1 92 50" fill="none" stroke="var(--color-sunken)" strokeWidth="10" strokeLinecap="round" />
          <path
            d="M 8 50 A 42 42 0 0 1 92 50"
            fill="none"
            stroke={fill}
            strokeWidth="10"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${value} 100`}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-0 text-center">
          <span className="text-[1.75rem] font-semibold leading-none tabular-nums text-ink">{Math.round(value)}%</span>
        </div>
      </div>
      {caption && <p className="mt-2 max-w-[220px] text-center text-xs leading-relaxed text-mut">{caption}</p>}
    </div>
  );
}
