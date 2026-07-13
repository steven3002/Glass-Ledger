/**
 * The creator's voucher: what she signed, and how a stranger checks it.
 *
 * A voucher is an item's whole identity — who made it, which item it is, what it says about itself,
 * and under which published split it may be sold. It carries no price. The digest computed here is
 * load-bearing twice over: it is what the creator signed, and it is the Merkle leaf her tranche
 * commits to. Those being the same thirty-two bytes is what makes it impossible for a tag to be
 * genuinely signed and yet absent from the consignment, or present in the consignment and signed by
 * nobody.
 *
 * The domain binds the chain id and the registry's address, so a signature cannot travel between
 * deployments or between chains. Nothing in this file trusts the tag: the digest is recomputed from
 * the voucher's own fields, and the signature is recovered against it.
 */

import { hashTypedData, recoverTypedDataAddress, type Address, type Hex } from "viem";

/** The voucher, as the registry's EIP-712 type declares it. */
export type Voucher = {
  creatorId: bigint;
  itemId: bigint;
  metadataHash: Hex;
  splitPolicyRef: Hex;
};

/** The shape of the bytes a voucher is published as: everything a stranger needs, and nothing they must be given. */
export type PublishedVoucher = {
  creatorId: string;
  itemId: string;
  metadataHash: number[];
  splitPolicyRef: number[];
  digest: Hex;
  signature: Hex;
  metadata?: Record<string, string>;
};

const types = {
  ItemVoucher: [
    { name: "creatorId", type: "uint256" },
    { name: "itemId", type: "uint256" },
    { name: "metadataHash", type: "bytes32" },
    { name: "splitPolicyRef", type: "bytes32" },
  ],
} as const;

const domain = (chainId: number, registry: Address) =>
  ({ name: "Glass Ledger", version: "1", chainId, verifyingContract: registry }) as const;

const bytes32 = (values: number[]): Hex =>
  `0x${values.map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;

/** The published bytes, read into the struct the registry hashes. */
export function voucherOf(published: PublishedVoucher): Voucher {
  return {
    creatorId: BigInt(published.creatorId),
    itemId: BigInt(published.itemId),
    metadataHash: bytes32(published.metadataHash),
    splitPolicyRef: bytes32(published.splitPolicyRef),
  };
}

/** What the creator signed — and the leaf her tranche commits to. */
export function digestOf(voucher: Voucher, chainId: number, registry: Address): Hex {
  return hashTypedData({
    domain: domain(chainId, registry),
    types,
    primaryType: "ItemVoucher",
    message: voucher,
  });
}

/** Which key signed this voucher. Whether that key is a registered creator's is the chain's answer, not ours. */
export function signerOf(
  voucher: Voucher,
  signature: Hex,
  chainId: number,
  registry: Address,
): Promise<Address> {
  return recoverTypedDataAddress({
    domain: domain(chainId, registry),
    types,
    primaryType: "ItemVoucher",
    message: voucher,
    signature,
  });
}

/**
 * Signs a voucher with a key that is not the creator's.
 *
 * This is how the forged tag on the creator's wall is made: an ordinary, perfectly valid EIP-712
 * signature over an ordinary, perfectly plausible voucher, produced in the browser by a key nobody
 * registered. It is here rather than hidden in a fixture file because the forgery is a *demonstration*
 * — the point is that forging the paperwork is easy, and that it does not matter, because the registry
 * is asked who signed it and the honest answer is "nobody we know".
 */
export async function forge(
  voucher: Voucher,
  privateKey: Hex,
  chainId: number,
  registry: Address,
): Promise<Hex> {
  const { privateKeyToAccount } = await import("viem/accounts");
  return privateKeyToAccount(privateKey).signTypedData({
    domain: domain(chainId, registry),
    types,
    primaryType: "ItemVoucher",
    message: voucher,
  });
}
