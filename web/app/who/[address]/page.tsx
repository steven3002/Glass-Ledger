"use client";

/**
 * One address, as an account.
 *
 * Same arrangement as the creator's: an identity-and-balance header, then the address's business as
 * sub-sections under a tab bar. What leads depends on what the address *is* — a landlord's locations,
 * otherwise the money owed to them — but the header is constant, and it leads with the one signed act
 * the protocol asks of any recipient: the payout account they put on file *from their own key*. That
 * hash is what every settlement proof must name; no account on file means Good cannot even post a claim
 * of having paid them. This page is derived, never registered — an address is what the ledger proves.
 */

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { Fact, Facts, Metric, Plate, Tabs, WhoLink } from "@/components/entity";
import { CardSkeleton, ChainError, Debts, PageHeader, Timeline, useLedger } from "@/components/ledger-view";
import { Badge, Bytes, Empty, Panel } from "@/components/ui";
import { abi, deployment, NGN, publicClient } from "@/lib/chain";
import { naira, untilDeadline, when } from "@/lib/format";
import type { Profile } from "@/lib/ledger/profiles";
import { linesAbout, profileOf } from "@/lib/ledger/profiles";

const ZERO = `0x${"0".repeat(64)}`;

type Tab = "locations" | "debts" | "activity";

export default function WhoPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address);

  const { cage, holdings, history, problem, now } = useLedger();
  const [accountHash, setAccountHash] = useState<string>();
  const [tab, setTab] = useState<Tab>("locations");

  useEffect(() => {
    if (!valid) return;
    void (async () => {
      const where = await deployment();
      const hash = await publicClient.readContract({
        address: where.debts,
        abi: abi.debts,
        functionName: "accountHashOf",
        args: [address as `0x${string}`, NGN],
      });
      setAccountHash(hash);
    })();
  }, [address, valid]);

  if (!valid) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <Panel title="Not an address" tone="alarm">
          <p className="text-sm leading-relaxed text-ink-2">
            &ldquo;{address}&rdquo; is not an address. A profile hangs off the forty hex characters a leg was minted to.
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

  const profile = holdings ? profileOf(holdings, address) : undefined;
  const filed = history?.entries.find((e) => e.name === "AccountHashSet" && e.who?.toLowerCase() === address.toLowerCase());
  const lines =
    history && profile ? linesAbout(history.entries, { address, debtIds: new Set(profile.debts.map((d) => d.id)) }) : [];

  const onFile = accountHash !== undefined && accountHash !== ZERO;
  const overdueNow = profile?.debts.filter((d) => d.state === "aging" && untilDeadline(d.deadline, now).overdue).length ?? 0;
  const hosts = (profile?.tranches.length ?? 0) > 0;

  // Locations lead when the address hosts any; otherwise the money it's owed does.
  const active: Tab = tab === "locations" && !hosts ? "debts" : tab;
  const tabs: { key: Tab; label: string; count?: number }[] = [
    ...(hosts ? [{ key: "locations" as const, label: "locations", count: profile?.tranches.length }] : []),
    { key: "debts", label: "debts", count: profile ? profile.debts.length : undefined },
    { key: "activity", label: "activity", count: history ? lines.length : undefined },
  ];

  return (
    <main className="mx-auto max-w-[1200px] space-y-5 p-6 lg:p-8">
      <PageHeader title="Profile" sub="Derived, never registered: an address, the roles its money gave it, and what the ledger can prove." />

      <section className="card p-6">
        {profile ? (
          <>
            <Plate address={profile.address} roles={profile.roles} />

            <div className="mt-5 border-t border-line pt-5">
              <Facts>
                <Fact label="Account on file" wide>
                  {accountHash === undefined ? (
                    <span className="text-mut">asking the chain…</span>
                  ) : onFile ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone="good" dot>
                        on file
                      </Badge>
                      <Bytes>{accountHash}</Bytes>
                    </span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone="warn" dot>
                        none
                      </Badge>
                      <span className="text-mut">no payout account is on file for NGN — Good cannot even post a claim of having paid them.</span>
                    </span>
                  )}
                </Fact>
                {onFile && (
                  <Fact label="Who wrote it" wide>
                    <span className="text-mut">
                      they did, from their own key{filed ? ` — ${when(filed.at)}` : ""}. Nobody else may: a shop that could
                      name the account would be asserting the fact it is supposed to prove. Every settlement proof about their
                      debts must name this hash.
                    </span>
                  </Fact>
                )}
              </Facts>
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-4">
              <Metric label="Ever minted" value={naira(profile.purse.minted)} />
              <Metric label="Owed now" value={naira(profile.purse.owedNow)} />
              <Metric label="Proven paid" value={naira(profile.purse.proven)} tone="good" />
              <Metric label="In default" value={String(overdueNow)} tone={overdueNow > 0 || profile.purse.defaultedCount > 0 ? "alarm" : "plain"} />
            </dl>
          </>
        ) : (
          <CardSkeleton rows={3} />
        )}
      </section>

      {profile && <Tabs tabs={tabs} active={active} onChange={setTab} />}

      {active === "locations" && profile && <Locations profile={profile} />}
      {active === "debts" &&
        (holdings && profile ? (
          profile.debts.length > 0 ? (
            <Debts debts={profile.debts} now={now} role="everyone" />
          ) : (
            <Panel title="Debts">
              <Empty>No leg has ever been minted to this address.</Empty>
            </Panel>
          )
        ) : (
          <CardSkeleton rows={4} tall />
        ))}
      {active === "activity" && (
        <Panel title="Their lines of the record" hint="The public history, cut down to what is this address's business.">
          {history ? (
            <Timeline entries={lines} empty="The record has never mentioned this address." />
          ) : (
            <CardSkeleton rows={4} />
          )}
        </Panel>
      )}
    </main>
  );
}

/* ---- Locations: the headline for a landlord ------------------------------------------------------ */

function Locations({ profile }: { profile: Profile }) {
  return (
    <section className="card p-6">
      <h2 className="mb-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-mut">Locations they host</h2>
      <p className="mb-4 max-w-2xl text-sm leading-relaxed text-mut">
        A tranche record carries its landlord and its location — the creator&rsquo;s consignment said where it sits and who
        the 5% belongs to, and the chain holds that sentence.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {profile.tranches.map((tranche) => (
          <li key={String(tranche.id)} className="rounded-[var(--radius-inner)] border border-line bg-sunken/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink">{tranche.location}</span>
              <Badge tone="plain">{tranche.itemCount} items</Badge>
            </div>
            <div className="mt-1 text-xs text-mut">
              consignment #{String(tranche.id)} · consigned by{" "}
              <Link href={`/creators/${String(tranche.creatorId)}`} className="underline-offset-2 hover:underline">
                creator #{String(tranche.creatorId)}
              </Link>{" "}
              · posted {when(tranche.postedAt)}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-faint">
        Paid the 5% on every sale at these locations. Their money and its state are in <span className="text-mut">debts</span>;
        who they are is nothing more than <WhoLink address={profile.address} /> and what the ledger proved.
      </p>
    </section>
  );
}
