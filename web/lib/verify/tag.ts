/**
 * What is printed on a tag.
 *
 * A tag is not evidence and it is not trusted. It is a *pointer into public state*: which item this
 * claims to be, which consignment it claims to belong to, where its paperwork is published, and the
 * path that is supposed to lead from its leaf to the root the chain holds. Every one of those claims
 * is checked against the chain, so a tag can say whatever it likes.
 *
 * Two forms exist, and the difference is itself informative:
 *
 *   pointer   the ordinary tag. Its voucher is published, and the reader fetches the bytes and hashes
 *             them. This is what the shop prints.
 *
 *   inline    a tag that carries its own paperwork. A forger has to do this — nothing they signed was
 *             ever published by anybody — and the verifier accepts the bytes anyway, because it does
 *             not matter where a voucher came from. What matters is who signed it and whether the
 *             consignment's root commits to it, and the answers to those two questions live on-chain.
 */

import type { Hex } from "viem";

import type { PublishedVoucher } from "./voucher";

export type Tag = {
  /** The tag format. One version so far; a reader that meets a newer one should say so rather than guess. */
  v: 1;
  item: string;
  tranche: string;
  /** Where the voucher's bytes are published. */
  pointer?: Hex;
  /** The voucher's bytes, carried on the tag itself. */
  voucher?: PublishedVoucher;
  /** The membership path from this item's leaf to the tranche root. */
  proof: Hex[];
};

/** Reads a scanned or clicked payload. A tag that cannot be parsed is not a tag, and says so. */
export function parseTag(payload: string): Tag {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("That QR code does not carry a Glass Ledger tag.");
  }

  const tag = parsed as Partial<Tag>;
  if (tag.v !== 1 || !tag.item || !tag.tranche || !Array.isArray(tag.proof)) {
    throw new Error("That QR code does not carry a Glass Ledger tag.");
  }
  if (!tag.pointer && !tag.voucher) {
    throw new Error("This tag names no paperwork at all: no published voucher, and none carried on it.");
  }

  return tag as Tag;
}

export const encodeTag = (tag: Tag): string => JSON.stringify(tag);
