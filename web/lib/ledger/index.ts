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
  creatorId: bigint;
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
  /** The tranche the chain's lazy slot names — 0 until the item is touched; the paperwork names it sooner. */
  trancheId: bigint;
  committedUntil: bigint;
};

/**
 * A collection, as the chain holds it: one record, one root.
 *
 * This is the whole on-chain footprint of a consignment before anything sells — the items under the
 * root are paperwork until the state machine touches them. The landlord's address and the location
 * label are part of the record itself: the creator's tranche names where it sits and who the 5% leg
 * belongs to, which is the closest thing this protocol has to a landlord "registering".
 */
export type Tranche = {
  id: bigint;
  creatorId: bigint;
  landlord: Address;
  itemCount: number;
  postedAt: bigint;
  root: Hex;
  currency: Hex;
  location: string;
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

/**
 * What the operator may hold of *one creator's* money.
 *
 * There is no single allowance any more, and there is not supposed to be. Capacity is earned with a
 * creator and spendable only on her goods, so the shop can have a wide-open till with one creator and a
 * shut one with another, at the same instant — and a page that printed one number would be printing an
 * average of two answers, neither of which is true.
 */
export type Capacity = {
  creatorId: bigint;
  /** The signing key she registered — her on-chain identity, and the only thing a voucher is checked against. */
  key: Address;
  allowance: bigint;
  outstanding: bigint;
  headroom: bigint;
};

/**
 * Good's record: what it has broken, and what it owes.
 *
 * **This is not a score, and the difference is the whole point.** Any statistic that aggregates across
 * counterparties can be farmed, because a farmer manufactures counterparties — a total can be farmed, an
 * average can be farmed, and a *rate* is worst of all, because a rate has a denominator and the
 * denominator is exactly what gets manufactured. Sell to yourself ten thousand times and watch any
 * ratio you like improve.
 *
 * So every field below is an absolute count or amount, monotone in Good's misbehaviour. You cannot farm
 * a clean record. You can only fail to have failed.
 */
export type FailureRecord = {
  defaults: bigint;
  defaultValue: bigint;
  claimsVoided: bigint;
  owedToPool: bigint;
  penaltiesUnpaid: bigint;
  growthFrozen: boolean;
  poolBalance: bigint;
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
  /** What the log was about, when it names a thing — so a dossier can pull only its own lines. */
  itemId?: bigint;
  debtId?: bigint;
  claimId?: bigint;
  trancheId?: bigint;
  creatorId?: bigint;
};

type Consignment = { items: { id: number; price: string }[] };

/**
 * The ledger is read in three stages, in the order a reader needs them — because waiting for all of it
 * at once means waiting for the slowest part of it, which is the event history: a full log scan from
 * the first block plus a timestamp read per block anything happened in.
 *
 *   1. the cage      the till, the record, the pool, the per-creator capacity. A handful of reads, and
 *                    the headline of the whole page. It lands first, so the cage is on screen while the
 *                    rest is still coming.
 *   2. the holdings  the shelf, the debts and their ages, the claims. The body of the ledger.
 *   3. the history   every event ever, narrated. The heaviest read, and the least urgent — a reader has
 *                    already seen the state before they read the story of how it got there.
 *
 * They are fetched in parallel and rendered as each arrives; the page holds a skeleton in the place of
 * whichever stage has not answered yet.
 */
export type Cage = {
  now: number;
  ceiling: Ceiling;
  capacity: Capacity[];
  record: FailureRecord;
  pool: Pool;
};

export type Holdings = {
  items: Item[];
  debts: Debt[];
  claims: Claim[];
  tranches: Tranche[];
  /** Who holds which role, learned from the debts themselves rather than assumed. */
  roleOf: Map<string, Role>;
};

export type History = {
  entries: Entry[];
  writeOffs: WriteOff[];
};

/** Stage 1 — the cage: the till, the record, the pool, the capacity. First on screen. */
export async function readCage(where: Deployment): Promise<Cage> {
  const [block, ceiling, capacity, record, pool] = await Promise.all([
    publicClient.getBlock(),
    readCeiling(where),
    readCapacity(where),
    readRecord(where),
    readPool(where),
  ]);
  return { now: Number(block.timestamp), ceiling, capacity, record, pool };
}

/** Stage 2 — the holdings: the shelf, the debts, the claims. */
export async function readHoldings(where: Deployment, consignment: Consignment): Promise<Holdings> {
  const [debtCount, claimCount] = await Promise.all([
    publicClient.readContract({ address: where.debts, abi: abi.debts, functionName: "debtCount" }),
    publicClient.readContract({ address: where.debts, abi: abi.debts, functionName: "claimCount" }),
  ]);

  const [items, debts, claims, tranches] = await Promise.all([
    readItems(where, consignment),
    readDebts(where, debtCount),
    readClaims(where, claimCount),
    readTranches(where),
  ]);

  const roleOf = new Map<string, Role>();
  for (const debt of debts) roleOf.set(debt.recipient.toLowerCase(), debt.role);
  roleOf.set(where.operatorRecipient.toLowerCase(), "operator");

  return { items, debts, claims, tranches, roleOf };
}

/** Stage 3 — the history: every event ever, narrated. The heaviest read, and the last needed. */
export async function readHistory(where: Deployment): Promise<History> {
  const logs = await publicClient.getLogs({
    address: [where.registry, where.items, where.prices, where.gateway, where.debts, where.sweep, where.pool, where.ceiling],
    fromBlock: 0n,
    toBlock: "latest",
  });
  return narrate(logs);
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
        name: `Item ${id - 1000}`,
        state: ITEM_STATES[item.state] ?? "ABSENT",
        price,
        owner: item.owner,
        trancheId: item.trancheId,
        committedUntil: item.committedUntil,
      };
    }),
  );
}

