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
  // Multicall3 sits at its canonical address on both 0G Galileo and a fresh Anvil (it is one of the
  // deterministic-deployment contracts), so naming it here lets the client aggregate the ledger's
  // hundred-odd reads through it instead of firing them one by one at a rate-limited public RPC.
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

/**
 * One read of the ledger fires ~100 contract reads at once, and it re-reads on a timer. 0G's public
 * RPC caps a burst at 50 requests ("Too many requests (exceeds 50)"), so a hundred separate `eth_call`s
 * trip the limit and the page wrongly reports the chain as unreachable when the chain was answering
 * fine. The fix is to send fewer requests, not slower ones: Multicall3 is deployed at its canonical
 * address on 0G, so every `readContract` in the same window is aggregated through it — a hundred calls
 * become one or two — and the handful of non-contract calls (block, logs) are JSON-RPC batched into the
 * same few HTTP requests. A genuinely stuck request is cut at 20s rather than stalling the whole snapshot.
 *
 * A batch counts as one request against the limiter (verified), which is the whole reason this works.
 */
export const publicClient: PublicClient = createPublicClient({
  chain,
  batch: { multicall: { wait: 16 } },
  transport: http(RPC_URL, { batch: { wait: 16 }, timeout: 20_000 }),
});

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
