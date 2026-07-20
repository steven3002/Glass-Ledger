"use client";

/**
 * One address, as an account — wearing the theme the creator's page sets.
 *
 * The name flush and large, the identity and the one signed act side by side, the figures ruled apart
 * rather than boxed, the tabs ruled off, and the headline sub-section first. What the name *is* depends
 * on what the address turned out to be: a landlord is called by the places he hosts, a referrer by the
 * address itself, because the protocol has no names for either.
 *
 * The right-hand object is the counterpart of the creator's till: the payout account on file. It is the
 * only thing the protocol ever asks of a recipient, and they must write it *from their own key* — that
 * hash is what every settlement proof must name, and no account on file means Good cannot even post a
 * claim of having paid them. This page is derived, never registered: an address is what the ledger proves.
 */

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { FiguresRow, PageFigure } from "@/components/browse";
import { Plate, Tabs } from "@/components/entity";
import { CardSkeleton, ChainError, Debts, Timeline, useLedger } from "@/components/ledger-view";
import { ProductTile } from "@/components/product";
import { Badge, Bytes, Empty, Panel, Skeleton } from "@/components/ui";
import { abi, deployment, NGN, publicClient } from "@/lib/chain";
import { naira, nairaShort, shortAddress, untilDeadline, when } from "@/lib/format";
import type { Entry } from "@/lib/ledger";
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

  const overdueNow = profile?.debts.filter((d) => d.state === "aging" && untilDeadline(d.deadline, now).overdue).length ?? 0;
  const hosts = (profile?.tranches.length ?? 0) > 0;
  const places = [...new Set((profile?.tranches ?? []).map((t) => t.location))];
  const who = identity(profile, places);

  // Locations lead when the address hosts any; otherwise the money it's owed does.
  const active: Tab = tab === "locations" && !hosts ? "debts" : tab;
  const tabs: { key: Tab; label: string; count?: number }[] = [
    ...(hosts ? [{ key: "locations" as const, label: "locations", count: places.length }] : []),
    { key: "debts", label: "debts", count: profile ? profile.debts.length : undefined },
    { key: "activity", label: "activity", count: history ? lines.length : undefined },
  ];

  return (
    <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10 lg:px-12">
      {/* Header: what the ledger made them, and the one thing they signed for themselves. */}
      <nav className="text-xs font-medium tracking-wide text-faint">
        <Link href={who.crumb.href} className="transition-colors hover:text-ink">
          {who.crumb.label}
        </Link>
        <span className="mx-1.5">•</span>
        <span className="text-mut">{shortAddress(address)}</span>
      </nav>
      {who.title && (
        <>
          <h1 className="mt-1.5 text-[32px] font-bold tracking-tight text-ink">{who.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-mut">{who.sub}</p>
        </>
      )}

      <div className={`flex flex-wrap items-start justify-between gap-8 ${who.title ? "mt-8" : "mt-5"}`}>
        {/* The identity column: who they are, what that means, and what it added up to. */}
        <div className="min-w-0 flex-1">
          {profile ? (
            <>
              <Plate address={profile.address} roles={profile.roles} />
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-mut">
                Nobody registered this profile — the roles are the roles their money gave them, and every figure below is
                derived from the same public facts the rest of the ledger reads. The one act asked of them is beside this:
                naming their own payout account, because a shop that could write it would be asserting the very fact it has
                to prove.
              </p>

              <FiguresRow className="mt-6">
                {hosts && <PageFigure label="Locations" value={String(places.length)} first />}
                {hosts && <PageFigure label="Consignments" value={String(profile.tranches.length)} />}
                {profile.roles.includes("community") && (
                  <PageFigure label="Referrals" value={String(profile.purse.mintedCount)} first />
                )}
                <PageFigure
                  label="Ever minted"
                  value={nairaShort(profile.purse.minted)}
                  title={naira(profile.purse.minted)}
                  first={!hosts && !profile.roles.includes("community")}
                />
                <PageFigure label="Owed now" value={nairaShort(profile.purse.owedNow)} title={naira(profile.purse.owedNow)} />
                <PageFigure label="Proven paid" value={nairaShort(profile.purse.proven)} title={naira(profile.purse.proven)} tone="good" />
                <PageFigure
                  label="In default"
                  value={String(overdueNow + profile.purse.defaultedCount)}
                  tone={overdueNow > 0 || profile.purse.defaultedCount > 0 ? "alarm" : "plain"}
                />
              </FiguresRow>
            </>
          ) : (
            <Skeleton className="h-40 w-full max-w-xl" />
          )}
        </div>
        <Account hash={accountHash} filed={filed} />
      </div>

      {/* The sub-sections, what they host first — ruled off. */}
      <div className="mt-12">
        {profile ? <Tabs tabs={tabs} active={active} onChange={setTab} /> : <Skeleton className="h-8 w-56" />}
      </div>

      <div className="mt-6">
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
      </div>
    </main>
  );
}

