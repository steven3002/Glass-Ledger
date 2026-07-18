"use client";

/**
 * The left rail. Where you are is lit; where you can go is quiet.
 *
 * The ledger's sub-pages hang under it as a directory tree that is always open — the tree is the map of
 * the ledger and a map you have to unfold is a map you forget exists. What *does* fold is the sidebar
 * itself: collapsed, it becomes an icon rail and the pages keep their full width.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  CaretDownIcon,
  GlobeIcon,
  LedgerIcon,
  SidebarIcon,
  StackIcon,
  StorefrontIcon,
  TagIcon,
  UserIcon,
  UsersIcon,
} from "./icons";

const LEDGER_TREE = [
  { href: "/debts", name: "Debts" },
  { href: "/shelf", name: "The shelf" },
  { href: "/claims", name: "Claims" },
  { href: "/history", name: "What happened" },
];

/** The rest of the map, grouped by what a visitor is looking at: things, then people. */
const GROUPS = [
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

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [treeOpen, setTreeOpen] = useState(true);

  // Remembered across visits — preferences, not states the page derives.
  useEffect(() => {
    setCollapsed(localStorage.getItem("gl-sidebar") === "collapsed");
    setTreeOpen(localStorage.getItem("gl-ledger-tree") !== "closed");
  }, []);

  // A page can ask the rail to fold — the map does, so a click on the world gives the world the room.
  useEffect(() => {
    const fold = () => {
      setCollapsed(true);
      localStorage.setItem("gl-sidebar", "collapsed");
    };
    window.addEventListener("gl-sidebar-collapse", fold);
    return () => window.removeEventListener("gl-sidebar-collapse", fold);
  }, []);

  // Publish the rail's live width, so a full-bleed page (the map) can float its own layers flush to the
  // content edge instead of sliding under the rail. Zero below lg, where the rail is not on screen.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => {
      document.documentElement.style.setProperty(
        "--gl-sidebar-w",
        mq.matches ? (collapsed ? "68px" : "248px") : "0px",
      );
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [collapsed]);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("gl-sidebar", next ? "collapsed" : "open");
  };
  const toggleTree = () => {
    const next = !treeOpen;
    setTreeOpen(next);
    localStorage.setItem("gl-ledger-tree", next ? "open" : "closed");
  };

  const onLedger = pathname === "/" || LEDGER_TREE.some((t) => pathname.startsWith(t.href));

  return (
    <aside
      className={`sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex ${
        collapsed ? "w-[68px] p-3" : "w-[248px] p-5"
      }`}
    >
      <div className="min-h-0 overflow-y-auto">
        <div className={`mb-8 flex items-center gap-3 ${collapsed ? "flex-col" : "justify-between px-1"}`}>
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-ink text-xs font-bold text-white transition-transform group-hover:-rotate-6">
              G
            </span>
            {!collapsed && <span className="text-base font-semibold tracking-tight">Glass Ledger</span>}
          </Link>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-mut transition-colors hover:bg-raised hover:text-ink"
          >
            <SidebarIcon className="size-5" />
          </button>
        </div>

        <nav className="space-y-1">
          {/* The ledger, and its tree. */}
          <div className={`flex items-center ${collapsed ? "" : "gap-1"}`}>
            <Link
              href="/"
              aria-current={pathname === "/" ? "page" : undefined}
              title={collapsed ? "The ledger" : undefined}
              className={`flex flex-1 items-center gap-3 rounded-xl text-sm transition-colors ${
                collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5"
              } ${onLedger && collapsed ? "bg-sunken" : ""} ${
                pathname === "/" ? "bg-sunken font-semibold text-ink" : "font-medium text-mut hover:bg-raised hover:text-ink"
              }`}
            >
              <LedgerIcon className={`size-5 shrink-0 ${onLedger ? "text-ink" : "text-faint"}`} />
              {!collapsed && "The ledger"}
            </Link>
            {!collapsed && (
              <button
                type="button"
                onClick={toggleTree}
                aria-expanded={treeOpen}
                aria-label={treeOpen ? "Fold the ledger's pages" : "Unfold the ledger's pages"}
                title={treeOpen ? "Hide pages" : "Show pages"}
                className={`grid size-7 shrink-0 place-items-center rounded-md border transition-colors ${
                  treeOpen
                    ? "border-line-strong bg-sunken text-ink"
                    : "border-line-strong bg-raised text-ink-2 hover:bg-sunken hover:text-ink"
                }`}
              >
                <CaretDownIcon className={`size-4 transition-transform duration-200 ${treeOpen ? "" : "-rotate-90"}`} />
              </button>
            )}
          </div>

          {/* The tree, foldable — folded, the ledger is one door; unfolded, it is the map. */}
          {!collapsed && treeOpen && (
            <div className="ml-[1.4rem] border-l border-line-strong/70 pb-1">
              {LEDGER_TREE.map((leaf) => {
                const active = pathname.startsWith(leaf.href);
                return (
                  <Link
                    key={leaf.href}
                    href={leaf.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative ml-3 flex items-center rounded-lg py-1.5 pr-2 pl-3 text-[0.82rem] transition-colors before:absolute before:top-1/2 before:-left-3 before:h-px before:w-3 before:bg-line-strong/70 ${
                      active ? "bg-sunken font-semibold text-ink" : "font-medium text-mut hover:bg-raised hover:text-ink"
                    }`}
                  >
                    {leaf.name}
                  </Link>
                );
              })}
            </div>
          )}

          {GROUPS.map((group) => (
            <div key={group.label}>
              {collapsed ? (
                <div className="mx-auto my-2 h-px w-6 bg-line-strong/70" aria-hidden />
              ) : (
                <p className="mt-5 mb-1 px-3 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-faint">
                  {group.label}
                </p>
              )}
              {group.links.map(({ href, name, Icon }) => {
                // A boundary, not a prefix: "/creator" must stay dark while you read "/creators/1".
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? name : undefined}
                    className={`flex items-center gap-3 rounded-xl text-sm transition-colors ${
                      collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5"
                    } ${active ? "bg-sunken font-semibold text-ink" : "font-medium text-mut hover:bg-raised hover:text-ink"}`}
                  >
                    <Icon className={`size-5 shrink-0 ${active ? "text-ink" : "text-faint"}`} />
                    {!collapsed && name}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}
