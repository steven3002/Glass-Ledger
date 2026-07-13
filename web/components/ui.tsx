/**
 * The pieces every surface is built from.
 *
 * One rule governs all of them: a person who has never read a contract has to be able to read the
 * screen. No label is a field name, no state is an enum, and no number appears without the sentence
 * that says what it means. The ledger is only public if it is legible.
 */

import type { ReactNode } from "react";

export function Panel({
  title,
  hint,
  children,
  tone = "plain",
}: {
  title?: string;
  hint?: string;
  children: ReactNode;
  tone?: "plain" | "alarm" | "warn" | "good";
}) {
  const border =
    tone === "alarm"
      ? "border-red-900/70 bg-red-950/20"
      : tone === "warn"
        ? "border-amber-900/70 bg-amber-950/20"
        : tone === "good"
          ? "border-emerald-900/70 bg-emerald-950/20"
          : "border-neutral-800 bg-neutral-950/60";

  return (
    <section className={`rounded-xl border ${border} p-5`}>
      {title && (
        <header className="mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">{title}</h2>
          {hint && <p className="mt-1 text-sm text-neutral-500">{hint}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string;
  value: ReactNode;
  note?: string;
  tone?: "plain" | "alarm" | "good";
}) {
  const colour =
    tone === "alarm" ? "text-red-400" : tone === "good" ? "text-emerald-400" : "text-neutral-100";

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-neutral-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${colour}`}>{value}</div>
      {note && <div className="mt-1 text-xs leading-relaxed text-neutral-500">{note}</div>}
    </div>
  );
}

const TONES = {
  plain: "border-neutral-700 bg-neutral-900 text-neutral-300",
  good: "border-emerald-800 bg-emerald-950 text-emerald-300",
  warn: "border-amber-800 bg-amber-950 text-amber-300",
  alarm: "border-red-800 bg-red-950 text-red-300",
  quiet: "border-neutral-800 bg-neutral-950 text-neutral-500",
} as const;

export function Badge({
  children,
  tone = "plain",
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** A hash or an address, shown as what it is: bytes a reader can compare with their own eyes. */
export function Bytes({ children }: { children: ReactNode }) {
  return <code className="font-mono text-xs break-all text-neutral-400">{children}</code>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-neutral-600">{children}</p>;
}
