/**
 * The map of the ledger — one copy, read by both the rail and the phone's drawer.
 *
 * It lives apart from either of them on purpose. Two navigations that list their own pages are two
 * navigations that drift: a page gets added to the desktop rail, the phone never hears about it, and
 * the small screen quietly becomes a smaller product. There is one list, and both surfaces render it.
 */

import { BagIcon, GlobeIcon, StorefrontIcon, TagIcon, UserIcon, UsersIcon } from "./icons";

/** The ledger's own sub-pages, which hang under it as a tree. */
export const LEDGER_TREE = [
  { href: "/debts", name: "Debts" },
  { href: "/shelf", name: "The shelf" },
  { href: "/claims", name: "Claims" },
  { href: "/commons", name: "The commons" },
  { href: "/history", name: "What happened" },
];

/**
 * The rest of the map, grouped by what a visitor is looking at: things, then people — and last, the
 * shop.
 *
 * Collections sits under "The goods" and answers a question the chain cannot: which items belong
 * together, and what the line is called. The contract accounts for items one at a time and knows no
 * grouping at all, so that identity is indexed metadata — editorial, off chain, and none the worse
 * for it. What a single unit is *doing* — sold, claimed, written off — is not this page's business;
 * that belongs to the item, and the item's own page carries it.
 *
 * The demo shop stays reachable at /demo for reference; the real one is indexed off the chain.
 */
export const GROUPS = [
  {
    label: "The goods",
    links: [
      { href: "/collections", name: "Collections", Icon: BagIcon },
      { href: "/map", name: "The map", Icon: GlobeIcon },
      { href: "/creator", name: "Inspect", Icon: TagIcon },
    ],
  },
  {
    label: "The people",
    links: [
      { href: "/creators", name: "Creators", Icon: UserIcon },
      { href: "/landlords", name: "Landlords", Icon: StorefrontIcon },
      { href: "/community", name: "Community", Icon: UsersIcon },
    ],
  },
];

/** Is this path inside the ledger — the overview itself, or one of its pages? */
export const onLedgerPath = (pathname: string): boolean =>
  pathname === "/" || LEDGER_TREE.some((t) => pathname.startsWith(t.href));

/** A boundary, not a prefix: "/creator" must stay dark while you read "/creators/1". */
export const isActive = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);
