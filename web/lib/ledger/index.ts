/**
 * The ledger, read.
 *
 * Every number on the ledger page comes from here, and everything here comes from the chain: view
 * calls and event logs over a public RPC. There is no operator endpoint in this module, deliberately —
 * a public ledger that goes blank when the shop closes is a dashboard, and a dashboard proves nothing.
 * Stop the operator and this page keeps updating; the debts go on aging, because aging is what time
 * does to them, not what a server says about them.
 */

import { parseEventLogs, type Address, type Hex, type Log } from "viem";

import { abi, publicClient, type Deployment } from "@/lib/chain";
import { ITEM_STATES, type ItemState } from "@/lib/verify";
import {
  CLAIM_STATES,
  DEBT_STATES,
  RAILS,
  ROLES,
  naira,
  shortAddress,
  type ClaimState,
  type DebtState,
  type Role,
} from "@/lib/format";

export type Debt = {
  id: bigint;
  itemId: bigint;
  recipient: Address;
  role: Role;
  rail: (typeof RAILS)[number];
  state: DebtState;
  mintedAt: bigint;
  deadline: bigint;
  amount: bigint;
};

export type Claim = {
  id: bigint;
  state: ClaimState;
  postedAt: bigint;
  challengeDeadline: bigint;
  responseDeadline: bigint;
  coverageDeadline: bigint;
  totalAmount: bigint;
  refHash: Hex;
  debtIds: readonly bigint[];
};

export type Item = {
  id: bigint;
  name: string;
  state: ItemState;
  price: bigint;
  owner: Address;
};

/** The till, in four numbers — and the three the used one is made of. */
export type Ceiling = {
  ceiling: bigint;
  used: bigint;
  headroom: bigint;
  allowance: bigint;
  frozen: boolean;
  custody: bigint;
  reimbursements: bigint;
  unpaidFines: bigint;
};

export type Pool = {
  balance: bigint;
  dues: bigint;
};

/** A write-off, with the two numbers that make the argument, straight out of the event. */
export type WriteOff = {
  itemId: bigint;
  price: bigint;
  paidAsSold: bigint;
  penalty: bigint;
  honestCommission: bigint;
  launderedNet: bigint;
};

export type Entry = {
  key: string;
  block: bigint;
  at: bigint;
  name: string;
  sentence: string;
  tone: "plain" | "good" | "warn" | "alarm" | "quiet";
  /** Whose business this was, when the log names somebody. */
  who?: Address;
};

export type Snapshot = {
  now: number;
  items: Item[];
  debts: Debt[];
  claims: Claim[];
  ceiling: Ceiling;
  pool: Pool;
  writeOffs: WriteOff[];
  entries: Entry[];
  /** Who holds which role, learned from the debts themselves rather than assumed. */
  roleOf: Map<string, Role>;
};

type Consignment = { items: { id: number; price: string }[] };

export async function readLedger(where: Deployment, consignment: Consignment): Promise<Snapshot> {
  const [block, debtCount, claimCount] = await Promise.all([
    publicClient.getBlock(),
    publicClient.readContract({ address: where.debts, abi: abi.debts, functionName: "debtCount" }),
    publicClient.readContract({ address: where.debts, abi: abi.debts, functionName: "claimCount" }),
  ]);

  const [items, debts, claims, ceiling, pool, logs] = await Promise.all([
    readItems(where, consignment),
    readDebts(where, debtCount),
    readClaims(where, claimCount),
    readCeiling(where),
    readPool(where),
    publicClient.getLogs({
      address: [where.registry, where.items, where.prices, where.gateway, where.debts, where.sweep, where.pool, where.ceiling],
      fromBlock: 0n,
      toBlock: "latest",
    }),
  ]);

  const roleOf = new Map<string, Role>();
  for (const debt of debts) roleOf.set(debt.recipient.toLowerCase(), debt.role);
  roleOf.set(where.operatorRecipient.toLowerCase(), "operator");

  const { entries, writeOffs } = await narrate(logs);

  return {
    now: Number(block.timestamp),
    items,
    debts,
    claims,
    ceiling,
    pool,
    writeOffs,
    entries,
    roleOf,
  };
}

