"use client";

/**
 * One collection — its items, and its life.
 *
 * The browse theme carried into a detail page: the title flush and large, the line's figures ruled
 * apart rather than boxed, the tabs ruled off, and the content below. The grid stays the collection's
 * own — the unique items of the line, each a product, not a unit. Demo catalog data — the indexer's
 * stand-in.
 */

import Link from "next/link";
import { use, useMemo, useState } from "react";

import { FiguresRow, PageFigure } from "@/components/browse";
import { Tabs } from "@/components/entity";
import { Pager, usePaged } from "@/components/paged";
import { ProductTile } from "@/components/product";
import { Badge, Panel } from "@/components/ui";
import { activityFor, collection, collectionTotals, itemTotals, ngn, since } from "@/lib/demo/catalog";

type Tab = "items" | "activity";

export default function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const c = collection(id);
  const [tab, setTab] = useState<Tab>("items");

  // The line's whole recent activity, its items' feeds merged newest-first.
  const activity = useMemo(
    () =>
      (c?.items ?? [])
        .flatMap((item) => activityFor(item, 8).map((tx) => ({ ...tx, item: item.name, itemId: item.id })))
        .sort((a, b) => a.ago - b.ago),
    [c],
  );
  const feed = usePaged(activity, 12);

  if (!c) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <Panel title="No such collection" tone="alarm">
          <p className="text-sm leading-relaxed text-ink-2">
            There is no collection &ldquo;{id}&rdquo; in the catalog. Browse them all on the{" "}
            <Link href="/demo/collections" className="underline">
              collections page
            </Link>
            .
          </p>
        </Panel>
      </main>
    );
  }

  const t = collectionTotals(c);

  return (
    <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10 lg:px-12">
      {/* Header: what the line is, who made it, and its picture. */}
      <div className="flex flex-col-reverse gap-6 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-8">
        <div className="min-w-0 flex-1">
          <nav className="text-xs font-medium tracking-wide text-faint">
            <Link href="/demo/collections" className="transition-colors hover:text-ink">
              Collections
            </Link>
            <span className="mx-1.5">•</span>
            <span className="text-mut">{c.name}</span>
          </nav>
          <h1 className="mt-1.5 flex flex-wrap items-center gap-3 text-[32px] font-bold tracking-tight text-ink">
            {c.name}
            <Badge tone="quiet">demo catalog</Badge>
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-mut">
            A collection by{" "}
            <Link href={`/creators/${c.creatorId}`} className="font-medium text-ink-2 underline-offset-2 hover:underline">
              {c.creatorName}
            </Link>{" "}
            · creator #{c.creatorId}
          </p>
          <p className="mt-4 max-w-[90%] text-sm leading-relaxed text-mut">{c.blurb}</p>

          <FiguresRow className="mt-6">
            <PageFigure label="Total items" value={String(t.items)} first />
            <PageFigure label="In stock" value={t.stock.toLocaleString("en-NG")} />
            <PageFigure label="Sold" value={t.sold.toLocaleString("en-NG")} />
            <PageFigure label="Locations" value={String(t.locations)} />
          </FiguresRow>
        </div>

        <ProductTile name={c.name} className="size-40 shrink-0 rounded-xl border border-line" />
      </div>

      {/* Items | Activity, ruled off. */}
      <div className="mt-12">
        <Tabs
          tabs={[
            { key: "items", label: "items", count: c.items.length },
            { key: "activity", label: "activity", count: activity.length },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === "items" && (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {c.items.map((item) => {
            const it = itemTotals(item);
            return (
              <li key={item.id}>
                <Link href={`/demo/collections/${c.id}/${item.id}`} className="card-tap group block overflow-hidden p-0">
                  <ProductTile name={item.name} className="aspect-square w-full" />
                  <div className="p-3">
                    <div className="text-[10px] font-medium text-faint">
                      {it.stock > 0 ? `${it.stock} in stock` : "sold out"} · {it.locations} {it.locations === 1 ? "loc" : "locs"}
                    </div>
                    <div className="mt-1 truncate text-[12px] font-bold text-ink group-hover:underline">{item.name}</div>
                    <div className="mt-0.5 text-[11px] font-semibold tabular-nums text-ink-2">
                      {it.low === it.high ? ngn(it.low) : `${ngn(it.low)} – ${ngn(it.high)}`}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {tab === "activity" && (
        <section className="card mt-6 overflow-hidden">
          <ul className="divide-y divide-line">
            {feed.slice.map((tx) => (
              <li key={tx.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-lg border text-[0.6rem] font-semibold uppercase ${
                    tx.kind === "claimed"
                      ? "border-[color-mix(in_oklab,var(--color-good-fill)_35%,white)] bg-[color-mix(in_oklab,var(--color-good-fill)_10%,white)] text-good"
                      : "border-line bg-sunken text-ink-2"
                  }`}
                >
                  {tx.kind === "claimed" ? "clm" : "buy"}
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/demo/collections/${c.id}/${tx.itemId}`} className="truncate text-sm font-semibold text-ink hover:underline">
                    {tx.item}
                  </Link>
                  <div className="truncate font-mono text-[0.66rem] text-faint">
                    {tx.location} · {tx.buyer} · {since(tx.ago)}
                  </div>
                </div>
                <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-ink">{ngn(tx.price)}</div>
              </li>
            ))}
          </ul>
          <div className="px-4 pb-4 sm:px-5">
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
          </div>
        </section>
      )}
    </main>
  );
}
