"use client";

/**
 * What happened, as a table: every state change the protocol ever made, narrated, newest first — with
 * the persona filter, so one party can read only the lines that are their business. A transition with
 * no event is an incomplete one.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import { FiguresRow, FilterRow, PageFigure } from "@/components/browse";
import { Dropdown } from "@/components/dropdown";
import { CardSkeleton, ChainError, useLedger } from "@/components/ledger-view";
import { usePaged } from "@/components/paged";
import { TableCard, Td, Th, Tr } from "@/components/table";
import { explorerTx } from "@/lib/chain";
import { ROLES, shortAddress, when, type Role } from "@/lib/format";
import type { Entry } from "@/lib/ledger";

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

/**
 * What a line is about, as doors.
 *
 * Built from the ids the entry already carries — never by reading the sentence. The narration spells
 * "debt #27" out in prose because a person has to be able to read it, but parsing that back out would
 * be inventing structure from a string that exists to be human, and it would break the first time
 * somebody rewords a sentence.
 *
 * Some lines have no subject at all: money into the pool, a fine paid, a freeze lifted. Those are the
 * operator's own conduct rather than any sale's business, and they get no chips — which is itself
 * informative, because it is exactly the set of things that hangs off nothing.
 */
function Subjects({ entry }: { entry: Entry }) {
  const chips: { href: string; label: string }[] = [];
  if (entry.itemId !== undefined) chips.push({ href: `/item/${String(entry.itemId)}`, label: `item ${String(entry.itemId)}` });
  if (entry.debtId !== undefined) chips.push({ href: `/debts/${String(entry.debtId)}`, label: `debt #${String(entry.debtId)}` });
  if (entry.claimId !== undefined) chips.push({ href: `/claims/${String(entry.claimId)}`, label: `claim #${String(entry.claimId)}` });
  if (entry.creatorId !== undefined)
    chips.push({ href: `/creators/${String(entry.creatorId)}`, label: `creator #${String(entry.creatorId)}` });
  if (entry.who) chips.push({ href: `/who/${entry.who}`, label: shortAddress(entry.who) });

  if (chips.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <Link
          key={chip.href}
          href={chip.href}
          className="rounded-md border border-line bg-sunken px-1.5 py-0.5 font-mono text-[0.66rem] text-mut transition-colors hover:border-line-strong hover:text-ink"
        >
          {chip.label}
        </Link>
      ))}
    </div>
  );
}

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
                {/* The line's own transaction. A ledger that asks to be trusted has failed already —
                    this is how a reader checks the sentence beside it against the chain itself. */}
                {explorerTx(entry.tx) && (
                  <a
                    href={explorerTx(entry.tx)}
                    target="_blank"
                    rel="noreferrer"
                    title="Open this transaction on 0G's public explorer"
                    className="mt-0.5 block underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink"
                  >
                    {entry.tx.slice(0, 10)}…
                  </a>
                )}
              </Td>
              <Td omit className="align-top">
                <span className="mt-1.5 block size-2 rounded-full" style={{ background: DOT[entry.tone] }} aria-hidden />
              </Td>
              <Td headline className="whitespace-normal">
                <p className={`max-w-4xl text-sm leading-relaxed ${WORDS[entry.tone]}`}>{entry.sentence}</p>
                <Subjects entry={entry} />
              </Td>
            </Tr>
          ))}
        </TableCard>
      )}
    </main>
  );
}
