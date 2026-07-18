/**
 * The tag set: what the shop printed, plus the two tags it never printed.
 *
 * The genuine tags are built from the consignment the creator signed — one leaf each, and the Merkle
 * path that proves it. The other two are the demonstration:
 *
 *   the forgery   a plausible tag for a plausible dress, signed in this browser, right now, by a key
 *                 nobody registered. Forging paperwork is easy. It is supposed to be easy. What the
 *                 protocol does is make it worthless, and it does that by asking the registry who
 *                 signed it rather than asking the tag.
 *
 *   the clone     a byte-for-byte copy of a genuine tag. There is nothing wrong with it — that is the
 *                 point of a clone — and there is nothing to detect about it in isolation. The item it
 *                 names has been sold, and an item sells once. The copy is worthless because the state
 *                 machine has already closed the door, not because anybody spotted the forger.
 */

import { keccak256, toHex, type Address, type Hex } from "viem";

import { abi, publicClient } from "@/lib/chain";
import { Tree, encodeTag, forge, type PublishedVoucher, type Tag } from "@/lib/verify";

/** The shop's published tag set, as the seed left it. */
export type Consignment = {
  creatorId: number;
  trancheId: number;
  root: Hex;
  items: { id: number; price: string; digest: Hex; pointer: Hex }[];
};

export type WallTag = {
  id: string;
  label: string;
  /** What this tag is, said plainly, on the wall itself. */
  note: string;
  kind: "genuine" | "forged" | "cloned";
  itemId: number;
  /** The listed price in NGN wei — for the product card. */
  price?: string;
  tag: Tag;
  payload: string;
  /** The membership path, kept for the wall's leaf → path → root display. */
  proof: Hex[];
  digest: Hex;
};

/**
 * The consignment, served by the web itself as a static file.
 *
 * It is the shop's published paperwork, not an answer from the shop's computers — the difference being
 * that this page keeps serving it when the operator is switched off, exactly as a printed tag keeps
 * saying what it says.
 */
export async function loadConsignment(): Promise<Consignment> {
  const response = await fetch("/consignment.json");
  if (!response.ok) {
    throw new Error(
      "No consignment has been published yet. Seed the demo, then run `npm run sync` in web/.",
    );
  }
  return (await response.json()) as Consignment;
}

/** Every genuine tag in the consignment, each with the path that proves it belongs. */
export function genuineTags(consignment: Consignment): WallTag[] {
  const tree = new Tree(consignment.items.map((item) => item.digest));

  return consignment.items.map((item, index) => {
    const proof = tree.proof(index);
    const tag: Tag = {
      v: 1,
      item: String(item.id),
      tranche: String(consignment.trancheId),
      pointer: item.pointer,
      proof,
    };

    return {
      id: `item-${item.id}`,
      label: `Item ${item.id - 1000}`,
      note: `Item ${item.id} · signed by creator #${consignment.creatorId} · one of ${consignment.items.length} leaves under the root`,
      kind: "genuine",
      itemId: item.id,
      price: item.price,
      tag,
      payload: encodeTag(tag),
      proof,
      digest: item.digest,
    };
  });
}

/** The root the wall computes for itself, from the leaves. The chain is asked to agree. */
export function rootOf(consignment: Consignment): Hex {
  return new Tree(consignment.items.map((item) => item.digest)).root();
}

/**
 * A key that is not the creator's.
 *
 * It is one of the development chain's published accounts: deterministic, known to everybody, and worth
 * nothing. Nothing real is ever signed with it. The forgery has to be signed by *something*, and using
 * a key whose privacy nobody has ever pretended about keeps the demonstration honest.
 */
const FORGER_KEY = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6" as const;

/** The item id the forger invents. It is not in the consignment, and no such dress was ever made. */
const FORGED_ITEM = 1099;

/**
 * Signs a forged tag in the browser.
 *
 * Everything about it is correct: the EIP-712 domain is the registry's, the split it names is the one
 * the shop publishes, the signature verifies against the key that produced it. The one thing it cannot
 * have is a registered creator behind it, and that is the only thing anyone checks.
 */
export async function forgedTag(
  consignment: Consignment,
  chainId: number,
  registry: Address,
  splitPolicy: Hex,
): Promise<WallTag> {
  const voucher = {
    creatorId: BigInt(consignment.creatorId),
    itemId: BigInt(FORGED_ITEM),
    metadataHash: keccak256(toHex(`forged-dress-${FORGED_ITEM}`)),
    splitPolicyRef: splitPolicy,
  };

  const signature = await forge(voucher, FORGER_KEY, chainId, registry);

  const published: PublishedVoucher = {
    creatorId: String(voucher.creatorId),
    itemId: String(voucher.itemId),
    metadataHash: bytesOf(voucher.metadataHash),
    splitPolicyRef: bytesOf(voucher.splitPolicyRef),
    digest: "0x",
    signature,
    metadata: { name: "Item 99", location: "unknown" },
  };

  // A forger has no way to get their voucher into the shop's published storage, so the tag has to
  // carry its own — which the verifier accepts, and then refuses on the only question that matters.
  const tag: Tag = {
    v: 1,
    item: String(FORGED_ITEM),
    tranche: String(consignment.trancheId),
    voucher: published,
    proof: [],
  };

  return {
    id: "forged",
    label: "Item 99",
    note: "A forgery. Signed a moment ago, in this browser, by a key the registry has never seen.",
    kind: "forged",
    itemId: FORGED_ITEM,
    tag,
    payload: encodeTag(tag),
    proof: [],
    digest: "0x",
  };
}

/** A perfect copy of a genuine tag — the same bytes, printed twice. */
export function clonedTag(of: WallTag): WallTag {
  return {
    ...of,
    id: "cloned",
    label: `${of.label} (again)`,
    note: `A clone: the same tag as item ${of.itemId}, copied byte for byte. Nothing about it is wrong. The item it names can only be sold once.`,
    kind: "cloned",
  };
}

/**
 * The whole wall: every genuine tag, the forgery, and the clone.
 *
 * The clone copies a tag whose item has actually been sold, and which one that is is a question for the
 * chain — because a clone of an unsold item is not a detectable forgery, it is simply a second copy of
 * a live tag, and both copies would verify. That is not a weakness being hidden. It is the mechanism:
 * a clone is never caught by inspection, it is defeated at the counter, by a state machine that has
 * already closed the door. Until the original sells, there is no door to be closed and nothing to see.
 */
export async function wall(
  consignment: Consignment,
  where: { chainId: number; registry: Address; gateway: Address; items: Address },
  splitPolicy: Hex,
): Promise<WallTag[]> {
  const genuine = genuineTags(consignment);

  const states = await Promise.all(
    genuine.map((tag) =>
      publicClient.readContract({
        address: where.items,
        abi: abi.items,
        functionName: "itemOf",
        args: [BigInt(tag.itemId)],
      }),
    ),
  );

  const soldIndex = states.findIndex((item) => item.state === 3 || item.state === 4);
  const copied = genuine[soldIndex === -1 ? 0 : soldIndex];

  const forged = await forgedTag(consignment, where.chainId, where.registry, splitPolicy);

  return [...genuine, forged, clonedTag(copied)];
}

const bytesOf = (hex: Hex): number[] =>
  Array.from({ length: 32 }, (_, i) => parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16));
