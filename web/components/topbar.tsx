"use client";

/**
 * The header of the app shell: it names the surface you are on, answers a typed question with the
 * right page, and keeps the shop's live signal in reach even where the sidebar is hidden. It reads,
 * it does not act — like everything but the counter.
 *
 * The search box is the scan for people without a camera: an item number, a creator, a debt, an
 * address — whatever a reader is holding, it resolves to the page that answers for it.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { LedgerIcon, SearchIcon } from "./icons";
import { CHAIN_ID } from "@/lib/chain";
import { MobileNav } from "./mobile-nav";

const TITLES: Record<string, { title: string; sub: string }> = {
  "/": { title: "The ledger", sub: "Overview · read live from the chain" },
  "/debts": { title: "The ledger / Debts", sub: "Who is owed, and for how long" },
  "/shelf": { title: "The ledger / The shelf", sub: "Every item, and where it stands" },
  "/claims": { title: "The ledger / Claims", sub: "What Good says it has paid" },
  "/commons": { title: "The ledger / The commons", sub: "The fund that pays when Good does not" },
  "/history": { title: "The ledger / What happened", sub: "Every state change, newest first" },
  "/creator": { title: "The goods / Inspect", sub: "Scan a tag — authenticity, state, and where the money went" },
  "/creator/understand": { title: "The goods / Inspect · How it works", sub: "The wall we scan in the demo" },
  "/demo/collections": { title: "The goods / Collections", sub: "Every creator's line" },
  "/map": { title: "The goods / The map", sub: "Everywhere Good stands, on the globe" },
  "/creators": { title: "The people / Creators", sub: "The registry's whole population" },
  "/landlords": { title: "The people / Landlords", sub: "Named by tranches, paid by legs" },
  "/community": { title: "The people / Community", sub: "The 2.5% that walked in with the buyer" },
};

function titleFor(pathname: string): { title: string; sub: string } {
  const exact = TITLES[pathname];
  if (exact) return exact;
  if (pathname.startsWith("/item/"))
    return { title: `The goods / Item ${pathname.slice("/item/".length)}`, sub: "One item, its whole life" };
  if (pathname.startsWith("/creators/"))
    return { title: `The people / Creator #${pathname.slice("/creators/".length)}`, sub: "A key, and what grew around it" };
  if (pathname.startsWith("/demo/collections/")) {
    const rest = pathname.slice("/demo/collections/".length);
    return rest.includes("/")
      ? { title: "The goods / Item", sub: "Where it stands, and for how much" }
      : { title: "The goods / Collection", sub: "Its items, across locations" };
  }
  if (pathname.startsWith("/debts/"))
    return {
      title: `The ledger / Debt #${pathname.slice("/debts/".length)}`,
      sub: "One leg of a sale, and what became of it",
    };
  if (pathname.startsWith("/claims/"))
    return {
      title: `The ledger / Claim #${pathname.slice("/claims/".length)}`,
      sub: "What Good asserted, and what became of it",
    };
  if (pathname.startsWith("/who/")) return { title: "The people / Profile", sub: "Derived, never registered" };
  return { title: "Glass Ledger", sub: "Trustless retail" };
}

/**
 * Where a typed question goes. Ids beat words, words beat browsing, and anything unrecognized lands
 * in the gallery — the page for people who do not know the id of what they are holding.
 */
function destination(query: string): string {
  const q = query.trim();
  if (q === "") return "/";
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) return `/who/${q}`;

  // "Item 3" is the friendly label (item id − 1000); "item 1003" is the id itself. Both resolve — a
  // small number gets the shelf offset, a full id is taken as-is.
  const item = q.match(/^(?:item|dress)\s*#?(\d+)$/i);
  if (item) {
    const n = Number(item[1]);
    return `/item/${n >= 1000 ? n : 1000 + n}`;
  }
  const creator = q.match(/^creator\s*#?(\d+)$/i);
  if (creator) return `/creators/${creator[1]}`;
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    return `/item/${n >= 1000 ? n : 1000 + n}`;
  }

  if (/^debts?(\s|#|\d|$)/i.test(q)) return "/debts";
  if (/^claims?(\s|#|\d|$)/i.test(q)) return "/claims";
  if (/^creators?$/i.test(q)) return "/creators";
  if (/^landlords?/i.test(q)) return "/landlords";
  if (/^communit/i.test(q)) return "/community";
  if (/^(map|globe|world|location|where)/i.test(q)) return "/map";
  if (/^(shelf|items?)$/i.test(q)) return "/shelf";
  if (/^(history|happened)/i.test(q)) return "/history";
  if (/^(buy|counter|scan)/i.test(q)) return "/creator";
  if (/^(inspect|verify|tags?|authenticate|scan)/i.test(q)) return "/creator";

  // Nothing matched. The gallery is the demo shop's — it is the only surface that browses by picture
  // rather than by id, which is exactly what a reader who typed a word instead of a number wants.
  return "/demo/collections";
}

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const here = titleFor(pathname);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur-md sm:gap-4 sm:px-6">
      {/* The wordmark stands where the rail would have carried it. Below `lg` there is no rail, so
          without this the product is nameless on the surface a stranger is most likely to meet it on. */}
      <Link href="/" className="flex shrink-0 items-center gap-2.5 lg:hidden">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink text-xs font-bold text-white">G</span>
        <span className="text-[15px] font-semibold tracking-tight text-ink">Glass Ledger</span>
      </Link>

      {/* Where the page is, in words. Hidden on a phone: the wordmark has the room there, and every
          page states its own name in its heading a moment below this one. */}
      <div className="hidden min-w-0 sm:block">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <LedgerIcon className="hidden size-4 text-faint sm:block" />
          <span className="truncate">{here.title}</span>
        </div>
        <div className="truncate text-xs text-mut">{here.sub}</div>
      </div>

      <form
        role="search"
        className="ml-auto hidden min-w-0 max-w-72 flex-1 items-center gap-2 rounded-full border border-line bg-sunken px-3.5 py-1.5 transition-colors focus-within:border-line-strong focus-within:bg-surface md:flex"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(destination(query));
          setQuery("");
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

      <div className="flex items-center gap-2 md:ml-0 ml-auto sm:gap-4">
        <span className="hidden items-center gap-2 rounded-full border border-line bg-sunken px-3 py-1 text-xs font-medium text-mut sm:flex">
          <span className="size-1.5 rounded-full bg-good-fill" />
          {CHAIN_ID === 16602 ? "0G Galileo" : "Local chain"} · {CHAIN_ID}
        </span>

        {/* Last in the bar, under the thumb — the hand holding the phone reaches this corner, not the
            far one across the screen. The wordmark keeps the left, where a name belongs. */}
        <MobileNav onSearch={(q) => router.push(destination(q))} />
      </div>
    </header>
  );
}
