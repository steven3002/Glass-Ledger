"use client";

/**
 * One debt: who is owed it, for what, and what became of it.
 *
 * A debt is the smallest unit of obligation this protocol has, and it is also the most misleading
 * thing to read on its own. A leg in isolation says "₦7,500, aging" — true, and almost useless. What
 * makes it mean anything is the company it keeps: the sale that minted it, the other legs minted in
 * the same breath, the claim that later said it had been paid, and whether that claim survived. So
 * this page is mostly about the debt's neighbours, and its own facts fit in a short column.
 *
 * The one number that carries a whole argument is the deadline. An overdue leg is not a warning — it
 * is money any stranger can walk up and collect on behalf of somebody they have never met, and the
 * page says so in those words, because that is the mechanism the whole design rests on.
 */

import Link from "next/link";
import { use } from "react";

import { FiguresRow, PageFigure } from "@/components/browse";
import { debtResolution, Fact, Facts, WhoLink } from "@/components/entity";
import { badgeTone, CardSkeleton, ChainError, useLedger } from "@/components/ledger-view";
import { Lifecycle } from "@/components/lifecycle";
import { Badge, Bytes, Panel, Skeleton } from "@/components/ui";
import { age, naira, untilDeadline, when, windowLeft } from "@/lib/format";
import type { Claim, Debt, Holdings } from "@/lib/ledger";
import { linesAbout } from "@/lib/ledger/profiles";

const ZERO32 = `0x${"0".repeat(64)}`;

