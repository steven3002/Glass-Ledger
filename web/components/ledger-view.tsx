"use client";

/**
 * The ledger, in parts.
 *
 * Everything here is read from the chain over a public connection — nothing is fetched from Good. The
 * read happens in three stages (cage → holdings → history) so the overview's headline lands before the
 * heavy event log does; the hook exposes each stage as it arrives, and the surfaces (the overview and
 * its sub-pages) each render the parts they need.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Pager, usePaged } from "@/components/paged";
import { Badge, Bytes, Delta, Empty, Gauge, Meter, Panel, Skeleton, StatCard } from "@/components/ui";
import { deployment } from "@/lib/chain";
import {
  DEBT_BUCKETS,
  DEBT_STATE_MEANING,
  ROLES,
  age,
  debtBucket,
  naira,
  shortAddress,
  untilDeadline,
  when,
  type DebtBucket,
  type Role,
} from "@/lib/format";
import { readCage, readHistory, readHoldings, type Cage, type History, type Holdings } from "@/lib/ledger";
import { loadConsignment } from "@/lib/tags";

export const pct = (part: bigint, whole: bigint): number => (whole > 0n ? Number((part * 10000n) / whole) / 100 : 0);

export type Ledger = { cage?: Cage; holdings?: Holdings; history?: History; problem?: string; now: number };

/** The live read, staged. Polls every 3s; the 1s clock keeps ages ticking between polls. */
export function useLedger(): Ledger {
  const [cage, setCage] = useState<Cage>();
  const [holdings, setHoldings] = useState<Holdings>();
  const [history, setHistory] = useState<History>();
  const [problem, setProblem] = useState<string>();
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [where, consignment] = await Promise.all([deployment(), loadConsignment()]);
      const freshCage = await readCage(where);
      setCage(freshCage);
      setProblem(undefined);
      void readHoldings(where, consignment).then(setHoldings);
      void readHistory(where).then(setHistory);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), 3000);
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [refresh]);

  const now = (cage?.now ?? Math.floor(Date.now() / 1000)) + (tick % 3);
  return { cage, holdings, history, problem, now };
}

/* ---- Page furniture ------------------------------------------------------------------------------- */

export function PageHeader({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-mut">{sub}</p>}
      </div>
      {right}
    </header>
  );
}

export function ChainError({ problem }: { problem: string }) {
  return (
    <Panel title="The chain is not answering" tone="alarm">
      <p className="text-sm leading-relaxed text-ink-2">{problem}</p>
    </Panel>
  );
}

/**
 * What you are looking at, said before the table says it.
 *
 * Sky, not amber/emerald/red: those three name states the ledger proved, and this strip proves nothing
 * — it is the page explaining its own filter. It shows for "everyone" too, because the commission line
 * is the part a stranger most needs and it would otherwise only appear if they happened to pick the
 * operator.
 */
export function DebtSummary({
  role,
  debts,
  now,
  loading,
  onClear,
}: {
  role: Role | "everyone";
  debts: Holdings["debts"];
  now: number;
  loading: boolean;
  onClear: () => void;
}) {
  const inDefault = debts.filter((d) => d.state === "aging" && untilDeadline(d.deadline, now).overdue).length;
  const owedDebts = debts.filter((d) => d.state === "aging" || d.state === "claimed" || d.state === "settled");
  const owed = owedDebts.reduce((sum, d) => sum + d.amount, 0n);
  const kept = debts.filter((d) => d.state === "retained");
  const commission = kept.reduce((sum, d) => sum + d.amount, 0n);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-[color-mix(in_oklab,var(--color-info-fill)_38%,white)] bg-[color-mix(in_oklab,var(--color-info-fill)_9%,white)] px-4 py-3 text-sm">
      <span className="font-medium text-ink">
        Showing {role === "everyone" ? "everyone" : <span className="capitalize">the {role}</span>}
      </span>
      <span className="min-w-0 text-mut">
        {loading ? (
          "reading\u2026"
        ) : (
          <>
            {owedDebts.length > 0 ? (
              <>
                owed <span className="font-semibold text-ink">{naira(owed)}</span> across {owedDebts.length}{" "}
                {owedDebts.length === 1 ? "debt" : "debts"}
                {inDefault > 0 && (
                  <>
                    {" \u00b7 "}
                    <span className="font-semibold text-bad">{inDefault} in default</span>
                  </>
                )}
              </>
            ) : (
              <>owed nothing outward right now</>
            )}
            {kept.length > 0 && (
              <>
                {owedDebts.length > 0 ? " \u00b7 " : " \u2014 "}
                {kept.length} of these {kept.length === 1 ? "is" : "are"}{" "}
                Good&rsquo;s own commission (
                <span className="font-semibold text-ink">{naira(commission)}</span>), which it pays itself
              </>
            )}
          </>
        )}
      </span>
      {role !== "everyone" && (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto border border-line-strong bg-surface px-3 py-1 text-xs font-medium text-mut transition-colors hover:text-ink"
        >
          show everyone
        </button>
      )}
    </div>
  );
}

