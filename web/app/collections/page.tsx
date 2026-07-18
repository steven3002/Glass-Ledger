"use client";

/**
 * Collections — the shop's lines, one card each.
 *
 * A collection is a creator's line, the way a house of perfume has a line: it holds items (its unique
 * products), and each item is sold in one or more places at one or more prices. This page lists the
 * lines; a card opens one, and inside are its items. The data here is the demo catalog — the indexer's
 * stand-in — not the chain; price and authenticity are the chain's job, the catalogue and its stock are
 * the indexer's.
 */

import Link from "next/link";

import { ProductTile } from "@/components/product";
import { PageHeader } from "@/components/ledger-view";
import { Badge } from "@/components/ui";
import { collections, collectionTotals } from "@/lib/demo/catalog";

export default function CollectionsPage() {
  const all = collections();

  return (
    <main className="mx-auto max-w-[1200px] space-y-5 p-6 lg:p-8">
      <PageHeader
        title="Collections"
        sub="Each creator's line — a collection of items, sold across locations. Open one to see its items; open an item to see where it stands and for how much."
        right={<Badge tone="quiet">demo catalog</Badge>}
      />

      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {all.map((c) => {
          const totals = collectionTotals(c);
          return (
            <li key={c.id}>
              <Link href={`/collections/${c.id}`} className="card-tap group flex h-full flex-col overflow-hidden p-0">
                <ProductTile name={c.name} className="aspect-[16/9] w-full" />
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-base font-semibold text-ink group-hover:underline">{c.name}</h2>
                    <Badge tone="plain">{totals.items} items</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-mut">by {c.creatorName}</div>
                  <p className="mt-2 line-clamp-2 flex-1 text-sm leading-relaxed text-mut">{c.blurb}</p>
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-xs text-mut">
                    <span>
                      <strong className="font-semibold tabular-nums text-ink-2">{totals.stock}</strong> in stock
                    </span>
                    <span>
                      <strong className="font-semibold tabular-nums text-ink-2">{totals.sold}</strong> sold
                    </span>
                    <span>
                      <strong className="font-semibold tabular-nums text-ink-2">{totals.locations}</strong>{" "}
                      {totals.locations === 1 ? "location" : "locations"}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="px-1 text-xs leading-relaxed text-faint">
        A collection groups a creator&rsquo;s items in signed metadata — it spans locations, and the chain holds each
        item&rsquo;s price and authenticity per unit. Stock and the activity feed are what an indexer derives; this page
        stands in for that indexer with demo data.
      </p>
    </main>
  );
}
