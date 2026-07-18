"use client";

/**
 * The event history: every state change the protocol ever made, narrated, newest first — with the
 * persona filter, so one party can read only the lines that are their business.
 */

import { useState } from "react";

import { CardSkeleton, ChainError, PageHeader, RoleFilter, useLedger, WhatHappened } from "@/components/ledger-view";
import type { Role } from "@/lib/format";

export default function HistoryPage() {
  const { cage, holdings, history, problem } = useLedger();
  const [role, setRole] = useState<Role | "everyone">("everyone");

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const entries = (history?.entries ?? []).filter(
    (e) => role === "everyone" || !e.who || holdings?.roleOf.get(e.who.toLowerCase()) === role,
  );

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6 lg:p-8">
      <PageHeader
        title="What happened"
        sub="Every state change the protocol ever made, newest first. A transition with no event is an incomplete one."
        right={<RoleFilter role={role} setRole={setRole} />}
      />
      {history ? <WhatHappened entries={entries} /> : <CardSkeleton rows={10} tall />}
    </main>
  );
}