/* ---- Stage 1: the cage ---------------------------------------------------------------------------- */

export function CageRow({ cage }: { cage: Cage }) {
  const { ceiling, pool, record } = cage;
  const shut = ceiling.headroom === 0n;
  const segs = [
    { pct: pct(ceiling.custody, ceiling.ceiling), fill: "var(--color-ink-2)", label: "held for people", value: naira(ceiling.custody) },
    { pct: pct(ceiling.reimbursements, ceiling.ceiling), fill: "var(--color-accent-fill)", label: "owed to the pool", value: naira(ceiling.reimbursements) },
    { pct: pct(ceiling.unpaidFines, ceiling.ceiling), fill: "var(--color-bad-fill)", label: "unpaid fines", value: naira(ceiling.unpaidFines) },
    { pct: pct(ceiling.headroom, ceiling.ceiling), fill: "var(--color-good-fill)", label: "free to sell", value: naira(ceiling.headroom) },
  ];
  const freePct = pct(ceiling.headroom, ceiling.ceiling);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
      <section
        className="card relative overflow-hidden p-6"
        style={{ boxShadow: "var(--shadow-pop)", ...(shut ? { background: "linear-gradient(180deg,color-mix(in oklab,var(--color-bad-fill) 5%,white),white)" } : {}) }}
      >
        {/* The verdict sits on the heading's line, and the sentence explaining the cage runs the full
            width beneath both. Held beside the paragraph instead, it squeezed that paragraph into a
            gutter on a phone — the narrower the screen, the more room the two words took from it. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-mut">Good&rsquo;s cage</h2>
          <span className={`shrink-0 text-sm font-medium ${shut ? "text-bad" : "text-good"}`}>
            {shut ? "till shut for cash" : "room to sell"}
          </span>
          <p className="mt-1.5 w-full max-w-md text-sm leading-relaxed text-mut">
            How much of other people&rsquo;s money Good holds, against how much it is allowed to.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-6">
          <div>
            <div className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-faint">Headroom</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {/* Stepped down on a phone: at 2.75rem a figure like ₦445,393.75 measures wider than the
                  card it sits in, and a headline number that touches both walls reads as a mistake. */}
              <span
                className={`text-[2rem] font-semibold leading-none tabular-nums tracking-[-0.02em] sm:text-[2.75rem] ${
                  shut ? "text-bad" : "text-good"
                }`}
              >
                {naira(ceiling.headroom)}
              </span>
              <Delta tone={shut ? "alarm" : "good"}>{shut ? "0 left" : "for the next cash sale"}</Delta>
            </div>
            <div className="mt-4 flex gap-8">
              <Support label="Ceiling" value={naira(ceiling.ceiling)} />
              <Support label="Being held" value={naira(ceiling.used)} />
            </div>
          </div>
          {/* Wrapped onto a line of its own, the dial centres rather than hanging off the left edge. */}
          <div className="mx-auto sm:mx-0">
            <Gauge pct={freePct} tone={shut ? "alarm" : "good"} caption="of the cage is free to sell for cash" />
          </div>
        </div>

        <div className="mt-6">
          <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-sunken ring-1 ring-line ring-inset">
            {segs.map((s, i) =>
              s.pct > 0 ? <span key={i} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${s.pct}%`, background: s.fill }} title={`${s.label} · ${s.value}`} /> : null,
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
            {segs.map((s, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="mt-0.5 size-2.5 shrink-0 rounded-[3px]" style={{ background: s.fill, boxShadow: s.label === "free to sell" ? "inset 0 0 0 1px var(--color-line-strong)" : undefined }} />
                <span className="min-w-0">
                  <span className="block font-medium tabular-nums text-ink-2">{s.value}</span>
                  <span className="block text-faint">{s.label}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {ceiling.frozen && (
          <p className="mt-5 rounded-xl border border-[color-mix(in_oklab,var(--color-bad-fill)_40%,white)] bg-[color-mix(in_oklab,var(--color-bad-fill)_8%,white)] p-3 text-sm leading-relaxed text-bad">
            <strong className="font-semibold">Frozen.</strong> Good owes the pool {naira(ceiling.reimbursements)} for a default it caused. Until that is repaid, no honest sale earns it capacity.
          </p>
        )}
      </section>

      <div className="grid gap-4">
        <StatCard label="The pool" value={naira(pool.balance)} trend={ceiling.frozen ? "frozen — cannot grow" : "backs every payout"} trendTone={ceiling.frozen ? "alarm" : "plain"} />
        <StatCard label="Defaults" value={String(record.defaults)} trend={record.defaults > 0n ? `${naira(record.defaultValue)} never paid` : "a clean record"} trendTone={record.defaults > 0n ? "alarm" : "good"} />
        <StatCard label="Claims voided" value={String(record.claimsVoided)} trend={record.claimsVoided > 0n ? "asserted, unprovable" : "nothing unproven"} trendTone={record.claimsVoided > 0n ? "alarm" : "good"} />
      </div>
    </div>
  );
}

function Support({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-ink-2">{value}</div>
    </div>
  );
}

export function Capacity({ capacity }: { capacity: Cage["capacity"] }) {
  return (
    <Panel
      title="What Good may hold, creator by creator"
      hint="Capacity is earned with a creator and spendable only on her goods — a reputation built by trading with yourself, you can only spend on yourself."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {capacity.map((row) => {
          const shutRow = row.headroom === 0n;
          return (
            <div key={String(row.creatorId)} className="rounded-xl bg-sunken p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink">creator #{String(row.creatorId)}</span>
                <Badge tone={shutRow ? "alarm" : "good"} dot>{shutRow ? "shut" : "open"}</Badge>
              </div>
              <div className="mt-3">
                <Meter segments={[{ pct: pct(row.outstanding, row.outstanding + row.headroom), tone: shutRow ? "alarm" : "ink", label: "held" }]} />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <Mini label="allowance" value={naira(row.allowance)} />
                <Mini label="held" value={naira(row.outstanding)} />
                <Mini label="headroom" value={naira(row.headroom)} tone={shutRow ? "alarm" : "good"} />
              </dl>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export function WriteOffs({ writeOffs }: { writeOffs: History["writeOffs"] }) {
  return (
    <>
      {writeOffs.map((burn) => (
        <Panel
          key={String(burn.itemId)}
          title="A write-off, and what it earned"
          hint="Good declared item destroyed and paid everybody as if it had sold — the two numbers are why nobody launders a sale this way."
          tone="warn"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[color-mix(in_oklab,var(--color-good-fill)_35%,white)] bg-[color-mix(in_oklab,var(--color-good-fill)_7%,white)] p-4">
              <div className="text-[0.7rem] font-medium uppercase tracking-wider text-good">Selling it honestly</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums text-good">{naira(burn.honestCommission)}</div>
              <p className="mt-2 text-sm text-mut">Commission on an ordinary sale of item {String(burn.itemId)} at {naira(burn.price)}.</p>
            </div>
            <div className="rounded-xl border border-[color-mix(in_oklab,var(--color-bad-fill)_35%,white)] bg-[color-mix(in_oklab,var(--color-bad-fill)_7%,white)] p-4">
              <div className="text-[0.7rem] font-medium uppercase tracking-wider text-bad">Laundering it as shrinkage</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums text-bad">{naira(burn.launderedNet)}</div>
              <p className="mt-2 text-sm text-mut">Keeps the price, then pays {naira(burn.paidAsSold)} out as if sold, plus a {naira(burn.penalty)} fee.</p>
            </div>
          </div>
        </Panel>
      ))}
    </>
  );
}

/* ---- Stage 2: debts, shelf, claims ---------------------------------------------------------------- */

export function Debts({ debts, now, role }: { debts: Holdings["debts"]; now: number; role: Role | "everyone" }) {
  const [bucket, setBucket] = useState<DebtBucket | "all">("all");

  const census = debts.reduce(
    (acc, d) => {
      acc[debtBucket(d, now)] += 1;
      return acc;
    },
    { inDefault: 0, clock: 0, proven: 0, commission: 0, resolved: 0 } as Record<DebtBucket, number>,
  );

  const rows = bucket === "all" ? debts : debts.filter((d) => debtBucket(d, now) === bucket);
  const paged = usePaged(rows, 8);

  // The census doubles as the filter: the counts are the buckets, so the number you are curious about
  // is the thing you click. Picking one again clears it.
  const pick = (b: DebtBucket) => setBucket((current) => (current === b ? "all" : b));
  const tones: Record<DebtBucket, "alarm" | "warn" | "good" | "quiet"> = {
    inDefault: "alarm",
    clock: "warn",
    proven: "good",
    commission: "quiet",
    resolved: "quiet",
  };

  return (
    <section className="card p-5 sm:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-mut">Debts</h2>
          <p className="mt-1.5 text-sm text-mut">Who is owed what, and for how long. Time runs one way: a debt never expires into paid.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {DEBT_BUCKETS.filter((b) => census[b.value] > 0).map((b) => (
            <button
              key={b.value}
              type="button"
              onClick={() => pick(b.value)}
              aria-pressed={bucket === b.value}
              title={bucket === b.value ? "Showing only these — click to clear" : `Show only ${b.label.toLowerCase()}`}
              className={`transition-opacity ${bucket !== "all" && bucket !== b.value ? "opacity-40 hover:opacity-70" : ""}`}
            >
              <span className={bucket === b.value ? "outline outline-1 outline-offset-2 outline-line-strong" : ""}>
                <Badge tone={tones[b.value]}>
                  {census[b.value]} {b.label.toLowerCase()}
                </Badge>
              </span>
            </button>
          ))}
        </div>
      </header>
      {debts.length === 0 ? (
        <Empty>Nothing is owed to {role === "everyone" ? "anybody" : `the ${role}`}.</Empty>
      ) : rows.length === 0 ? (
        <Empty>Nothing in that state. Pick the tag again to see them all.</Empty>
      ) : (
        <>
          <ul className="space-y-1.5">
            {paged.slice.map((debt) => (
              <DebtRow key={String(debt.id)} debt={debt} now={now} />
            ))}
          </ul>
          <Pager page={paged.page} pages={paged.pages} start={paged.start} size={paged.size} total={paged.total} onPrev={paged.prev} onNext={paged.next} noun="debts" />
        </>
      )}
    </section>
  );
}

function DebtRow({ debt, now }: { debt: Holdings["debts"][number]; now: number }) {
  const live = debt.state === "aging" || debt.state === "claimed";
  const clock = untilDeadline(debt.deadline, now);
  const inDefault = debt.state === "aging" && clock.overdue;
  const propped = debt.state === "claimed" && clock.overdue;
  const detail = inDefault
    ? "Deadline passed, nobody claimed payment. Anybody can collect this now — the pool pays in full and Good is written down fivefold."
    : propped
      ? "Its deadline has passed; only Good's claim to have paid holds it up. The day that claim dies, this is in default."
      : DEBT_STATE_MEANING[debt.state];
  const tone = badgeTone(debt.state, inDefault);
  const square =
    tone === "alarm"
      ? "border-[color-mix(in_oklab,var(--color-bad-fill)_35%,white)] bg-[color-mix(in_oklab,var(--color-bad-fill)_10%,white)] text-bad"
      : tone === "warn"
        ? "border-[color-mix(in_oklab,var(--color-accent-fill)_40%,white)] bg-[color-mix(in_oklab,var(--color-accent-fill)_12%,white)] text-accent"
        : tone === "good"
          ? "border-[color-mix(in_oklab,var(--color-good-fill)_35%,white)] bg-[color-mix(in_oklab,var(--color-good-fill)_10%,white)] text-good"
          : "border-line bg-surface text-ink-2";

  return (
    <li title={detail} className="flex items-center gap-3 rounded-2xl p-2.5 transition-colors hover:bg-sunken">
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl border text-sm font-bold uppercase shadow-sm ${square}`}>
        {debt.role.charAt(0)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold capitalize text-ink">the {debt.role}</div>
        <div className="mt-0.5 truncate font-mono text-[0.68rem] text-faint">
          <Link href={`/item/${String(debt.itemId)}`} className="transition-colors hover:text-ink">
            item {String(debt.itemId)}
          </Link>
          {" · "}
          {debt.rail}
          {" · "}
          <Link href={`/who/${debt.recipient}`} className="transition-colors hover:text-ink">
            {shortAddress(debt.recipient)}
          </Link>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold tabular-nums text-ink">{naira(debt.amount)}</div>
        <div className={`mt-0.5 text-[0.68rem] tabular-nums ${inDefault ? "font-semibold text-bad" : propped ? "text-accent" : "text-faint"}`}>
          {live ? (inDefault || propped ? clock.text : `${age(debt.mintedAt, now)} old`) : "—"}
        </div>
      </div>
      <div className="hidden w-24 shrink-0 text-right sm:block">
        <Badge tone={tone} dot>{inDefault ? "in default" : debt.state}</Badge>
      </div>
    </li>
  );
}

export function Shelf({ items }: { items: Holdings["items"] }) {
  const paged = usePaged(items, 10);
  return (
    <Panel title="The shelf" hint="Every item in the consignment, and where it stands.">
      <ul className="divide-y divide-line">
        {paged.slice.map((item) => (
          <li key={String(item.id)} className="flex items-center justify-between gap-2 py-2.5 text-sm first:pt-0">
            <span className="font-medium text-ink">
              <Link href={`/item/${String(item.id)}`} className="transition-colors hover:underline">
                {item.name}
              </Link>
              <span className="ml-2 font-mono text-[0.68rem] font-normal text-faint">{naira(item.price)}</span>
            </span>
            <Badge tone={itemTone(item.state)} dot>{shelfWord(item.state)}</Badge>
          </li>
        ))}
      </ul>
      <Pager page={paged.page} pages={paged.pages} start={paged.start} size={paged.size} total={paged.total} onPrev={paged.prev} onNext={paged.next} noun="items" />
    </Panel>
  );
}

export function Claims({ claims }: { claims: Holdings["claims"] }) {
  const paged = usePaged(claims, 8);
  return (
    <Panel title="Claims" hint="Good's assertions that it paid. Each is contestable by the person it names, from her own key.">
      {claims.length === 0 ? (
        <Empty>Good has not claimed to have paid anybody.</Empty>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {paged.slice.map((claim) => (
              <li key={String(claim.id)} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-ink">{naira(claim.totalAmount)}</span>
                  <span className="ml-2 text-xs text-faint">across {claim.debtIds.length} {claim.debtIds.length === 1 ? "debt" : "debts"}</span>
                  <div className="mt-1"><Bytes>ref {claim.refHash.slice(0, 18)}…</Bytes></div>
                </div>
                <Badge tone={claimTone(claim.state)} dot>{claim.state}</Badge>
              </li>
            ))}
          </ul>
          <Pager page={paged.page} pages={paged.pages} start={paged.start} size={paged.size} total={paged.total} onPrev={paged.prev} onNext={paged.next} noun="claims" />
        </>
      )}
    </Panel>
  );
}

export function WhatHappened({ entries }: { entries: History["entries"] }) {
  return (
    <Panel title="What happened" hint="Every state change the protocol ever made, newest first. A transition with no event is an incomplete one.">
      <Timeline entries={entries} empty="Nothing has happened yet." />
    </Panel>
  );
}

/**
 * The narrated log, as a list — the same sentences everywhere they appear, because a dossier's
 * timeline and the global history must never disagree about what happened.
 */
export function Timeline({
  entries,
  empty,
  size = 12,
  capped = false,
}: {
  entries: History["entries"];
  empty: string;
  size?: number;
  /**
   * Show only the first three on a phone.
   *
   * For a feed that is a *sample* with a link onward, never one a pager is counting: a cap under a
   * pager reading "1–12 of 152" would be the page contradicting itself. Safe here because `Pager`
   * renders nothing while `total <= size`.
   */
  capped?: boolean;
}) {
  const paged = usePaged(entries, size);
  return entries.length === 0 ? (
    <Empty>{empty}</Empty>
  ) : (
    <>
      <ol className={`space-y-3 ${capped ? "gl-cap-3" : ""}`}>
        {paged.slice.map((entry) => (
          <li key={entry.key} className="flex gap-3">
            <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: dotColor(entry.tone) }} />
            <div className="min-w-0 flex-1 border-b border-line pb-3">
              <div className="text-[0.68rem] tabular-nums text-faint">{when(entry.at)}</div>
              <p className={`mt-0.5 text-sm leading-relaxed ${words(entry.tone)}`}>{entry.sentence}</p>
            </div>
          </li>
        ))}
      </ol>
      <Pager page={paged.page} pages={paged.pages} start={paged.start} size={paged.size} total={paged.total} onPrev={paged.prev} onNext={paged.next} noun="events" />
    </>
  );
}

