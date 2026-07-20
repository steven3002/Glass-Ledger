"use client";

/**
 * One collection — its products, and its life.
 *
 * The grid stays the collection's own: the unique products of the line, each a product, not a unit.
 * That distinction is the whole reason this page exists separately from the shelf. The shelf lists
 * tagged units and answers "where does item 1001 stand"; this lists identities and answers "what does
 * she make, and can I buy it". A product here may be backed by one unit or by twenty.
 */

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { FiguresRow, PageFigure } from "@/components/browse";
import { Tabs } from "@/components/entity";
import { CardSkeleton, ChainError, useLedger } from "@/components/ledger-view";
import { Activity } from "@/components/activity";
import { ProductTile } from "@/components/product";
import { Badge, Panel } from "@/components/ui";
import { naira } from "@/lib/format";
import { collectionOf, loadIndex, productUnits, unitIds, type CatalogIndex, type IndexedCollection, type IndexedProduct } from "@/lib/index";
import type { Holdings } from "@/lib/ledger";
import { linesAbout } from "@/lib/ledger/profiles";
import { placesOf, standOf, totalsOf } from "../page";

type Tab = "items" | "activity";

export default function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { cage, holdings, history, problem, now } = useLedger();
  const [index, setIndex] = useState<CatalogIndex>();
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>("items");

  useEffect(() => {
    void loadIndex()
      .then(setIndex)
      .catch(() => setMissing(true));
  }, []);

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const collection = index ? collectionOf(index, id) : undefined;

  if ((index && !collection) || missing) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <Panel title="No such collection" tone="alarm">
          <p className="text-sm leading-relaxed text-ink-2">
            The indexer groups no line called &ldquo;{id}&rdquo;. Browse them all on the{" "}
            <Link href="/collections" className="underline decoration-line-strong underline-offset-2">
              collections page
            </Link>
            .
          </p>
        </Panel>
      </main>
    );
  }

  const ids = collection ? new Set(unitIds(collection).map((n) => BigInt(n))) : new Set<bigint>();
  const lines = history && collection ? linesAbout(history.entries, { itemIds: ids }) : [];

  return (
    <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10 lg:px-12">
      <nav className="text-xs font-medium tracking-wide text-faint">
        <Link href="/collections" className="transition-colors hover:text-ink">
          Collections
        </Link>
        <span className="mx-1.5">•</span>
        <span className="text-mut">{collection?.name ?? id}</span>
      </nav>

      {!collection ? (
        <div className="mt-6">
          <CardSkeleton rows={5} title />
        </div>
      ) : (
        <>
          <Header collection={collection} holdings={holdings} />

          <div className="mt-12">
            <Tabs
              tabs={[
                { key: "items", label: "items", count: collection.products.length },
                { key: "activity", label: "activity", count: history ? lines.length : undefined },
              ]}
              active={tab}
              onChange={setTab}
            />
          </div>

          {tab === "items" && (
            <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {collection.products.map((product) => (
                <li key={product.id}>
                  <ProductCard collection={collection} product={product} holdings={holdings} />
                </li>
              ))}
            </ul>
          )}

          {tab === "activity" && (
            <div className="mt-6">
              <Panel
                title="The line's activity"
                hint="Units bought and claimed across the whole line, newest first. Open any line to read that unit's whole life on the chain."
              >
                {history ? (
                  <Activity entries={lines} holdings={holdings} now={now} size={12} empty="Nothing has happened to this line yet." />
                ) : (
                  <CardSkeleton rows={5} />
                )}
              </Panel>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function Header({ collection, holdings }: { collection: IndexedCollection; holdings?: Holdings }) {
  const t = totalsOf(collection, holdings);

  return (
    <div className="flex flex-col-reverse gap-6 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-8">
      <div className="min-w-0 flex-1">
        <h1 className="mt-1.5 flex flex-wrap items-center gap-3 text-[32px] font-bold tracking-tight text-ink">
          {collection.name}
          <Badge tone="plain">{collection.category}</Badge>
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-mut">
          A collection by{" "}
          <Link
            href={`/creators/${collection.creatorId}`}
            className="font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink"
          >
            {collection.creatorName}
          </Link>{" "}
          · creator #{collection.creatorId}
        </p>
        <p className="mt-4 max-w-[90%] text-sm leading-relaxed text-mut">{collection.blurb}</p>

        <FiguresRow className="mt-6">
          <PageFigure label="Total items" value={String(t.products)} first />
          <PageFigure label="In stock" value={holdings ? String(t.inStore) : undefined} />
          <PageFigure label="Sold" value={holdings ? String(t.sold) : undefined} />
          <PageFigure label="Locations" value={holdings ? String(t.places.length) : undefined} />
        </FiguresRow>
      </div>

      <ProductTile name={collection.name} className="size-40 shrink-0 rounded-xl border border-line" />
    </div>
  );
}

function ProductCard({
  collection,
  product,
  holdings,
}: {
  collection: IndexedCollection;
  product: IndexedProduct;
  holdings?: Holdings;
}) {
  const ids = new Set(productUnits(product).map((u) => u.itemId));
  const units = (holdings?.items ?? []).filter((i) => ids.has(Number(i.id)));
  const prices = units.map((u) => u.price).filter((p) => p > 0n);
  const inStore = units.filter((u) => standOf(u.state) === "inStore").length;
  const places = placesOf(units, holdings);
  const low = prices.length ? prices.reduce((a, b) => (b < a ? b : a)) : undefined;
  const high = prices.length ? prices.reduce((a, b) => (b > a ? b : a)) : undefined;

  return (
    <Link href={`/collections/${collection.id}/${product.id}`} className="card-tap group block overflow-hidden p-0">
      <ProductTile name={product.name} className="aspect-square w-full" />
      <div className="p-3">
        <div className="text-[10px] font-medium text-faint">
          {inStore > 0 ? `${inStore} in stock` : "sold out"} · {places.length} {places.length === 1 ? "loc" : "locs"}
        </div>
        <div className="mt-1 truncate text-[12px] font-bold text-ink group-hover:underline">{product.name}</div>
        <div className="mt-0.5 text-[11px] font-semibold tabular-nums text-ink-2">
          {low === undefined ? "—" : low === high ? naira(low) : `${naira(low)} – ${naira(high)}`}
        </div>
      </div>
    </Link>
  );
}