/** Every consignment the chain holds: the record, and the location label posted with it. */
async function readTranches(where: Deployment): Promise<Tranche[]> {
  const count = await publicClient.readContract({
    address: where.items,
    abi: abi.items,
    functionName: "trancheCount",
  });

  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));

  return Promise.all(
    ids.map(async (id) => {
      const [tranche, location] = await Promise.all([
        publicClient.readContract({ address: where.items, abi: abi.items, functionName: "tranche", args: [id] }),
        publicClient.readContract({ address: where.items, abi: abi.items, functionName: "locationOf", args: [id] }),
      ]);

      return {
        id,
        creatorId: tranche.creatorId,
        landlord: tranche.landlord,
        itemCount: Number(tranche.itemCount),
        postedAt: tranche.postedAt,
        root: tranche.root,
        currency: tranche.currency,
        location,
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
        creatorId: debt.creatorId,
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
  const read = <T extends "ceiling" | "used" | "headroom" | "totalAllowance" | "frozen">(functionName: T) =>
    publicClient.readContract({ address: where.ceiling, abi: abi.ceiling, functionName });

  const [ceiling, used, headroom, allowance, frozen, custody, reimbursements, fines] = await Promise.all([
    read("ceiling"),
    read("used"),
    read("headroom"),
    read("totalAllowance"),
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

/**
 * The operator's standing with every creator the registry knows about.
 *
 * The ceiling will answer for a creator it has never heard of too — she stands at her genesis threshold,
 * because that grant belongs to the relationship rather than to Good — but a table of relationships that
 * do not exist would be a table of noise.
 */
async function readCapacity(where: Deployment): Promise<Capacity[]> {
  const creators = await publicClient.readContract({
    address: where.registry,
    abi: abi.registry,
    functionName: "creatorCount",
  });

  const ids = Array.from({ length: Number(creators) }, (_, i) => BigInt(i + 1));

  return Promise.all(
    ids.map(async (creatorId) => {
      const [key, allowance, outstanding, headroom] = await Promise.all([
        publicClient.readContract({
          address: where.registry,
          abi: abi.registry,
          functionName: "keyOf",
          args: [creatorId],
        }),
        publicClient.readContract({
          address: where.ceiling,
          abi: abi.ceiling,
          functionName: "allowanceOf",
          args: [creatorId],
        }),
        publicClient.readContract({
          address: where.debts,
          abi: abi.debts,
          functionName: "outstandingOf",
          args: [creatorId],
        }),
        publicClient.readContract({
          address: where.ceiling,
          abi: abi.ceiling,
          functionName: "headroomOf",
          args: [creatorId],
        }),
      ]);

      return { creatorId, key, allowance, outstanding, headroom };
    }),
  );
}

async function readRecord(where: Deployment): Promise<FailureRecord> {
  return publicClient.readContract({
    address: where.ceiling,
    abi: abi.ceiling,
    functionName: "record",
  });
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
      itemId: big(args.itemId),
      debtId: big(args.debtId),
      claimId: big(args.claimId),
      trancheId: big(args.trancheId),
      creatorId: big(args.creatorId),
    });
  }

  entries.reverse();
  return { entries, writeOffs };
}

type Said = { sentence: string; tone: Entry["tone"]; who?: Address };

const big = (value: unknown): bigint | undefined => (typeof value === "bigint" ? value : undefined);

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
    case "AccountHashSet":
      return {
        sentence: `${who(args.recipient)} put the account they are paid into on file — written from their own key, because a shop that could write that record would be asserting the fact it must later prove.`,
        tone: "quiet",
        who: args.recipient as Address,
      };
    case "ItemBurned":
    case "ItemSold":
    case "ItemOwned":
    case "ItemCommitted":
    case "CommitmentReleased":
    case "DebtStateChanged":
      return undefined; // Said better by the events above, which carry the money as well as the fact.
    default:
      return undefined; // Deployment wiring: one-shot setters, said once, at the start of time.
  }
}
