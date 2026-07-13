/**
 * The counter, dry-run.
 *
 * `Allowance.authorize` is a `view` function and it is ungated, which means anybody — including this
 * page, including you — can ask the ceiling what it would say *before* a single transaction is sent.
 * So the buy page does not guess. It runs the sale the shop would run, as an ordinary call against the
 * chain's current state, and reports back either "this would go through" or the rule that refused it,
 * by name, out of the contract's own ABI.
 *
 * That is worth more than a tidier button. A shop that tells a buyer "sorry, system error" is a shop
 * with a story; a shop whose refusal arrives as a published rule, checkable by the buyer against a
 * contract nobody can quietly edit, is a shop with a cage. Both rails are simulated, because the
 * difference between them is the whole of the argument: the cash rail is money Good takes into its own
 * hands and is therefore rationed; the instant rail never touches Good at all, and passes even when the
 * ceiling is shut.
 *
 * Nothing here sends anything. Every call is an `eth_call` against a public RPC.
 */

import { keccak256, toHex, zeroAddress, type Hex } from "viem";

import { abi, publicClient, type Deployment } from "@/lib/chain";
import { refusalOf, withProtocolErrors, type Refusal } from "@/lib/chain/errors";
import { voucherOf, type Tag } from "@/lib/verify";

export type DryRun = {
  rail: "instant" | "cash";
  allowed: boolean;
  refusal?: Refusal;
};

/**
 * What the till would do with this tag, on each rail, right now.
 *
 * The community leg is left off: it mints only against a referral voucher, and a browser has none to
 * present. So this is the shape of a walk-in sale with nobody to attribute it to — three debts, not
 * four — and it is the sale the page actually offers.
 */
export async function dryRun(tag: Tag, published: NonNullable<Tag["voucher"]>, where: Deployment): Promise<DryRun[]> {
  const input = {
    voucher: voucherOf(published),
    signature: published.signature,
    trancheId: BigInt(tag.tranche),
    proof: tag.proof,
    claimCodeHash: keccak256(toHex(`claim-code/${tag.item}`)) as Hex,
    certificateCommitment: keccak256(toHex(`certificate/${tag.item}`)) as Hex,
    communityRecipient: zeroAddress,
    communityVoucherHash: `0x${"0".repeat(64)}` as Hex,
  };

  const gateway = {
    address: where.gateway,
    abi: withProtocolErrors(abi.gateway),
    // The operator is the only account the gateway will sell for, so the operator is the account the
    // simulation runs as. Impersonating it costs nothing and proves nothing — an `eth_call` moves no
    // money and signs nothing. What it does is ask the contracts the question the shop is about to ask.
    account: where.operator,
  } as const;

  const [instant, cash] = await Promise.all([
    attempt("instant", () =>
      publicClient.simulateContract({
        ...gateway,
        functionName: "sellInstant",
        args: [input, keccak256(toHex(`payment/${tag.item}`))],
      }),
    ),
    attempt("cash", () =>
      publicClient.simulateContract({ ...gateway, functionName: "sellCash", args: [input] }),
    ),
  ]);

  return [instant, cash];
}

async function attempt(rail: DryRun["rail"], call: () => Promise<unknown>): Promise<DryRun> {
  try {
    await call();
    return { rail, allowed: true };
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal) return { rail, allowed: false, refusal };

    // Not a refusal from the protocol — an RPC that could not be reached, or a chain that is not
    // there. Saying "the rules forbid this" about a network failure would be a lie of exactly the kind
    // this page exists to make impossible.
    throw error;
  }
}
