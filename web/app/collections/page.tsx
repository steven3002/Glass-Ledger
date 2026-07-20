"use client";

/**
 * Collections — the shop's lines, one card each.
 *
 * A collection is a creator's line, the way a house of perfume has a line: it holds products, and
 * each product is sold in one or more places at one or more prices. The grouping is the indexer's —
 * the chain accounts for items one at a time and has no notion of a line at all — while every number
 * on these cards is read from the chain against the item ids the indexer grouped.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { BrowseControls, FiguresRow, FilterRow, GRID_OF, PageFigure, type View } from "@/components/browse";
import { Dropdown } from "@/components/dropdown";
import { CardSkeleton, ChainError, useLedger } from "@/components/ledger-view";
import { usePaged } from "@/components/paged";
import { ProductTile } from "@/components/product";
import { Badge } from "@/components/ui";
import { loadIndex, unitIds, type CatalogIndex, type IndexedCollection } from "@/lib/index";
import type { Holdings, Item } from "@/lib/ledger";

/** The shelf's own words, kept identical to /shelf so a count here can never contradict one there. */
export const standOf = (state: string) =>
  state === "SOLD" || state === "OWNED" ? "sold" : state === "BURNED" ? "burned" : "inStore";

/**
 * Where one unit sits, according to the creator's own paperwork.
 *
 * A consignment names the place its goods sit, so location belongs to the tranche rather than to
 * anything the catalog decided. Every unit knows its tranche — the chain's once a sale has touched
 * it, and the published consignment's before that.
 */
export const locationOf = (unit: Item, holdings?: Holdings): string =>
  holdings?.tranches.find((t) => t.id === unit.trancheId)?.location ?? "Unrecorded";

/**
 * The places a given set of units actually stands in.
 *
 * Derived from the units, never from their creator. Asking "which towns does this creator sell in"
 * is a different question with a plausible-looking wrong answer: a creator with two lines lends each
 * of them the other's towns, and every product in a line inherits all of the line's. It read as a cap
 * sold only in Abuja announcing three locations, and as rows of "—, 0, 0" that look like sold out
 * where nothing was ever stocked.
 */
export const placesOf = (units: Item[], holdings?: Holdings): string[] =>
  [...new Set(units.map((u) => locationOf(u, holdings)))].sort();

/** What the chain says about one line's units. Everything here is read, nothing is asserted. */
export function totalsOf(collection: IndexedCollection, holdings?: Holdings) {
  const ids = new Set(unitIds(collection));
  const units = (holdings?.items ?? []).filter((i) => ids.has(Number(i.id)));
  const prices = units.map((u) => u.price).filter((p) => p > 0n);
  const places = placesOf(units, holdings);

  return {
    products: collection.products.length,
    units: ids.size,
    inStore: units.filter((u) => standOf(u.state) === "inStore").length,
    sold: units.filter((u) => standOf(u.state) === "sold").length,
    burned: units.filter((u) => standOf(u.state) === "burned").length,
    low: prices.length ? prices.reduce((a, b) => (b < a ? b : a)) : undefined,
    high: prices.length ? prices.reduce((a, b) => (b > a ? b : a)) : undefined,
    places,
  };
}

