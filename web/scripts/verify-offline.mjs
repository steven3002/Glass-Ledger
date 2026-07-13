/**
 * The kill-switch test, executable.
 *
 * The claim this application makes is that a buyer can check a tag without Good's help, and that the
 * check keeps working when Good is switched off. A claim like that is not proven by an import graph or
 * by a sentence in a README. It is proven by killing the operator and running the check.
 *
 * So this does exactly that. It loads the *real* verification module — the same TypeScript the browser
 * runs, no re-implementation, no mock — points it at a chain and at the web's own static origin, and
 * runs the four browse cases of P2: a genuine unsold item, a forged tag, a clone of something already
 * sold, and the off-books contradiction. While it runs, every network call the module makes is recorded
 * and checked: if verification ever touched the operator's service, this fails, even if every verdict
 * came out right.
 *
 *   node scripts/verify-offline.mjs
 *
 * Needs: a chain with the protocol deployed and seeded, and the web served (`npm run build && npm run
 * start`). It does not need the operator, and it refuses to run if the operator is alive — because then
 * it would be proving nothing.
 */

import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://127.0.0.1:3000";
const RELAYER_ORIGIN = process.env.NEXT_PUBLIC_RELAYER_URL ?? "http://127.0.0.1:8790";
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";
const INDEXER_URL =
  process.env.NEXT_PUBLIC_0G_INDEXER ?? "https://indexer-storage-testnet-turbo.0g.ai";

/* ------------------------------------------------------------------ *
 * The wiretap.
 *
 * Everything the verification module reaches for goes through here, and everything it reaches for is
 * written down. A browser resolves a relative URL against the page's own origin; Node does not, so the
 * origin is supplied — and that substitution is the only thing this wrapper does besides watch.
 *
 * Two layers are tapped, because the code under test uses two. viem speaks `fetch`. The 0G SDK speaks
 * axios, which in Node goes straight to the `http`/`https` modules and never touches `fetch` at all —
 * so a tap on `fetch` alone would watch the chain reads, miss every byte of the storage reads, and then
 * report a clean bill of health it had no way to know was true. A wiretap with a hole in it is worse
 * than none: it produces a passing run that proves less than it claims.
 * ------------------------------------------------------------------ */

const reached = [];
const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  const absolute = url.startsWith("/") ? `${WEB_ORIGIN}${url}` : url;
  reached.push(absolute);
  return realFetch(absolute, init);
};

for (const [module, scheme] of [
  [http, "http"],
  [https, "https"],
]) {
  for (const method of ["request", "get"]) {
    const real = module[method];
    module[method] = (...args) => {
      const [first] = args;
      if (typeof first === "string" || first instanceof URL) {
        reached.push(String(first));
      } else if (first && typeof first === "object") {
        const protocol = first.protocol ?? `${scheme}:`;
        const host = first.host ?? `${first.hostname}${first.port ? `:${first.port}` : ""}`;
        reached.push(`${protocol}//${host}${first.path ?? ""}`);
      }
      return real.apply(module, args);
    };
  }
}

/* ------------------------------------------------------------------ */

const operatorIsDown = await realFetch(`${RELAYER_ORIGIN}/status`, { signal: AbortSignal.timeout(1000) })
  .then(() => false)
  .catch(() => true);

if (!operatorIsDown) {
  console.error(
    `\n  ✗ The operator is still answering on ${RELAYER_ORIGIN}. Stop it and run this again — with it\n` +
      `    alive, a passing run would prove nothing at all.\n`,
  );
  process.exit(1);
}

console.log(`\n  the operator is down (${RELAYER_ORIGIN} does not answer)`);
console.log(`  the chain is at ${RPC_URL}, and the web is serving its own paperwork at ${WEB_ORIGIN}\n`);

const jiti = createJiti(import.meta.url, { alias: { "@": web } });

const { deployment, publicClient, abi } = await jiti.import("@/lib/chain");
const { verifyTag } = await jiti.import("@/lib/verify");
const { loadConsignment, genuineTags, forgedTag, clonedTag } = await jiti.import("@/lib/tags");

const where = await deployment();
const consignment = await loadConsignment();

const splitPolicy = await publicClient.readContract({
  address: where.gateway,
  abi: abi.gateway,
  functionName: "splitPolicy",
});

const genuine = genuineTags(consignment);

// Which dress is still on the shelf, and which one has been sold, is a question for the chain — not for
// a fixture written by somebody who hoped it would still be true.
const states = await Promise.all(
  genuine.map(async (tag) => {
    const item = await publicClient.readContract({
      address: where.items,
      abi: abi.items,
      functionName: "itemOf",
      args: [BigInt(tag.itemId)],
    });
    return { tag, state: Number(item.state) };
  }),
);

