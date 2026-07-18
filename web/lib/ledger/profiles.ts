/**
 * Profiles, derived — never registered.
 *
 * The protocol registers exactly one kind of identity: a creator and her signing key. Everybody else
 * *is what the ledger can prove about them*: a landlord is the address the creator's tranche names,
 * which registered its own payout account and which these debts paid or defaulted on; a community
 * owner is the address the 2.5% legs minted against, voucher by voucher. So a profile page is not a
 * lookup, it is a derivation over the same public facts every other page reads.
 *
 * Every figure here is an absolute count or amount, on purpose. A rate has a denominator, and a
 * denominator is what a farmer manufactures — the ledger's own rule, applied to people as it is to
 * the shop.
 */

import type { Address } from "viem";

import type { Debt, Entry, Holdings, Tranche } from "./index";
import type { Role } from "@/lib/format";

/** What a set of debts adds up to for the person they name. Absolute numbers only. */
export type Purse = {
  /** Owed and live right now: aging, claimed, or settled-but-unproven. */
  owedNow: bigint;
  owedCount: number;
  /** Backed by evidence that had to name their account. */
  proven: bigint;
  provenCount: number;
  /** The deadline passed; the pool paid them in full and Good was written down. */
  defaulted: bigint;
  defaultedCount: number;
  /** Everything ever minted in their name. */
  minted: bigint;
  mintedCount: number;
};

export function purseOf(debts: Debt[]): Purse {
  const purse: Purse = {
    owedNow: 0n,
    owedCount: 0,
    proven: 0n,
    provenCount: 0,
    defaulted: 0n,
    defaultedCount: 0,
    minted: 0n,
    mintedCount: 0,
  };

  for (const debt of debts) {
    purse.minted += debt.amount;
    purse.mintedCount += 1;
    if (debt.state === "aging" || debt.state === "claimed" || debt.state === "settled") {
      purse.owedNow += debt.amount;
      purse.owedCount += 1;
    } else if (debt.state === "proven") {
      purse.proven += debt.amount;
      purse.provenCount += 1;
    } else if (debt.state === "defaulted") {
      purse.defaulted += debt.amount;
      purse.defaultedCount += 1;
    }
  }

  return purse;
}

/** One person, one address, and everything the ledger can prove about them. */
export type Profile = {
  address: Address;
  /** Every role their debts have named them in — one address can hold several. */
  roles: Role[];
  /** The tranches that name them as landlord, if any: their locations, said by the creator's paperwork. */
  tranches: Tranche[];
  debts: Debt[];
  purse: Purse;
};

const lower = (address: string) => address.toLowerCase();

/** The profile of one address, derived from the holdings. Exists for any address; empty for a stranger. */
export function profileOf(holdings: Holdings, address: string): Profile {
  const debts = holdings.debts.filter((d) => lower(d.recipient) === lower(address));
  const tranches = holdings.tranches.filter((t) => lower(t.landlord) === lower(address));

  const roles: Role[] = [];
  for (const debt of debts) if (!roles.includes(debt.role)) roles.push(debt.role);
  if (tranches.length > 0 && !roles.includes("landlord")) roles.push("landlord");

  return { address: (debts[0]?.recipient ?? tranches[0]?.landlord ?? address) as Address, roles, tranches, debts, purse: purseOf(debts) };
}

/**
 * Everyone a role's money has ever named, one profile each.
 *
 * Landlords are found twice over — named by a tranche, or paid by a leg — because a tranche whose
 * items have not sold yet has a landlord with no debts, and he still exists.
 */
export function profilesOf(holdings: Holdings, role: Role): Profile[] {
  const addresses = new Set<string>();
  for (const debt of holdings.debts) if (debt.role === role) addresses.add(lower(debt.recipient));
  if (role === "landlord") for (const tranche of holdings.tranches) addresses.add(lower(tranche.landlord));

  return [...addresses]
    .map((address) => profileOf(holdings, address))
    .sort((a, b) => (b.purse.minted > a.purse.minted ? 1 : b.purse.minted < a.purse.minted ? -1 : 0));
}

/** The history, cut down to the lines that are one subject's business. */
export function linesAbout(
  entries: Entry[],
  about: {
    address?: string;
    creatorId?: bigint;
    trancheId?: bigint;
    itemIds?: Set<bigint>;
    debtIds?: Set<bigint>;
    claimIds?: Set<bigint>;
  },
): Entry[] {
  const address = about.address ? lower(about.address) : undefined;

  return entries.filter(
    (e) =>
      (address !== undefined && e.who !== undefined && lower(e.who) === address) ||
      (about.creatorId !== undefined && e.creatorId === about.creatorId) ||
      (about.trancheId !== undefined && e.trancheId === about.trancheId) ||
      (e.itemId !== undefined && about.itemIds?.has(e.itemId)) ||
      (e.debtId !== undefined && about.debtIds?.has(e.debtId)) ||
      (e.claimId !== undefined && about.claimIds?.has(e.claimId)),
  );
}

/** The claims that touch any of these debts — how an item's money got asserted about. */
export function claimsTouching(holdings: Holdings, debtIds: Set<bigint>): Holdings["claims"] {
  return holdings.claims.filter((claim) => claim.debtIds.some((id) => debtIds.has(id)));
}
