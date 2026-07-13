/**
 * Independent verification: what a stranger can find out about a tag, using nothing but public
 * infrastructure and their own machine.
 *
 * Four questions, asked in the order the checkout itself asks them:
 *
 *   1. the paperwork    fetch the voucher the tag points at, from public storage
 *   2. the signature    recompute the digest and recover the signer; ask the registry whether that key
 *                       belongs to a creator it has ever heard of
 *   3. the consignment  walk the Merkle path from the leaf to a root, and compare it against the root
 *                       the tranche actually holds on-chain
 *   4. the item         read the item's state — the nullifier *is* the state machine, so "already
 *                       sold" is not a flag somebody sets, it is a door that has closed
 *
 * BOUNDARY RULE — the reason this is its own module. Nothing under lib/verify may import anything that
 * talks to the operator's service: not a client, not a status endpoint, not a type. The claim this
 * product makes is that verification survives Good being switched off, and a claim like that is worth
 * exactly as much as the import graph behind it. It is enforced in the lint configuration and checked
 * by killing the operator and running these four questions again.
 */

import { getContract, type Address, type Hex } from "viem";

import { abi, CHAIN_ID, publicClient, type Deployment } from "@/lib/chain";
import { rootFrom, verifyMembership } from "./merkle";
import { BACKEND, backendLabel, fetchBlob } from "./storage";
import { parseTag, type Tag } from "./tag";
import { digestOf, signerOf, voucherOf, type PublishedVoucher } from "./voucher";

export { rootFrom, Tree, verifyMembership } from "./merkle";
export { BACKEND, backendLabel } from "./storage";
export { encodeTag, parseTag, type Tag } from "./tag";
export { digestOf, forge, voucherOf, type PublishedVoucher, type Voucher } from "./voucher";

/** The item's state machine. The single-use nullifier is this enum: consumption is terminal. */
export const ITEM_STATES = ["ABSENT", "LISTED", "COMMITTED", "SOLD", "OWNED", "BURNED"] as const;
export type ItemState = (typeof ITEM_STATES)[number];

/** One question, and what the chain answered. */
export type Check = {
  title: string;
  passed: boolean;
  /** The finding, in a sentence a non-technical reader can act on. */
  detail: string;
  /** The bytes behind the finding, for a reader who wants to see them. */
  evidence?: { label: string; value: string }[];
};

export type Verdict = "GENUINE" | "FORGED" | "ALREADY_SOLD" | "RESERVED" | "WRITTEN_OFF" | "UNREADABLE";

export type Report = {
  verdict: Verdict;
  /** The headline, written for someone standing in a shop holding a dress. */
  headline: string;
  /** What follows from it — including the contradiction no ledger can resolve for you. */
  meaning: string;
  checks: Check[];
  /** Where the voucher's bytes came from. Named on every report, because it is the firewall. */
  source: string;

  itemId?: bigint;
  trancheId?: bigint;
  state?: ItemState;
  price?: bigint;
  location?: string;
  owner?: Address;
  creatorId?: bigint;
  creatorKey?: Address;
  signer?: Address;
  digest?: Hex;
  root?: Hex;
  computedRoot?: Hex;
  proof?: readonly Hex[];
  voucher?: PublishedVoucher;
};

const ZERO = "0x0000000000000000000000000000000000000000";

const short = (value: string) => `${value.slice(0, 10)}…${value.slice(-8)}`;

/**
 * Verifies a tag against the chain and public storage.
 *
 * It never throws on a bad tag — an unreadable tag is a finding, not a crash — and no branch of it can
 * reach the operator.
 */