/* ---- Skeletons ------------------------------------------------------------------------------------ */

export function CageRowSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
      <div className="card p-6" style={{ boxShadow: "var(--shadow-pop)" }}>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-3.5 w-80 max-w-full" />
        <div className="mt-6 flex flex-wrap items-center justify-between gap-6">
          <div>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2.5 h-11 w-56" />
            <div className="mt-4 flex gap-8">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
          <Skeleton className="h-24 w-40 rounded-t-full" />
        </div>
        <Skeleton className="mt-6 h-3.5 w-full rounded-full" />
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      </div>
      <div className="grid gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card p-5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="mt-2 h-7 w-28" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CapacitySkeleton() {
  return (
    <div className="card p-6">
      <Skeleton className="h-3 w-56" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-sunken p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-2 w-full rounded-full" />
            <div className="mt-3 grid grid-cols-3 gap-2">{Array.from({ length: 3 }).map((_, j) => <Skeleton key={j} className="h-7 w-full" />)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardSkeleton({ rows, title, tall }: { rows: number; title?: boolean; tall?: boolean }) {
  return (
    <div className="card p-6">
      <Skeleton className="h-3 w-24" />
      {title && <Skeleton className="mt-2.5 h-3.5 w-full max-w-sm" />}
      <div className="mt-4 space-y-2.5">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className={tall ? "h-12 w-full rounded-xl" : "h-8 w-full"} />)}</div>
    </div>
  );
}

