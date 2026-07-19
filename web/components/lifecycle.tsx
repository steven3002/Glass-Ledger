"use client";

/**
 * One thing's life, running forwards.
 *
 * The history page reads newest-first, which is right for a feed you are checking on and wrong for a
 * story you are following: an item's life makes no sense backwards. So this runs oldest to newest,
 * and it groups by transaction, because the protocol acts in atomic moments rather than in events. A
 * sale is one moment that fires seven to thirteen logs — the sale itself, a debt minted per leg, the
 * certificate, the ceiling moving — and listing those as separate rows invents a sequence that never
 * happened. Grouped, they read as what they were: one act, with consequences.
 *
 * Between moments it prints the gap. That is not decoration. Everything this protocol argues about is
 * a clock — how long a debt aged before anyone claimed to have paid it, how long a challenge window
 * sat open, how long the shop had to produce evidence and did not — and a list of bare timestamps
 * makes the reader do that subtraction in their head.
 *
 * Each moment carries its transaction hash out to a public explorer. A ledger that asks to be trusted
 * has failed already; the hash is how a reader checks this page against the chain without believing a
 * word of it.
 */

import type { ReactNode } from "react";

import { Empty } from "./ui";
import { explorerTx } from "@/lib/chain";
import { when } from "@/lib/format";
import type { Entry } from "@/lib/ledger";

/** One atomic act: everything the chain recorded in a single transaction. */
export type Moment = {
  tx: string;
  at: bigint;
  block: bigint;
  entries: Entry[];
};

/**
 * The entries as moments, oldest first.
 *
 * `narrate` hands back newest-first, so this reverses. Grouping is by transaction rather than by
 * block only because one is the unit the chain guarantees atomicity over — on this deployment they
 * happen to be one and the same, but a busier chain would put several acts in one block and they
 * would not belong under one heading.
 */
export function momentsOf(entries: Entry[]): Moment[] {
  const order: string[] = [];
  const byTx = new Map<string, Moment>();

  for (const entry of [...entries].reverse()) {
    const existing = byTx.get(entry.tx);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    order.push(entry.tx);
    byTx.set(entry.tx, { tx: entry.tx, at: entry.at, block: entry.block, entries: [entry] });
  }

  return order.map((tx) => byTx.get(tx) as Moment);
}

const DOT: Record<Entry["tone"], string> = {
  alarm: "var(--color-bad-fill)",
  warn: "var(--color-accent-fill)",
  good: "var(--color-good-fill)",
  quiet: "var(--color-line-strong)",
  plain: "var(--color-mut)",
};

const WORDS: Record<Entry["tone"], string> = {
  alarm: "text-bad",
  warn: "text-accent",
  good: "text-good",
  quiet: "text-faint",
  plain: "text-ink-2",
};

/** The strongest thing that happened in a moment decides how the moment reads. */
const RANK: Entry["tone"][] = ["alarm", "warn", "good", "plain", "quiet"];
const toneOf = (moment: Moment): Entry["tone"] =>
  RANK.find((tone) => moment.entries.some((e) => e.tone === tone)) ?? "plain";

/** A gap, in the words a person would use. Whole units only — nobody cares about the seconds here. */
function gap(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s later`;
  if (s < 3600) return `${Math.floor(s / 60)}m later`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m later`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h later`;
}

export function Lifecycle({ entries, empty }: { entries: Entry[]; empty: string }) {
  const moments = momentsOf(entries);
  if (moments.length === 0) return <Empty>{empty}</Empty>;

  return (
    <ol className="relative">
      {moments.map((moment, i) => {
        const previous = i > 0 ? moments[i - 1] : undefined;
        const since = previous ? Number(moment.at) - Number(previous.at) : undefined;
        const tone = toneOf(moment);
        const href = explorerTx(moment.tx);
        const last = i === moments.length - 1;

        return (
          <li key={moment.tx} className="relative pl-7">
            {/* The spine. It stops at the last dot rather than trailing into space below it — the
                life has reached the present, and a line running past that suggests it has not. */}
            {!last && <span aria-hidden className="absolute left-[5px] top-3 bottom-0 w-px bg-line-strong/60" />}
            <span
              aria-hidden
              className="absolute left-0 top-[7px] size-[11px] rounded-full ring-4 ring-surface"
              style={{ background: DOT[tone] }}
            />

            <div className={`pb-6 ${last ? "" : ""}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="font-mono text-[0.68rem] tabular-nums text-faint">{when(moment.at)}</span>
                {since !== undefined && (
                  <span className="text-[0.68rem] font-medium text-mut">{gap(since)}</span>
                )}
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[0.68rem] text-faint underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink"
                    title="Open this transaction on 0G's public explorer"
                  >
                    {moment.tx.slice(0, 10)}…
                  </a>
                )}
              </div>

              <ul className="mt-1.5 space-y-1.5">
                {moment.entries.map((entry) => (
                  <li key={entry.key} className={`text-sm leading-relaxed ${WORDS[entry.tone]}`}>
                    {entry.sentence}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A labelled block for the item page's right-hand column, matching Panel's voice without its box. */
export function Stage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className="mt-1 text-sm text-ink-2">{children}</div>
    </div>
  );
}
