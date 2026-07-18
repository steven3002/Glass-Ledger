"use client";

/**
 * Home is the explorer: the shop's whole state at a glance, read live from the chain.
 *
 * The shape is a block explorer's — a band of counts across the top, the cage as the one deep reading,
 * then the leaderboards a curious visitor actually wants (what is selling, where, who is being paid)
 * beside the live record of everything that has happened. Every count and every row is a door: the
 * point of a landing page is to send you somewhere, not to make you read it.
 *
 * The activity feed here carries no persona filter on purpose — that belongs on the history page, which
 * this one links to. A landing page shows the latest of everything; the tool for reading one party's
 * lines is one click away.
 */

import Link from "next/link";
import type { ReactNode } from "react";

import {
  CageRow,
  CageRowSkeleton,
  ChainError,
  PageHeader,
  Timeline,
  useLedger,
  WriteOffs,
} from "@/components/ledger-view";
import { Badge, Panel, Skeleton } from "@/components/ui";
import { naira, shortAddress } from "@/lib/format";
import type { Cage, Holdings } from "@/lib/ledger";
import { profilesOf, purseOf } from "@/lib/ledger/profiles";
import { placeOf } from "@/lib/places";

export default function Overview() {
  const { cage, holdings, history, problem } = useLedger();

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const tiles: { href: string; name: string; value?: string; note: string }[] = [
    { href: "/collections", name: "Collections", value: holdings && String(holdings.tranches.length), note: "consignments on chain" },
    { href: "/creators", name: "Creators", value: cage && String(cage.capacity.length), note: "registered keys" },
    { href: "/landlords", name: "Landlords", value: holdings && String(profilesOf(holdings, "landlord").length), note: "spaces hosting goods" },
    { href: "/community", name: "Community", value: holdings && String(profilesOf(holdings, "community").length), note: "referrers paid" },
    { href: "/shelf", name: "Items", value: holdings && String(holdings.items.length), note: "on the shelf" },
    { href: "/debts", name: "Debts", value: holdings && String(holdings.debts.length), note: "minted, every state" },
    { href: "/claims", name: "Claims", value: holdings && String(holdings.claims.length), note: "assertions of payment" },
    { href: "/history", name: "Events", value: history && String(history.entries.length), note: "state changes recorded" },
  ];

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 p-6 lg:p-8">
      <PageHeader title="The ledger" sub="Read live from the chain. Nothing on this page comes from the shop." />

      {/* The counts band — a block explorer's headline row, every tile a door. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="card-tap p-4">
            <div className="text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-faint">{t.name}</div>
            {t.value !== undefined ? (
              <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{t.value}</div>
            ) : (
              <Skeleton className="mt-1.5 h-7 w-10" />
            )}
            <div className="mt-0.5 text-[0.7rem] text-mut">{t.note}</div>
          </Link>
        ))}
      </div>

      {cage ? <CageRow cage={cage} /> : <CageRowSkeleton />}
      {history && <WriteOffs writeOffs={history.writeOffs} />}

      {/* The live record, beside what is selling. */}
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Panel
          title="Latest on the ledger"
          hint="Every state change the protocol made, newest first. The full record — with the persona filter — is on the history page."
        >
          {history ? (
            <>
              <Timeline entries={history.entries.slice(0, 12)} empty="Nothing has happened yet." />
              {history.entries.length > 12 && (
                <Link href="/history" className="mt-4 inline-flex items-center text-sm font-medium text-mut transition-colors hover:text-ink">
                  View all {history.entries.length} events →
                </Link>
              )}
            </>
          ) : (
            <FeedSkeleton />
          )}
        </Panel>

        <Trending holdings={holdings} />
      </div>

      {/* The leaderboards: where, who brought the buyer, who signed. */}
      <div className="grid gap-5 lg:grid-cols-3">
        <HitLocations holdings={holdings} />
        <TopCommunities holdings={holdings} />
        <Creators cage={cage} holdings={holdings} />
      </div>
    </main>
  );
}

/* ---- Section furniture ---------------------------------------------------------------------------- */

function ViewAll({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mt-4 inline-flex items-center text-sm font-medium text-mut transition-colors hover:text-ink">
      {children} →
    </Link>
  );
}

function RankRow({ href, rank, title, sub, value, badge }: { href: string; rank: number; title: string; sub: string; value?: string; badge?: ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 rounded-2xl p-2.5 transition-colors hover:bg-sunken">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-sunken font-mono text-xs font-semibold text-ink-2">{rank}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">{title}</div>
          <div className="truncate font-mono text-[0.68rem] text-faint">{sub}</div>
        </div>
        {value && <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-ink">{value}</div>}
        {badge}
      </Link>
    </li>
  );
}

function FeedSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full rounded-xl" />
      ))}
    </div>
  );
}

function RankSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  );
}

/* ---- The leaderboards ----------------------------------------------------------------------------- */