/* ---- Who the ledger made them ------------------------------------------------------------------- */

/**
 * The parent page, and — only where there is one — a name.
 *
 * A landlord has one: the places he hosts, which is what anybody actually calls him. Nobody else does,
 * and a shortened address set in 32px over the same address written out in full below it says nothing
 * twice. So for everyone else the title is dropped and the nameplate carries the identity alone.
 */
function identity(
  profile: Profile | undefined,
  places: string[],
): { crumb: { href: string; label: string }; title?: string; sub?: string } {
  if (places.length > 0) {
    const n = profile?.tranches.length ?? 0;
    return {
      crumb: { href: "/landlords", label: "Landlords" },
      title: places.join(" · "),
      sub: `The address a creator's consignment named as landlord — ${n} ${
        n === 1 ? "consignment" : "consignments"
      } standing here, and everything the 5% legs proved around them.`,
    };
  }

  if (profile?.roles.includes("community")) return { crumb: { href: "/community", label: "Community" } };

  return { crumb: { href: "/", label: "The ledger" } };
}

/* ---- The account on file: their side of the bargain, kept as its own object ----------------------- */

function Account({ hash, filed }: { hash?: string; filed?: Entry }) {
  const onFile = hash !== undefined && hash !== ZERO;

  return (
    <div className="w-full rounded-xl border border-line bg-sunken/60 p-4 lg:w-72">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-faint">Payout account on file</span>
        {hash !== undefined && <Badge tone={onFile ? "good" : "warn"}>{onFile ? "on file" : "none"}</Badge>}
      </div>

      {hash === undefined ? (
        <Skeleton className="mt-3 h-10 w-full" />
      ) : onFile ? (
        <>
          <div className="mt-2">
            <Bytes>{hash}</Bytes>
          </div>
          <p className="mt-3 border-t border-line pt-3 text-[0.7rem] leading-relaxed text-mut">
            They filed it themselves, from their own key{filed ? ` — ${when(filed.at)}` : ""}. Every settlement proof about
            their debts must name this hash.
          </p>
        </>
      ) : (
        <p className="mt-2 text-[0.7rem] leading-relaxed text-mut">
          No payout account is on file for NGN. Until they file one from their own key, Good cannot even post a claim of
          having paid them.
        </p>
      )}
    </div>
  );
}

/* ---- Locations: the headline for a landlord ------------------------------------------------------ */

function Locations({ profile }: { profile: Profile }) {
  return (
    <>
      <p className="mb-5 max-w-2xl text-sm leading-relaxed text-mut">
        A consignment record carries its landlord and its location — the creator&rsquo;s paperwork said where the goods sit
        and who the 5% belongs to, and the chain holds that sentence.
      </p>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {profile.tranches.map((tranche) => (
          <li key={String(tranche.id)} className="card overflow-hidden p-0">
            <ProductTile name={tranche.location} className="aspect-[16/9]" />
            <div className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-ink">{tranche.location}</span>
                <Badge tone="plain">{tranche.itemCount} items</Badge>
              </div>
              <div className="mt-1 text-[0.68rem] text-faint">
                consignment #{String(tranche.id)} · consigned by{" "}
                <Link href={`/creators/${String(tranche.creatorId)}`} className="underline-offset-2 hover:underline">
                  creator #{String(tranche.creatorId)}
                </Link>{" "}
                · posted {when(tranche.postedAt)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