async function readItems(where: Deployment, consignment: Consignment): Promise<Item[]> {
  return Promise.all(
    consignment.items.map(async ({ id }) => {
      const itemId = BigInt(id);
      const [item, price] = await Promise.all([
        publicClient.readContract({
          address: where.items,
          abi: abi.items,
          functionName: "itemOf",
          args: [itemId],
        }),
        publicClient.readContract({
          address: where.prices,
          abi: abi.prices,
          functionName: "effectivePrice",
          args: [itemId],
        }),
      ]);

      return {
        id: itemId,
        name: `Dress ${id - 1000}`,
        state: ITEM_STATES[item.state] ?? "ABSENT",
        price,
        owner: item.owner,
      };
    }),
  );
}

async function readDebts(where: Deployment, count: bigint): Promise<Debt[]> {
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));

  return Promise.all(
    ids.map(async (id) => {
      const debt = await publicClient.readContract({
        address: where.debts,
        abi: abi.debts,
        functionName: "debt",
        args: [id],
      });

      return {
        id,
        itemId: debt.saleRef,
        recipient: debt.recipient,
        role: ROLES[debt.role],
        rail: RAILS[debt.rail],
        state: DEBT_STATES[debt.state],
        mintedAt: debt.mintedAt,
        deadline: debt.deadline,
        amount: debt.amount,
      };
    }),
  );
}

async function readClaims(where: Deployment, count: bigint): Promise<Claim[]> {
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));

  return Promise.all(
    ids.map(async (id) => {
      const [claim, debtIds, coverage] = await Promise.all([
        publicClient.readContract({ address: where.debts, abi: abi.debts, functionName: "claim", args: [id] }),
        publicClient.readContract({ address: where.debts, abi: abi.debts, functionName: "claimDebts", args: [id] }),
        publicClient.readContract({
          address: where.sweep,
          abi: abi.sweep,
          functionName: "coverageDeadline",
          args: [id],
        }),
      ]);

      return {
        id,
        state: CLAIM_STATES[claim.state],
        postedAt: claim.postedAt,
        challengeDeadline: claim.challengeDeadline,
        responseDeadline: claim.responseDeadline,
        coverageDeadline: coverage,
        totalAmount: claim.totalAmount,
        refHash: claim.refHash,
        debtIds,
      };
    }),
  );
}

async function readCeiling(where: Deployment): Promise<Ceiling> {
  const read = <T extends "ceiling" | "used" | "headroom" | "allowance" | "frozen">(functionName: T) =>
    publicClient.readContract({ address: where.ceiling, abi: abi.ceiling, functionName });

  const [ceiling, used, headroom, allowance, frozen, custody, reimbursements, fines] = await Promise.all([
    read("ceiling"),
    read("used"),
    read("headroom"),
    read("allowance"),
    read("frozen"),
    publicClient.readContract({ address: where.debts, abi: abi.debts, functionName: "outstanding" }),
    publicClient.readContract({ address: where.pool, abi: abi.pool, functionName: "reimbursementOutstanding" }),
    publicClient.readContract({ address: where.pool, abi: abi.pool, functionName: "penaltiesOutstanding" }),
  ]);

  return {
    ceiling,
    used,
    headroom,
    allowance,
    frozen,
    custody,
    reimbursements,
    unpaidFines: fines,
  };
}

async function readPool(where: Deployment): Promise<Pool> {
  const [balance, dues] = await Promise.all([
    publicClient.readContract({ address: where.pool, abi: abi.pool, functionName: "balance" }),
    publicClient.readContract({ address: where.pool, abi: abi.pool, functionName: "poolDuesOwed" }),
  ]);
  return { balance, dues };
}

/**
 * The event log, as sentences.
 *
 * If a transition has no event, the transition is incomplete — so everything that ever happened is in
 * here, and the job of this function is to say what each thing *was*, in words. A log line nobody can
 * read is a log line nobody checks.
 */
