"use client";

/**
 * The commons — the fund that pays when Good does not, and Good's standing with it.
 *
 * Every other page in this ledger is about a thing: an item, a leg, an assertion. This one is about
 * the shop itself, and it exists because a whole class of events has no thing to belong to. Money
 * skimmed into the pool, a fine paid, dues collected, a freeze lifted — none of these name an item, a
 * debt or a claim, because none of them is about a sale. They are about whether the operator is in
 * good standing with the commons that backstops it.
 *
 * The layout borrows the creator page's: the figures run down the left, and the one card that says
 * where the party *stands* sits beside them. There it is the till Good keeps with her; here it is
 * Good's record, in the same clothes, because the two answer the same shape of question.
 *
 * Every figure is an absolute count or amount. A rate has a denominator, and a denominator is exactly
 * what a farmer manufactures — so nothing here is averaged, normalised or scored.
 */

import { FiguresRow, PageFigure } from "@/components/browse";
import { Info } from "@/components/info";
import { CardSkeleton, ChainError, pct, useLedger } from "@/components/ledger-view";
import { Lifecycle } from "@/components/lifecycle";
import { PoolChart } from "@/components/pool-chart";
import { Badge, Meter, Panel } from "@/components/ui";
import { naira, nairaShort } from "@/lib/format";
import { poolSeries, type Entry, type FailureRecord } from "@/lib/ledger";

/**
 * The events that belong to no sale.
 *
 * Derived from the protocol's own shape rather than chosen by taste: these are exactly the logs that
 * carry no itemId, no debtId and no claimId, so there is nowhere else in the product they could be
 * read in context. `PoolShortfall` is the one deliberate inclusion that does name a debt — the pool
 * running dry is the commons failing, and it belongs beside the rest of the fund's story.
 */
const CONDUCT = new Set([
  "SkimDeposited",
  "Reimbursed",
  "PenaltyPaid",
  "PoolDuesCollected",
  "FreezeLifted",
  "AttestationPosted",
  "PoolShortfall",
  "WriteOffAccrued",
]);

export default function CommonsPage() {
  const { cage, history, problem } = useLedger();

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const conduct: Entry[] = (history?.entries ?? []).filter((e) => CONDUCT.has(e.name));
  const level = history ? poolSeries(history.entries) : [];
  const record = cage?.record;
  const pool = cage?.pool;

  return (
    <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10 lg:px-12">
      <h1 className="text-[32px] font-bold tracking-tight text-ink">The commons</h1>
      <p className="mt-1 max-w-3xl text-sm text-mut">
        The fund that pays the wronged party when Good does not, and what Good owes it. These are the acts
        that belong to no sale — which is why they are here, and not on any item&rsquo;s page.
      </p>

      <div className="mt-8 flex flex-wrap items-start justify-between gap-8">
        {/* The fund's own figures run down the left, as the creator's do on hers. */}
        <div className="min-w-0 flex-1">
          <FiguresRow>
            <PageFigure label="In the pool" value={pool ? nairaShort(pool.balance) : undefined} title={pool ? naira(pool.balance) : undefined} first />
            <PageFigure
              label="Dues owed to it"
              value={pool ? nairaShort(pool.dues) : undefined}
              title={pool ? naira(pool.dues) : undefined}
              tone={pool && pool.dues > 0n ? "alarm" : "plain"}
            />
            <PageFigure
              label="Owed back by Good"
              value={record ? nairaShort(record.owedToPool) : undefined}
              title={record ? naira(record.owedToPool) : undefined}
              tone={record && record.owedToPool > 0n ? "alarm" : "plain"}
            />
            <PageFigure
              label="Fines unpaid"
              value={record ? nairaShort(record.penaltiesUnpaid) : undefined}
              title={record ? naira(record.penaltiesUnpaid) : undefined}
              tone={record && record.penaltiesUnpaid > 0n ? "alarm" : "plain"}
            />
          </FiguresRow>

          <p className="mt-6 max-w-xl text-sm leading-relaxed text-mut">
            The pool is what a wronged party is paid from when the shop does not pay them itself. Anybody
            may collect a default on somebody else&rsquo;s behalf and the fund settles it in full — which is
            why it has to be visible, and why what Good owes back to it sits beside it rather than buried.
          </p>
        </div>

        {record ? (
          <Record record={record} />
        ) : (
          <div className="w-full lg:w-64">
            <CardSkeleton rows={3} />
          </div>
        )}
      </div>

      <div className="mt-10">
        <Panel
          title="The pool, over time"
          info={
            <>
              What the fund held, moment by moment. Three of the pool&rsquo;s events state the resulting
              balance outright, so this line is the pool&rsquo;s own record of itself rather than a total
              this page accumulated — only a payout has to be derived, and the next stated balance
              corrects it.
              <span className="mt-2 block">
                It is drawn as a step because a balance does not glide between two figures: it sits at one
                until a transaction moves it. Every point is a transaction; hover one to read it.
              </span>
            </>
          }
          right={pool && <span className="text-sm font-semibold tabular-nums text-ink">{naira(pool.balance)} today</span>}
        >
          {!history ? <CardSkeleton rows={6} /> : <PoolChart points={level} />}
        </Panel>
      </div>

      <div className="mt-5">
        <Panel
          title="The shop's conduct"
          info="Skims into the fund, repayments, fines, dues, sweeps and freezes — oldest first. None of these lines names an item, because none of them is about a sale: they are the shop's standing with the commons rather than anything that happened to a thing."
        >
          {!history ? (
            <CardSkeleton rows={6} />
          ) : (
            <Lifecycle
              entries={conduct}
              empty="Good has never touched the commons — no skim, no fine, no repayment. On a shop that has sold anything, that would itself be strange."
            />
          )}
        </Panel>
      </div>
    </main>
  );
}

