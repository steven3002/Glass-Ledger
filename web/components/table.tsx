"use client";

/**
 * The table standard — the reference's card: the count on the left, numbered pages in the middle, the
 * page size on the right, and a real table under them. Rows hover, never scroll; a public ledger is
 * walked a page at a time, and the numbers say exactly where you stand in it.
 */

import { useRouter } from "next/navigation";
import { Children, isValidElement, useState, type ReactElement, type ReactNode } from "react";

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

/**
 * A column heading.
 *
 * `secondary` and `omit` must match the `Td`s underneath: a phone drops whole COLUMNS, header and
 * body together, so the two have to agree about which ones. They are stated twice — once here, once
 * on the cell — which is the price of a `<table>` keeping its head and body in separate elements.
 */
export function Th({
  children,
  className = "",
  secondary = false,
  omit = false,
}: {
  children?: ReactNode;
  className?: string;
  secondary?: boolean;
  omit?: boolean;
}) {
  return (
    <th
      className={`gl-th px-2 pb-4 font-semibold ${className}`}
      data-more={secondary ? "" : undefined}
      data-omit={omit ? "" : undefined}
    >
      {children}
    </th>
  );
}

type TdProps = {
  children?: ReactNode;
  className?: string;
  title?: string;
  label?: string;
  secondary?: boolean;
  omit?: boolean;
  headline?: boolean;
};

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
   * What this column is called. Not printed beside the value — the header row prints it, once, the
   * way a table always has. It is used for the folded fields under an opened row, where there is no
   * column above them to do the naming.
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
   * On a phone its column takes the slack and wraps, so the values beside it (a sum, a status) keep
   * their one line and the table still fits the screen. Exactly one per row.
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
 * A row — and, on a phone, the shorter row plus the drawer underneath it.
 *
 * `more` says the row has cells worth folding. On a phone the table stays a table: it simply shows
 * fewer COLUMNS, so one header row still names them all and the values still line up down the page.
 * The folded fields cannot live in that row — a cell more than the header has would break the very
 * alignment we are protecting — so they go in a second row spanning the full width, which is what a
 * table has always done with detail.
 */
export function Tr({ children, more = false, href }: { children: ReactNode; more?: boolean; href?: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const cells = Children.toArray(children).filter(isValidElement) as ReactElement<TdProps>[];
  const folded = cells.filter((c) => c.props.secondary);
  // What the detail row has to span: the columns a phone still shows, plus the kebab's own.
  const across = cells.filter((c) => !c.props.secondary && !c.props.omit).length + (more ? 1 : 0);

  return (
    <>
      <tr
        className={`gl-tr transition-colors hover:bg-sunken/50 ${href ? "cursor-pointer" : ""}`}
        data-more={more ? "" : undefined}
        data-open={more && open ? "" : undefined}
        /* The whole row is the door, not just the word in the first cell.
         *
         * A table row cannot be an anchor — HTML will not nest one inside <tr> — so the row
         * navigates programmatically, and the cell that names the row keeps a real <a> so the
         * keyboard and a screen reader still meet a link rather than a mystery. Clicks that landed
         * on something else interactive (the other links in the row, the kebab) are left alone:
         * `closest` finds them and this handler stands down, which is the difference between a
         * helpful row and a row that eats every click in it. */
        onClick={
          href
            ? (e) => {
                if ((e.target as HTMLElement).closest("a, button")) return;
                router.push(href);
              }
            : undefined
        }
      >
        {children}
        {more && (
          /* The phone's control only — a wider screen folds nothing, so the cell collapses to nothing. */
          <td className="gl-td-toggle">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen((v) => !v);
              }}
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

      {more && open && folded.length > 0 && (
        <tr className="gl-detail">
          <td colSpan={across} className="px-2 pb-4">
            <dl className="grid gap-x-5 gap-y-1.5 rounded-lg bg-sunken/60 px-3 py-2.5 text-[13px]">
              {folded.map((cell, i) => (
                <div key={i} className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-faint">{cell.props.label}</dt>
                  <dd className="min-w-0 text-right whitespace-normal">{cell.props.children}</dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      )}
    </>
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
