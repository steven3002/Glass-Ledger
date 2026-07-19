"use client";

/**
 * The table standard — the reference's card: the count on the left, numbered pages in the middle, the
 * page size on the right, and a real table under them. Rows hover, never scroll; a public ledger is
 * walked a page at a time, and the numbers say exactly where you stand in it.
 */

import { useState, type ReactNode } from "react";

import { DotsIcon } from "./icons";
import { Dropdown } from "./dropdown";

type Cursor = { page: number; pages: number; goto: (p: number) => void; next: () => void };

export function TableCard({
  found,
  sub,
  cursor,
  show,
  onShow,
  sizes = [10, 20, 50],
  head,
  children,
}: {
  /** "169,554 found" — the card's own headline. */
  found: string;
  sub?: string;
  cursor: Cursor;
  show: number;
  onShow: (n: number) => void;
  sizes?: number[];
  /** The header cells, as <Th>s. */
  head: ReactNode;
  /** The body rows, as <Tr>s. */
  children: ReactNode;
}) {
  return (
    <section className="card mt-8 p-4 sm:p-6">
      <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-ink">{found}</span>
          {sub && <span className="mt-0.5 text-[13px] text-faint">{sub}</span>}
        </div>

        <NumberedPager cursor={cursor} />

        <div className="flex items-center gap-3 text-sm text-mut">
          <span>Show</span>
          <Dropdown value={show} onChange={onShow} align="right" options={sizes.map((n) => ({ value: n, label: String(n) }))} />
        </div>
      </div>

      <Table head={head}>{children}</Table>
    </section>
  );
}

/** The same table without the toolbar — for pages that already carry their own browse controls. */
export function TableShell({ head, children, className = "mt-8" }: { head: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 sm:p-6 ${className}`}>
      <Table head={head}>{children}</Table>
    </section>
  );
}

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="gl-table w-full border-collapse whitespace-nowrap text-left">
        <thead>
          <tr className="border-b border-line text-[13px] font-semibold text-ink-2">{head}</tr>
        </thead>
        <tbody className="text-sm">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <th className={`px-2 pb-4 font-semibold ${className}`}>{children}</th>;
}

export function Td({
  children,
  className = "",
  title,
  label,
  secondary = false,
  omit = false,
  headline = false,
}: {
  children?: ReactNode;
  className?: string;
  /** The long form of a terse cell — the sentence behind a word like "unchallenged". */
  title?: string;
  /**
   * What this column is called. On a phone the header row is gone, so each cell has to name itself;
   * without a label a stacked cell is a value with nothing saying what it measures.
   */
  label?: string;
  /**
   * Fold this cell away on a phone, behind the row's "know more".
   *
   * The test is not "is this interesting" but "would a reader scanning the list stop on it" — the
   * money, the party and the state earn their place; the rail, the age and the reference are what you
   * open a row to find out. Which cells fold is stated here and acted on by the stacked layout in
   * globals.css, keyed off the row's own open state — so the fold is one rule, not a prop threaded
   * through every cell on the page.
   */
  secondary?: boolean;
  /**
   * Drop this cell on a phone rather than fold it.
   *
   * For cells that carry no fact of their own — an icon that decorates the row it sits in. Stacked,
   * such a cell would become a labelled line of its own saying nothing. `secondary` is for facts a
   * reader might want; this is for things that were never facts.
   */
  omit?: boolean;
  /**
   * The cell the row is *about* — the party, the item, the place.
   *
   * On a phone it is the one that gives up room: it is always the widest, and at its natural width it
   * pushes the kebab onto a line of its own. Stated rather than inferred from "the cell with no
   * label", because on a phone every column wants a label, including this one.
   */
  headline?: boolean;
}) {
  return (
    <td
      className={`gl-td px-2 py-4 align-middle ${className}`}
      title={title}
      data-label={label}
      data-more={secondary ? "" : undefined}
      data-omit={omit ? "" : undefined}
      data-headline={headline ? "" : undefined}
    >
      {children}
    </td>
  );
}

/**
 * A row, and on a phone the card it becomes.
 *
 * `more` says the row has cells worth folding: it gets a toggle of its own, and the stacked layout
 * hides its `secondary` cells until that toggle is pressed. A row with nothing folded never grows a
 * control that would open nothing.
 */
export function Tr({ children, more = false }: { children: ReactNode; more?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <tr
      className="gl-tr transition-colors hover:bg-sunken/50"
      data-more={more ? "" : undefined}
      data-open={more && open ? "" : undefined}
    >
      {children}
      {more && (
        /* The phone's control only — a wider screen folds nothing, so the cell collapses to nothing. */
        <td className="gl-td-toggle">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Hide the rest of this row" : "Show the rest of this row"}
            className={`grid size-8 place-items-center rounded-lg transition-colors ${
              open ? "bg-sunken text-ink" : "text-faint hover:bg-sunken hover:text-ink"
            }`}
          >
            <DotsIcon className="size-4" />
          </button>
        </td>
      )}
    </tr>
  );
}

/** 1 2 3 … N →, the current page held. Collapses honestly when there is only one page. */
function NumberedPager({ cursor }: { cursor: Cursor }) {
  const { page, pages } = cursor;
  if (pages <= 1) return <div aria-hidden className="hidden lg:block" />;

  return (
    <div className="flex items-center gap-1">
      {numbers(page, pages).map((n, i) =>
        n === -1 ? (
          <span key={`gap-${i}`} className="grid size-8 place-items-center text-sm text-faint">
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            onClick={() => cursor.goto(n)}
            aria-current={n === page ? "page" : undefined}
            className={`grid size-8 place-items-center rounded-md text-sm font-medium transition-colors ${
              n === page ? "bg-sunken text-ink" : "text-mut hover:bg-raised hover:text-ink"
            }`}
          >
            {n + 1}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={cursor.next}
        disabled={page >= pages - 1}
        aria-label="Next page"
        className="grid size-8 place-items-center rounded-md text-mut transition-colors enabled:hover:bg-raised enabled:hover:text-ink disabled:cursor-not-allowed disabled:text-line-strong"
      >
        <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}

/** Which page numbers to print; -1 is an ellipsis. */
function numbers(page: number, pages: number): number[] {
  const all = Array.from({ length: pages }, (_, i) => i);
  if (pages <= 7) return all;
  if (page < 4) return [...all.slice(0, 5), -1, pages - 1];
  if (page > pages - 5) return [0, -1, ...all.slice(pages - 5)];
  return [0, -1, page - 1, page, page + 1, -1, pages - 1];
}
