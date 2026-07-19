"use client";

/**
 * The entity layer's shared pieces: dossiers, profiles, and the gallery.
 *
 * One visual rule runs through all of them, and it is the protocol's own distinction made material:
 *
 *   a white card       is the chain — state somebody proved, readable with the shop switched off.
 *   a dashed panel     is paperwork — what the printed tag and the published consignment *say*,
 *                      true because it verifies against the chain, never because anybody vouched.
 *
 * A reader who never learns the rule still feels it: the solid facts sit on solid ground, and the
 * asserted ones sit on a sheet with a cut edge.
 */

import Link from "next/link";
import type { ReactNode } from "react";

import { DressImage } from "./dress-image";
import { itemTone, shelfWord } from "./ledger-view";
import { Badge, Empty, Panel } from "./ui";
import { naira, shortAddress, untilDeadline, type Role } from "@/lib/format";
import type { Holdings, Item } from "@/lib/ledger";

/**
 * The paperwork material: what a printed thing says. The dashed hairline is the tell — a cut edge,
 * not a wall — and the caption names whose paperwork it is.
 */
export function Paperwork({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-inner)] border border-dashed border-line-strong bg-raised/70 p-5">
      <header className="mb-3">
        <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-mut">{title}</h3>
        {hint && <p className="mt-1 text-xs leading-relaxed text-faint">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

/** A labelled fact, in the dossier's ledger hand: small caps for the question, mono for the answer. */
export function Fact({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-[0.62rem] font-medium uppercase tracking-[0.12em] text-faint">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-sm text-ink-2">{children}</dd>
    </div>
  );
}

export function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{children}</dl>;
}

/**
 * An address, worn as a nameplate. The protocol has no names for people — an address, the role the
 * money gave it, and what the ledger can prove are the entire identity, so the plate says exactly that.
 */
export function Plate({ address, roles, note }: { address: string; roles: Role[]; note?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-ink font-mono text-sm font-bold text-white">
        {address.slice(2, 4)}
      </span>
      <div className="min-w-0">
        <div className="font-mono text-sm font-semibold break-all text-ink">{address}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {roles.length === 0 ? (
            <Badge tone="quiet">no role yet</Badge>
          ) : (
            roles.map((role) => (
              <Badge key={role} tone="plain">
                the {role}
              </Badge>
            ))
          )}
          {note && <span className="text-xs text-faint">{note}</span>}
        </div>
      </div>
    </div>
  );
}

/** One dress in the gallery: the picture, the price, and where it stands — the card is the door to its dossier. */
export function ItemCard({ item }: { item: Item }) {
  return (
    <Link href={`/item/${String(item.id)}`} className="card-tap group block overflow-hidden p-0">
      <div className="relative">
        <DressImage id={Number(item.id)} label={item.name} className="aspect-[4/5]" />
        <span className="absolute left-2 top-2">
          <Badge tone={itemTone(item.state)} dot>
            {shelfWord(item.state)}
          </Badge>
        </span>
      </div>
      <div className="p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-ink group-hover:underline">{item.name}</span>
          <span className="text-sm font-semibold tabular-nums text-ink">{naira(item.price)}</span>
        </div>
        <div className="mt-0.5 font-mono text-[0.68rem] text-faint">item {String(item.id)}</div>
      </div>
    </Link>
  );
}

/**
 * The sub-section switcher every account page shares.
 *
 * Tabs that sit *on* the rule rather than floating above it: the chosen one is a tinted tab with a
 * squared top and a heavy underline that interrupts the hairline, so what follows reads as the inside
 * of the tab you picked. The rule belongs to this component — a call site places it and adds nothing.
 *
 * The tint is ink, not a semantic colour: amber, emerald and red mean things here, and a tab is
 * furniture, not state.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  right,
}: {
  tabs: { key: T; label: string; count?: number }[];
  active: T;
  onChange: (key: T) => void;
  /** An optional note at the far end of the rule — a source, a count, a caveat. */
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line">
      <div className="flex gap-1" role="tablist" aria-label="Sections">
        {tabs.map((t) => {
          const on = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(t.key)}
              className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-[13px] capitalize transition-colors ${
                on
                  ? "border-ink bg-sunken font-semibold text-ink"
                  : "border-transparent font-medium text-mut hover:text-ink"
              }`}
            >
              {t.label}
              {t.count !== undefined && <span className="ml-1.5 tabular-nums opacity-60">{t.count}</span>}
            </button>
          );
        })}
      </div>
      {right && <div className="pb-2 text-[13px] text-faint">{right}</div>}
    </div>
  );
}

/** A quiet link to a profile: the short address, underlined on approach. */
export function WhoLink({ address }: { address: string }) {
  return (
    <Link href={`/who/${address}`} className="font-mono text-xs text-mut transition-colors hover:text-ink hover:underline">
      {shortAddress(address)}
    </Link>
  );
}

/**
 * Where an item's money went: every debt its sale minted, and whether the party it names has been paid.
 *
 * Shared by the dossier and the inspect result so they can never tell two different stories — the split
 * *is* the sale, and each leg's state is the honest answer to "did the creator/landlord/community
 * actually get theirs."
 */
export function ItemMoney({
  debts,
  claims,
  now,
}: {
  debts: Holdings["debts"];
  claims: Holdings["claims"];
  now: number;
}) {
  return (
    <Panel
      title="Where the money went"
      hint="Every debt this item's sale minted — the split is the sale, and each leg belongs to somebody with a key."
    >
      {debts.length === 0 ? (
        <Empty>No sale yet, so no debts. The split exists on paper; the mint waits for the counter.</Empty>
      ) : (
        <ul className="space-y-1.5">
          {debts.map((debt) => {
            const clock = untilDeadline(debt.deadline, now);
            const inDefault = debt.state === "aging" && clock.overdue;
            return (
              <li key={String(debt.id)} className="flex items-center gap-3 rounded-2xl p-2.5 transition-colors hover:bg-sunken">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold capitalize text-ink">the {debt.role}</div>
                  <div className="mt-0.5 font-mono text-[0.68rem] text-faint">
                    debt #{String(debt.id)} · {debt.rail} · <WhoLink address={debt.recipient} />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums text-ink">{naira(debt.amount)}</div>
                </div>
                <Badge
                  tone={
                    inDefault
                      ? "alarm"
                      : debt.state === "proven"
                        ? "good"
                        : debt.state === "claimed"
                          ? "warn"
                          : debt.state === "retained"
                            ? "quiet"
                            : "plain"
                  }
                  dot
                >
                  {inDefault ? "in default" : debt.state}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}

      {claims.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-faint">Claims that touched this money</h3>
          <ul className="mt-2 space-y-2">
            {claims.map((claim) => (
              <li key={String(claim.id)} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-mut">
                  claim #{String(claim.id)} · {naira(claim.totalAmount)} across {claim.debtIds.length}{" "}
                  {claim.debtIds.length === 1 ? "debt" : "debts"}
                </span>
                <Badge
                  tone={claim.state === "voided" ? "alarm" : claim.state === "challenged" ? "warn" : claim.state === "proven" ? "good" : "plain"}
                  dot
                >
                  {claim.state}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