export default function CollectionsPage() {
  const { cage, holdings, problem } = useLedger();
  const [index, setIndex] = useState<CatalogIndex>();
  const [indexProblem, setIndexProblem] = useState<string>();
  const [category, setCategory] = useState("all");
  const [view, setView] = useState<View>("grid2");
  const [show, setShow] = useState(6);

  useEffect(() => {
    void loadIndex()
      .then(setIndex)
      .catch((e: unknown) => setIndexProblem(e instanceof Error ? e.message : String(e)));
  }, []);

  const categories = useMemo(() => [...new Set((index?.collections ?? []).map((c) => c.category))], [index]);
  const rows = useMemo(
    () => (index?.collections ?? []).filter((c) => category === "all" || c.category === category),
    [index, category],
  );
  const paged = usePaged(rows, show);

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const all = (index?.collections ?? []).map((c) => totalsOf(c, holdings));
  const sum = (pick: (t: ReturnType<typeof totalsOf>) => number) => all.reduce((n, t) => n + pick(t), 0);

  return (
    <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10 lg:px-12">
      <h1 className="text-[32px] font-bold tracking-tight text-ink">Collections</h1>
      <p className="mt-1 max-w-3xl text-sm text-mut">
        Each creator&rsquo;s line — a collection of products, sold across locations. Open one to see its
        products; open a product to see where it stands and for how much.
      </p>

      <FiguresRow>
        <PageFigure label="Collections" value={index ? String(index.collections.length) : undefined} first />
        <PageFigure label="Products" value={index ? String(sum((t) => t.products)) : undefined} />
        <PageFigure label="In stock" value={holdings && index ? String(sum((t) => t.inStore)) : undefined} />
        <PageFigure label="Sold" value={holdings && index ? String(sum((t) => t.sold)) : undefined} />
      </FiguresRow>

      <FilterRow right={<Badge tone="plain">grouped off chain · counted on chain</Badge>}>
        <Dropdown
          prefix="Category"
          value={category}
          onChange={setCategory}
          options={[{ value: "all", label: "All" }, ...categories.map((c) => ({ value: c, label: c }))]}
        />
        <span className="font-mono text-xs text-faint">
          {index ? `${rows.length} ${rows.length === 1 ? "collection" : "collections"}` : "…"}
        </span>
      </FilterRow>

      <BrowseControls cursor={paged} view={view} onView={setView} show={show} onShow={setShow} />

      {indexProblem ? (
        <p className="mt-16 text-center text-sm text-bad">{indexProblem}</p>
      ) : !index ? (
        <div className="mt-8">
          <CardSkeleton rows={4} tall />
        </div>
      ) : paged.slice.length === 0 ? (
        <p className="mt-16 text-center text-sm text-faint">
          Nothing on this shelf yet — a line appears here when the indexer groups one.
        </p>
      ) : (
        <ul className={`mt-8 grid grid-cols-1 gap-6 ${view === "grid2" ? "xl:grid-cols-2" : GRID_OF[view]}`}>
          {paged.slice.map((c) => (
            <CollectionCard key={c.id} c={c} view={view} holdings={holdings} />
          ))}
        </ul>
      )}

      <p className="mt-10 px-1 text-xs leading-relaxed text-faint">
        A collection groups a creator&rsquo;s items and names them. The chain holds no such thing and never
        will — it holds each unit&rsquo;s price, its state, and the root that proves it genuine. Open any
        product to see where it stands, or take the whole{" "}
        <Link href="/shelf" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
          shelf
        </Link>{" "}
        at once.
      </p>
    </main>
  );
}

/* ---- The card: cover left, the line's story and its chain-read standing right ---------------------- */

function CollectionCard({ c, view, holdings }: { c: IndexedCollection; view: View; holdings?: Holdings }) {
  const t = totalsOf(c, holdings);
  const compact = view === "grid3";

  return (
    <li>
      <Link
        href={`/collections/${c.id}`}
        className={`card group flex gap-5 overflow-hidden p-2.5 transition-transform duration-300 hover:-translate-y-1 ${
          compact ? "h-[210px]" : "h-[248px]"
        }`}
      >
        <ProductTile name={c.name} className={`h-full shrink-0 rounded-[8px] ${compact ? "w-[36%]" : "w-[42%]"}`} />

        <div className={`flex min-w-0 flex-1 flex-col justify-between py-3 pr-3 ${compact ? "py-2" : ""}`}>
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h2
                className={`truncate font-bold leading-tight text-ink group-hover:underline ${
                  compact ? "text-[15px]" : "text-[17px]"
                }`}
              >
                {c.name}
              </h2>
              <span className="shrink-0 text-sm font-bold tabular-nums text-ink">{t.products} items</span>
            </div>
            <p className="mt-1 text-xs font-medium text-mut">by {c.creatorName}</p>
            <p className={`mt-3 text-xs leading-relaxed text-mut ${compact ? "line-clamp-2" : "line-clamp-4"}`}>{c.blurb}</p>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-faint">Available at</span>
              <span className="text-[11px] font-medium text-mut">
                {t.places.length} {t.places.length === 1 ? "location" : "locations"}
              </span>
            </div>
            <div className={`flex items-center ${compact ? "gap-6" : "gap-10"}`}>
              <Figure label="In stock" value={t.inStore} />
              <Figure label="Sold" value={t.sold} />
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className="text-sm font-bold tabular-nums text-ink">{value.toLocaleString("en-NG")}</div>
    </div>
  );
}
