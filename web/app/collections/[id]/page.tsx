"use client";

/**
 * One collection — its items.
 *
 * The unique products in the line, each shown once however many places it is sold. A card names what it
 * is, the range it costs across locations, and how many are in stock; opening it drops to the item,
 * where the locations, prices, stock and activity live. Demo catalog data — the indexer's stand-in.
 */

import Link from "next/link";
import { use } from "react";

import { ProductTile } from "@/components/product";
import { PageHeader } from "@/components/ledger-view";
import { Badge, Panel } from "@/components/ui";
import { collection, collectionTotals, itemTotals, ngn } from "@/lib/demo/catalog";

export default function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const c = collection(id);

  if (!c) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <Panel title="No such collection" tone="alarm">
          <p className="text-sm leading-relaxed text-ink-2">
            There is no collection &ldquo;{id}&rdquo; in the catalog. Browse them all on the{" "}
            <Link href="/collections" className="underline">
              collections page
            </Link>
            .
          </p>
        </Panel>
      </main>
    );
  }

  const totals = collectionTotals(c);

  return (
    <main className="mx-auto max-w-[1200px] space-y-5 p-6 lg:p-8">
      <PageHeader title={c.name} sub={`A collection by ${c.creatorName}.`} right={<Badge tone="quiet">demo catalog</Badge>} />

      <section className="card overflow-hidden">
        <div className="grid gap-0 sm:grid-cols-[16rem_1fr]">
          <ProductTile name={c.name} className="aspect-[16/9] w-full sm:aspect-auto sm:h-full" />
          <div className="p-6">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">Collection</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">{c.name}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mut">{c.blurb}</p>
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
              <Stat label="Items" value={String(totals.items)} />
              <Stat label="In stock" value={String(totals.stock)} />
              <Stat label="Sold" value={String(totals.sold)} />
              <Stat label="Locations" value={String(totals.locations)} />
            </dl>
          </div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="mb-4 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-mut">The items</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {c.items.map((item) => {
            const t = itemTotals(item);
            return (
              <li key={item.id}>
                <Link href={`/collections/${c.id}/${item.id}`} className="card-tap group block overflow-hidden p-0">
                  <ProductTile name={item.name} className="aspect-[4/3]" />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-ink group-hover:underline">{item.name}</span>
                      <Badge tone={t.stock > 0 ? "plain" : "alarm"}>{t.stock > 0 ? `${t.stock} in stock` : "sold out"}</Badge>
                    </div>
                    <div className="mt-1.5 text-sm font-semibold tabular-nums text-ink">
                      {t.low === t.high ? ngn(t.low) : `${ngn(t.low)} – ${ngn(t.high)}`}
                    </div>
                    <div className="mt-0.5 text-[0.68rem] text-faint">
                      {t.sold} sold · {t.locations} {t.locations === 1 ? "location" : "locations"}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.62rem] font-medium uppercase tracking-[0.12em] text-faint">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}
