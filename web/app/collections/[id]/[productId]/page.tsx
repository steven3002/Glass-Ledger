"use client";

/**
 * One product — where it stands, and what has happened to it.
 *
 * This page is about an identity, not a unit. "Palm & Smoke" is three candles to the shop and three
 * unrelated items to the contract, and the question a reader arrives with is *where can I buy this
 * and for how much* — not *what became of item 2002*. So the left panel is the per-location price and
 * stock, and the right is the line of everything that ever happened to any of its units, merged.
 *
 * The tagged units are listed, quietly, because the item is still the root of everything: a reader
 * who wants one unit's whole life clicks through to its dossier. What this page must not become is
 * that dossier — a product with twenty units cannot be twenty lifecycles stacked on one screen.
 */

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { FiguresRow, PageFigure } from "@/components/browse";
import { Activity } from "@/components/activity";
import { CardSkeleton, ChainError, itemTone, shelfWord, useLedger } from "@/components/ledger-view";
import { ProductTile } from "@/components/product";
import { Badge, Empty, Panel } from "@/components/ui";
import { naira } from "@/lib/format";
import {
  collectionOf,
  loadIndex,
  productOf,
  productUnits,
  type CatalogIndex,
  type IndexedProduct,
} from "@/lib/index";
import type { Holdings, Item } from "@/lib/ledger";
import { linesAbout } from "@/lib/ledger/profiles";
import { locationOf, placesOf, standOf } from "../../page";

export default function ProductPage({ params }: { params: Promise<{ id: string; productId: string }> }) {
  const { id, productId } = use(params);
  const { cage, holdings, history, problem, now } = useLedger();
  const [index, setIndex] = useState<CatalogIndex>();
  const [missing, setMissing] = useState(false);

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
  const product = collection ? productOf(collection, productId) : undefined;

  if ((index && !product) || missing) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <Panel title="No such product" tone="alarm">
          <p className="text-sm leading-relaxed text-ink-2">
            The indexer groups nothing called &ldquo;{productId}&rdquo; in that collection. Back to{" "}
            <Link href={`/collections/${id}`} className="underline decoration-line-strong underline-offset-2">
              the collection
            </Link>
            .
          </p>
        </Panel>
      </main>
    );
  }

  const ids = product ? new Set(productUnits(product).map((u) => u.itemId)) : new Set<number>();
  const units = (holdings?.items ?? []).filter((i) => ids.has(Number(i.id)));
  const lines =
    history && product ? linesAbout(history.entries, { itemIds: new Set([...ids].map((n) => BigInt(n))) }) : [];

  return (
    <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10 lg:px-12">
      {!collection || !product ? (
        <CardSkeleton rows={5} title />
      ) : (
        <>
          <div className="flex flex-col-reverse gap-6 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-8">
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
                <span className="text-mut">{product.name}</span>
              </nav>

              <h1 className="mt-1.5 flex flex-wrap items-center gap-3 text-[32px] font-bold tracking-tight text-ink">
                {product.name}
                <Badge tone="plain">
                  {productUnits(product).length} {productUnits(product).length === 1 ? "unit" : "units"}
                </Badge>
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-mut">
                in{" "}
                <Link
                  href={`/collections/${collection.id}`}
                  className="font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink"
                >
                  {collection.name}
                </Link>{" "}
                · by{" "}
                <Link
                  href={`/creators/${collection.creatorId}`}
                  className="font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink"
                >
                  {collection.creatorName}
                </Link>
              </p>
              <p className="mt-4 max-w-[90%] text-sm leading-relaxed text-mut">{product.blurb}</p>

              <Figures units={units} holdings={holdings} />
            </div>

            <ProductTile name={product.name} className="size-40 shrink-0 rounded-xl border border-line" />
          </div>

          <div className="mt-10 grid gap-5 [&>*]:min-w-0 lg:grid-cols-[1fr_1fr]">
            <WhereItStands units={units} holdings={holdings} loading={!holdings} />

            <Panel
              title="Activity"
              hint="Units bought and claimed, newest first. Open any line to read that unit's whole life on the chain."
            >
              {history ? (
                <Activity
                  entries={lines}
                  holdings={holdings}
                  now={now}
                  empty="Nothing has happened to this product yet. It is paperwork and a price, waiting."
                />
              ) : (
                <CardSkeleton rows={4} />
              )}
            </Panel>
          </div>
        </>
      )}
    </main>
  );
}

