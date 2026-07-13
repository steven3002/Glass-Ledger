/**
 * Refusals, in English.
 *
 * Half of what this protocol does is refuse things, and a refusal nobody can read is a refusal nobody
 * can check. So every revert is decoded by name out of the contracts' own ABIs — the same artifacts
 * the chain was deployed from — and rendered as the rule it stands for. The page never says "execution
 * reverted", and it never carries its own list of what the errors are: an error added to a contract is
 * legible here the moment the contracts are compiled.
 *
 * The sentences below are the only thing this module adds. Everything else — the name, the arguments —
 * comes from the chain.
 */

import { BaseError, ContractFunctionRevertedError, formatUnits, type Abi } from "viem";

import { abi } from "./generated/abi";

export type Refusal = {
  /** The custom error's name, exactly as the contract declares it. */
  name: string;
  /** What the rule means, written for someone who has never read a contract. */
  sentence: string;
  /** The arguments the contract reverted with, formatted for display. */
  detail?: string;
};

/** Every ABI the surfaces might meet a revert from. Errors are looked up across all of them. */
const ABIS: Abi[] = Object.values(abi) as Abi[];

const naira = (value: unknown) =>
  typeof value === "bigint" ? `₦${Number(formatUnits(value, 18)).toLocaleString("en-NG")}` : String(value);

/**
 * What each rule means. The protocol's refusals are its argument, so they are written out in full:
 * a buyer who is told "no" is owed the reason, and the reason is always a rule that was published
 * before they walked in.
 */
function explain(name: string, args: readonly unknown[]): Refusal {
  switch (name) {
    case "AlreadySold":
      return {
        name,
        sentence:
          "This tag has already been used. An item can be sold exactly once, and the ledger will not " +
          "sell it a second time — which is what makes a cloned tag worthless.",
        detail: `item ${args[0]}`,
      };
    case "UnknownCreatorSignature":
      return {
        name,
        sentence:
          "No registered creator signed this tag. The signature on it recovers to a key the registry " +
          "has never heard of, so nothing here was ever consigned by anybody.",
      };
    case "UnknownCreator":
      return { name, sentence: "The creator this tag names is not registered.", detail: `creator ${args[0]}` };
    case "NotInTranche":
      return {
        name,
        sentence:
          "This item is not in the consignment it claims to be part of. The tranche's root does not " +
          "commit to this tag, so the shop never took it in.",
        detail: `item ${args[0]}, tranche ${args[1]}`,
      };
    case "CreatorMismatch":
      return {
        name,
        sentence: "The voucher was signed by one creator and the consignment belongs to another.",
      };
    case "UnknownSplitPolicy":
      return {
        name,
        sentence:
          "The split this tag was signed under is not the split this shop pays. The paper and the " +
          "shelf have to agree about what the creator was promised.",
      };
    case "OverCeiling":
      return {
        name,
        sentence:
          "The sale is refused: it would put more of other people's money in the operator's hands than " +
          "the operator is currently trusted to hold. The ceiling is the pool plus the earned allowance, " +
          "and it is checked before the item can leave the shelf.",
        detail: `this sale needs ${naira(args[0])} of headroom; ${naira(args[1])} is left`,
      };
    case "ItemReserved":
      return {
        name,
        sentence: "Somebody has already ordered this item and the shop has not yet handed it over.",
        detail: `item ${args[0]}`,
      };
    case "NoAccountOnFile":
      return {
        name,
        sentence:
          "One of the people this sale would pay has never registered an account to be paid into. On " +
          "the instant rail the sale asserts the rail already paid them — and it cannot assert a " +
          "payment to an account that does not exist.",
      };
    case "InvalidCommunityVoucher":
      return { name, sentence: "The referral voucher presented at checkout is not a valid one." };
    case "BadClaimCode":
      return {
        name,
        sentence: "That is not the code on the receipt for this item. The certificate stays where it is.",
        detail: `item ${args[0]}`,
      };
    case "NoCertificate":
      return { name, sentence: "No certificate was ever issued for this item.", detail: `item ${args[0]}` };
    case "ProofRejected":
      return {
        name,
        sentence:
          "The proof the operator offered does not establish the payment it claimed. The claim dies, " +
          "and the debt goes back to aging from the moment it always aged from.",
        detail: `claim ${args[0]}`,
      };
    case "NotDefaulted":
      return { name, sentence: "This debt is not in default yet — its deadline has not passed." };
    case "ClaimNotLive":
      return { name, sentence: "This claim is already finished with: it has been settled, proven or voided." };
    case "CoverageWindowOpen":
      return {
        name,
        sentence: "The operator still has time to back this claim with evidence. The coverage deadline has not passed.",
      };
    case "GrowthFrozen":
      return {
        name,
        sentence:
          "The operator's allowance cannot grow while it owes the pool for a default it caused. " +
          "Capacity is bought with proof, and a defaulter is not buying any.",
      };
    default:
      return {
        name,
        sentence: `The contracts refused this: ${name}.`,
        detail: args.length ? args.map(String).join(", ") : undefined,
      };
  }
}

