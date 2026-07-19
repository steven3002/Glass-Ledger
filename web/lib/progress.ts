/**
 * How far the ledger has got, published for anything that wants to draw it.
 *
 * The read happens in three stages — cage, holdings, history — and on 0G's public RPC the last of
 * them is a full log scan from block zero, which is seconds. Every page already renders a skeleton
 * where its own data will land, but nothing tells a reader that the *page* is still filling: a
 * half-drawn overview and a finished one look alike if you have not seen the finished one.
 *
 * This is deliberately a module-level store rather than React context. `useLedger` is a hook each
 * page calls for itself, so lifting it to a provider would be a real refactor of how every surface
 * gets its data — worth doing one day, not worth doing to hang a progress bar on. A store costs one
 * subscription and changes nothing about how the ledger is read.
 *
 * The bar reports genuine stages, never a fake creep toward a number it invents. A progress
 * indicator that lies about progress is the same species of thing this whole product argues against.
 */

export type Stage = "cage" | "holdings" | "history";

const STAGES: Stage[] = ["cage", "holdings", "history"];

let arrived = new Set<Stage>();
/** First load only. Re-polls every 3s must not flash the bar for data already on screen. */
let settled = false;
const listeners = new Set<() => void>();

/** 0 → 1 across the three stages; 1 once everything has landed at least once. */
export function progress(): number {
  if (settled) return 1;
  return arrived.size / STAGES.length;
}

/** Whether a reader should be shown that something is still coming. */
export function loading(): boolean {
  return !settled;
}

export function markArrived(stage: Stage): void {
  if (settled || arrived.has(stage)) return;
  arrived.add(stage);
  if (arrived.size === STAGES.length) settled = true;
  for (const notify of listeners) notify();
}

/**
 * A read failed and is being retried — the bar goes back to unsettled so the reader is not left
 * looking at a full bar over a page that is still empty.
 */
export function markStalled(): void {
  if (!settled && arrived.size === 0) return;
  arrived = new Set();
  settled = false;
  for (const notify of listeners) notify();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
