"use client";

/**
 * Collections — the shop's lines, one card each.
 *
 * A collection is a creator's line, the way a house of perfume has a line: it holds items (its unique
 * products), and each item is sold in one or more places at one or more prices. This page lists the
 * lines in the browse standard — figures on one line, the shelf filter ruled off, cursor and format
 * under the rule — and keeps the card it already owned: the line's cover on the left, its story and
 * stock on the right. Demo catalog data — the indexer's stand-in, not the chain.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import { BrowseControls, FiguresRow, FilterRow, GRID_OF, PageFigure, type View } from "@/components/browse";
import { Dropdown } from "@/components/dropdown";
import { usePaged } from "@/components/paged";
import { ProductTile } from "@/components/product";
import { Badge } from "@/components/ui";
import { CATEGORIES, collections, collectionTotals, type Collection } from "@/lib/demo/catalog";

export default function CollectionsPage() {
  const [category, setCategory] = useState("all");
  const [view, setView] = useState<View>("grid2");
  const [show, setShow] = useState(6);

  const rows = useMemo(() => {
    const all = collections();
    if (category === "all") return all;
    return all.filter((c) => c.category === category);
  }, [category]);

  const paged = usePaged(rows, show);

  const totals = useMemo(() => {
    const all = collections().map(collectionTotals);
    return {
      collections: collections().length,
      items: all.reduce((n, t) => n + t.items, 0),
      stock: all.reduce((n, t) => n + t.stock, 0),
      sold: all.reduce((n, t) => n + t.sold, 0),
    };
  }, []);

  return (
    <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10 lg:px-12">
      <h1 className="text-[32px] font-bold tracking-tight text-ink">Collections</h1>
      <p className="mt-1 max-w-3xl text-sm text-mut">
        Each creator&rsquo;s line — a collection of items, sold across locations. Open one to see its items; open an item to
        see where it stands and for how much.
      </p>

      <FiguresRow>
        <PageFigure label="Collections" value={String(totals.collections)} first />
        <PageFigure label="Items" value={String(totals.items)} />
        <PageFigure label="In stock" value={totals.stock.toLocaleString("en-NG")} />
        <PageFigure label="Sold" value={totals.sold.toLocaleString("en-NG")} />
      </FiguresRow>

      <FilterRow right={<Badge tone="quiet">demo catalog</Badge>}>
        <Dropdown
          prefix="Category"
          value={category}
          onChange={setCategory}
          options={[{ value: "all", label: "All" }, ...CATEGORIES.map((c) => ({ value: c, label: c }))]}
        />
        <span className="font-mono text-xs text-faint">
          {rows.length} {rows.length === 1 ? "collection" : "collections"}
        </span>
      </FilterRow>

      <BrowseControls cursor={paged} view={view} onView={setView} show={show} onShow={setShow} />

      {paged.slice.length === 0 ? (
        <p className="mt-16 text-center text-sm text-faint">Nothing on this shelf yet — a line appears here when a creator publishes one.</p>
      ) : (
        <ul className={`mt-8 grid grid-cols-1 gap-6 ${view === "grid2" ? "xl:grid-cols-2" : GRID_OF[view]}`}>
          {paged.slice.map((c) => (
            <CollectionCard key={c.id} c={c} view={view} />
          ))}
        </ul>
      )}

      <p className="mt-10 px-1 text-xs leading-relaxed text-faint">
        A collection groups a creator&rsquo;s items in signed metadata — it spans locations, and the chain holds each
        item&rsquo;s price and authenticity per unit. Stock and the activity feed are what an indexer derives; this page
        stands in for that indexer with demo data.
      </p>
    </main>
  );
}

/* ---- The card, kept: cover left, the line's story and stock right — denser when the grid is. ------- */

function CollectionCard({ c, view }: { c: Collection; view: View }) {
  const t = collectionTotals(c);
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
              <h2 className={`truncate font-bold leading-tight text-ink group-hover:underline ${compact ? "text-[15px]" : "text-[17px]"}`}>
                {c.name}
              </h2>
              <span className="shrink-0 text-sm font-bold tabular-nums text-ink">{t.items} items</span>
            </div>
            <p className="mt-1 text-xs font-medium text-mut">by {c.creatorName}</p>
            <p className={`mt-3 text-xs leading-relaxed text-mut ${compact ? "line-clamp-2" : "line-clamp-4"}`}>{c.blurb}</p>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-faint">Available at</span>
              <span className="text-[11px] font-medium text-mut">
                {t.locations} {t.locations === 1 ? "location" : "locations"}
              </span>
            </div>
            <div className={`flex items-center ${compact ? "gap-6" : "gap-10"}`}>
              <Figure label="In stock" value={t.stock} />
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
