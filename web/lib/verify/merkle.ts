/**
 * The tranche's Merkle tree, walked in the browser.
 *
 * A consignment is a root over the digests the creator signed, and a tag proves it belongs to one by
 * handing over the path from its leaf up to that root. The walk is four hashes and it happens here, on
 * the reader's own machine — not because it would be hard to ask a server, but because a verification
 * you have to ask somebody for is not a verification.
 *
 * Pairs are hashed in sorted order, so a proof carries no left/right bookkeeping. This is the same
 * construction the item ledger verifies against and the same one the relayer builds; the tag set the
 * creator's wall renders is checked against the root the chain holds, every time it is drawn, which is
 * what would catch the three implementations drifting apart.
 */

import { concatHex, keccak256, type Hex } from "viem";

const pair = (a: Hex, b: Hex): Hex =>
  keccak256(BigInt(a) <= BigInt(b) ? concatHex([a, b]) : concatHex([b, a]));

/** Walks a membership proof from a leaf to the root it implies. */
export function rootFrom(leaf: Hex, proof: readonly Hex[]): Hex {
  return proof.reduce<Hex>((computed, sibling) => pair(computed, sibling), leaf);
}

/** Whether this leaf, with this path, is under this root. */
export function verifyMembership(leaf: Hex, proof: readonly Hex[], root: Hex): boolean {
  return rootFrom(leaf, proof).toLowerCase() === root.toLowerCase();
}

/** The tree over a consignment's leaves, in item order. */
export class Tree {
  private readonly nodes: Hex[];

  constructor(private readonly leaves: readonly Hex[]) {
    if (leaves.length === 0) throw new Error("a consignment of nothing is not a consignment");

    // The leaves occupy the tail of the array in reverse, so a node's children are always at 2i+1 and
    // 2i+2 and the root lands at 0.
    const n = leaves.length;
    this.nodes = new Array<Hex>(2 * n - 1);
    leaves.forEach((leaf, i) => {
      this.nodes[2 * n - 2 - i] = leaf;
    });
    for (let i = n - 1; i > 0; i--) {
      const node = i - 1;
      this.nodes[node] = pair(this.nodes[2 * node + 1], this.nodes[2 * node + 2]);
    }
  }

  /** The consignment object: the whole of a tranche's on-chain footprint. */
  root(): Hex {
    return this.nodes[0];
  }

  /** The membership path for the leaf at `index` — what a tag carries. */
  proof(index: number): Hex[] {
    if (index < 0 || index >= this.leaves.length) throw new Error("no such leaf");

    let node = 2 * this.leaves.length - 2 - index;
    const path: Hex[] = [];

    while (node > 0) {
      path.push(this.nodes[node % 2 === 1 ? node + 1 : node - 1]);
      node = Math.floor((node - 1) / 2);
    }

    return path;
  }
}