async function narrate(logs: Log[]): Promise<{ entries: Entry[]; writeOffs: WriteOff[] }> {
  const parsed = parseEventLogs({
    abi: [
      ...abi.registry,
      ...abi.items,
      ...abi.prices,
      ...abi.gateway,
      ...abi.debts,
      ...abi.sweep,
      ...abi.pool,
      ...abi.ceiling,
    ],
    logs,
  });

  const blocks = new Map<bigint, bigint>();
  await Promise.all(
    [...new Set(parsed.map((log) => log.blockNumber))].map(async (blockNumber) => {
      const block = await publicClient.getBlock({ blockNumber });
      blocks.set(blockNumber, block.timestamp);
    }),
  );

  const writeOffs: WriteOff[] = [];
  const entries: Entry[] = [];

  for (const log of parsed) {
    const args = (log.args ?? {}) as Record<string, unknown>;
    const said = sentenceFor(log.eventName, args);
    if (!said) continue;

    if (log.eventName === "Burned") {
      writeOffs.push({
        itemId: args.itemId as bigint,
        price: args.price as bigint,
        paidAsSold: args.paidAsSold as bigint,
        penalty: args.penalty as bigint,
        honestCommission: args.honestCommission as bigint,
        launderedNet: args.launderedNet as bigint,
      });
    }

    entries.push({
      key: `${log.transactionHash}-${log.logIndex}`,
      block: log.blockNumber,
      at: blocks.get(log.blockNumber) ?? 0n,
      name: log.eventName,
      sentence: said.sentence,
      tone: said.tone,
      who: said.who ?? (args.recipient as Address | undefined),
    });
  }

  entries.reverse();
  return { entries, writeOffs };
}

type Said = { sentence: string; tone: Entry["tone"]; who?: Address };

const money = (value: unknown) => (typeof value === "bigint" ? naira(value) : "—");

const who = (value: unknown) => (typeof value === "string" ? shortAddress(value) : "somebody");

/**
 * What each event was.
 *
 * The tone matters as much as the words: this ledger is read in a room, and the two things an audience
 * has to be able to see at a glance are that a debt has gone unpaid, and that a stranger — not the
 * person who was wronged — is the one who collected it.
 */