export async function verifyTag(payload: string, where: Deployment): Promise<Report> {
  const checks: Check[] = [];
  const source = backendLabel();

  let tag: Tag;
  try {
    tag = parseTag(payload);
  } catch (error) {
    return {
      verdict: "UNREADABLE",
      headline: "This is not a Glass Ledger tag.",
      meaning:
        "Nothing here points at an item, a consignment or a creator. Whatever it is, this ledger has " +
        "never heard of it.",
      checks: [
        { title: "The tag", passed: false, detail: error instanceof Error ? error.message : String(error) },
      ],
      source,
    };
  }

  const itemId = BigInt(tag.item);
  const trancheId = BigInt(tag.tranche);

  // 1 — the paperwork.
  let published: PublishedVoucher;
  try {
    published = await paperwork(tag, checks, source);
  } catch (error) {
    checks.push({
      title: "The paperwork",
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
    });
    return {
      verdict: "FORGED",
      headline: "This tag has no paperwork behind it.",
      meaning:
        "A genuine tag points at a voucher anybody can fetch and check for themselves. This one points " +
        "at bytes nobody ever published.",
      checks,
      itemId,
      trancheId,
      source,
    };
  }

  const voucher = voucherOf(published);

  // 2 — the signature. The digest is recomputed from the voucher's own fields; what the tag *says* the
  // digest is has no standing here.
  const digest = digestOf(voucher, CHAIN_ID, where.registry);
  const signer = await signerOf(voucher, published.signature, CHAIN_ID, where.registry);
  const creatorKey = await registry(where).read.keyOf([voucher.creatorId]);
  const signed = creatorKey !== ZERO && signer.toLowerCase() === creatorKey.toLowerCase();

  checks.push({
    title: "Who signed it",
    passed: signed,
    detail: signed
      ? `Creator #${voucher.creatorId} — the registry has held her signing key since she was ` +
        `registered, and the signature on this tag recovers to it. She signed every word on it, ` +
        `including which item it is and which split she consigned it under.`
      : `Nobody the registry has ever heard of. The signature recovers to ${short(signer)}, and that ` +
        `is not a registered creator's key.`,
    evidence: [
      { label: "the digest she signed", value: digest },
      { label: "recovered signer", value: signer },
      { label: `registry's key for creator #${voucher.creatorId}`, value: creatorKey },
    ],
  });

  if (!signed) {
    return {
      verdict: "FORGED",
      headline: "Forged — no registered creator signed this.",
      meaning:
        "Anybody can print a QR code and sign it with a key of their own, and this one is signed " +
        "perfectly. It simply is not signed by anyone this shop has ever taken stock from. The " +
        "checkout refuses it for exactly the reason you can.",
      checks,
      itemId,
      trancheId,
      signer,
      digest,
      voucher: published,
      creatorId: voucher.creatorId,
      source,
    };
  }

  // 3 — the consignment. The digest she signed is the leaf her tranche committed to. That is one fact,
  // not two, and it is why a tag cannot be genuinely signed and yet absent from the consignment.
  const tranche = await items(where).read.tranche([trancheId]);
  const location = await items(where).read.locationOf([trancheId]);
  const computedRoot = rootFrom(digest, tag.proof);
  const inTranche = verifyMembership(digest, tag.proof, tranche.root);

  checks.push({
    title: "Is it in the consignment",
    passed: inTranche,
    detail: inTranche
      ? `Yes. Walking this tag's path — ${tag.proof.length} hashes, computed in this browser — lands ` +
        `exactly on the root the shop posted for consignment #${trancheId}, which covers ` +
        `${tranche.itemCount} items at ${location}.`
      : `No. This tag's path leads somewhere other than the root consignment #${trancheId} holds. ` +
        `Whatever it is, it was never taken in here.`,
    evidence: [
      { label: "leaf — the digest she signed", value: digest },
      ...tag.proof.map((sibling, i) => ({ label: `path ${i + 1}`, value: sibling })),
      { label: "root this path computes", value: computedRoot },
      { label: "root the chain holds", value: tranche.root },
    ],
  });

  if (!inTranche) {
    return {
      verdict: "FORGED",
      headline: "This item is not in the consignment it claims to belong to.",
      meaning:
        "A registered creator's key signed it, but the consignment's root does not commit to it. " +
        "Nobody ever brought this item in — so nobody here can sell it, and the checkout says the same.",
      checks,
      itemId,
      trancheId,
      digest,
      root: tranche.root,
      computedRoot,
      proof: tag.proof,
      voucher: published,
      creatorId: voucher.creatorId,
      creatorKey,
      signer,
      location,
      source,
    };
  }

  // 4 — the item itself.
  const item = await items(where).read.itemOf([itemId]);
  const state = ITEM_STATES[item.state] ?? "ABSENT";
  const price = await prices(where).read.effectivePrice([itemId]);
  const consumed = state === "SOLD" || state === "OWNED" || state === "BURNED";

  checks.push({
    title: "Has it been sold",
    passed: !consumed,
    detail: describeState(state, location, item.owner),
    evidence: [{ label: "item state, on-chain", value: state }],
  });

  const found = {
    checks,
    source,
    itemId,
    trancheId,
    state,
    price,
    location,
    owner: item.owner,
    creatorId: voucher.creatorId,
    creatorKey,
    signer,
    digest,
    root: tranche.root,
    computedRoot,
    proof: tag.proof,
    voucher: published,
  };

  if (state === "SOLD" || state === "OWNED") {
    return {
      ...found,
      verdict: "ALREADY_SOLD",
      headline: "Already sold. This one is a copy.",
      meaning:
        `Everything on this tag is genuine — creator #${voucher.creatorId} signed it and the ` +
        `consignment commits to it. It has also already been sold, and an item can be sold exactly ` +
        `once. ${
          state === "OWNED"
            ? `The certificate is held by ${short(item.owner)}.`
            : "Its certificate has been issued and is waiting to be claimed with the code on the receipt."
        } Whoever is holding this tag is holding a duplicate, and the counter will refuse to ring it up.`,
    };
  }

  if (state === "BURNED") {
    return {
      ...found,
      verdict: "WRITTEN_OFF",
      headline: "This item was written off.",
      meaning:
        "The shop declared it destroyed or lost — and paid the creator, the landlord and the community " +
        "as if it had sold, which is what a write-off costs here. It cannot be sold now. If it is in " +
        "your hands, the shop has told the world one thing and you another.",
    };
  }

  if (state === "COMMITTED") {
    return {
      ...found,
      verdict: "RESERVED",
      headline: "Genuine — and already ordered by somebody.",
      meaning:
        "A buyer has paid for this item and is waiting to be handed it. The shop is on a clock to do " +
        "that. If it misses the deadline, the buyer is refunded from the pool automatically — no " +
        "complaint, no form, nobody to telephone.",
    };
  }

  return {
    ...found,
    verdict: "GENUINE",
    headline: "Genuine, and still for sale.",
    meaning:
      `Signed by creator #${voucher.creatorId}, committed to by consignment #${trancheId}, and never ` +
      `sold. The ledger says it is in store at ${location} — and an item in store is buyable, right ` +
      `now, by anyone in the world. So if you are holding this tag somewhere other than that shop ` +
      `floor, the ledger is contradicting whoever handed it to you: the item walked out of the door ` +
      `and the books still say it is on the shelf. Nobody needs to accuse anyone. The twin is still ` +
      `listed, and buying it is what forces the question.`,
  };
}

