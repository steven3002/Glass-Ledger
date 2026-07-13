/**
 * Where a voucher's bytes come from — and, just as importantly, where they never come from.
 *
 * What is on-chain is a hash and a pointer. The bytes the hash commits to live in public storage, and
 * a reader who has a tag fetches them, hashes them, and checks the signature — without asking the
 * operator for anything. That last clause is the whole of the firewall, and it is why this module has
 * exactly two backends:
 *
 *   0G Storage   the bytes are fetched from 0G's public indexer through the 0G SDK. The indexer is
 *                0G's infrastructure, not Good's. Stopping Good stops nothing here.
 *
 *   the web      on a development chain there is no 0G to publish to, so the vouchers are served as
 *                static files by this application itself, from its own origin. Still not the operator:
 *                the page is serving its own published paperwork, exactly as a printed tag carries its
 *                own.
 *
 * There is deliberately no third backend, and there is no code path in this file — or anywhere under
 * lib/verify — that can reach the operator's service. A page that could only verify while Good's
 * process was alive would be proving the opposite of what it claims to prove.
 */

import { keccak256, toHex, type Hex } from "viem";

export type StorageBackend = "0g" | "web";

/** Which store the vouchers are read from. Configuration, never a default that could quietly change. */
export const BACKEND: StorageBackend =
  process.env.NEXT_PUBLIC_STORAGE === "0g" ? "0g" : "web";

export const INDEXER_URL =
  process.env.NEXT_PUBLIC_0G_INDEXER ?? "https://indexer-storage-testnet-turbo.0g.ai";

/** What a reader can say about where the bytes came from, so a page never has to guess. */
export function backendLabel(): string {
  return BACKEND === "0g"
    ? `0G Storage — public indexer (${INDEXER_URL})`
    : "this page's own origin (a development chain has no 0G to publish to)";
}

/**
 * Fetches the bytes a pointer names.
 *
 * The two backends address bytes differently, and the difference is worth stating rather than
 * papering over. The web store is content-addressed: the pointer is the keccak of the bytes, so the
 * fetch can be checked locally and is — see `assertPointer`. 0G addresses a file by its own Merkle
 * root and verifies segment proofs on the way down inside the SDK, so the check is done there, by 0G,
 * against 0G's root. Either way the bytes cannot be swapped after the fact, which is the only property
 * a voucher store has to have.
 */
export async function fetchBlob(pointer: Hex): Promise<string> {
  if (BACKEND === "0g") return fetchFrom0G(pointer);

  const response = await fetch(`/blobs/${pointer}.blob`);
  if (!response.ok) {
    throw new Error(
      `Nothing is published at ${pointer}. A tag that points at bytes nobody ever published is a tag ` +
        `with no paperwork behind it.`,
    );
  }

  const bytes = await response.text();
  assertPointer(pointer, bytes);
  return bytes;
}

/**
 * The content-addressing check, done by the reader.
 *
 * The pointer is the keccak of the bytes. If they hash to something else, the store handed back
 * something other than what the chain committed to — and the reader finds that out without trusting
 * the store, which is the entire reason the pointer is a hash and not a URL.
 */
function assertPointer(pointer: Hex, bytes: string) {
  const digest = keccak256(toHex(bytes));
  if (digest.toLowerCase() !== pointer.toLowerCase()) {
    throw new Error(
      `The bytes at ${pointer} hash to ${digest}. That is not the voucher this tag points at.`,
    );
  }
}

/**
 * Reads a blob from 0G Storage through the public indexer.
 *
 * The SDK is loaded on demand: it is only needed when the deployment actually publishes to 0G, and a
 * development chain should not be paying for it in its bundle. The import is dynamic for that reason
 * and for no other — nothing about which store is in use changes what verification checks.
 */
async function fetchFrom0G(pointer: Hex): Promise<string> {
  const { Indexer } = await import("@0gfoundation/0g-storage-ts-sdk");
  const indexer = new Indexer(INDEXER_URL);

  // `proof: true` is not optional here. A store that hands back unverified bytes is a store that has
  // to be trusted, and the point of this one is that it does not: the segments are checked against
  // 0G's own root on the way down, in the reader's browser.
  const [blob, error] = await indexer.downloadToBlob(pointer, { proof: true });
  if (error) {
    throw new Error(
      `0G Storage has no verified copy of ${pointer}: ${error.message}. A tag that points at bytes ` +
        `nobody published is a tag with no paperwork behind it.`,
    );
  }

  return blob.text();
}
