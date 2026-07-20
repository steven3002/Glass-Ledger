"use client";

/**
 * The (i) that holds an explanation until somebody wants it.
 *
 * These pages explain themselves constantly, and they have to: a ledger nobody can read is not
 * public. But an explanation printed in full beside every panel competes with the thing it is
 * explaining — a reader who already knows what the pool is has to scroll past two sentences saying so
 * to reach the line showing it. So the prose moves behind a dot and the data gets the room.
 *
 * Click rather than hover, because hover does not exist on a phone and an explanation only the
 * desktop can reach is not an explanation. Escape closes it, a click outside closes it, and the
 * button says what it is to a screen reader rather than announcing itself as the letter "i".
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export function Info({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  /**
   * Which side it opens on, decided when it opens rather than declared by the caller.
   *
   * The same component sits beside a panel title on the far left of a page and inside a card pinned
   * to the right edge, and a popover anchored left runs off the screen in the second case. Asking
   * every call site to know where it sits on the page is asking each of them to be wrong eventually;
   * measuring at open time is right wherever it lands, including after a resize.
   */
  const [flip, setFlip] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div ref={box} className="relative inline-flex shrink-0 align-middle">
      <button
        type="button"
        onClick={() => {
          const anchor = box.current?.getBoundingClientRect();
          if (anchor) {
            const width = Math.min(352, window.innerWidth * 0.7);
            setFlip(anchor.left + width > window.innerWidth - 12);
          }
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label={open ? `Hide: what ${label} means` : `What ${label} means`}
        /* Its own typography, not the heading's. Sitting inside a `uppercase tracking-[0.14em]
           font-semibold` title, an inherited "i" renders as a bold, letter-spaced capital I — which
           reads as a stray initial rather than the universal info dot. */
        className={`grid size-[18px] shrink-0 place-items-center rounded-full border font-sans text-[11px] leading-none font-normal normal-case tracking-normal italic transition-colors ${
          open
            ? "border-line-strong bg-sunken text-ink"
            : "border-line text-faint hover:border-line-strong hover:text-ink"
        }`}
      >
        i
      </button>

      {open && (
        <div
          role="note"
          /* `normal-case font-normal tracking-normal` is load bearing, not defensive tidying. This
             popover is rendered inside the panel's own <h2>, which is `uppercase font-semibold
             tracking-[0.14em]` — so without resetting them the explanation comes out as a wall of
             bold, letter-spaced capitals. A heading's typography is for three words, never for two
             paragraphs of prose. */
          className={`absolute top-6 z-30 w-[min(22rem,70vw)] ${flip ? "right-0" : "left-0"} rounded-xl border border-line bg-surface p-3.5 text-[0.78rem] font-normal normal-case leading-relaxed tracking-normal text-mut shadow-xl`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