export default function DebtPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const debtId = /^\d+$/.test(id) ? BigInt(id) : undefined;

  const { cage, holdings, history, problem, now } = useLedger();

  if (debtId === undefined) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <Panel title="Not a debt" tone="alarm">
          <p className="text-sm leading-relaxed text-ink-2">
            &ldquo;{id}&rdquo; is not a debt number. Legs are numbered from one — browse them on the{" "}
            <Link href="/debts" className="underline decoration-line-strong underline-offset-2">
              debts page
            </Link>
            .
          </p>
        </Panel>
      </main>
    );
  }

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const debt = holdings?.debts.find((d) => d.id === debtId);

  if (holdings && !debt) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <Panel title={`No debt #${String(debtId)}`} tone="alarm">
          <p className="text-sm leading-relaxed text-ink-2">
            The counter has minted {holdings.debts.length} {holdings.debts.length === 1 ? "leg" : "legs"}, and none of them
            is #{String(debtId)}.
          </p>
        </Panel>
      </main>
    );
  }

  const siblings = debt ? (holdings?.debts ?? []).filter((d) => d.itemId === debt.itemId) : [];
  const claim =
    debt && debt.claimRef !== ZERO32
      ? (holdings?.claims ?? []).find((c) => c.refHash.toLowerCase() === debt.claimRef.toLowerCase())
      : undefined;
  const item = debt ? holdings?.items.find((i) => i.id === debt.itemId) : undefined;

  const lines =
    history && debt
      ? linesAbout(history.entries, {
          debtIds: new Set([debt.id]),
          claimIds: claim ? new Set([claim.id]) : undefined,
        })
      : [];

  const covered = (history?.entries ?? []).find((e) => e.name === "DefaultCovered" && e.debtId === debtId)?.who;

  return (
    <main className="mx-auto max-w-[1200px] space-y-5 p-6 lg:p-8">
      <nav className="text-xs font-medium tracking-wide text-faint">
        <Link href="/debts" className="transition-colors hover:text-ink">
          Debts
        </Link>
        <span className="mx-1.5">•</span>
        <span className="text-mut">#{String(debtId)}</span>
      </nav>

      {!debt ? (
        <CardSkeleton rows={6} title />
      ) : (
        <>
          <Masthead debt={debt} claim={claim} covered={covered} now={now} />

          <div className="grid gap-5 [&>*]:min-w-0 lg:grid-cols-2">
            <div className="space-y-5">
              <Clock debt={debt} now={now} />
              <Assertion debt={debt} claim={claim} now={now} />
            </div>

            <div className="space-y-5">
              <Sale debt={debt} siblings={siblings} price={item?.price} now={now} />
              <Panel
                title="The life"
                hint="Oldest first, grouped by the transaction each act happened in. Every moment carries its hash out to a public explorer."
              >
                {history ? (
                  <Lifecycle entries={lines} empty="Nothing has happened to this leg since it was minted." />
                ) : (
                  <div className="space-y-2.5">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

/* ---- The masthead ---------------------------------------------------------------------------------- */

function Masthead({
  debt,
  claim,
  covered,
  now,
}: {
  debt: Debt;
  claim?: Claim;
  covered?: string;
  now: number;
}) {
  const clock = untilDeadline(debt.deadline, now);
  const inDefault = debt.state === "aging" && clock.overdue;

  return (
    <section className="card p-6" style={{ boxShadow: "var(--shadow-pop)" }}>
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
        Debt · the {debt.role}&rsquo;s leg of a sale
      </div>
      <h1 className="mt-1.5 flex flex-wrap items-center gap-3 text-3xl font-semibold tracking-tight">
        {naira(debt.amount)}
        <Badge tone={badgeTone(debt.state, inDefault)} dot>
          {inDefault ? "in default" : debt.state}
        </Badge>
      </h1>

      <p className={`mt-3 max-w-2xl text-sm leading-relaxed ${inDefault ? "text-bad" : "text-mut"}`}>
        {debtResolution({ debt, claim, clock, inDefault, covered })}
      </p>

      <FiguresRow className="mt-6">
        <PageFigure label="Debt" value={`#${String(debt.id)}`} first />
        <PageFigure label="Owed to" value={`the ${debt.role}`} />
        <PageFigure label="From" value={`item ${String(debt.itemId)}`} />
        <PageFigure label="Rail" value={debt.rail} />
      </FiguresRow>
    </section>
  );
}

/* ---- The clock ------------------------------------------------------------------------------------- */

function Clock({ debt, now }: { debt: Debt; now: number }) {
  const clock = untilDeadline(debt.deadline, now);
  const live = debt.state === "aging" || debt.state === "claimed";
  const inDefault = debt.state === "aging" && clock.overdue;

  return (
    <Panel
      title="The clock"
      tone={inDefault ? "alarm" : undefined}
      hint="Time runs one way here. A debt never expires into paid — it expires into a default somebody else can collect."
    >
      <Facts>
        <Fact label="Minted">{when(debt.mintedAt)}</Fact>
        <Fact label="Deadline">{when(debt.deadline)}</Fact>
        <Fact label="Age">{age(debt.mintedAt, now)} old</Fact>
        <Fact label="Standing">
          {live ? (
            <span className={inDefault ? "font-semibold text-bad" : "text-accent"}>{clock.text}</span>
          ) : (
            <span className="text-mut">the clock has stopped — {debt.state}</span>
          )}
        </Fact>
        <Fact label="Owed to" wide>
          <span className="capitalize">the {debt.role}</span> · <WhoLink address={debt.recipient} />
        </Fact>
      </Facts>

      {inDefault && (
        <p className="mt-4 border-t border-line pt-4 text-[0.78rem] leading-relaxed text-bad">
          This is collectable right now, by anyone. The collector need not be the person who is owed and need
          not know them — the pool pays the recipient in full and Good&rsquo;s allowance is written down five
          times the harm. That a stranger can do this, and profit by it, is the entire enforcement mechanism.
        </p>
      )}
    </Panel>
  );
}

/* ---- The claim that spoke for it ------------------------------------------------------------------- */

function Assertion({ debt, claim, now }: { debt: Debt; claim?: Claim; now: number }) {
  if (!claim) {
    return (
      <Panel
        title="What Good has said about it"
        hint="A claim is the operator asserting it has paid. Until one names this leg, the shop has said nothing at all."
      >
        <p className="text-sm leading-relaxed text-mut">
          {debt.state === "retained"
            ? "Nothing, and nothing is owed — this leg is Good's own commission, so there is no counterparty to assert anything to."
            : debt.claimRef === ZERO32
              ? "No claim has ever named this leg. Good has not said it paid it."
              : "This leg carries a claim reference the ledger cannot resolve to a posted claim."}
        </p>
      </Panel>
    );
  }

  const window_ = windowLeft(claim.challengeDeadline, now);

  return (
    <Panel
      title="What Good has said about it"
      tone={claim.state === "voided" ? "alarm" : claim.state === "challenged" ? "warn" : undefined}
      hint="A claim is the operator asserting it has paid. It is only worth what happened to it afterwards."
    >
      <Facts>
        <Fact label="Under">
          <Link
            href={`/claims/${String(claim.id)}`}
            className="font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink"
          >
            claim #{String(claim.id)}
          </Link>
        </Fact>
        <Fact label="Its state">
          <Badge
            tone={
              claim.state === "voided"
                ? "alarm"
                : claim.state === "challenged"
                  ? "warn"
                  : claim.state === "proven"
                    ? "good"
                    : "plain"
            }
            dot
          >
            {claim.state}
          </Badge>
        </Fact>
        <Fact label="Posted">{when(claim.postedAt)}</Fact>
        <Fact label="Challenge window">{window_.closed ? `closed ${window_.text.replace("closed ", "")}` : window_.text}</Fact>
        <Fact label="Asserted in total" wide>
          {naira(claim.totalAmount)} across {claim.debtIds.length} {claim.debtIds.length === 1 ? "debt" : "debts"} —{" "}
          <Link
            href={`/claims/${String(claim.id)}`}
            className="underline decoration-line-strong underline-offset-2 hover:text-ink"
          >
            read the receipt
          </Link>
        </Fact>
        <Fact label="Reference" wide>
          <Bytes>{debt.claimRef}</Bytes>
        </Fact>
      </Facts>

      {claim.state === "voided" && (
        <p className="mt-4 border-t border-line pt-4 text-[0.78rem] leading-relaxed text-bad">
          The claim over this leg died. Good said it had paid and could not prove it, so this debt went back to
          aging from the day it was born — every hour the claim had bought was taken back.
        </p>
      )}
    </Panel>
  );
}

/* ---- The sale it came from ------------------------------------------------------------------------- */

function Sale({
  debt,
  siblings,
  price,
  now,
}: {
  debt: Debt;
  siblings: Holdings["debts"];
  price?: bigint;
  now: number;
}) {
  const minted = siblings.reduce((n, d) => n + d.amount, 0n);

  return (
    <Panel
      title="The sale it came from"
      hint="One sale, minted whole. Every leg below was created in the same transaction as this one — the split is the sale, and no part of it can exist without the rest."
    >
      <p className="mb-3 text-sm text-mut">
        Item{" "}
        <Link
          href={`/item/${String(debt.itemId)}`}
          className="font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink"
        >
          {String(debt.itemId)}
        </Link>
        {price !== undefined && <> sold for {naira(price)}</>} on the {debt.rail} rail.
      </p>

      <ul className="space-y-1">
        {siblings.map((leg) => {
          const clock = untilDeadline(leg.deadline, now);
          const inDefault = leg.state === "aging" && clock.overdue;
          const self = leg.id === debt.id;
          return (
            <li
              key={String(leg.id)}
              className={`flex items-center gap-3 rounded-2xl p-2.5 ${self ? "bg-sunken" : "transition-colors hover:bg-sunken/60"}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold capitalize text-ink">
                  the {leg.role}
                  {self && <span className="ml-2 text-[0.68rem] font-medium normal-case text-faint">this leg</span>}
                </div>
                <div className="mt-0.5 font-mono text-[0.68rem] text-faint">
                  {self ? (
                    <>debt #{String(leg.id)}</>
                  ) : (
                    <Link
                      href={`/debts/${String(leg.id)}`}
                      className="underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink"
                    >
                      debt #{String(leg.id)}
                    </Link>
                  )}{" "}
                  · <WhoLink address={leg.recipient} />
                </div>
              </div>
              <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-ink">{naira(leg.amount)}</div>
              <Badge tone={badgeTone(leg.state, inDefault)} dot>
                {inDefault ? "in default" : leg.state}
              </Badge>
            </li>
          );
        })}
      </ul>

      <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-[0.78rem]">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-faint">Minted by this sale</dt>
          <dd className="font-semibold tabular-nums text-ink">{naira(minted)}</dd>
        </div>
        {price !== undefined && (
          <p className={`pt-1 text-[0.7rem] leading-relaxed ${minted === price ? "text-mut" : "text-bad"}`}>
            {minted === price
              ? `The legs add up to the ${naira(price)} the item sold for.`
              : `The legs add up to ${naira(minted)}, but the item sold for ${naira(price)}.`}
          </p>
        )}
      </dl>
    </Panel>
  );
}
