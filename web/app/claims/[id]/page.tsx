"use client";

/**
 * A claim, as a receipt.
 *
 * A claim is not about an item, and building this page taught me to stop pretending it is. The
 * contract groups by *currency* — `_openClaim` reads each debt's sale purely to check the currency
 * matches and then discards it, and there is no rule against a batch spanning sales. So the honest
 * description is "a bundle of aging debts in one currency", and in production that is a settlement
 * run covering many items at once. The receipt is where that bundle can be read as one thing, with
 * every debt fanning back out to the sale it came from.
 *
 * The four deadlines are the spine of it. A claim can die two entirely different deaths — challenged
 * and unanswered, or never challenged and simply never evidenced — and the list page, which shows two
 * of the four dates, renders both as the same word. Here they are distinguishable, which matters
 * because one of them is Good being caught and the other is Good not bothering.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use } from "react";

import { FiguresRow, PageFigure } from "@/components/browse";
import { WhoLink } from "@/components/entity";
import { CardSkeleton, ChainError, claimTone, useLedger } from "@/components/ledger-view";
import { Lifecycle } from "@/components/lifecycle";
import { Badge, Bytes, Empty, Panel, Skeleton } from "@/components/ui";
import { naira, untilDeadline, when, windowLeft, nairaShort } from "@/lib/format";
import type { Claim, Holdings } from "@/lib/ledger";
import { linesAbout } from "@/lib/ledger/profiles";

const ZERO = `0x${"0".repeat(64)}`;

export default function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const claimId = /^\d+$/.test(id) ? BigInt(id) : undefined;

  const { cage, holdings, history, problem, now } = useLedger();

  if (claimId === undefined) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <Panel title="Not a claim" tone="alarm">
          <p className="text-sm leading-relaxed text-ink-2">
            &ldquo;{id}&rdquo; is not a claim number. Claims are numbered from one — browse them on the{" "}
            <Link href="/claims" className="underline decoration-line-strong underline-offset-2">
              claims page
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

  const claim = holdings?.claims.find((c) => c.id === claimId);

  if (holdings && !claim) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <Panel title={`No claim #${String(claimId)}`} tone="alarm">
          <p className="text-sm leading-relaxed text-ink-2">
            The ledger has posted {holdings.claims.length} {holdings.claims.length === 1 ? "claim" : "claims"}, and none of
            them is #{String(claimId)}.
          </p>
        </Panel>
      </main>
    );
  }

  const debts = claim ? claim.debtIds.map((did) => holdings?.debts.find((d) => d.id === did)).filter(Boolean) : [];
  const lines =
    history && claim
      ? linesAbout(history.entries, { claimIds: new Set([claim.id]), debtIds: new Set(claim.debtIds) })
      : [];

  // Which claims share this one's amounts commitment. Identical amounts hash to the same value, so a
  // repeat is a repeat: the same sale posted again, by an operator with nothing new to report.
  const twins = claim
    ? (holdings?.claims ?? []).filter((c) => c.id !== claim.id && c.amountsCommitment === claim.amountsCommitment)
    : [];

  // A response deadline only exists once somebody objected, so its presence — not the claim's current
  // state — is what says a challenge happened. A proven claim that was challenged and answered still
  // has one, and that history should not vanish just because the shop won in the end.
  const objection = lines.find((e) => e.name === "ClaimChallenged");
  const challenger = objection?.who;
  const challengedLegs =
    challenger !== undefined
      ? (debts as Holdings["debts"]).filter((d) => d.recipient.toLowerCase() === challenger.toLowerCase())
      : [];
  const wasChallenged = claim !== undefined && claim.responseDeadline !== 0n;

  return (
    <main className="mx-auto max-w-[1200px] space-y-5 p-6 lg:p-8">
      <nav className="text-xs font-medium tracking-wide text-faint">
        <Link href="/claims" className="transition-colors hover:text-ink">
          Claims
        </Link>
        <span className="mx-1.5">•</span>
        <span className="text-mut">#{String(claimId)}</span>
      </nav>

      {!claim ? (
        <CardSkeleton rows={6} title />
      ) : (
        <>
          <Masthead claim={claim} debts={debts as Holdings["debts"]} />

          <div className="grid gap-5 [&>*]:min-w-0 lg:grid-cols-2">
            <div className="space-y-5">
              <Ladder claim={claim} now={now} />
              {wasChallenged && (
                <Challenge claim={claim} challenger={challenger} at={objection?.at} legs={challengedLegs} now={now} />
              )}
              <Evidence claim={claim} twins={twins} />
            </div>

            <div className="space-y-5">
              <Covered claim={claim} debts={debts as Holdings["debts"]} now={now} challenger={challenger} />
              <Panel
                title="The life"
                hint="Oldest first, grouped by the transaction each act happened in. Every moment carries its hash out to a public explorer."
              >
                {history ? (
                  <Lifecycle entries={lines} empty="Nothing has happened to this claim beyond its posting." />
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

function Masthead({ claim, debts }: { claim: Claim; debts: Holdings["debts"] }) {
  const items = [...new Set(debts.map((d) => String(d.itemId)))];

  return (
    <section className="card p-6" style={{ boxShadow: "var(--shadow-pop)" }}>
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">Claim receipt</div>
      <h1 className="mt-1.5 flex flex-wrap items-center gap-3 text-3xl font-semibold tracking-tight">
        Claim #{String(claim.id)}
        <Badge tone={claimTone(claim.state)} dot>
          {claim.state}
        </Badge>
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mut">
        Good&rsquo;s assertion that it paid {naira(claim.totalAmount)} across {claim.debtIds.length}{" "}
        {claim.debtIds.length === 1 ? "debt" : "debts"}
        {items.length === 1 ? (
          <>
            , all from the sale of{" "}
            <Link
              href={`/item/${items[0]}`}
              className="font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink"
            >
              item {items[0]}
            </Link>
          </>
        ) : (
          <>, drawn from {items.length} different sales</>
        )}
        . Anybody it names can contest it from their own key, through any RPC on earth.
      </p>

      <FiguresRow className="mt-6">
        <PageFigure label="Asserted" value={nairaShort(claim.totalAmount)} title={naira(claim.totalAmount)} first />
        <PageFigure label="Debts" value={String(claim.debtIds.length)} />
        <PageFigure label="Items" value={String(items.length)} />
        <PageFigure label="Posted" value={when(claim.postedAt)} />
      </FiguresRow>
    </section>
  );
}

/* ---- The four deadlines ---------------------------------------------------------------------------- */