/**
 * Good's record, in the same card the creator page gives her till.
 *
 * They answer the same shape of question — where does this party stand — so they wear the same
 * clothes: a sunken tile beside the figures rather than a tinted panel across them. Red belongs on the
 * number that earned it, never on the card; a panel that is permanently red says nothing the second
 * time you see it, and this one has to read the same when the news is good.
 */
function Record({ record }: { record: FailureRecord }) {
  const owing = record.owedToPool > 0n;

  return (
    <div className="w-full rounded-xl border border-line bg-sunken/60 p-4 lg:w-64">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-faint">
          Good&rsquo;s record
          <Info label="Good's record">
            Not a score. Every field is an absolute count or amount, monotone in Good&rsquo;s misbehaviour —
            you cannot farm a clean record, you can only fail to have failed. Any statistic that averages
            across counterparties can be farmed, because a farmer manufactures the counterparties.
            <span className="mt-2 block">
              {record.growthFrozen
                ? "Good owes the pool, so its allowance cannot grow — no amount of new business digs it out. It has to repay first, and even then the capacity resumes from now, never for the time it lost."
                : "Good owes the pool nothing, so its allowance may grow — but only by proving it paid, which is the one thing volume alone can never do."}
            </span>
          </Info>
        </span>
        <Badge tone={record.growthFrozen ? "alarm" : "good"} dot>
          {record.growthFrozen ? "frozen" : "open"}
        </Badge>
      </div>

      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${record.defaultValue > 0n ? "text-bad" : "text-good"}`}>
        {naira(record.defaultValue)}
      </div>
      <div className="text-[0.7rem] text-mut">
        {record.defaults > 0n ? "the pool paid this in Good's place" : "never defaulted on anybody"}
      </div>

      {/* How much of the harm is still unrepaid. An empty track means the fund was made whole again —
          the one number on this card that can improve, since the rest only ever climb. */}
      <div className="mt-3">
        <Meter
          segments={[
            {
              pct: record.defaultValue > 0n ? pct(record.owedToPool, record.defaultValue) : 0,
              tone: owing ? "alarm" : "ink",
              label: "still owed to the pool",
            },
          ]}
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-[0.7rem]">
        <div>
          <dt className="uppercase tracking-wider text-faint">defaults</dt>
          <dd className="mt-0.5 font-mono font-medium tabular-nums text-ink-2">{String(record.defaults)}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-faint">claims voided</dt>
          <dd className="mt-0.5 font-mono font-medium tabular-nums text-ink-2">{String(record.claimsVoided)}</dd>
        </div>
      </dl>
    </div>
  );
}
