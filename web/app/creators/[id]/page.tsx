"use client";

/**
 * One creator's account.
 *
 * Arranged like a block explorer's account page: an identity-and-balance header, then the creator's
 * work as the headline — her collections — with the rest (the money owed to her, her lines of the
 * record) as sub-sections under a tab bar. Everything hangs off one registered key: her vouchers verify
 * against it, her tranches name her by the id it earned, and the bilateral till — allowance, held,
 * headroom — is hers, capacity Good earned with her and spendable only on her goods.
 */

import Link from "next/link";
import { use, useState } from "react";

import { Metric, Plate, Tabs } from "@/components/entity";
import { CardSkeleton, ChainError, Debts, pct, Timeline, useLedger } from "@/components/ledger-view";
import { ProductTile } from "@/components/product";
import { Badge, Empty, Meter, Panel } from "@/components/ui";
import { naira, when } from "@/lib/format";
import type { Cage } from "@/lib/ledger";
import { linesAbout, purseOf } from "@/lib/ledger/profiles";
import { collections as demoCollections, collectionTotals, type Collection } from "@/lib/demo/catalog";

const TABS = ["collections", "debts", "activity"] as const;
type Tab = (typeof TABS)[number];

export default function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const creatorId = /^\d+$/.test(id) ? BigInt(id) : undefined;

  const { cage, holdings, history, problem, now } = useLedger();
  const [tab, setTab] = useState<Tab>("collections");

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const capacity = creatorId !== undefined ? cage?.capacity.find((c) => c.creatorId === creatorId) : undefined;

  if (creatorId === undefined || (cage && !capacity)) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <Panel title="No such creator" tone="alarm">
          <p className="text-sm leading-relaxed text-ink-2">
            The registry has no creator #{id}. A creator exists when her key is registered, and this id was never given
            out. The population is on the <Link href="/creators" className="underline">creators page</Link>.
          </p>
        </Panel>
      </main>
    );
  }

  const creditLegs = (holdings?.debts ?? []).filter((d) => d.role === "creator" && d.creatorId === creatorId);
  const purse = purseOf(creditLegs);
  const volume = (holdings?.debts ?? [])
    .filter((d) => d.creatorId === creatorId && d.role !== "buyer")
    .reduce((sum, d) => sum + d.amount, 0n);
  const myCollections = demoCollections().filter((c) => c.creatorId === Number(creatorId));
  const itemIds = new Set((holdings?.items ?? []).map((i) => i.id));
  const registered = history?.entries.find((e) => e.name === "CreatorRegistered" && e.creatorId === creatorId);
  const lines = history
    ? linesAbout(history.entries, { creatorId, address: capacity?.key, itemIds, debtIds: new Set(creditLegs.map((d) => d.id)) })
    : [];

  const counts: Record<Tab, number | undefined> = {
    collections: myCollections.length,
    debts: holdings ? creditLegs.length : undefined,
    activity: history ? lines.length : undefined,
  };

  return (
    <main className="mx-auto max-w-[1200px] space-y-5 p-6 lg:p-8">
      {/* The account header: who she is, and the till Good keeps with her. */}
      <section className="card p-6">
        {capacity ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">Creator account</div>
              <div className="mt-2">
                <Plate address={capacity.key} roles={["creator"]} note={registered ? `registered ${when(registered.at)}` : undefined} />
              </div>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-mut">
                Every voucher on every tag of hers is checked against this key — the registry is asked who signed, never the
                paperwork. A forgery with any other key is worthless by construction.
              </p>
            </div>
            <Till capacity={capacity} />
          </div>
        ) : (
          <CardSkeleton rows={2} />
        )}

        {/* The balance strip — her numbers at a glance. */}
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Collections" value={String(myCollections.length)} />
          <Metric label="Sales" value={holdings ? String(purse.mintedCount) : undefined} />
          <Metric label="Volume" value={holdings ? naira(volume) : undefined} />
          <Metric label="Owed now" value={holdings ? naira(purse.owedNow) : undefined} />
          <Metric label="Proven paid" value={holdings ? naira(purse.proven) : undefined} tone="good" />
          <Metric label="Defaults" value={holdings ? String(purse.defaultedCount) : undefined} tone={purse.defaultedCount > 0 ? "alarm" : "plain"} />
        </dl>
      </section>

      {/* The sub-sections, collections first and prominent. */}
      <Tabs tabs={TABS.map((key) => ({ key, label: key, count: counts[key] }))} active={tab} onChange={setTab} />

      {tab === "collections" && <CreatorCollections collections={myCollections} />}
      {tab === "debts" && (holdings ? <Debts debts={creditLegs} now={now} role="creator" /> : <CardSkeleton rows={5} tall />)}
      {tab === "activity" && (
        <Panel title="Her lines of the record" hint="The public history, cut down to what is this creator's business.">
          {history ? (
            <Timeline entries={lines} empty="Nothing yet — her story starts when the consignment posts." />
          ) : (
            <CardSkeleton rows={5} />
          )}
        </Panel>
      )}
    </main>
  );
}

/* ---- The till: her balance, as the account's headline number ------------------------------------- */

function Till({ capacity }: { capacity: NonNullable<Cage["capacity"][number]> }) {
  const shut = capacity.headroom === 0n;
  return (
    <div className="rounded-2xl border border-line bg-sunken/60 p-4 lg:w-64">
      <div className="flex items-center justify-between">
        <span className="text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-faint">Till Good keeps with her</span>
        <Badge tone={shut ? "alarm" : "good"} dot>
          {shut ? "shut" : "open"}
        </Badge>
      </div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${shut ? "text-bad" : "text-good"}`}>{naira(capacity.headroom)}</div>
      <div className="text-[0.7rem] text-mut">headroom for her next cash sale</div>
      <div className="mt-3">
        <Meter segments={[{ pct: pct(capacity.outstanding, capacity.outstanding + capacity.headroom), tone: shut ? "alarm" : "ink", label: "held" }]} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-[0.7rem]">
        <div>
          <dt className="uppercase tracking-wider text-faint">allowance</dt>
          <dd className="mt-0.5 font-mono font-medium tabular-nums text-ink-2">{naira(capacity.allowance)}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-faint">held</dt>
          <dd className="mt-0.5 font-mono font-medium tabular-nums text-ink-2">{naira(capacity.outstanding)}</dd>
        </div>
      </dl>
    </div>
  );
}

/* ---- Collections: the headline of the profile ---------------------------------------------------- */

function CreatorCollections({ collections }: { collections: Collection[] }) {
  if (collections.length === 0) {
    return (
      <section className="card p-6">
        <Empty>No collection yet. Her lines appear here as she publishes them.</Empty>
      </section>
    );
  }

  return (
    <section className="card p-6">
      <h2 className="mb-4 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-mut">Her collections</h2>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {collections.map((c) => {
          const totals = collectionTotals(c);
          return (
            <li key={c.id}>
              <Link href={`/collections/${c.id}`} className="card-tap group block overflow-hidden p-0">
                <ProductTile name={c.name} className="aspect-[16/9]" />
                <div className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-ink group-hover:underline">{c.name}</span>
                    <Badge tone="plain">{totals.items} items</Badge>
                  </div>
                  <div className="mt-1 text-[0.68rem] text-faint">
                    {totals.stock} in stock · {totals.sold} sold · {totals.locations}{" "}
                    {totals.locations === 1 ? "location" : "locations"}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
