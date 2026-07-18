"use client";

/** The shelf: every item in the consignment, and where it stands. */

import { CardSkeleton, ChainError, PageHeader, Shelf, useLedger } from "@/components/ledger-view";

export default function ShelfPage() {
  const { cage, holdings, problem } = useLedger();

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6 lg:p-8">
      <PageHeader
        title="The shelf"
        sub="Every item in the consignment, and where it stands — proven by the chain, not asserted by the shop."
      />
      {holdings ? <Shelf items={holdings.items} /> : <CardSkeleton rows={13} title />}
    </main>
  );
}
