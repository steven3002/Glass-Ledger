"use client";

/**
 * The community: the 2.5% that walked in with the buyer.
 *
 * A community owner exists per sale, bound by the voucher presented at checkout — half a referral is
 * not a referral, so the leg needs a recipient and a voucher hash or neither. The leaderboard ranks by
 * absolute amounts only. No rates, no averages: a rate has a denominator, and a denominator is what a
 * farmer manufactures.
 */

import Link from "next/link";

import { CardSkeleton, ChainError, PageHeader, useLedger } from "@/components/ledger-view";
import { Pager, usePaged } from "@/components/paged";
import { Avatar } from "@/components/product";
import { Badge, Empty } from "@/components/ui";
import { naira, shortAddress } from "@/lib/format";
import { profilesOf } from "@/lib/ledger/profiles";

const MEDAL = ["#d9a441", "#a9b0bb", "#c08457"]; // gold, silver, bronze

export default function CommunityPage() {
  const { cage, holdings, problem } = useLedger();
  const owners = holdings ? profilesOf(holdings, "community") : undefined;
  const paged = usePaged(owners ?? [], 10);

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const totalMinted = owners?.reduce((s, p) => s + p.purse.minted, 0n) ?? 0n;
  const totalReferrals = owners?.reduce((n, p) => n + p.purse.mintedCount, 0) ?? 0;

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6 lg:p-8">
      <PageHeader
        title="Community"
        sub="Whoever brought the buyer, paid by the sale itself: the 2.5% leg mints against a voucher presented at the counter, and the ledger remembers every one."
      />

      {owners && owners.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Summary label="Referrers" value={String(owners.length)} />
          <Summary label="Referrals" value={String(totalReferrals)} />
          <Summary label="Paid to community" value={naira(totalMinted)} tone="good" />
        </div>
      )}

      {!owners ? (
        <CardSkeleton rows={3} title tall />
      ) : owners.length === 0 ? (
        <section className="card p-6">
          <Empty>No sale has carried a community voucher yet. The leg exists the moment one is presented at checkout.</Empty>
        </section>
      ) : (
        <section className="card overflow-hidden">
          <header className="border-b border-line p-5 sm:p-6">
            <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-mut">The leaderboard</h2>
            <p className="mt-1.5 text-sm text-mut">
              Ranked by everything ever minted in their name — absolute amounts, because totals are the one thing a clean
              record cannot be farmed into.
            </p>
          </header>
          <ol className="divide-y divide-line">
            {paged.slice.map((profile, i) => {
              const rank = paged.start + i;
              return (
                <li key={profile.address}>
                  <Link href={`/who/${profile.address}`} className="flex items-center gap-4 p-4 transition-colors hover:bg-sunken sm:px-6">
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-sm font-bold tabular-nums"
                      style={
                        rank < 3
                          ? { background: `color-mix(in oklab, ${MEDAL[rank]} 22%, white)`, color: `color-mix(in oklab, ${MEDAL[rank]} 70%, black)` }
                          : { background: "var(--color-sunken)", color: "var(--color-mut)" }
                      }
                    >
                      {rank + 1}
                    </span>
                    <Avatar name={profile.address} className="size-10" text="text-xs" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-sm font-semibold text-ink">{shortAddress(profile.address)}</div>
                      <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-mut">
                        <span>
                          {profile.purse.mintedCount} {profile.purse.mintedCount === 1 ? "referral" : "referrals"}
                        </span>
                        <span>
                          owed now <strong className="font-semibold tabular-nums text-ink-2">{naira(profile.purse.owedNow)}</strong>
                        </span>
                        <span>
                          proven <strong className="font-semibold tabular-nums text-good">{naira(profile.purse.proven)}</strong>
                        </span>
                      </div>
                    </div>
                    {profile.purse.defaultedCount > 0 && (
                      <Badge tone="alarm" dot>
                        {profile.purse.defaultedCount} {profile.purse.defaultedCount === 1 ? "default" : "defaults"}
                      </Badge>
                    )}
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold tabular-nums text-ink">{naira(profile.purse.minted)}</div>
                      <div className="text-[0.62rem] uppercase tracking-wider text-faint">ever minted</div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
          <div className="px-5 pb-4 sm:px-6">
            <Pager
              page={paged.page}
              pages={paged.pages}
              start={paged.start}
              size={paged.size}
              total={paged.total}
              onPrev={paged.prev}
              onNext={paged.next}
              noun="referrers"
            />
          </div>
        </section>
      )}
    </main>
  );
}

function Summary({ label, value, tone = "plain" }: { label: string; value: string; tone?: "plain" | "good" }) {
  return (
    <div className="card p-4">
      <div className="text-[0.62rem] font-medium uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone === "good" ? "text-good" : "text-ink"}`}>{value}</div>
    </div>
  );
}