/** Sales carried per creator — one creator-role debt is minted per sale, so this counts sales. */
function salesByCreator(holdings?: Holdings): Map<string, number> {
  const map = new Map<string, number>();
  for (const debt of holdings?.debts ?? []) {
    if (debt.role !== "creator") continue;
    const key = String(debt.creatorId);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function Trending({ holdings }: { holdings?: Holdings }) {
  const sales = salesByCreator(holdings);
  const rows = [...(holdings?.tranches ?? [])]
    .map((t) => ({ t, sales: sales.get(String(t.creatorId)) ?? 0 }))
    .sort((a, b) => b.sales - a.sales || b.t.itemCount - a.t.itemCount)
    .slice(0, 6);

  return (
    <Panel title="Trending collections" hint="Ranked by sales carried — a sale mints one creator leg, so this is volume, not trust.">
      {!holdings ? (
        <RankSkeleton />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">No consignment posted yet.</p>
      ) : (
        <>
          <ul className="space-y-1">
            {rows.map(({ t, sales }, i) => (
              <RankRow
                key={String(t.id)}
                href="/collections"
                rank={i + 1}
                title={`${t.location}`}
                sub={`consignment #${String(t.id)} · creator #${String(t.creatorId)}`}
                value={`${sales} ${sales === 1 ? "sale" : "sales"}`}
              />
            ))}
          </ul>
          <ViewAll href="/collections">All collections</ViewAll>
        </>
      )}
    </Panel>
  );
}

function HitLocations({ holdings }: { holdings?: Holdings }) {
  const sales = salesByCreator(holdings);
  const groups = new Map<string, { collections: number; sales: number }>();
  for (const t of holdings?.tranches ?? []) {
    const name = placeOf(t.location)?.name ?? t.location;
    const g = groups.get(name) ?? { collections: 0, sales: 0 };
    g.collections += 1;
    g.sales += sales.get(String(t.creatorId)) ?? 0;
    groups.set(name, g);
  }
  const rows = [...groups].sort((a, b) => b[1].sales - a[1].sales || b[1].collections - a[1].collections).slice(0, 5);

  return (
    <Panel title="Hit locations" hint="Where the goods stand, busiest first. The globe shows the same places.">
      {!holdings ? (
        <RankSkeleton />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">No location named yet.</p>
      ) : (
        <>
          <ul className="space-y-1">
            {rows.map(([name, g], i) => (
              <RankRow
                key={name}
                href="/map"
                rank={i + 1}
                title={name}
                sub={`${g.collections} ${g.collections === 1 ? "collection" : "collections"}`}
                value={`${g.sales} ${g.sales === 1 ? "sale" : "sales"}`}
              />
            ))}
          </ul>
          <ViewAll href="/map">Open the map</ViewAll>
        </>
      )}
    </Panel>
  );
}

function TopCommunities({ holdings }: { holdings?: Holdings }) {
  const rows = holdings ? profilesOf(holdings, "community").slice(0, 5) : [];

  return (
    <Panel title="Top communities" hint="Whoever brought the buyer, by everything ever minted in their name — an absolute total, never a rate.">
      {!holdings ? (
        <RankSkeleton />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">No referral has minted yet.</p>
      ) : (
        <>
          <ul className="space-y-1">
            {rows.map((p, i) => (
              <RankRow
                key={p.address}
                href={`/who/${p.address}`}
                rank={i + 1}
                title={shortAddress(p.address)}
                sub={`${p.purse.mintedCount} ${p.purse.mintedCount === 1 ? "referral" : "referrals"}`}
                value={naira(p.purse.minted)}
              />
            ))}
          </ul>
          <ViewAll href="/community">The leaderboard</ViewAll>
        </>
      )}
    </Panel>
  );
}

function Creators({ cage, holdings }: { cage?: Cage; holdings?: Holdings }) {
  return (
    <Panel title="Creators" hint="The registry's whole population — a signing key, and the till Good has open with each.">
      {!cage ? (
        <RankSkeleton />
      ) : cage.capacity.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">Nobody has registered yet.</p>
      ) : (
        <>
          <ul className="space-y-1">
            {cage.capacity.map((row, i) => {
              const purse = purseOf((holdings?.debts ?? []).filter((d) => d.role === "creator" && d.creatorId === row.creatorId));
              const shut = row.headroom === 0n;
              return (
                <RankRow
                  key={String(row.creatorId)}
                  href={`/creators/${String(row.creatorId)}`}
                  rank={i + 1}
                  title={`creator #${String(row.creatorId)}`}
                  sub={`signs as ${shortAddress(row.key)} · ${purse.mintedCount} sales`}
                  badge={
                    <Badge tone={shut ? "alarm" : "good"} dot>
                      {shut ? "shut" : "open"}
                    </Badge>
                  }
                />
              );
            })}
          </ul>
          <ViewAll href="/creators">All creators</ViewAll>
        </>
      )}
    </Panel>
  );
}