const unsold = states.find(({ state }) => state === 0 || state === 1)?.tag;
const sold = states.find(({ state }) => state === 3 || state === 4)?.tag;

assert(unsold, "no unsold item on the shelf — seed the demo first");
assert(sold, "nothing has been sold yet — run the demo first, or there is no clone to test");

const cases = [
  {
    name: "P2.1  a genuine, unsold tag",
    tag: unsold,
    expect: "GENUINE",
  },
  {
    name: "P2.2  a forged tag — signed by a key nobody registered",
    tag: await forgedTag(consignment, where.chainId, where.registry, splitPolicy),
    expect: "FORGED",
  },
  {
    name: "P2.3  a clone of a tag whose item is already sold",
    tag: clonedTag(sold),
    expect: "ALREADY_SOLD",
  },
  {
    name: "P2.4  the off-books contradiction — the ledger still says it is in store",
    tag: unsold,
    expect: "GENUINE",
  },
];

let failed = 0;

for (const each of cases) {
  const report = await verifyTag(each.tag.payload, where);
  const passed = report.verdict === each.expect;
  if (!passed) failed++;

  console.log(`  ${passed ? "✓" : "✗"} ${each.name}`);
  console.log(`      → ${report.verdict}: ${report.headline}`);
  if (!passed) console.log(`      expected ${each.expect}`);
}

// P2.4 is the same chain state as P2.1 — a listed item — and that is precisely the point: the item went
// home in somebody's bag and the shop's own books still say it is on the shelf. The verdict has to say
// so out loud, or the contradiction is invisible to the person holding the dress.
const offBooks = await verifyTag(unsold.payload, where);
const saysInStore = offBooks.meaning.includes("in store at");
const saysBuyable = offBooks.meaning.includes("buyable");
if (!saysInStore || !saysBuyable) {
  failed++;
  console.log("  ✗ P2.4  the verdict does not tell the holder that the ledger contradicts them");
}

/* ------------------------------------------------------------------ *
 * The point of the whole exercise.
 *
 * Not merely "it did not call the operator" — that is a claim about one host. The claim the firewall
 * actually makes is that verification reads *public* infrastructure and nothing else, so every host it
 * reached has to be one that can be named: the chain's RPC, the page's own origin, and — when the
 * vouchers live in 0G Storage — 0G's public indexer and the storage nodes that indexer itself vouches
 * for. The 0G SDK does not proxy its downloads through the indexer: it asks the indexer where a file
 * is and then fetches the segments from those nodes directly, so their hosts show up here and must be
 * accounted for rather than waved through. Anything else is a stranger, and a stranger in this list is
 * a failure whatever the verdicts said.
 * ------------------------------------------------------------------ */

/** The storage hosts 0G's own indexer publishes as its trusted set. Public infrastructure, not Good's. */
async function zeroGNodes() {
  const response = await realFetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "indexer_getShardedNodes", params: [] }),
  });
  const { result } = await response.json();
  return (result?.trusted ?? []).map((node) => new URL(node.url).origin);
}

const known = new Map([
  [new URL(RPC_URL).origin, "the chain, over a public RPC"],
  [new URL(WEB_ORIGIN).origin, "this page's own origin (the published paperwork)"],
]);

if (reached.some((url) => url.startsWith(INDEXER_URL))) {
  known.set(new URL(INDEXER_URL).origin, "0G Storage — the public indexer");
  for (const node of await zeroGNodes()) {
    known.set(node, "0G Storage — a storage node the indexer vouches for");
  }
}

const origins = [...new Set(reached.map((url) => new URL(url).origin))];
const touchedTheOperator = origins.includes(new URL(RELAYER_ORIGIN).origin);
const strangers = origins.filter((origin) => !known.has(origin));

console.log(`\n  what verification reached for, in ${reached.length} calls:`);
for (const origin of origins) {
  console.log(`    ${origin}  —  ${known.get(origin) ?? "AN UNKNOWN HOST"}`);
}

if (touchedTheOperator) {
  console.error("\n  ✗ verification called the operator's service. The kill switch is a lie.\n");
  process.exit(1);
}

if (strangers.length > 0) {
  console.error(
    `\n  ✗ verification reached a host nobody can account for: ${strangers.join(", ")}.\n` +
      `    Every read on this path must be public infrastructure that can be named.\n`,
  );
  process.exit(1);
}

if (failed > 0) {
  console.error(`\n  ✗ ${failed} of the browse cases did not come out right.\n`);
  process.exit(1);
}

console.log(
  "\n  ✓ every browse case verified with the operator dead, and not one call went near it.\n",
);
