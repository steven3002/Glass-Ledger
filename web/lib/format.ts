/**
 * How numbers, clocks and names are written on these pages.
 *
 * The audience is a person who has never read a contract. Everything here exists to make the ledger's
 * own facts sayable out loud: naira with its symbol, an age in the words a person would use, a deadline
 * that has passed said as "overdue" rather than as a negative number.
 */

import { formatUnits } from "viem";

/** Naira, at the token's 18 decimals. Whole naira, because the ledger deals in whole naira. */
export function naira(amount: bigint | undefined): string {
  if (amount === undefined) return "—";
  const whole = Number(formatUnits(amount, 18));
  return `₦${whole.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

/**
 * Naira, abbreviated — for a figure read at a glance rather than reconciled.
 *
 * ₦63,750,000 is eleven characters and it breaks the row it sits in; ₦63.75m is six and says the same
 * thing to somebody scanning. Used only on summary figures, never where a number is being checked:
 * a reader auditing a sum needs every digit, and the pages that show one give it in full.
 *
 * Rounded to two decimals, so the abbreviation never claims more precision than it has.
 */
export function nairaShort(amount: bigint | undefined): string {
  if (amount === undefined) return "—";
  const whole = Number(formatUnits(amount, 18));
  const trim = (n: number) => String(Number(n.toFixed(2)));
  if (Math.abs(whole) >= 1_000_000_000) return `₦${trim(whole / 1_000_000_000)}bn`;
  if (Math.abs(whole) >= 1_000_000) return `₦${trim(whole / 1_000_000)}m`;
  if (Math.abs(whole) >= 100_000) return `₦${trim(whole / 1_000)}k`;
  return naira(amount);
}

/** An address, short enough to read aloud. */
export const shortAddress = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** A hash, short enough to compare by eye. */
export const shortHash = (hash: string): string => `${hash.slice(0, 10)}…${hash.slice(-6)}`;

/** How long something has been going on, in the words a person would use. */
export function age(since: bigint, now: number): string {
  return duration(now - Number(since));
}

/**
 * How long is left, or how long it is overdue.
 *
 * A deadline that has passed is the whole point of this protocol, so it is never rendered as a
 * negative: it is rendered as the sentence somebody has to answer for.
 */
export function untilDeadline(deadline: bigint, now: number): { text: string; overdue: boolean } {
  const seconds = Number(deadline) - now;
  return seconds >= 0
    ? { text: `${duration(seconds)} left`, overdue: false }
    : { text: `overdue by ${duration(-seconds)}`, overdue: true };
}

/**
 * How long a window has left, or how long ago it shut.
 *
 * Not the same sentence as a debt's deadline, and it must never borrow it. A debt that runs out of time
 * has *failed* — somebody is late and somebody answers for it. A challenge window that runs out has
 * simply closed, and closing is the ordinary, expected end: it means nobody objected. Calling that
 * "overdue" accuses a party who did nothing wrong, and reads as an alarm where there is none.
 */
export function windowLeft(deadline: bigint, now: number): { text: string; closed: boolean } {
  const seconds = Number(deadline) - now;
  return seconds >= 0
    ? { text: `${duration(seconds)} left`, closed: false }
    : { text: `closed ${duration(-seconds)} ago`, closed: true };
}

function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

/** A timestamp, as a date somebody could testify to. */
export const when = (timestamp: bigint): string =>
  new Date(Number(timestamp) * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** Who a debt is owed to. */
export const ROLES = ["creator", "landlord", "community", "operator", "buyer"] as const;
export type Role = (typeof ROLES)[number];

/** How the money for a sale reached the parties. */
export const RAILS = ["instant", "cash"] as const;

/** The life of a debt. Time flows only toward default: a debt never expires into paid. */
export const DEBT_STATES = [
  "none",
  "aging",
  "claimed",
  "settled",
  "proven",
  "defaulted",
  "discharged",
  "retained",
] as const;
export type DebtState = (typeof DEBT_STATES)[number];

/** What each state of a debt means, for someone who is owed money. */
export const DEBT_STATE_MEANING: Record<DebtState, string> = {
  none: "—",
  aging: "Owed, unpaid, and on the clock. If the deadline passes, the pool pays it and Good is written down.",
  claimed: "Good says it has paid this. The recipient has a window to say otherwise, from her own key.",
  settled: "The window closed with nobody objecting. Still owed evidence at the sweep.",
  proven: "Backed by evidence. This is the only state that earns Good any capacity.",
  defaulted: "The deadline passed. The pool paid the recipient in full, and Good's allowance was written down fivefold.",
  discharged: "Extinguished by performance — the item was delivered, so the refund it guaranteed is owed to nobody.",
  retained: "Good's own commission. The payer and the payee are the same party, so nothing was ever owed outward.",
};

/**
 * The buckets the debt census counts in.
 *
 * Eight raw states are more than a reader needs, and two of them ("aging" overdue vs not) are the same
 * state either side of a deadline — so the pages group them. This is the single definition of that
 * grouping: every census figure and every filter goes through it, which is the only way the number in
 * the band and the rows in the table can be guaranteed to agree.
 */
export type DebtBucket = "inDefault" | "clock" | "proven" | "commission" | "resolved";

export function debtBucket(debt: { state: DebtState; deadline: bigint }, now: number): DebtBucket {
  if (debt.state === "aging" && untilDeadline(debt.deadline, now).overdue) return "inDefault";
  if (debt.state === "aging" || debt.state === "claimed" || debt.state === "settled") return "clock";
  if (debt.state === "proven") return "proven";
  if (debt.state === "retained") return "commission";
  return "resolved";
}

export const DEBT_BUCKETS: { value: DebtBucket; label: string }[] = [
  { value: "inDefault", label: "In default" },
  { value: "clock", label: "On the clock" },
  { value: "proven", label: "Proven" },
  { value: "commission", label: "Commission" },
  { value: "resolved", label: "Resolved" },
];

/** The life of a claim. */
export const CLAIM_STATES = ["none", "pending", "challenged", "settled", "proven", "voided"] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];