/** Fetches the tag's voucher — and says where it came from, because for a forgery the answer is "the tag". */
async function paperwork(tag: Tag, checks: Check[], source: string): Promise<PublishedVoucher> {
  if (tag.pointer) {
    const bytes = await fetchBlob(tag.pointer);
    checks.push({
      title: "The paperwork",
      passed: true,
      detail:
        `The voucher is published, and these are its bytes — fetched from ${source}, and they hash to ` +
        `exactly the pointer this tag carries. Nothing in this step goes anywhere near the shop's own ` +
        `computers.`,
      evidence: [
        { label: "pointer", value: tag.pointer },
        {
          label: "fetched from",
          value: BACKEND === "0g" ? "0G Storage, through its public indexer" : "this page's own origin",
        },
      ],
    });
    return JSON.parse(bytes) as PublishedVoucher;
  }

  checks.push({
    title: "The paperwork",
    passed: true,
    detail:
      "This tag carries its own voucher instead of pointing at a published one, so nothing anybody " +
      "else can see stands behind it. That is not fatal on its own and is not treated as fatal: the " +
      "voucher is checked exactly as any other would be. It simply has to survive the next two " +
      "questions on its own merits.",
  });

  return tag.voucher as PublishedVoucher;
}

function describeState(state: ItemState, location: string, owner: Address): string {
  switch (state) {
    case "ABSENT":
    case "LISTED":
      return (
        `No. The item ledger has never consumed this tag, so it is unsold and in store at ${location}. ` +
        `(An item that has never moved holds no record of its own: being on the shelf is proven by the ` +
        `consignment, not asserted by something the shop wrote down.)`
      );
    case "COMMITTED":
      return "Ordered and not yet handed over. The shop is on the clock to fulfil it.";
    case "SOLD":
      return "Yes — sold. The certificate is issued and waiting for the claim code from the receipt.";
    case "OWNED":
      return `Yes — sold, and the certificate is held by ${short(owner)}.`;
    case "BURNED":
      return "No — written off. The shop declared it gone and paid everybody as if it had sold.";
  }
}

const registry = (where: Deployment) =>
  getContract({ address: where.registry, abi: abi.registry, client: publicClient });

const items = (where: Deployment) =>
  getContract({ address: where.items, abi: abi.items, client: publicClient });

const prices = (where: Deployment) =>
  getContract({ address: where.prices, abi: abi.prices, client: publicClient });
