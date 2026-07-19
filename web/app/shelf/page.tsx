"use client";

/**
 * The shelf, as a table: every item in the consignment, and where it stands — proven by the chain,
 * not asserted by the shop. The browse theme's table card: a count, numbered pages, the rows.
 */

import Link from "next/link";
import { useState } from "react";

import { FiguresRow, FilterRow, PageFigure } from "@/components/browse";
import { Dropdown } from "@/components/dropdown";
import { CardSkeleton, ChainError, itemTone, shelfWord, useLedger } from "@/components/ledger-view";
import { usePaged } from "@/components/paged";
import { TableCard, Td, Th, Tr } from "@/components/table";
import { Badge } from "@/components/ui";
import { naira, shortAddress } from "@/lib/format";

/** The shelf's own buckets — the words the census uses, so a figure and a filter always agree. */
type Stand = "inStore" | "sold" | "burned";
const STANDS: { value: Stand; label: string }[] = [
  { value: "inStore", label: "In store" },
  { value: "sold", label: "Sold" },
  { value: "burned", label: "Written off" },
];
const standOf = (state: string): Stand =>
  state === "SOLD" || state === "OWNED" ? "sold" : state === "BURNED" ? "burned" : "inStore";

export default function ShelfPage() {
  const { cage, holdings, problem } = useLedger();
  const [stand, setStand] = useState<Stand | "all">("all");
  const [show, setShow] = useState(10);

  const items = holdings?.items ?? [];
  const rows = stand === "all" ? items : items.filter((i) => standOf(i.state) === stand);
  const paged = usePaged(rows, show);

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const sold = items.filter((i) => standOf(i.state) === "sold").length;
  const inStore = items.filter((i) => standOf(i.state) === "inStore").length;
  const burned = items.filter((i) => standOf(i.state) === "burned").length;

  return (
    <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10 lg:px-12">
      <h1 className="text-[32px] font-bold tracking-tight text-ink">The shelf</h1>
      <p className="mt-1 max-w-3xl text-sm text-mut">
        Every item in the consignment, and where it stands — proven by the chain, not asserted by the shop.
      </p>

      <FiguresRow>
        <PageFigure label="Items" value={holdings ? String(items.length) : undefined} first />
        <PageFigure label="In store" value={holdings ? String(inStore) : undefined} tone="good" />
        <PageFigure label="Sold" value={holdings ? String(sold) : undefined} />
        <PageFigure label="Written off" value={holdings ? String(burned) : undefined} tone={burned > 0 ? "alarm" : "plain"} />
      </FiguresRow>

      <FilterRow>
        <Dropdown
          prefix="Standing"
          value={stand}
          onChange={setStand}
          options={[{ value: "all" as const, label: "All" }, ...STANDS]}
        />
        <span className="font-mono text-xs text-faint">
          {holdings ? `${rows.length} ${rows.length === 1 ? "item" : "items"}` : "\u2026"}
        </span>
      </FilterRow>

      {!holdings ? (
        <div className="mt-8">
          <CardSkeleton rows={10} title />
        </div>
      ) : (
        <TableCard
          found={`${rows.length} ${rows.length === 1 ? "item" : "items"} found`}
          sub={stand === "all" ? "the whole consignment, one row per unit" : STANDS.find((s) => s.value === stand)?.label.toLowerCase()}
          cursor={paged}
          show={show}
          onShow={setShow}
          head={
            <>
              <Th>Item</Th>
              <Th secondary>Id</Th>
              <Th className="text-right">Price</Th>
              <Th secondary>Held by</Th>
              <Th>Status</Th>
            </>
          }
        >
          {paged.slice.map((item) => (
            <Tr key={String(item.id)} more>
              <Td label="Item" headline>
                <Link href={`/item/${String(item.id)}`} className="font-medium text-ink transition-colors hover:underline">
                  {item.name}
                </Link>
              </Td>
              <Td label="Id" secondary className="font-mono text-xs text-faint">
                {String(item.id)}
              </Td>
              <Td label="Price" className="text-right font-semibold tabular-nums text-ink">
                {naira(item.price)}
              </Td>
              <Td label="Held by" secondary className="font-mono text-xs text-mut">
                {item.owner === "0x0000000000000000000000000000000000000000" ? (
                  <span className="text-faint">—</span>
                ) : (
                  <Link href={`/who/${item.owner}`} className="transition-colors hover:text-ink">
                    {shortAddress(item.owner)}
                  </Link>
                )}
              </Td>
              <Td label="Status">
                <Badge tone={itemTone(item.state)} dot>
                  {shelfWord(item.state)}
                </Badge>
              </Td>
            </Tr>
          ))}
        </TableCard>
      )}
    </main>
  );
}
