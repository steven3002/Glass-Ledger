"use client";

/**
 * The browse standard — the arrangement every list page shares.
 *
 * A page's own cards stay its own; what repeats is the body around them: the headline figures in one
 * line with a hairline between neighbours, a filter row ruled off from what follows, and under the
 * rule the cursor in the middle with the grid format and page size on the right. One shape, learned
 * once, recognised everywhere.
 */

import type { ReactNode } from "react";

import { Dropdown } from "./dropdown";
import { Skeleton } from "./ui";

export type View = "grid2" | "grid3" | "list";

/** The grid classes a view resolves to — cards decide their insides, this decides their columns. */
export const GRID_OF: Record<View, string> = {
  grid2: "lg:grid-cols-2",
  grid3: "sm:grid-cols-2 xl:grid-cols-3",
  list: "grid-cols-1",
};

/**
 * The figures line: values side by side, a hairline between neighbours, nothing above or below.
 *
 * One size, everywhere. It began wide and page-spanning, but a detail page has to seat this strip
 * inside an identity column next to a card — a till, an account, a picture — so it was tightened to
 * fit there and the browse pages took the same measure rather than keep a second, looser one. The
 * strip wraps within whatever column holds it and never grows that column.
 *
 * `className` carries the top margin because the two contexts sit differently: a browse page hangs it
 * off the page sub, a detail page tucks it under a paragraph.
 */
export function FiguresRow({ children, className = "mt-8" }: { children: ReactNode; className?: string }) {
  return (
    /*
     * A grid on a phone, the divided line everywhere else.
     *
     * `divide-x` draws a rule before every child but the first, which is exactly right on one line and
     * wrong the moment the line wraps: the rule that should have started row two is still hanging off
     * the end of row one, and row two sits indented against row one's flush-left first figure. A grid
     * has real rows, so at phone width the figures pair up in columns and the rules simply go — the
     * alignment does the separating that the hairlines did.
     */
    <dl className={`grid grid-cols-2 gap-x-4 gap-y-5 sm:flex sm:flex-wrap sm:gap-y-4 sm:divide-x sm:divide-line ${className}`}>
      {children}
    </dl>
  );
}

export function PageFigure({
  label,
  value,
  tone = "plain",
  first = false,
  title,
}: {
  label: string;
  value?: string;
  tone?: "plain" | "good" | "alarm";
  first?: boolean;
  /** The figure in full, when the one shown is abbreviated. */
  title?: string;
}) {
  return (
    <div className={`min-w-0 max-sm:px-0 px-5 ${first ? "pl-0" : ""}`}>
      <dt className="text-[0.6rem] font-medium uppercase tracking-[0.12em] text-faint">{label}</dt>
      {value !== undefined ? (
        /* `break-words` rather than `truncate`: a figure cut off with an ellipsis is a number the
           reader cannot use, and a wrong number read confidently is worse than a wrapped one. */
        <dd
          title={title}
          className={`mt-1 text-lg font-bold break-words tabular-nums ${
            tone === "good" ? "text-good" : tone === "alarm" ? "text-bad" : "text-ink"
          }`}
        >
          {value}
        </dd>
      ) : (
        <dd className="mt-1.5">
          <Skeleton className="h-5 w-14" />
        </dd>
      )}
    </div>
  );
}

/** The filter row, ruled off from the browse below it. */
export function FilterRow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-14 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
      <div className="flex flex-wrap items-center gap-3">{children}</div>
      {right}
    </div>
  );
}

/** Under the rule: the cursor centred, the grid format and page size on the right. */
export function BrowseControls({
  cursor,
  view,
  onView,
  show,
  onShow,
  sizes = [6, 12, 24],
}: {
  cursor: { page: number; pages: number; first: () => void; prev: () => void; next: () => void };
  view: View;
  onView: (view: View) => void;
  show: number;
  onShow: (show: number) => void;
  sizes?: number[];
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-4">
      <div className="flex-1" />

      <div className="flex flex-1 items-center justify-center gap-1">
        <CursorButton disabled={cursor.page === 0} onClick={cursor.first} label="First page">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
        </CursorButton>
        <CursorButton disabled={cursor.page === 0} onClick={cursor.prev} label="Previous page">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
        </CursorButton>
        <CursorButton disabled={cursor.page >= cursor.pages - 1} onClick={cursor.next} label="Next page">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
        </CursorButton>
      </div>

      <div className="flex flex-1 items-center justify-end gap-3">
        <div className="flex items-center rounded-lg border border-line bg-raised p-0.5">
          <ViewButton active={view === "grid2"} onClick={() => onView("grid2")} label="Large grid">
            <path d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z" />
          </ViewButton>
          <ViewButton active={view === "grid3"} onClick={() => onView("grid3")} label="Compact grid">
            <path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z" />
          </ViewButton>
          <ViewButton active={view === "list"} onClick={() => onView("list")} label="List">
            <path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z" />
          </ViewButton>
        </div>

        <Dropdown prefix="Show" value={show} onChange={onShow} align="right" options={sizes.map((n) => ({ value: n, label: String(n) }))} />
      </div>
    </div>
  );
}

function CursorButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`p-1 transition-colors ${disabled ? "cursor-not-allowed text-line-strong" : "text-mut hover:text-ink"}`}
    >
      <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

function ViewButton({
  children,
  active,
  onClick,
  label,
}: {
  children: ReactNode;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`p-1.5 transition-colors ${active ? "rounded-md bg-surface text-ink shadow-sm" : "text-faint hover:text-ink-2"}`}
    >
      <svg className="size-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
        {children}
      </svg>
    </button>
  );
}
