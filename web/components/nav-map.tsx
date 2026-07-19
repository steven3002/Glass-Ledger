/**
 * The map of the ledger — one copy, read by both the rail and the phone's drawer.
 *
 * It lives apart from either of them on purpose. Two navigations that list their own pages are two
 * navigations that drift: a page gets added to the desktop rail, the phone never hears about it, and
 * the small screen quietly becomes a smaller product. There is one list, and both surfaces render it.
 */

import { GlobeIcon, StackIcon, StorefrontIcon, TagIcon, UserIcon, UsersIcon } from "./icons";

/** The ledger's own sub-pages, which hang under it as a tree. */
export const LEDGER_TREE = [
  { href: "/debts", name: "Debts" },
  { href: "/shelf", name: "The shelf" },
  { href: "/claims", name: "Claims" },
  { href: "/history", name: "What happened" },
];

/** The rest of the map, grouped by what a visitor is looking at: things, then people. */
export const GROUPS = [
  {
    label: "The goods",
    links: [
      { href: "/collections", name: "Collections", Icon: StackIcon },
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
