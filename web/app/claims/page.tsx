"use client";

/**
 * The claims, as a table: Good's assertions that it paid, each contestable by the person it names,
 * from her own key, through any RPC on earth.
 */

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
              <Th>Debts</Th>
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
            return (
              <Tr key={String(claim.id)} more>
                <Td label="Claim" secondary className="font-mono text-xs text-faint">
                  #{String(claim.id)}
                </Td>
                <Td label="Amount" className="text-left font-semibold tabular-nums text-ink sm:text-right">
                  {naira(claim.totalAmount)}
                </Td>
                <Td label="Debts" className="text-mut">
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
