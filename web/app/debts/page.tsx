"use client";

/**
 * The debts, as a table — who is owed what, and for how long.
 *
 * The browse theme carried onto a ledger list: the title flush, the census ruled apart, the persona
 * filter above the rule, and then the table card — a count, numbered pages, a page size, and the rows.
 * Time runs one way here: a debt never expires into paid.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import { FiguresRow, FilterRow, PageFigure } from "@/components/browse";
import { Dropdown } from "@/components/dropdown";
import { badgeTone, CardSkeleton, ChainError, DebtSummary, useLedger } from "@/components/ledger-view";
import { usePaged } from "@/components/paged";
import { TableCard, Td, Th, Tr } from "@/components/table";
import { Badge } from "@/components/ui";
import {
  age,
  debtBucket,
  DEBT_BUCKETS,
  naira,
  ROLES,
  shortAddress,
  untilDeadline,
  type DebtBucket,
  type Role,
} from "@/lib/format";

export default function DebtsPage() {
  const { cage, holdings, problem, now } = useLedger();
  const [role, setRole] = useState<Role | "everyone">("everyone");
  const [bucket, setBucket] = useState<DebtBucket | "all">("all");
  const [show, setShow] = useState(10);

  // The persona narrows the population the census describes; the state narrows only the rows shown,
  // so the band keeps telling you what is in the buckets you have not picked.
  const debts = useMemo(
    () => (holdings?.debts ?? []).filter((d) => role === "everyone" || d.role === role),
    [holdings, role],
  );
  const rows = useMemo(
    () => (bucket === "all" ? debts : debts.filter((d) => debtBucket(d, now) === bucket)),
    [debts, bucket, now],
  );
  const paged = usePaged(rows, show);

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const census = debts.reduce(
    (acc, d) => {
      acc[debtBucket(d, now)] += 1;
      return acc;
    },
    { inDefault: 0, clock: 0, proven: 0, commission: 0, resolved: 0 } as Record<DebtBucket, number>,
  );

  return (
    <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10 lg:px-12">
      <h1 className="text-[32px] font-bold tracking-tight text-ink">Debts</h1>
      <p className="mt-1 max-w-3xl text-sm text-mut">
        Who is owed what, and for how long. Time runs one way: a debt never expires into paid.
      </p>

      <FiguresRow>
        <PageFigure label="Debts" value={holdings ? String(debts.length) : undefined} first />
        <PageFigure label="In default" value={holdings ? String(census.inDefault) : undefined} tone={census.inDefault > 0 ? "alarm" : "plain"} />
        <PageFigure label="On the clock" value={holdings ? String(census.clock) : undefined} />
        <PageFigure label="Proven" value={holdings ? String(census.proven) : undefined} tone="good" />
        <PageFigure label="Commission" value={holdings ? String(census.commission) : undefined} />
      </FiguresRow>

      <FilterRow>
        <Dropdown
          prefix="Owed to"
          value={role}
          onChange={setRole}
          options={[{ value: "everyone" as const, label: "Everyone" }, ...ROLES.map((r) => ({ value: r, label: `The ${r}` }))]}
        />
        <Dropdown
          prefix="State"
          value={bucket}
          onChange={setBucket}
          options={[{ value: "all" as const, label: "All" }, ...DEBT_BUCKETS]}
        />
        <span className="font-mono text-xs text-faint">
          {holdings ? `${rows.length} ${rows.length === 1 ? "debt" : "debts"}` : "…"}
        </span>
      </FilterRow>

      <div className="mt-5">
        <DebtSummary role={role} debts={debts} now={now} loading={!holdings} onClear={() => setRole("everyone")} />
      </div>

      {!holdings ? (
        <div className="mt-8">
          <CardSkeleton rows={8} tall />
        </div>
      ) : (
        <TableCard
          found={`${rows.length} ${rows.length === 1 ? "debt" : "debts"} found`}
          sub={[
            bucket === "all" ? "every leg the counter ever minted" : DEBT_BUCKETS.find((b) => b.value === bucket)?.label.toLowerCase(),
            role === "everyone" ? undefined : `owed to the ${role}`,
          ]
            .filter(Boolean)
            .join(" · ")}
          cursor={paged}
          show={show}
          onShow={setShow}
          head={
            <>
              <Th secondary>Debt</Th>
              <Th>Owed to</Th>
              <Th secondary>Item</Th>
              <Th secondary>Rail</Th>
              <Th className="text-right">Amount</Th>
              <Th secondary>Age</Th>
              <Th>Status</Th>
            </>
          }
        >
          {paged.slice.map((debt) => {
            const clock = untilDeadline(debt.deadline, now);
            const inDefault = debt.state === "aging" && clock.overdue;
            const propped = debt.state === "claimed" && clock.overdue;
            const live = debt.state === "aging" || debt.state === "claimed";
            const tone = badgeTone(debt.state, inDefault);
            const square =
              tone === "alarm"
                ? "border-[color-mix(in_oklab,var(--color-bad-fill)_35%,white)] bg-[color-mix(in_oklab,var(--color-bad-fill)_10%,white)] text-bad"
                : tone === "warn"
                  ? "border-[color-mix(in_oklab,var(--color-accent-fill)_40%,white)] bg-[color-mix(in_oklab,var(--color-accent-fill)_12%,white)] text-accent"
                  : tone === "good"
                    ? "border-[color-mix(in_oklab,var(--color-good-fill)_35%,white)] bg-[color-mix(in_oklab,var(--color-good-fill)_10%,white)] text-good"
                    : "border-line bg-surface text-ink-2";

            return (
              /* The row leads to the item the debt arose from. Every leg exists because something
                 was sold, so the item is the root a reader can always get back to — and from there
                 to the sale, the other legs, and the claims that touched them. */
              <Tr key={String(debt.id)} more href={`/item/${String(debt.itemId)}`}>
                <Td label="Debt" secondary className="font-mono text-xs text-faint">
                  {/* The row leads to the item, which is the root; the id leads to the leg's own
                      dossier, for a reader who came here asking about this obligation in particular. */}
                  <Link
                    href={`/debts/${String(debt.id)}`}
                    className="underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink"
                  >
                    #{String(debt.id)}
                  </Link>
                </Td>
                <Td label="Owed to" headline>
                  <div className="flex items-center gap-3">
                    <span className={`grid size-8 shrink-0 place-items-center rounded-lg border text-xs font-bold uppercase ${square}`}>
                      {debt.role.charAt(0)}
                    </span>
                    <div>
                      <div className="font-medium capitalize text-ink">the {debt.role}</div>
                      <Link href={`/who/${debt.recipient}`} className="font-mono text-[0.68rem] text-faint transition-colors hover:text-ink">
                        {shortAddress(debt.recipient)}
                      </Link>
                    </div>
                  </div>
                </Td>
                <Td label="Item" secondary>
                  <Link href={`/item/${String(debt.itemId)}`} className="text-mut transition-colors hover:text-ink hover:underline">
                    item {String(debt.itemId)}
                  </Link>
                </Td>
                <Td label="Rail" secondary className="text-mut">
                  {debt.rail}
                </Td>
                <Td label="Amount" className="text-right font-semibold tabular-nums text-ink">
                  {naira(debt.amount)}
                </Td>
                <Td label="Age" secondary className={inDefault ? "font-semibold text-bad" : propped ? "text-accent" : "text-mut"}>
                  {live ? (inDefault || propped ? clock.text : `${age(debt.mintedAt, now)} old`) : "—"}
                </Td>
                <Td label="Status">
                  <Badge tone={tone} dot>
                    {inDefault ? "in default" : debt.state}
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
