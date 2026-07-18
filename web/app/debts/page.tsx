"use client";

/**
 * The debts, in full — with the persona filter, because "who is owed" is the question this page exists
 * to answer for one person at a time.
 */

import { useState } from "react";

import {
  CardSkeleton,
  ChainError,
  Debts,
  PageHeader,
  RoleFilter,
  RoleSummary,
  useLedger,
} from "@/components/ledger-view";
import type { Role } from "@/lib/format";

export default function DebtsPage() {
  const { cage, holdings, problem, now } = useLedger();
  const [role, setRole] = useState<Role | "everyone">("everyone");

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const debts = (holdings?.debts ?? []).filter((d) => role === "everyone" || d.role === role);

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 p-6 lg:p-8">
      <PageHeader
        title="Debts"
        sub="Who is owed what, and for how long. Time runs one way: a debt never expires into paid."
        right={<RoleFilter role={role} setRole={setRole} />}
      />
      {role !== "everyone" && (
        <RoleSummary role={role} debts={debts} now={now} loading={!holdings} onClear={() => setRole("everyone")} />
      )}
      {holdings ? <Debts debts={debts} now={now} role={role} /> : <CardSkeleton rows={8} tall />}
    </main>
  );
}
