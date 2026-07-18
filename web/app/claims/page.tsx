"use client";

/** The claims: Good's assertions that it has paid, each contestable by the person it names. */

import { CardSkeleton, ChainError, Claims, PageHeader, useLedger } from "@/components/ledger-view";

export default function ClaimsPage() {
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
        title="Claims"
        sub="Good's assertions that it paid. Each can be contested by the person it names, from her own key, through any RPC on earth."
      />
      {holdings ? <Claims claims={holdings.claims} /> : <CardSkeleton rows={9} title />}
    </main>
  );
}
