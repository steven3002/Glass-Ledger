"use client";

/**
 * The one place on these surfaces that asks Good whether Good is alive — and it asks so that the
 * answer can be displayed, not so that anything can depend on it.
 *
 * When this says the operator is offline, every other thing on every other page is still true and
 * still updating: the tags still verify, the debts still age, the deadlines still pass, the pool still
 * pays, the ceiling still refuses. The only thing that stops is buying. That is what a shop being
 * closed looks like, and it is the difference between a ledger and a dashboard.
 */

import { useEffect, useState } from "react";

import { operatorIsUp } from "@/lib/relayer";

export function OperatorStatus() {
  const [up, setUp] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let live = true;
    const poll = () => {
      void operatorIsUp().then((answer) => {
        if (live) setUp(answer);
      });
    };

    poll();
    const timer = setInterval(poll, 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  if (up === undefined) return null;

  return up ? (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-mut">
      <span className="size-2 rounded-full bg-good-fill shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-good-fill)_20%,transparent)]" />
      the shop&rsquo;s counter is open
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_oklab,var(--color-accent-fill)_45%,white)] bg-[color-mix(in_oklab,var(--color-accent-fill)_12%,white)] px-3 py-1 text-xs font-medium text-accent">
      <span className="size-2 rounded-full bg-accent-fill" />
      Good is offline — nothing on this page needed it
    </span>
  );
}