function sentenceFor(name: string, args: Record<string, unknown>): Said | undefined {
  switch (name) {
    case "CreatorRegistered":
      return { sentence: `Creator #${args.creatorId} registered her signing key.`, tone: "quiet" };
    case "TranchePosted":
      return {
        sentence: `A consignment of ${args.itemCount} items was posted — one root, and every tag under it is now sellable.`,
        tone: "plain",
      };
    case "PriceSeeded":
      return { sentence: `The creator priced item ${args.itemId} at ${money(args.price)}.`, tone: "quiet" };
    case "PriceUpdateScheduled":
      return {
        sentence: `The creator posted a new price for item ${args.itemId}. It is public now and takes effect at the next epoch boundary — never retroactively, and never on an item already sold.`,
        tone: "quiet",
      };
    case "Sold":
      return {
        sentence:
          `Item ${args.itemId} sold for ${money(args.price)} on the ${args.rail === 0 ? "instant" : "cash"} rail. ` +
          `${(args.debtIds as unknown[]).length} debts minted in the same transaction.`,
        tone: "plain",
      };
    case "DebtMinted":
      return {
        sentence: `Debt #${args.debtId}: ${money(args.amount)} owed to the ${ROLES[Number(args.role)]}.`,
        tone: "quiet",
      };
    case "CertificateIssued":
      return { sentence: `A certificate for item ${args.itemId} was committed, with a claim code on the receipt.`, tone: "quiet" };
    case "CertificateRedeemed":
      return { sentence: `${who(args.owner)} redeemed the certificate for item ${args.itemId} with the code from her receipt.`, tone: "good" };
    case "Committed":
      return {
        sentence: `${who(args.buyer)} ordered item ${args.itemId} for ${money(args.price)}. The shop is on the clock to hand it over — and the refund it owes if it cannot is already minted, as debt #${args.refundDebtId}.`,
        tone: "warn",
      };
    case "Fulfilled":
      return { sentence: `Item ${args.itemId} was handed over. The refund it guaranteed is owed to nobody now.`, tone: "good" };
    case "CommitmentExpired":
      return {
        sentence: `The shop missed its deadline on item ${args.itemId}. ${who(args.buyer)}'s refund (debt #${args.refundDebtId}) is now collectable by anyone.`,
        tone: "alarm",
      };
    case "ClaimPosted":
      return {
        sentence: `Good claims it has paid ${money(args.totalAmount)} across ${(args.debtIds as unknown[]).length} debts. Anybody owed by them can now say otherwise.`,
        tone: "plain",
      };
    case "ClaimChallenged":
      return { sentence: `${who(args.challenger)} says she was not paid. Good has until the response deadline to prove it was.`, tone: "warn" };
    case "ClaimSettled":
      return { sentence: `Claim #${args.claimId} settled: the window closed and nobody objected.`, tone: "plain" };
    case "ClaimProven":
      return { sentence: `Claim #${args.claimId} is backed by evidence. This — and only this — earns Good capacity.`, tone: "good" };
    case "ClaimVoided":
      return {
        sentence: `Claim #${args.claimId} died. Good said it had paid and could not prove it: a fine of ${money(args.totalPenalty)}, and every debt underneath goes back to aging from the day it was born.`,
        tone: "alarm",
      };
    case "PenaltyAccrued":
      return { sentence: `The fine falls due: ${money(args.toRecipient)} to the party who was lied about, ${money(args.toPool)} to the pool.`, tone: "alarm" };
    case "DebtDefaulted":
      return { sentence: `Debt #${args.debtId} is in default. ${money(args.amount)} was owed and the deadline passed.`, tone: "alarm" };
    case "ObligationDischarged":
      return { sentence: `Debt #${args.debtId} was extinguished by performance.`, tone: "quiet" };
    case "DefaultCovered":
      return {
        sentence:
          `${who(args.by)} — a stranger, with nothing at stake — collected the default on debt #${args.debtId}. ` +
          `The pool paid ${money(args.paid)} to ${who(args.recipient)}, and Good's allowance was written down ${money(args.writtenDown)}. ` +
          `The person who was owed the money sent nothing.`,
        tone: "alarm",
        who: args.by as Address,
      };
    case "PoolShortfall":
      return { sentence: `The pool was short: ${money(args.unpaid)} of what was owed could not be paid.`, tone: "alarm" };
    case "CoverageLapsed":
      return { sentence: `Claim #${args.claimId} was never backed by evidence, and its coverage deadline has passed. It dies.`, tone: "alarm" };
    case "AttestationPosted":
      return { sentence: `Good swept: ${args.claimsCovered} of ${args.claimsSubmitted} claims backed by one piece of evidence.`, tone: "plain" };
    case "ClaimCovered":
      return { sentence: `Claim #${args.claimId} was covered by the sweep.`, tone: "quiet" };
    case "ClaimUncovered":
      return { sentence: `Claim #${args.claimId} was submitted to the sweep and the evidence did not reach it. The clock keeps running.`, tone: "warn" };
    case "AllowanceGrew":
      return { sentence: `Good earned ${money(args.growth)} of capacity by proving it paid ${money(args.settledValue)}.`, tone: "good" };
    case "AllowanceWrittenDown":
      return { sentence: `Good's allowance was written down ${money(args.applied)} for a default of ${money(args.defaulted)} — five times the harm.`, tone: "alarm" };
    case "FreezeLifted":
      return { sentence: `Good repaid the pool. Its allowance can grow again — from now, never for the time it lost.`, tone: "good" };
    case "SkimDeposited":
      return { sentence: `${money(args.amount)} into the pool. The fund that pays when Good does not.`, tone: "quiet" };
    case "Reimbursed":
      return { sentence: `Good repaid the pool ${money(args.amount)}. The write-down stands.`, tone: "plain" };
    case "PenaltyPaid":
      return { sentence: `Good paid its fine: ${money(args.amount)} to ${who(args.recipient)}.`, tone: "plain" };
    case "PoolDuesCollected":
      return { sentence: `The pool collected ${money(args.amount)} in fees Good owed it.`, tone: "quiet" };
    case "WriteOffAccrued":
      return { sentence: `The write-off's fee falls due to the pool: ${money(args.owed)}.`, tone: "warn" };
    case "Burned":
      return {
        sentence:
          `Item ${args.itemId} was written off. Good paid ${money(args.paidAsSold)} — everybody's share, as if it had sold — ` +
          `plus a ${money(args.penalty)} fee. Selling it off the books and calling it shrinkage nets ${money(args.launderedNet)}; ` +
          `honesty would have paid ${money(args.honestCommission)}.`,
        tone: "warn",
      };
    case "ItemBurned":
    case "ItemSold":
    case "ItemOwned":
    case "ItemCommitted":
    case "CommitmentReleased":
    case "DebtStateChanged":
    case "AccountHashSet":
      return undefined; // Said better by the events above, which carry the money as well as the fact.
    default:
      return undefined; // Deployment wiring: one-shot setters, said once, at the start of time.
  }
}