/* ---- Tones ---------------------------------------------------------------------------------------- */

function Mini({ label, value, tone = "plain" }: { label: string; value: string; tone?: "plain" | "alarm" | "good" }) {
  return (
    <div>
      <dt className="text-[0.62rem] uppercase tracking-wider text-faint">{label}</dt>
      <dd className={`mt-0.5 font-mono text-xs font-medium tabular-nums ${tone === "alarm" ? "text-bad" : tone === "good" ? "text-good" : "text-ink-2"}`}>{value}</dd>
    </div>
  );
}

export function badgeTone(state: string, overdue: boolean): "alarm" | "good" | "warn" | "quiet" | "plain" {
  if (overdue && state === "aging") return "alarm";
  if (state === "defaulted") return "alarm";
  if (state === "proven") return "good";
  if (state === "claimed") return "warn";
  if (state === "retained") return "quiet";
  return "plain";
}

export function itemTone(state: string): "alarm" | "warn" | "good" | "plain" {
  if (state === "BURNED") return "alarm";
  if (state === "COMMITTED") return "warn";
  if (state === "SOLD" || state === "OWNED") return "plain";
  return "good";
}

export function shelfWord(state: string): string {
  switch (state) {
    case "ABSENT":
    case "LISTED":
      return "in store";
    case "COMMITTED":
      return "ordered";
    case "SOLD":
      return "sold";
    case "OWNED":
      return "sold · claimed";
    case "BURNED":
      return "written off";
    default:
      return state.toLowerCase();
  }
}

export function claimTone(state: string): "alarm" | "warn" | "good" | "plain" {
  if (state === "voided") return "alarm";
  if (state === "challenged") return "warn";
  if (state === "proven") return "good";
  return "plain";
}

const words = (tone: string) =>
  tone === "alarm" ? "text-bad" : tone === "warn" ? "text-accent" : tone === "good" ? "text-good" : tone === "quiet" ? "text-faint" : "text-ink-2";

const dotColor = (tone: string) =>
  tone === "alarm" ? "var(--color-bad-fill)" : tone === "warn" ? "var(--color-accent-fill)" : tone === "good" ? "var(--color-good-fill)" : tone === "quiet" ? "var(--color-line-strong)" : "var(--color-mut)";
