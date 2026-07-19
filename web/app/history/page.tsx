"use client";

/**
 * What happened, as a table: every state change the protocol ever made, narrated, newest first — with
 * the persona filter, so one party can read only the lines that are their business. A transition with
 * no event is an incomplete one.
 */

import { useMemo, useState } from "react";

import { FiguresRow, FilterRow, PageFigure } from "@/components/browse";
import { Dropdown } from "@/components/dropdown";
import { CardSkeleton, ChainError, useLedger } from "@/components/ledger-view";
import { usePaged } from "@/components/paged";
import { TableCard, Td, Th, Tr } from "@/components/table";
import { ROLES, when, type Role } from "@/lib/format";

const DOT: Record<string, string> = {
  alarm: "var(--color-bad-fill)",
  warn: "var(--color-accent-fill)",
  good: "var(--color-good-fill)",
  quiet: "var(--color-line-strong)",
  plain: "var(--color-mut)",
};

const WORDS: Record<string, string> = {
  alarm: "text-bad",
  warn: "text-accent",
  good: "text-good",
  quiet: "text-faint",
  plain: "text-ink-2",
};

export default function HistoryPage() {
  const { cage, holdings, history, problem } = useLedger();
  const [role, setRole] = useState<Role | "everyone">("everyone");
  const [show, setShow] = useState(20);

  const entries = useMemo(
    () =>
      (history?.entries ?? []).filter(
        (e) => role === "everyone" || !e.who || holdings?.roleOf.get(e.who.toLowerCase()) === role,
      ),
    [history, holdings, role],
  );
  const paged = usePaged(entries, show);

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const alarms = entries.filter((e) => e.tone === "alarm").length;
  const goods = entries.filter((e) => e.tone === "good").length;

  return (
    <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10 lg:px-12">
      <h1 className="text-[32px] font-bold tracking-tight text-ink">What happened</h1>
      <p className="mt-1 max-w-3xl text-sm text-mut">
        Every state change the protocol ever made, newest first. A transition with no event is an incomplete one.
      </p>

      <FiguresRow>
        <PageFigure label="Events" value={history ? String(entries.length) : undefined} first />
        <PageFigure label="Alarms" value={history ? String(alarms) : undefined} tone={alarms > 0 ? "alarm" : "plain"} />
        <PageFigure label="Good news" value={history ? String(goods) : undefined} tone="good" />
      </FiguresRow>

      <FilterRow>
        <Dropdown
          prefix="Whose lines"
          value={role}
          onChange={setRole}
          options={[{ value: "everyone" as const, label: "Everyone" }, ...ROLES.map((r) => ({ value: r, label: `The ${r}` }))]}
        />
        <span className="font-mono text-xs text-faint">
          {history ? `${entries.length} ${entries.length === 1 ? "event" : "events"}` : "…"}
        </span>
      </FilterRow>

      {!history ? (
        <div className="mt-8">
          <CardSkeleton rows={10} tall />
        </div>
      ) : (
        <TableCard
          found={`${entries.length} ${entries.length === 1 ? "event" : "events"} found`}
          sub="newest first — the whole public record"
          cursor={paged}
          show={show}
          onShow={setShow}
          sizes={[20, 50, 100]}
          head={
            <>
              <Th className="w-44">When</Th>
              <Th omit className="w-8" />
              <Th>What happened</Th>
            </>
          }
        >
          {/* Three columns, none of them foldable: a timestamp and a sentence are the whole entry, and
              the dot only colours the sentence it sits beside — so on a phone it goes rather than folds. */}
          {paged.slice.map((entry) => (
            <Tr key={entry.key}>
              <Td label="When" className="align-top font-mono text-xs tabular-nums text-faint">
                {when(entry.at)}
              </Td>
              <Td omit className="align-top">
                <span className="mt-1.5 block size-2 rounded-full" style={{ background: DOT[entry.tone] }} aria-hidden />
              </Td>
              <Td headline className="whitespace-normal">
                <p className={`max-w-4xl text-sm leading-relaxed ${WORDS[entry.tone]}`}>{entry.sentence}</p>
              </Td>
            </Tr>
          ))}
        </TableCard>
      )}
    </main>
  );
}
