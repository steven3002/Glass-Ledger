"use client";

/**
 * One item — where it stands, in the browse theme.
 *
 * The name flush and large with its trail of breadcrumbs, the figures ruled apart rather than boxed,
 * and then the item's two truths side by side: the per-location price and stock table, and the run of
 * recent purchases, a page at a time. The same design carries different prices in different places —
 * that spread is the point of the table.
 *
 * The honest line: price and authenticity are the chain's, per unit; stock and this activity feed are
 * what an indexer derives. Here both are demo data, so the shape can be seen before the index exists.
 */

import Link from "next/link";
import { use } from "react";


import { FiguresRow, PageFigure } from "@/components/browse";
import { Pager, usePaged } from "@/components/paged";
import { ProductTile } from "@/components/product";
import { Badge, Panel } from "@/components/ui";
import { activityFor, findItem, itemTotals, ngn, since } from "@/lib/demo/catalog";

export default function ItemPage({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = use(params);
  const found = findItem(id, itemId);

  const activity = found ? activityFor(found.item, 24) : [];
  const feed = usePaged(activity, 8);

  if (!found) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <Panel title="No such item" tone="alarm">
          <p className="text-sm leading-relaxed text-ink-2">
            The catalog has no item &ldquo;{itemId}&rdquo; in that collection. Back to{" "}
            <Link href={`/collections/${id}`} className="underline">
              the collection
            </Link>
            .
          </p>
        </Panel>
      </main>
    );
  }

  const { collection, item } = found;
  const t = itemTotals(item);

  return (
    <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10 lg:px-12">
      {/* Header: what it is, whose line it belongs to, and its picture. */}
      <div className="flex flex-wrap items-start justify-between gap-8">
        <div className="min-w-0 flex-1">
          <nav className="text-xs font-medium tracking-wide text-faint">
            <Link href="/collections" className="transition-colors hover:text-ink">
              Collections
            </Link>
            <span className="mx-1.5">•</span>
            <Link href={`/collections/${collection.id}`} className="transition-colors hover:text-ink">
              {collection.name}
            </Link>
            <span className="mx-1.5">•</span>
            <span className="text-mut">{item.name}</span>
          </nav>
          <h1 className="mt-1.5 flex flex-wrap items-center gap-3 text-[32px] font-bold tracking-tight text-ink">
            {item.name}
            <Badge tone="quiet">demo catalog</Badge>
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-mut">
            in{" "}
            <Link href={`/collections/${collection.id}`} className="font-medium text-ink-2 underline-offset-2 hover:underline">
              {collection.name}
            </Link>{" "}
            · by{" "}
            <Link href={`/creators/${collection.creatorId}`} className="font-medium text-ink-2 underline-offset-2 hover:underline">
              {collection.creatorName}
            </Link>
          </p>
          <p className="mt-4 max-w-[90%] text-sm leading-relaxed text-mut">{item.blurb}</p>

          <FiguresRow className="mt-6">
            <PageFigure label="Price" value={t.low === t.high ? ngn(t.low) : `${ngn(t.low)} – ${ngn(t.high)}`} first />
            <PageFigure label="In stock" value={String(t.stock)} tone={t.stock > 0 ? "plain" : "alarm"} />
            <PageFigure label="Sold" value={String(t.sold)} />
            <PageFigure label="Locations" value={String(t.locations)} />
          </FiguresRow>
        </div>

        <ProductTile name={item.name} className="size-40 shrink-0 rounded-xl border border-line" />
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-[1fr_1fr]">
        {/* Where it stands, place by place — the same item at different prices. */}
        <Panel
          title="Where it stands"
          hint="The same item, priced per location. Price is the kind of thing the chain proves per unit; the stock count is the indexer's."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[26rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[0.62rem] uppercase tracking-[0.12em] text-faint">
                  <th className="py-2.5 pr-2 font-semibold">Location</th>
                  <th className="px-2 py-2.5 text-right font-semibold">Price</th>
                  <th className="px-2 py-2.5 text-right font-semibold">In stock</th>
                  <th className="py-2.5 pl-2 text-right font-semibold">Sold</th>
                </tr>
              </thead>
              <tbody>
                {item.at.map((a) => (
                  <tr key={a.location} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-2 font-medium text-ink">{a.location}</td>
                    <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-ink">{ngn(a.price)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {a.stock > 0 ? <span className="text-ink-2">{a.stock}</span> : <span className="text-bad">0</span>}
                    </td>
                    <td className="py-2.5 pl-2 text-right tabular-nums text-mut">{a.sold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* The run of recent purchases, cursored — never an endless scroll. */}
        <Panel title="Activity" hint="Recent units bought and claimed, newest first — a page at a time.">
          <ul className="divide-y divide-line">
            {feed.slice.map((tx) => (
              <li key={tx.id} className="flex items-center gap-3 py-2.5 text-sm first:pt-0">
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-lg border text-[0.62rem] font-semibold uppercase ${
                    tx.kind === "claimed"
                      ? "border-[color-mix(in_oklab,var(--color-good-fill)_35%,white)] bg-[color-mix(in_oklab,var(--color-good-fill)_10%,white)] text-good"
                      : "border-line bg-sunken text-ink-2"
                  }`}
                >
                  {tx.kind === "claimed" ? "clm" : "buy"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">{tx.location}</div>
                  <div className="truncate font-mono text-[0.66rem] text-faint">
                    {tx.buyer} · {since(tx.ago)}
                  </div>
                </div>
                <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-ink">{ngn(tx.price)}</div>
              </li>
            ))}
          </ul>
          <Pager
            page={feed.page}
            pages={feed.pages}
            start={feed.start}
            size={feed.size}
            total={feed.total}
            onPrev={feed.prev}
            onNext={feed.next}
            noun="events"
          />
        </Panel>
      </div>
    </main>
  );
}