function Figures({ units, holdings }: { units: Item[]; holdings?: Holdings }) {
  const prices = units.map((u) => u.price).filter((p) => p > 0n);
  const low = prices.length ? prices.reduce((a, b) => (b < a ? b : a)) : undefined;
  const high = prices.length ? prices.reduce((a, b) => (b > a ? b : a)) : undefined;
  const places = placesOf(units, holdings);

  return (
    <FiguresRow className="mt-6">
      <PageFigure
        label="Price"
        value={low === undefined ? undefined : low === high ? naira(low) : `${naira(low)} – ${naira(high)}`}
        first
      />
      <PageFigure
        label="In stock"
        value={holdings ? String(units.filter((u) => standOf(u.state) === "inStore").length) : undefined}
      />
      <PageFigure label="Sold" value={holdings ? String(units.filter((u) => standOf(u.state) === "sold").length) : undefined} />
      <PageFigure label="Locations" value={holdings ? String(places.length) : undefined} />
    </FiguresRow>
  );
}

function WhereItStands({ units, holdings, loading }: { units: Item[]; holdings?: Holdings; loading: boolean }) {
  const places = placesOf(units, holdings);

  const rows = places.map((place) => {
    const locate = (unit: Item) => locationOf(unit, holdings);
    const here = units.filter((u) => locate(u) === place);
    const prices = here.map((u) => u.price).filter((p) => p > 0n);
    return {
      place,
      price: prices.length ? prices.reduce((a, b) => (b < a ? b : a)) : undefined,
      stock: here.filter((u) => standOf(u.state) === "inStore").length,
      sold: here.filter((u) => standOf(u.state) === "sold").length,
    };
  });

  return (
    <Panel
      title="Where it stands"
      hint="The same product, priced per location. Price and authenticity are the chain's, per unit; the grouping that makes these one product is the indexer's."
    >
      {loading ? (
        <CardSkeleton rows={3} />
      ) : rows.length === 0 ? (
        <Empty>No consignment names a place for this line yet.</Empty>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[0.62rem] uppercase tracking-[0.12em] text-faint">
                  <th className="py-2.5 pr-2 font-semibold">Location</th>
                  <th className="px-2 py-2.5 text-right font-semibold">Price</th>
                  <th className="px-2 py-2.5 text-right font-semibold">In stock</th>
                  <th className="py-2.5 pl-2 text-right font-semibold">Sold</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.place} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-2 font-medium text-ink">{row.place}</td>
                    <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-ink">
                      {row.price === undefined ? "—" : naira(row.price)}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {row.stock > 0 ? <span className="text-ink-2">{row.stock}</span> : <span className="text-bad">0</span>}
                    </td>
                    <td className="py-2.5 pl-2 text-right tabular-nums text-mut">{row.sold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* The units themselves, kept subordinate. The product is the subject of this page; a unit
              is a door out of it, to the dossier that holds that one item's whole life. */}
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-faint">The tagged units behind it</h3>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {units.map((unit) => (
                <li key={String(unit.id)}>
                  <Link
                    href={`/item/${String(unit.id)}`}
                    className="flex items-center gap-1.5 rounded-md border border-line bg-sunken px-2 py-1 font-mono text-[0.66rem] text-mut transition-colors hover:border-line-strong hover:text-ink"
                  >
                    item {String(unit.id)}
                    <Badge tone={itemTone(unit.state)}>{shelfWord(unit.state)}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </Panel>
  );
}
