/**
 * The operator's counter — the only thing on these pages that talks to Good.
 *
 * A sale is the one action in this protocol that nobody but the operator can take: the gateway will
 * not consume an item for anybody else, and the buyer has no wallet, no gas and no account. So the
 * checkout posts here and Good sponsors the transaction. That is the whole of the web's dependency on
 * the operator, and it is the write path only.
 *
 * It is a separate module from lib/verify for a reason that is not stylistic. Verification must keep
 * working when this service is dead — that is the product — and the way to be sure of it is to make it
 * impossible to reach from there by accident. Nothing under lib/verify imports this file; the lint
 * configuration refuses to compile a version that does.
 *
 * When this service is down, `status()` says so and the buy button says so, and every check on every
 * page carries on exactly as before. That is not a degraded mode. That is the shop being closed.
 */

const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL ?? "http://127.0.0.1:8790";

export type Receipt = { itemId: number; claimCode: string };

/** Where the certificate ended up. The buyer has no wallet, so the shop binds it to the account she was given. */
export type Certificate = { itemId: number; owner: string };

/** Whether the operator is up. A "no" is information, not an error. */
export async function operatorIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${RELAYER_URL}/status`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Rings up a sale at the counter.
 *
 * A refusal comes back as the rule that refused it — the relayer decodes the contract's own error by
 * name, exactly as the page does for its dry runs — so a buyer who is told "no" is told which rule
 * said it.
 */
export async function buy(itemId: bigint): Promise<Receipt> {
  return call<Receipt>("/buy", { itemId: Number(itemId) });
}

/**
 * Redeems the certificate with the code from the receipt, in the name of whoever presents it.
 *
 * No address is sent, because the buyer has none: she has a paper code and nothing else, and the shop
 * binds the certificate to the account it gave her. That is the whole demonstration — she never had a
 * wallet, never held gas, and owns the certificate anyway. Production replaces the paper code with a
 * passkey account created at the point of sale, and nothing bearer-shaped ever travels.
 */
export async function redeem(itemId: bigint, code: string): Promise<Certificate> {
  return call<Certificate>("/redeem", { itemId: Number(itemId), code });
}

async function call<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${RELAYER_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "The shop's counter is not answering. Nothing else on this page depends on it: the ledger, the " +
        "verification and every clock in the protocol carry on without it. You simply cannot buy " +
        "anything while the till is switched off.",
    );
  }

  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `The counter refused this (HTTP ${response.status}).`);

  return payload as T;
}
