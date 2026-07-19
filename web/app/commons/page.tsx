"use client";

/**
 * The commons — the fund that pays when Good does not, and Good's standing with it.
 *
 * Every other page in this ledger is about a thing: an item, a leg, an assertion. This one is about
 * the shop itself, and it exists because a whole class of events has no thing to belong to. Money
 * skimmed into the pool, a fine paid, dues collected, a freeze lifted — none of these name an item,
 * a debt or a claim, because none of them is about a sale. They are about whether the operator is in
 * good standing with the commons that backstops it.
 *
 * That absence is a fact worth showing rather than a gap to paper over. The item pages can answer
 * "was she paid?"; only this page can answer "and what kind of shop is this?" — which is the question
 * a reader actually arrived with.
 *
 * Every figure here is an absolute count or amount. A rate has a denominator and a denominator is
 * exactly what a farmer manufactures, so nothing on this page is averaged, normalised or scored.
 */

import { FiguresRow, PageFigure } from "@/components/browse";
import { Fact, Facts } from "@/components/entity";
import { CardSkeleton, ChainError, useLedger } from "@/components/ledger-view";
import { Lifecycle } from "@/components/lifecycle";
import { Badge, Panel } from "@/components/ui";
import { naira } from "@/lib/format";
import type { Entry } from "@/lib/ledger";

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
  const record = cage?.record;
  const pool = cage?.pool;

  return (
    <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10 lg:px-12">
      <h1 className="text-[32px] font-bold tracking-tight text-ink">The commons</h1>
      <p className="mt-1 max-w-3xl text-sm text-mut">
        The fund that pays the wronged party when Good does not, and what Good owes it. These are the acts that
        belong to no sale — which is why they are here, and not on any item&rsquo;s page.
      </p>

      <FiguresRow>
        <PageFigure label="In the pool" value={pool ? naira(pool.balance) : undefined} first />
        <PageFigure label="Dues owed to it" value={pool ? naira(pool.dues) : undefined} tone={pool && pool.dues > 0n ? "alarm" : "plain"} />
        <PageFigure
          label="Owed back by Good"
          value={record ? naira(record.owedToPool) : undefined}
          tone={record && record.owedToPool > 0n ? "alarm" : "plain"}
        />
        <PageFigure
          label="Fines unpaid"
          value={record ? naira(record.penaltiesUnpaid) : undefined}
          tone={record && record.penaltiesUnpaid > 0n ? "alarm" : "plain"}
        />
      </FiguresRow>

      <div className="mt-10 grid gap-5 [&>*]:min-w-0 lg:grid-cols-[22rem_1fr]">
        {!record ? (
          <CardSkeleton rows={5} title />
        ) : (
          <Panel
            title="Good's record"
            tone={record.growthFrozen || record.defaults > 0n ? "alarm" : undefined}
            hint="Not a score. Every field is an absolute count or amount, monotone in Good's misbehaviour — you cannot farm a clean record, you can only fail to have failed."
          >
            <Facts>
              <Fact label="Defaults">
                <span className={record.defaults > 0n ? "font-semibold text-bad" : ""}>{String(record.defaults)}</span>
              </Fact>
              <Fact label="Value defaulted">{naira(record.defaultValue)}</Fact>
              <Fact label="Claims voided">
                <span className={record.claimsVoided > 0n ? "font-semibold text-bad" : ""}>
                  {String(record.claimsVoided)}
                </span>
              </Fact>
              <Fact label="Growth">
                <Badge tone={record.growthFrozen ? "alarm" : "good"} dot>
                  {record.growthFrozen ? "frozen" : "unfrozen"}
                </Badge>
              </Fact>
            </Facts>

            <p className="mt-4 border-t border-line pt-4 text-[0.78rem] leading-relaxed text-mut">
              {record.growthFrozen ? (
                <>
                  Good owes the pool, so its allowance cannot grow — no amount of new business digs it out. It has to
                  repay first, and even then the capacity resumes from now, never for the time it lost.
                </>
              ) : (
                <>
                  Good owes the pool nothing, so its allowance may grow — but only by proving it paid, which is the one
                  thing volume alone can never do.
                </>
              )}
            </p>
          </Panel>
        )}

        <Panel
          title="The shop's conduct"
          hint="Skims into the fund, repayments, fines, dues, sweeps and freezes — oldest first. None of these lines names an item, because none of them is about a sale."
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