/**
 * The claim's clocks, in order.
 *
 * Four dates, and which of them are set is the diagnosis. A response deadline only exists if somebody
 * challenged; a coverage deadline is the sweep's outer limit. A voided claim with a response deadline
 * was answered for and failed; a voided claim without one was never even contested — it simply ran out
 * of time to be evidenced. Those are different failures and they deserve different sentences.
 */
function Ladder({ claim, now }: { claim: Claim; now: number }) {
  const challenged = claim.responseDeadline !== 0n;
  const window_ = windowLeft(claim.challengeDeadline, now);

  const rungs: { label: string; at?: bigint; note: string; tone?: "good" | "warn" | "alarm" }[] = [
    { label: "Posted", at: claim.postedAt, note: "Good asserted it had paid." },
    {
      label: "Challenge window",
      at: claim.challengeDeadline,
      note: window_.closed
        ? challenged
          ? "Somebody objected before it closed."
          : "Closed with nobody objecting."
        : `Open — ${window_.text}. Anyone it names can still object.`,
      tone: challenged ? "warn" : undefined,
    },
    {
      label: "Response deadline",
      at: challenged ? claim.responseDeadline : undefined,
      note: challenged
        ? "Good had until here to produce evidence."
        : "Never set — the claim was not challenged, so Good was never put to proof.",
      tone: challenged ? "warn" : undefined,
    },
    {
      label: "Coverage deadline",
      at: claim.coverageDeadline !== 0n ? claim.coverageDeadline : undefined,
      note:
        claim.coverageDeadline === 0n
          ? "None recorded."
          : untilDeadline(claim.coverageDeadline, now).overdue
            ? "Passed. Evidence after this point cannot save the claim."
            : `The sweep's outer limit — ${untilDeadline(claim.coverageDeadline, now).text}.`,
    },
  ];

  return (
    <Panel
      title="The clocks"
      hint="Which of these are set is the diagnosis. A claim that died challenged and a claim that simply lapsed both read 'voided' in a list, and they are not the same failure."
    >
      <ol className="space-y-3">
        {rungs.map((rung) => (
          <li key={rung.label} className="flex gap-3">
            <span
              aria-hidden
              className={`mt-1.5 size-2 shrink-0 rounded-full ${
                rung.at === undefined
                  ? "bg-line-strong"
                  : rung.tone === "warn"
                    ? "bg-accent-fill"
                    : rung.tone === "alarm"
                      ? "bg-bad-fill"
                      : "bg-mut"
              }`}
            />
            <div className="min-w-0 flex-1 border-b border-line pb-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-faint">{rung.label}</span>
                <span className={`font-mono text-[0.7rem] tabular-nums ${rung.at ? "text-ink-2" : "text-faint"}`}>
                  {rung.at ? when(rung.at) : "—"}
                </span>
              </div>
              <p className="mt-0.5 text-[0.78rem] leading-relaxed text-mut">{rung.note}</p>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/* ---- What the claim commits to --------------------------------------------------------------------- */

function Evidence({ claim, twins }: { claim: Claim; twins: Claim[] }) {
  return (
    <Panel
      title="What it commits to"
      hint="Fixed when the claim was posted, so the operator cannot decide afterwards who it says it paid, or how much."
    >
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-[0.62rem] font-medium uppercase tracking-[0.12em] text-faint">Reference</dt>
          <dd className="mt-0.5">
            <Bytes>{claim.refHash}</Bytes>
          </dd>
        </div>
        <div>
          <dt className="text-[0.62rem] font-medium uppercase tracking-[0.12em] text-faint">Accounts commitment</dt>
          <dd className="mt-0.5">
            {claim.accountsCommitment === ZERO ? (
              <span className="text-faint">—</span>
            ) : (
              <Bytes>{claim.accountsCommitment}</Bytes>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[0.62rem] font-medium uppercase tracking-[0.12em] text-faint">Amounts commitment</dt>
          <dd className="mt-0.5">
            {claim.amountsCommitment === ZERO ? <span className="text-faint">—</span> : <Bytes>{claim.amountsCommitment}</Bytes>}
          </dd>
        </div>
      </dl>

      {twins.length > 0 && (
        /* Not an accusation — an observation the reader can check. Identical amounts produce an
           identical hash, so the same figures posted again are visible as the same figures. */
        <p className="mt-4 border-t border-line pt-4 text-[0.78rem] leading-relaxed text-mut">
          The same amounts commitment appears on{" "}
          {twins.map((t, i) => (
            <span key={String(t.id)}>
              {i > 0 && ", "}
              <Link
                href={`/claims/${String(t.id)}`}
                className="font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink"
              >
                claim #{String(t.id)}
              </Link>
            </span>
          ))}
          . The figures being asserted are identical, to the kobo.
        </p>
      )}
    </Panel>
  );
}

/* ---- The debts it was closing ---------------------------------------------------------------------- */

function Covered({
  claim,
  debts,
  now,
  challenger,
}: {
  claim: Claim;
  debts: Holdings["debts"];
  now: number;
  challenger?: string;
}) {
  const summed = debts.reduce((n, d) => n + d.amount, 0n);
  const balances = summed === claim.totalAmount;

  // A claim is a bundle of debts in one currency, and nothing stops the bundle spanning sales — in
  // production a settlement run is exactly that. So when it does, the debts are grouped under the
  // item each came from with its own subtotal; when it does not, the grouping would be one heading
  // over the whole list saying nothing, so it collapses to a flat list.
  const itemIds = [...new Set(debts.map((d) => String(d.itemId)))];
  const groups =
    itemIds.length > 1
      ? itemIds.map((itemId) => ({ itemId, rows: debts.filter((d) => String(d.itemId) === itemId) }))
      : [{ itemId: undefined, rows: debts }];

  return (
    <Panel
      title="The debts it was closing"
      hint="Each one fans back out to the sale it came from — a claim is a bundle of obligations, and every obligation began as an item leaving a shelf."
    >
      {debts.length === 0 ? (
        <Empty>This claim names no debts the ledger can find.</Empty>
      ) : (
        <>
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.itemId ?? "all"}>
                {group.itemId && (
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 border-b border-line pb-1.5">
                    <Link
                      href={`/item/${group.itemId}`}
                      className="text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink"
                    >
                      item {group.itemId}
                    </Link>
                    <span className="font-mono text-[0.7rem] tabular-nums text-faint">
                      {naira(group.rows.reduce((n, d) => n + d.amount, 0n))} · {group.rows.length}{" "}
                      {group.rows.length === 1 ? "debt" : "debts"}
                    </span>
                  </div>
                )}

                <ul className="space-y-1">
                  {group.rows.map((debt) => (
                    <DebtRow
                      key={String(debt.id)}
                      debt={debt}
                      now={now}
                      objected={challenger !== undefined && debt.recipient.toLowerCase() === challenger.toLowerCase()}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-[0.78rem]">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-faint">The debts add up to</dt>
              <dd className="font-semibold tabular-nums text-ink">{naira(summed)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-faint">The claim asserts</dt>
              <dd className="font-semibold tabular-nums text-ink">{naira(claim.totalAmount)}</dd>
            </div>
            <p className={`pt-1 text-[0.7rem] leading-relaxed ${balances ? "text-mut" : "text-bad"}`}>
              {balances
                ? "The two agree. The claim asserts exactly what the debts underneath it are worth — no more, and nothing left out."
                : "These do not agree. A claim asserting a different sum from the debts beneath it should not be possible."}
            </p>
          </dl>
        </>
      )}
    </Panel>
  );
}

/**
 * One debt on the receipt — and a door to the sale it came from.
 *
 * The whole row navigates, because the debt is a view and the item is the record: a reader who wants
 * to know whether this leg was really paid is asking about a sale. The nested links (the recipient's
 * profile) are left to do their own job — `closest` catches those clicks before this one fires.
 */
function DebtRow({ debt, now, objected }: { debt: Holdings["debts"][number]; now: number; objected: boolean }) {
  const router = useRouter();
  const clock = untilDeadline(debt.deadline, now);
  const inDefault = debt.state === "aging" && clock.overdue;
  const href = `/item/${String(debt.itemId)}`;

  return (
    <li
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button")) return;
        router.push(href);
      }}
      className="cursor-pointer rounded-2xl p-2.5 transition-colors hover:bg-sunken"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-sm font-semibold capitalize text-ink">
            the {debt.role}
            {objected && (
              /* The one who spoke up. A claim names several recipients and usually only one of them
                 objects — marking which turns "somebody challenged this" into a person and a leg. */
              <Badge tone="warn">objected</Badge>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[0.68rem] text-faint">
            <Link
              href={`/debts/${String(debt.id)}`}
              className="underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink"
            >
              debt #{String(debt.id)}
            </Link>{" "}
            ·{" "}
            <Link
              href={href}
              className="underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink"
            >
              item {String(debt.itemId)}
            </Link>{" "}
            · <WhoLink address={debt.recipient} />
          </div>
        </div>
        <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-ink">{naira(debt.amount)}</div>
        <Badge
          tone={
            inDefault ? "alarm" : debt.state === "proven" ? "good" : debt.state === "claimed" ? "warn" : "plain"
          }
          dot
        >
          {inDefault ? "in default" : debt.state}
        </Badge>
      </div>
    </li>
  );
}

/* ---- The challenge --------------------------------------------------------------------------------- */

/**
 * Somebody said they were not paid.
 *
 * This is the only moment in the protocol where a party who is not the operator moves the state, and
 * it is gated on being one of the claim's own recipients (`_isRecipientOf`) — so a challenger is
 * never a bystander, always someone the claim itself said had been paid. What happened next is the
 * whole test: Good either produced evidence inside the response window or it did not, and the claim
 * lives or dies on that alone.
 */
function Challenge({
  claim,
  challenger,
  at,
  legs,
  now,
}: {
  claim: Claim;
  challenger?: string;
  at?: bigint;
  legs: Holdings["debts"];
  now: number;
  }) {
  const open = claim.state === "challenged";
  const window_ = untilDeadline(claim.responseDeadline, now);

  return (
    <Panel
      title="The challenge"
      tone={claim.state === "voided" ? "alarm" : open ? "warn" : undefined}
      hint="The only move in this protocol that belongs to somebody other than the shop — and it is gated on being one of the people the claim named."
    >
      <p className="text-sm leading-relaxed text-ink-2">
        {challenger ? (
          <>
            <WhoLink address={challenger} /> said she was not paid
            {at ? `, ${when(at)}` : ""}. She was owed{" "}
            {legs.length > 0 ? (
              <>
                {legs.map((l, i) => (
                  <span key={String(l.id)}>
                    {i > 0 && " and "}
                    {naira(l.amount)} as the {l.role}
                  </span>
                ))}{" "}
                under this claim.
              </>
            ) : (
              "a leg under this claim."
            )}
          </>
        ) : (
          <>Somebody named by this claim objected to it.</>
        )}
      </p>

      <p className="mt-3 text-sm leading-relaxed text-mut">
        {open ? (
          <>
            Good has until {when(claim.responseDeadline)} to produce evidence — {window_.text}. If it
            cannot, the claim dies and every debt beneath it goes back to aging from the day it was born.
          </>
        ) : claim.state === "proven" ? (
          <>Good answered inside the window with evidence that verified. The claim stands, and only this earns it capacity.</>
        ) : claim.state === "voided" ? (
          <span className="text-bad">
            Good did not answer with evidence that verified. The claim died: a fine fell due to the party it had
            lied about, and every debt beneath it went back to aging from the day it was born — the clock it
            had bought itself was taken away.
          </span>
        ) : (
          <>The challenge is recorded; the claim has not resolved.</>
        )}
      </p>
    </Panel>
  );
}
