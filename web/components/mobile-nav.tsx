"use client";

/**
 * The map, on a phone.
 *
 * Below `lg` the rail is not on screen, and for a while nothing stood in for it — every page but the
 * overview was unreachable by tapping. This is the door: a button in the header, and the same map the
 * rail draws, in a sheet over the page.
 *
 * The tree is always open here. The rail folds it because a permanent column has to budget its height
 * against everything below it; a sheet is summoned, read, and dismissed, so there is nothing below to
 * protect and a fold would only add a tap between the reader and the page they came for.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { CloseIcon, LedgerIcon, MenuIcon, SearchIcon } from "./icons";
import { GROUPS, LEDGER_TREE, isActive, onLedgerPath } from "./nav-map";

export function MobileNav({ onSearch }: { onSearch: (query: string) => void }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Arriving somewhere is the end of navigating — the sheet has done its job and gets out of the way.
  useEffect(() => setOpen(false), [pathname]);

  // Escape closes, and while the sheet is up the page behind it must not scroll under the finger.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const onLedger = onLedgerPath(pathname);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the map"
        aria-expanded={open}
        className="grid size-10 shrink-0 place-items-center rounded-lg text-mut transition-colors hover:bg-raised hover:text-ink lg:hidden"
      >
        <MenuIcon className="size-5" />
      </button>

      {/*
       * Through a portal, onto the body — not because the markup is tidier there, but because it is the
       * only place this works. The button lives in the header, and the header carries a `backdrop-blur`;
       * a backdrop-filter makes an element a containing block for fixed-position descendants, so a sheet
       * rendered in place resolves `fixed inset-0` against the header and comes out 390×64 — the
       * header's own box — instead of covering the screen.
       */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close the map"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
            />

            {/* It arrives from the right because that is where the button is. Flying in from the left
                to mirror the rail it stands in for reads as a second, unrelated thing opening —
                the panel should come from the side the thumb just touched. */}
            <nav
              aria-label="Sections"
              className="absolute inset-y-0 right-0 flex w-[280px] max-w-[85vw] flex-col overflow-y-auto border-l border-line bg-surface p-5 shadow-xl"
            >
              <div className="mb-6 flex items-center justify-between">
                <Link href="/" className="flex items-center gap-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-ink text-xs font-bold text-white">G</span>
                  <span className="text-base font-semibold tracking-tight">Glass Ledger</span>
                </Link>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close the map"
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-mut transition-colors hover:bg-raised hover:text-ink"
                >
                  <CloseIcon className="size-5" />
                </button>
              </div>

              {/* The scan, for a reader with no camera. The header hides it below md; the sheet is where
                  it goes on a phone, because a phone is exactly where somebody is holding the thing. */}
              <form
                role="search"
                className="mb-5 flex items-center gap-2 rounded-full border border-line bg-sunken px-3.5 py-2 focus-within:border-line-strong focus-within:bg-surface"
                onSubmit={(e) => {
                  e.preventDefault();
                  onSearch(query);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <SearchIcon className="size-4 shrink-0 text-faint" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Item 3 · creator 1 · 0x…"
                  aria-label="Find an item, a creator, or an address"
                  className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
                />
              </form>

              <Link
                href="/"
                aria-current={pathname === "/" ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                  pathname === "/" ? "bg-sunken font-semibold text-ink" : "font-medium text-mut hover:bg-raised hover:text-ink"
                }`}
              >
                <LedgerIcon className={`size-5 shrink-0 ${onLedger ? "text-ink" : "text-faint"}`} />
                The ledger
              </Link>

              <div className="ml-[1.4rem] border-l border-line-strong/70 pb-1">
                {LEDGER_TREE.map((leaf) => {
                  const active = pathname.startsWith(leaf.href);
                  return (
                    <Link
                      key={leaf.href}
                      href={leaf.href}
                      aria-current={active ? "page" : undefined}
                      className={`relative ml-3 flex items-center rounded-lg py-2 pr-2 pl-3 text-[0.82rem] transition-colors before:absolute before:top-1/2 before:-left-3 before:h-px before:w-3 before:bg-line-strong/70 ${
                        active ? "bg-sunken font-semibold text-ink" : "font-medium text-mut hover:bg-raised hover:text-ink"
                      }`}
                    >
                      {leaf.name}
                    </Link>
                  );
                })}
              </div>

              {GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="mt-5 mb-1 px-3 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-faint">
                    {group.label}
                  </p>
                  {group.links.map(({ href, name, Icon }) => {
                    const active = isActive(pathname, href);
                    return (
                      <Link
                        key={href}
                        href={href}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                          active ? "bg-sunken font-semibold text-ink" : "font-medium text-mut hover:bg-raised hover:text-ink"
                        }`}
                      >
                        <Icon className={`size-5 shrink-0 ${active ? "text-ink" : "text-faint"}`} />
                        {name}
                      </Link>
                    );
                  })}
                </div>
              ))}

              <span className="mt-6 flex items-center gap-2 self-start rounded-full border border-line bg-sunken px-3 py-1 text-xs font-medium text-mut">
                <span className="size-1.5 rounded-full bg-good-fill" />
                0G Galileo · 16602
              </span>
            </nav>
          </div>,
          document.body,
        )}
    </>
  );
}
