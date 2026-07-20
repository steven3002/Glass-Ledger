"use client";

/**
 * The creators: the only identity the protocol registers.
 *
 * An explorer's browse page. The title leads, the headline figures run as plain text — no rules, no
 * boxes — and one toolbar carries the whole browse: a shelf (category) dropdown, the cursor, the grid
 * controls. Each creator card is the marketplace fusion of banner and profile: her line as the banner,
 * her avatar ringed and overlapping its lower edge, her name in the body beneath it.
 *
 * The money and the till are the chain's; the names, banners and shelves are the demo catalog's — the
 * indexer stand-in — until s12's signed metadata replaces it.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { BrowseControls, FiguresRow, FilterRow, GRID_OF, PageFigure, type View } from "@/components/browse";
import { Dropdown } from "@/components/dropdown";
import { ChainError, useLedger } from "@/components/ledger-view";
import { usePaged } from "@/components/paged";
import { Avatar, ProductTile } from "@/components/product";
import { TableShell, Td, Th, Tr } from "@/components/table";
import { Skeleton } from "@/components/ui";
import { naira, shortAddress, nairaShort } from "@/lib/format";
import type { Cage, Holdings } from "@/lib/ledger";
import { useCatalog } from "@/components/catalog";
import { categoriesIn, categoriesOf, creatorNameOf, linesOf, type CatalogIndex } from "@/lib/index";
import { purseOf, type Purse } from "@/lib/ledger/profiles";

export default function CreatorsPage() {
  const { cage, holdings, problem } = useLedger();
  const [category, setCategory] = useState("all");
  const [view, setView] = useState<View>("grid3");
  const [show, setShow] = useState(6);
  const { index } = useCatalog();

  const rows = useMemo(() => {
    const all = cage?.capacity ?? [];
    if (category === "all") return all;
    return all.filter((row) => categoriesOf(index, row.creatorId).includes(category));
  }, [cage, category, index]);

  const paged = usePaged(rows, show);

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const totalVolume = (holdings?.debts ?? []).filter((d) => d.role !== "buyer").reduce((s, d) => s + d.amount, 0n);
  const lineCount = cage && index ? new Set(cage.capacity.flatMap((c) => linesOf(index, c.creatorId).map((x) => x.id))).size : undefined;

  return (
    <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10 lg:px-12">
      <h1 className="text-[32px] font-bold tracking-tight text-ink">Creators</h1>
      <p className="mt-1 max-w-3xl text-sm text-mut">
        The registry&rsquo;s whole population: a creator is a signing key, and every voucher is checked against it — nothing
        else is ever asked.
      </p>

      <FiguresRow>
        <PageFigure label="Creators" value={cage ? String(cage.capacity.length) : undefined} first />
        <PageFigure label="Open tills" value={cage ? String(cage.capacity.filter((c) => c.headroom > 0n).length) : undefined} tone="good" />
        <PageFigure label="Volume" value={holdings ? nairaShort(totalVolume) : undefined} title={holdings ? naira(totalVolume) : undefined} />
        <PageFigure label="Collections" value={lineCount !== undefined ? String(lineCount) : undefined} />
      </FiguresRow>

      <FilterRow>
        <Dropdown
          prefix="Category"
          value={category}
          onChange={setCategory}
          options={[{ value: "all", label: "All" }, ...categoriesIn(index).map((c) => ({ value: c, label: c }))]}
        />
        <span className="font-mono text-xs text-faint">
          {cage ? `${rows.length} ${rows.length === 1 ? "creator" : "creators"}` : "…"}
        </span>
      </FilterRow>

      <BrowseControls cursor={paged} view={view} onView={setView} show={show} onShow={setShow} />

      {/* The creators. */}
      {!cage ? (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-[var(--radius-card)]" />
          ))}
        </div>
      ) : paged.slice.length === 0 ? (
        <p className="mt-16 text-center text-sm text-faint">
          No creator on this shelf yet. A creator appears here the moment her registered key has a line in it.
        </p>
      ) : view === "list" ? (
        <CreatorsTable rows={paged.slice} holdings={holdings} index={index} />
      ) : (
        <ul className={`mt-8 grid gap-5 ${GRID_OF[view]}`}>
          {paged.slice.map((row) => (
            <CreatorCard key={String(row.creatorId)} row={row} holdings={holdings} index={index} />
          ))}
        </ul>
      )}
    </main>
  );
}

/* ---- The pieces ----------------------------------------------------------------------------------- */

