/**
 * The chain, as the public sees it: one viem client over a public RPC, and the addresses the
 * deployment script published.
 *
 * Every read the surfaces perform goes through here. There is no operator endpoint in this module and
 * there never may be one — the ledger view, the buyer's verification and the creator's wall all answer
 * from public state, which is why they keep answering when Good is switched off.
 */

import { createPublicClient, defineChain, http, type Address, type PublicClient } from "viem";

import { abi } from "./generated/abi";

export { abi };

/** Where the contracts live. The deployment script writes this file; nobody else does. */
export type Deployment = {
  chainId: number;
  registry: Address;
  items: Address;
  prices: Address;
  gateway: Address;
  debts: Address;
  sweep: Address;
  proofs: Address;
  pool: Address;
  ceiling: Address;
  ngn: Address;
  operator: Address;
  operatorRecipient: Address;
};

/**
 * The RPC and the chain id are configuration, not code: the same page reads a development chain and
 * 0G's testnet, and it reads them the same way. A public endpoint is the only kind that appears here.
 */
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);

const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 16602 ? "0G Galileo Testnet" : "Local development chain",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

export const publicClient: PublicClient = createPublicClient({ chain, transport: http(RPC_URL) });

let cached: Promise<Deployment> | undefined;

/**
 * Loads the deployment the surfaces read.
 *
 * The file is a static asset served by the web itself, copied from what the deployment script
 * published — the same file the relayer reads, and neither of them deploys anything. Asking the
 * operator where its contracts are would make the operator load-bearing for verification, which is the
 * one thing that must never be true.
 */
export function deployment(): Promise<Deployment> {
  cached ??= fetch(`/deployments/${CHAIN_ID}.json`)
    .then((response) => {
      if (!response.ok) {
        throw new Error(
          `No deployment is published for chain ${CHAIN_ID}. Deploy the contracts, then run ` +
            "`npm run sync` in web/.",
        );
      }
      return response.json() as Promise<Deployment>;
    })
    .catch((error: unknown) => {
      cached = undefined;
      throw error;
    });

  return cached;
}

/** The currency this deployment's prices and debts are denominated in: "NGN", right-padded to 32 bytes. */
export const NGN = "0x4e474e0000000000000000000000000000000000000000000000000000000000" as const;
