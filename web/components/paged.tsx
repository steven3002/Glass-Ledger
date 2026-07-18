"use client";

/**
 * Cursoring for lists.
 *
 * A public ledger grows without bound, and a page that answers by growing without bound — an infinite
 * scroll — is a page you cannot get to the bottom of. So every long list is cut into pages and walked
 * with a cursor: a fixed window, a count, and a way forward and back. You always know where you are and
 * that there is an end.
 */

import { useState } from "react";

export function usePaged<T>(items: T[], size = 10) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const clamped = Math.min(page, pages - 1);
  const start = clamped * size;
  return {
    slice: items.slice(start, start + size),
    page: clamped,
    pages,
    start,
    size,
    total: items.length,
    next: () => setPage((p) => Math.min(pages - 1, p + 1)),
    prev: () => setPage((p) => Math.max(0, p - 1)),
  };
}

/** The cursor's controls: where you are, and the two steps. Hidden when a single page holds it all. */
export function Pager({
  page,
  pages,
  start,
  size,
  total,
  onPrev,
  onNext,
  noun = "rows",
}: {
  page: number;
  pages: number;
  start: number;
  size: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  noun?: string;
}) {
  if (total <= size) return null;
  const from = start + 1;
  const to = Math.min(start + size, total);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-xs text-mut">
      <span className="tabular-nums">
        {from}–{to} of {total} {noun}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onPrev}
          disabled={page === 0}
          className="rounded-lg border border-line-strong px-2.5 py-1 font-medium text-mut transition-colors enabled:hover:bg-raised enabled:hover:text-ink disabled:opacity-40"
        >
          ← Prev
        </button>
        <span className="px-1 tabular-nums text-faint">
          {page + 1} / {pages}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={page >= pages - 1}
          className="rounded-lg border border-line-strong px-2.5 py-1 font-medium text-mut transition-colors enabled:hover:bg-raised enabled:hover:text-ink disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
