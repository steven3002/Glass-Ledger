"use client";

/**
 * The public ledger.
 *
 * Everything here is read from the chain over a public connection: the items, the debts and their
 * ages, the pool, the allowance, the ceiling, and every event that ever fired. Nothing on this page is
 * fetched from Good. Switch Good off — the demo does, in front of people — and the page carries on,
 * because a debt ages whether or not anybody is serving a website, and a deadline passes whether or not
 * anybody is watching.
 *
 * It is built to make two things visible from across a room: a debt that has gone unpaid too long, and
 * the stranger — not the person who was wronged — who collected it.
 */

import { useCallback, useEffect, useState } from "react";

import { Badge, Bytes, Empty, Panel, Stat } from "@/components/ui";
import { deployment } from "@/lib/chain";
import {
  DEBT_STATE_MEANING,
  ROLES,
  age,
  naira,
  shortAddress,
  untilDeadline,
  when,
  type Role,
} from "@/lib/format";
import { readLedger, type Snapshot } from "@/lib/ledger";
import { loadConsignment } from "@/lib/tags";

export default function LedgerPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [problem, setProblem] = useState<string>();
  const [role, setRole] = useState<Role | "everyone">("everyone");
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [where, consignment] = await Promise.all([deployment(), loadConsignment()]);
      setSnapshot(await readLedger(where, consignment));
      setProblem(undefined);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, []);

  // The chain is the external system this page subscribes to: it is polled, and what it says is
  // written into React state when it answers. Nothing is set synchronously here — there is nothing to
  // set until the chain has spoken.
  useEffect(() => {
    void (async () => {
      await refresh();
    })();

    const poll = setInterval(() => void refresh(), 3000);
    const clock = setInterval(() => setTick((t) => t + 1), 1000);

    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [refresh]);

  if (problem) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <Panel title="The chain is not answering" tone="alarm">
          <p className="text-sm leading-relaxed text-neutral-300">{problem}</p>
        </Panel>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <Empty>Reading the chain…</Empty>
      </main>
    );
  }

  // The chain's own clock, nudged along between polls so an age on screen ticks like an age.
  const now = snapshot.now + (tick % 3);

  const { ceiling, pool } = snapshot;
  const debts = snapshot.debts.filter((debt) => role === "everyone" || debt.role === role);
  const entries = snapshot.entries.filter(
    (entry) => role === "everyone" || !entry.who || snapshot.roleOf.get(entry.who.toLowerCase()) === role,
  );

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">The ledger</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Read live from the chain. Nothing on this page comes from the shop.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(["everyone", ...ROLES] as const).map((each) => (
            <button
              key={each}
              onClick={() => setRole(each)}
              className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                role === each
                  ? "border-neutral-500 bg-neutral-800 text-neutral-100"
                  : "border-neutral-800 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300"
              }`}
            >
              {each === "everyone" ? "everyone" : `the ${each}`}
            </button>
          ))}
        </div>
      </header>

      {/* The ceiling is not a warning light. It is a door, and it is checked before an item can leave
          the shelf. */}
      <Panel
        title="Good's cage"
        hint="How much of other people's money Good is holding, and how much it is allowed to hold. When the second number runs out, the till stops selling for cash."
        tone={ceiling.headroom === 0n ? "alarm" : "plain"}
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Ceiling"
            value={naira(ceiling.ceiling)}
            note="the pool, plus the allowance Good has earned by proving it pays"
          />
          <Stat
            label="Being held"
            value={naira(ceiling.used)}
            note={`${naira(ceiling.custody)} owed to people · ${naira(ceiling.reimbursements)} owed to the pool · ${naira(ceiling.unpaidFines)} in unpaid fines`}
          />
          <Stat
            label="Headroom"
            value={naira(ceiling.headroom)}
            tone={ceiling.headroom === 0n ? "alarm" : "good"}
            note={
              ceiling.headroom === 0n
                ? "the till is shut for cash sales. An instant-rail sale still goes through: Good never touches that money."
                : "what the next cash sale is allowed to add"
            }
          />
          <Stat
            label="The pool"
            value={naira(pool.balance)}
            note={
              ceiling.frozen
                ? "frozen: Good owes the pool for a default, and its allowance cannot grow until it repays"
                : "the fund that pays the creator when Good does not"
            }
          />
        </div>

        {ceiling.frozen && (
          <p className="mt-5 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm leading-relaxed text-red-200">
            <strong className="font-semibold">Frozen.</strong> Good caused a default, the pool paid for
            it, and Good owes the pool {naira(ceiling.reimbursements)}. Until that is repaid, no honest
            sale it makes earns it any capacity at all — and the volume it trades in the meantime is not
            banked for later. It is forfeited.
          </p>
        )}

        {ceiling.unpaidFines > 0n && (
          <p className="mt-3 rounded-lg border border-amber-900 bg-amber-950/40 p-3 text-sm leading-relaxed text-amber-200">
            Good owes {naira(ceiling.unpaidFines)} in fines it has not paid — and an unpaid fine eats the
            headroom it needs in order to keep selling. Refusing costs it capacity; paying costs it
            money. There is no third door.
          </p>
        )}
      </Panel>

      {snapshot.writeOffs.map((burn) => (
        <Panel
          key={String(burn.itemId)}
          title="A write-off, and what it earned"
          hint="Good declared an item destroyed. It still paid everybody as though it had sold — that is what a write-off costs here — and the two numbers below are why nobody launders a sale this way."
          tone="warn"
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-4">
              <div className="text-xs uppercase tracking-wider text-emerald-500">Selling it honestly</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums text-emerald-300">
                {naira(burn.honestCommission)}
              </div>
              <p className="mt-2 text-sm text-neutral-400">
                Good&rsquo;s commission on an ordinary sale of item {String(burn.itemId)} at{" "}
                {naira(burn.price)}.
              </p>
            </div>
            <div className="rounded-lg border border-red-900/60 bg-red-950/20 p-4">
              <div className="text-xs uppercase tracking-wider text-red-500">
                Selling it off the books and calling it shrinkage
              </div>
              <div className="mt-1 text-3xl font-semibold tabular-nums text-red-300">
                {naira(burn.launderedNet)}
              </div>
              <p className="mt-2 text-sm text-neutral-400">
                It keeps the whole price — then pays {naira(burn.paidAsSold)} to the creator, the landlord
                and the community as if it had sold, plus a {naira(burn.penalty)} fee.
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-neutral-400">
            The best possible outcome of the fraud is worth less than telling the truth. That is the
            whole of the deterrent, and it is arithmetic, not a policy.
          </p>
        </Panel>
      ))}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel
            title="Debts"
            hint="Who is owed what, and for how long. Time runs one way here: a debt never expires into paid."
          >
            {debts.length === 0 ? (
              <Empty>Nothing is owed to anybody.</Empty>
            ) : (
              <div className="-mx-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-neutral-600">
                      <th className="px-2 pb-2 font-medium">Owed to</th>
                      <th className="px-2 pb-2 font-medium">Amount</th>
                      <th className="px-2 pb-2 font-medium">Age</th>
                      <th className="px-2 pb-2 font-medium">Deadline</th>
                      <th className="px-2 pb-2 font-medium">Where it stands</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debts.map((debt) => {
                      const live = debt.state === "aging" || debt.state === "claimed";
                      const clock = untilDeadline(debt.deadline, now);

                      // A debt whose deadline has passed with nobody claiming to have paid it is in
                      // default, and anybody may collect it. A debt whose deadline has passed while a
                      // claim stands over it is not — the claim suspends it. But the claim is the only
                      // thing holding it up, and the debt keeps the age it always had, so the day that
                      // claim dies is the day this is in default. Those are two different colours,
                      // because they are two different facts.
                      const inDefault = debt.state === "aging" && clock.overdue;
                      const propped = debt.state === "claimed" && clock.overdue;

                      return (
                        <tr
                          key={String(debt.id)}
                          className={`border-t border-neutral-900 ${
                            inDefault ? "bg-red-950/30" : propped ? "bg-amber-950/20" : ""
                          }`}
                        >
                          <td className="px-2 py-2.5">
                            <div className="font-medium capitalize text-neutral-200">the {debt.role}</div>
                            <div className="text-xs text-neutral-600">
                              item {String(debt.itemId)} · {debt.rail} rail · {shortAddress(debt.recipient)}
                            </div>
                          </td>
                          <td className="px-2 py-2.5 tabular-nums text-neutral-200">{naira(debt.amount)}</td>
                          <td
                            className={`px-2 py-2.5 tabular-nums ${
                              inDefault ? "font-semibold text-red-400" : propped ? "text-amber-400" : "text-neutral-400"
                            }`}
                          >
                            {live ? age(debt.mintedAt, now) : "—"}
                          </td>
                          <td className="px-2 py-2.5 tabular-nums">
                            {live ? (
                              <span
                                className={
                                  inDefault
                                    ? "font-semibold text-red-400"
                                    : propped
                                      ? "text-amber-400"
                                      : "text-neutral-400"
                                }
                              >
                                {clock.text}
                              </span>
                            ) : (
                              <span className="text-neutral-700">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2.5">
                            <Badge tone={toneOfDebt(debt.state, inDefault)}>
                              {inDefault ? "in default" : debt.state}
                            </Badge>
                            <div className="mt-1 max-w-md text-xs leading-relaxed text-neutral-600">
                              {inDefault
                                ? "The deadline has passed and nobody has claimed to have paid it. Anybody in the world can collect this now: the pool pays the recipient in full, and Good is written down five times over."
                                : propped
                                  ? "Its deadline has already passed — the only thing holding it up is Good's claim to have paid it. The debt keeps the age it always had, so if that claim dies, this is in default the second it comes back."
                                  : DEBT_STATE_MEANING[debt.state]}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel
            title="What happened"
            hint="Every state change the protocol has ever made, newest first. If a transition has no event, the transition is incomplete."
          >
            {entries.length === 0 ? (
              <Empty>Nothing has happened yet.</Empty>
            ) : (
              <ol className="space-y-2.5">
                {entries.map((entry) => (
                  <li
                    key={entry.key}
                    className="flex gap-3 border-l-2 pl-3"
                    style={{ borderColor: edge(entry.tone) }}
                  >
                    <div className="min-w-28 shrink-0 pt-0.5 text-xs tabular-nums text-neutral-600">
                      {when(entry.at)}
                    </div>
                    <p className={`text-sm leading-relaxed ${words(entry.tone)}`}>{entry.sentence}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="The shelf" hint="Every item in the consignment, and where it stands.">
            <ul className="space-y-1.5">
              {snapshot.items.map((item) => (
                <li key={String(item.id)} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-neutral-300">
                    {item.name}
                    <span className="ml-2 text-xs text-neutral-600">{naira(item.price)}</span>
                  </span>
                  <Badge tone={toneOfItem(item.state)}>{shelfWord(item.state)}</Badge>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title="Claims"
            hint="Good's assertions that it has paid. Each can be contested by the person it names, from her own key, through any RPC on earth."
          >
            {snapshot.claims.length === 0 ? (
              <Empty>Good has not claimed to have paid anybody.</Empty>
            ) : (
              <ul className="space-y-3">
                {snapshot.claims.map((claim) => (
                  <li
                    key={String(claim.id)}
                    className="border-t border-neutral-900 pt-3 first:border-0 first:pt-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-neutral-300">
                        {naira(claim.totalAmount)} across {claim.debtIds.length}{" "}
                        {claim.debtIds.length === 1 ? "debt" : "debts"}
                      </span>
                      <Badge tone={toneOfClaim(claim.state)}>{claim.state}</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-neutral-600">
                      {claimMeaning(claim.state, untilDeadline(claim.coverageDeadline, now))}
                    </p>
                    <div className="mt-1">
                      <Bytes>payment reference {claim.refHash.slice(0, 18)}…</Bytes>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </main>
  );
}

function toneOfDebt(state: string, overdue: boolean) {
  if (overdue && state === "aging") return "alarm" as const;
  if (state === "defaulted") return "alarm" as const;
  if (state === "proven") return "good" as const;
  if (state === "claimed") return "warn" as const;
  if (state === "retained") return "quiet" as const;
  return "plain" as const;
}

function toneOfItem(state: string) {
  if (state === "BURNED") return "alarm" as const;
  if (state === "COMMITTED") return "warn" as const;
  if (state === "SOLD" || state === "OWNED") return "plain" as const;
  return "good" as const;
}

function shelfWord(state: string): string {
  switch (state) {
    case "ABSENT":
    case "LISTED":
      return "in store";
    case "COMMITTED":
      return "ordered";
    case "SOLD":
      return "sold";
    case "OWNED":
      return "sold · certificate claimed";
    case "BURNED":
      return "written off";
    default:
      return state.toLowerCase();
  }
}

function toneOfClaim(state: string) {
  if (state === "voided") return "alarm" as const;
  if (state === "challenged") return "warn" as const;
  if (state === "proven") return "good" as const;
  return "plain" as const;
}

function claimMeaning(state: string, coverage: { text: string; overdue: boolean }): string {
  switch (state) {
    case "pending":
      return "Nobody has objected yet. Silence will settle it — but silence is not evidence, and the sweep still has to reach it.";
    case "challenged":
      return "Somebody says she was not paid. Good must prove otherwise before its response window closes, or the claim dies and Good is fined.";
    case "settled":
      return coverage.overdue
        ? "Nobody objected — and the deadline for backing it with evidence has now passed. It dies on the next touch, from anybody at all."
        : `Nobody objected. It still needs evidence at the sweep: ${coverage.text} to produce it.`;
    case "proven":
      return "Backed by evidence. This is the only thing that earns Good any capacity to hold money.";
    case "voided":
      return "Good said it had paid and could not prove it. The claim is dead, the fine is levied, and the debts underneath went back to the age they always had.";
    default:
      return "";
  }
}

const words = (tone: string) =>
  tone === "alarm"
    ? "text-red-300"
    : tone === "warn"
      ? "text-amber-300"
      : tone === "good"
        ? "text-emerald-300"
        : tone === "quiet"
          ? "text-neutral-600"
          : "text-neutral-300";

const edge = (tone: string) =>
  tone === "alarm"
    ? "#7f1d1d"
    : tone === "warn"
      ? "#78350f"
      : tone === "good"
        ? "#065f46"
        : tone === "quiet"
          ? "#171717"
          : "#262626";