/**
 * Pulls the named rule out of whatever viem threw.
 *
 * Returns undefined when the failure was not a contract refusal at all — an RPC that cannot be
 * reached is a different kind of problem and must not be dressed up as one of the protocol's rules.
 */
export function refusalOf(error: unknown): Refusal | undefined {
  if (!(error instanceof BaseError)) return undefined;

  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(reverted instanceof ContractFunctionRevertedError)) return undefined;

  if (reverted.data?.errorName) {
    return explain(reverted.data.errorName, reverted.data.args ?? []);
  }

  // A refusal viem could not name against the ABI it was handed. Simulations here are always given
  // `withProtocolErrors`, so this means the revert came from somewhere outside the protocol.
  return undefined;
}

/**
 * Every custom error every contract in the set declares.
 *
 * A sale reverts through four contracts — the gateway calls the registry, the item ledger and the
 * ceiling — and viem can only name an error it was given the shape of. So a simulation is handed the
 * whole protocol's error list, and the refusal comes back with the name the contract that raised it
 * gave it, whichever contract that was.
 */
export const protocolErrors = ABIS.flatMap((each) => each.filter((entry) => entry.type === "error"));

const ERROR_NAMES = [
  ...new Set(protocolErrors.map((entry) => ("name" in entry && entry.name) as string).filter(Boolean)),
];

/**
 * The same rule, recovered from a refusal that came back as text.
 *
 * The one write this page performs is the sale, and the operator sponsors it — so that refusal arrives
 * over HTTP rather than from an `eth_call`, already decoded by the relayer against these same ABIs
 * (`AlreadySold(1007)`). The name is the part that matters and the name is the part that is trustworthy:
 * it is the contract's, not the operator's. This finds it and says what it means, so the buyer gets the
 * published rule and not a log line.
 *
 * If the message carries no rule the contracts declare, nothing is invented — a shop that is simply
 * unreachable must not be dressed up as a shop that refused you.
 */
export function refusalFromMessage(message: string): Refusal | undefined {
  const name = ERROR_NAMES.find((each) => message.includes(`${each}(`));
  if (!name) return undefined;

  const args = message
    .slice(message.indexOf(`${name}(`) + name.length + 1)
    .split(")")[0]
    .split(",")
    .map((arg) => arg.trim())
    .filter(Boolean)
    .map((arg) => (/^\d+$/.test(arg) ? BigInt(arg) : arg));

  return explain(name, args);
}

/** The contract's own ABI, plus every error any contract it calls might refuse with. */
export function withProtocolErrors<T extends Abi>(contractAbi: T): Abi {
  return [...contractAbi, ...protocolErrors];
}

/** The rule, or a plain sentence about a failure that was not the protocol's doing. */
export function refusalMessage(error: unknown): string {
  const refusal = refusalOf(error);
  if (refusal) return refusal.detail ? `${refusal.sentence} (${refusal.detail})` : refusal.sentence;
  return error instanceof Error ? error.message : String(error);
}