/** The list view: one creator per row, as a real table. */
function CreatorsTable({ rows, holdings, index }: { rows: Cage["capacity"]; holdings?: Holdings; index?: CatalogIndex }) {
  return (
    <TableShell
      head={
        <>
          <Th>Creator</Th>
          <Th secondary>Signs as</Th>
          <Th secondary className="text-right">Collections</Th>
          <Th secondary className="text-right">Sales</Th>
          <Th className="text-right">Owed now</Th>
          <Th className="text-right">Headroom</Th>
          <Th>Till</Th>
        </>
      }
    >
      {rows.map((row) => {
        const id = Number(row.creatorId);
        const name = creatorNameOf(index, id);
        const lines = linesOf(index, id);
        const purse = purseOf((holdings?.debts ?? []).filter((d) => d.role === "creator" && d.creatorId === row.creatorId));
        const shut = row.headroom === 0n;

        return (
          <Tr key={String(row.creatorId)} more>
            <Td label="Creator" headline>
              <Link href={`/creators/${id}`} className="group flex items-center gap-3">
                <Avatar name={name} className="size-9" text="text-xs" />
                <div>
                  <div className="font-medium text-ink group-hover:underline">{name}</div>
                  <div className="font-mono text-[0.66rem] text-faint">#{id}</div>
                </div>
              </Link>
            </Td>
            <Td label="Signs as" secondary className="font-mono text-xs text-mut">
              {shortAddress(row.key)}
            </Td>
            <Td label="Collections" secondary className="text-right tabular-nums text-ink-2">
              {lines.length}
            </Td>
            <Td label="Sales" secondary className="text-right tabular-nums text-ink-2">
              {holdings ? purse.mintedCount : "—"}
            </Td>
            <Td label="Owed now" className="text-right tabular-nums text-ink-2">
              {holdings ? naira(purse.owedNow) : "—"}
            </Td>
            <Td label="Headroom" className={`text-right font-semibold tabular-nums ${shut ? "text-bad" : "text-good"}`}>
              {naira(row.headroom)}
            </Td>
            <Td label="Till">
              <TillTag shut={shut} />
            </Td>
          </Tr>
        );
      })}
    </TableShell>
  );
}

/**
 * One creator — the marketplace fusion of banner and profile: the line as the banner, the avatar
 * ringed in surface-white and riding the banner's lower edge, the name beneath it in the body.
 */
function CreatorCard({ row, holdings, index }: { row: Cage["capacity"][number]; holdings?: Holdings; index?: CatalogIndex }) {
  const id = Number(row.creatorId);
  const name = creatorNameOf(index, id);
  const lines = linesOf(index, id);
  const banner = lines[0]?.name ?? name;
  const purse = purseOf((holdings?.debts ?? []).filter((d) => d.role === "creator" && d.creatorId === row.creatorId));
  const shut = row.headroom === 0n;

  return (
    <li>
      <Link href={`/creators/${id}`} className="card group block overflow-hidden p-0 transition-shadow hover:shadow-md">
        {/* Banner, and the avatar riding its lower edge. */}
        <div className="relative">
          <ProductTile name={banner} className="aspect-[16/6] w-full transition-transform duration-500 group-hover:scale-[1.02]" />
          <span className="absolute -bottom-6 left-4 inline-block rounded-2xl shadow-md ring-4 ring-surface">
            <Avatar name={name} className="size-14" text="text-base" />
          </span>
        </div>

        <div className="px-4 pb-4 pt-8">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-bold leading-tight text-ink group-hover:underline">{name}</div>
              <div className="mt-0.5 font-mono text-[0.66rem] text-faint">
                signs as {shortAddress(row.key)} · #{id} · {lines.length} {lines.length === 1 ? "collection" : "collections"}
              </div>
            </div>
            <TillTag shut={shut} />
          </div>

          <div className="mt-4 border-t border-line pt-3">
            <CardFigures purse={purse} headroom={naira(row.headroom)} shut={shut} loaded={!!holdings} />
          </div>
        </div>
      </Link>
    </li>
  );
}

/** The till's state, said in a plain rectangle — no rounded pill. */
function TillTag({ shut }: { shut: boolean }) {
  return (
    <span
      className={`inline-block shrink-0 border px-2 py-0.5 text-[11px] font-semibold ${
        shut
          ? "border-[color-mix(in_oklab,var(--color-bad-fill)_45%,white)] bg-[color-mix(in_oklab,var(--color-bad-fill)_8%,white)] text-bad"
          : "border-[color-mix(in_oklab,var(--color-good-fill)_45%,white)] bg-[color-mix(in_oklab,var(--color-good-fill)_8%,white)] text-good"
      }`}
    >
      {shut ? "till shut" : "till open"}
    </span>
  );
}

function CardFigures({ purse, headroom, shut, loaded }: { purse: Purse; headroom: string; shut: boolean; loaded: boolean }) {
  return (
    <div className="flex divide-x divide-line">
      <CardFigure label="sales" value={loaded ? String(purse.mintedCount) : undefined} first />
      <CardFigure label="owed now" value={loaded ? naira(purse.owedNow) : undefined} />
      <CardFigure label="headroom" value={headroom} tone={shut ? "alarm" : "good"} />
    </div>
  );
}

function CardFigure({ label, value, tone = "plain", first = false }: { label: string; value?: string; tone?: "plain" | "good" | "alarm"; first?: boolean }) {
  return (
    <div className={`px-5 ${first ? "pl-0" : ""}`}>
      <div className="text-[0.6rem] font-medium uppercase tracking-wider text-faint">{label}</div>
      {value !== undefined ? (
        <div className={`mt-0.5 text-sm font-bold tabular-nums ${tone === "good" ? "text-good" : tone === "alarm" ? "text-bad" : "text-ink-2"}`}>
          {value}
        </div>
      ) : (
        <Skeleton className="mt-1 h-4 w-12" />
      )}
    </div>
  );
}
