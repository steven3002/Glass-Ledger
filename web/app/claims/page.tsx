"use client";

/**
 * The claims, as a table: Good's assertions that it paid, each contestable by the person it names,
 * from her own key, through any RPC on earth.
 */

import Link from "next/link";
import { useState } from "react";

import { FiguresRow, FilterRow, PageFigure } from "@/components/browse";
import { Dropdown } from "@/components/dropdown";
import { CardSkeleton, ChainError, claimTone, useLedger } from "@/components/ledger-view";
import { usePaged } from "@/components/paged";
import { TableCard, Td, Th, Tr } from "@/components/table";
import { Badge, Bytes } from "@/components/ui";
import { naira, when, windowLeft } from "@/lib/format";

/** The claim buckets the census names — one definition for both the figures and the filter. */
type Standing = "open" | "proven" | "voided";
const STANDINGS: { value: Standing; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "proven", label: "Proven" },
  { value: "voided", label: "Voided" },
];
const standingOf = (state: string): Standing | undefined =>
  state === "pending" || state === "challenged" ? "open" : state === "proven" ? "proven" : state === "voided" ? "voided" : undefined;

export default function ClaimsPage() {
  const { cage, holdings, problem, now } = useLedger();
  const [standing, setStanding] = useState<Standing | "all">("all");
  const [show, setShow] = useState(10);

  const claims = holdings?.claims ?? [];
  const rows = standing === "all" ? claims : claims.filter((c) => standingOf(c.state) === standing);
  const paged = usePaged(rows, show);

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  /**
   * Which item a claim is about.
   *
   * A claim names debts, and debts name the sale they arose from — so the item is reached through
   * them rather than stated. Nothing in the protocol says a claim must stay within one item: it is a
   * bundle of obligations, and a bundle can span sales. So this returns the whole set and the row
   * only becomes a door when there is exactly one place for it to lead.
   */
  const itemsOf = (debtIds: readonly bigint[]): bigint[] => [
    ...new Set(
      debtIds
        .map((id) => holdings?.debts.find((d) => d.id === id)?.itemId)
        .filter((id): id is bigint => id !== undefined),
    ),
  ];

  const pending = claims.filter((c) => standingOf(c.state) === "open").length;
  const proven = claims.filter((c) => standingOf(c.state) === "proven").length;
  const voided = claims.filter((c) => standingOf(c.state) === "voided").length;

  return (
    <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10 lg:px-12">
      <h1 className="text-[32px] font-bold tracking-tight text-ink">Claims</h1>
      <p className="mt-1 max-w-3xl text-sm text-mut">
        Good&rsquo;s assertions that it paid. Each can be contested by the person it names, from her own key, through any RPC
        on earth.
      </p>

      <FiguresRow>
        <PageFigure label="Claims" value={holdings ? String(claims.length) : undefined} first />
        <PageFigure label="Open" value={holdings ? String(pending) : undefined} />
        <PageFigure label="Proven" value={holdings ? String(proven) : undefined} tone="good" />
        <PageFigure label="Voided" value={holdings ? String(voided) : undefined} tone={voided > 0 ? "alarm" : "plain"} />
      </FiguresRow>

      <FilterRow>
        <Dropdown
          prefix="State"
          value={standing}
          onChange={setStanding}
          options={[{ value: "all" as const, label: "All" }, ...STANDINGS]}
        />
        <span className="font-mono text-xs text-faint">
          {holdings ? `${rows.length} ${rows.length === 1 ? "claim" : "claims"}` : "\u2026"}
        </span>
      </FilterRow>

      {!holdings ? (
        <div className="mt-8">
          <CardSkeleton rows={8} title />
        </div>
      ) : (
        <TableCard
          found={`${rows.length} ${rows.length === 1 ? "claim" : "claims"} found`}
          sub={standing === "all" ? "what Good says it has paid" : STANDINGS.find((s) => s.value === standing)?.label.toLowerCase()}
          cursor={paged}
          show={show}
          onShow={setShow}
          head={
            <>
              <Th secondary>Claim</Th>
              <Th className="text-left sm:text-right">Amount</Th>
              <Th>Item</Th>
              <Th secondary>Debts</Th>
              <Th secondary>Posted</Th>
              <Th secondary>Challenge window</Th>
              <Th secondary>Reference</Th>
              <Th>Status</Th>
            </>
          }
        >
          {paged.slice.map((claim) => {
            const window_ = windowLeft(claim.challengeDeadline, now);
            const open = claim.state === "pending";
            const items = itemsOf(claim.debtIds);
            const only = items.length === 1 ? items[0] : undefined;
            return (
              /* The row opens the receipt, not the item — a claim is a bundle of debts in one
                 currency and nothing stops that bundle spanning sales, so the receipt is the only
                 destination that is always right. The Item cell beside it stays a direct door to the
                 root for the common case where the bundle came from one sale. */
              <Tr key={String(claim.id)} more href={`/claims/${String(claim.id)}`}>
                <Td label="Claim" secondary className="font-mono text-xs text-faint">
                  <Link
                    href={`/claims/${String(claim.id)}`}
                    className="underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink"
                  >
                    #{String(claim.id)}
                  </Link>
                </Td>
                <Td label="Amount" className="text-left font-semibold tabular-nums text-ink sm:text-right">
                  {naira(claim.totalAmount)}
                </Td>
                {/* What the claim is ultimately about. A reader chasing "was she paid?" is chasing a
                    sale, and the sale is the item — so it is on the row rather than folded away, and
                    it is the one column a phone keeps beside the money and the state. */}
                <Td label="Item">
                  {only !== undefined ? (
                    <Link
                      href={`/item/${String(only)}`}
                      className="text-mut underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink"
                    >
                      item {String(only)}
                    </Link>
                  ) : items.length > 1 ? (
                    <span className="text-mut">{items.length} items</span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </Td>
                <Td label="Debts" secondary className="text-mut">
                  {claim.debtIds.length} {claim.debtIds.length === 1 ? "debt" : "debts"}
                </Td>
                <Td label="Posted" secondary className="text-mut">
                  {when(claim.postedAt)}
                </Td>
                {/* A pending claim whose window has shut was not challenged — a challenge would have
                    moved it to "challenged". It stays pending until somebody calls settleClaim, which
                    anyone may do: the chain does not change state just because a timestamp passed.

                    Dropped on a phone: "closed 5d 2h ago · unchallenged" is a sentence, not a value,
                    and at 207px it was wider than the rest of the row put together. Sentences belong
                    under the kebab with the other things you open a row to read. */}
                <Td
                  label="Challenge window"
                  secondary
                  className={open && !window_.closed ? "text-accent" : "text-faint"}
                  title={
                    open && window_.closed
                      ? "The window shut with nobody objecting. It stays pending until someone records that — settleClaim is permissionless, but it does take a transaction."
                      : undefined
                  }
                >
                  {open ? (window_.closed ? `${window_.text} · unchallenged` : window_.text) : "—"}
                </Td>
                <Td label="Reference" secondary>
                  <Bytes>{claim.refHash.slice(0, 14)}…</Bytes>
                </Td>
                <Td label="Status">
                  <Badge tone={claimTone(claim.state)} dot>
                    {claim.state}
                  </Badge>
                </Td>
              </Tr>
            );
          })}
        </TableCard>
      )}
    </main>
  );
}
