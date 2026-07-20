/**
 * Projects the compiled contracts, the deployment, and the published vouchers into the web app.
 *
 * Three things come out of this, and none of them is written by hand:
 *
 *   lib/chain/generated/abi.ts   the ABIs, straight from forge's build output. The error list is
 *                                part of them, which is the point: the page decodes `AlreadySold`
 *                                and `OverCeiling` by name, from the same artifact the chain was
 *                                deployed from, so a rule added to a contract is legible here the
 *                                moment it is compiled. A second, hand-kept copy of that list would
 *                                be wrong the first time somebody edited a contract.
 *
 *   public/deployments/*.json    where the contracts live. The deployment script publishes this and
 *                                the relayer reads the same file; neither of them deploys anything.
 *
 *   public/blobs/*               the vouchers, and public/consignment.json, the tag set — the shop's
 *                                published paperwork, served as static files by the web itself.
 *                                This is the local-mode store: it stands in for 0G Storage on a
 *                                development chain, and it is served by the *web*, never by the
 *                                operator, because a page that could only verify while the operator
 *                                was alive would be proving nothing at all.
 *
 * All three are generated and git-ignored. They are a projection of the contracts and of a
 * deployment, and a hand-touched projection is a lie waiting to happen.
 */

import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(web, "..");
const out = path.join(root, "contracts", "out");

/** The contracts the surfaces read, and the name each is known by in the deployment file. */
const CONTRACTS = {
  registry: "CreatorRegistry",
  items: "ItemLedger",
  prices: "PriceBook",
  gateway: "SaleGateway",
  debts: "DebtLedger",
  sweep: "SweepRegistry",
  proofs: "StubProofVerifier",
  pool: "Pool",
  ceiling: "Allowance",
  ngn: "MockNGN",
};

/**
 * `ISaleAuthorizer` declares `OverCeiling` — the refusal that closes the till — and an interface is
 * not a deployed contract, so its errors are not in any deployment's ABI. The page still has to be
 * able to name it, so it is compiled in alongside them.
 */
const INTERFACES = ["ISaleAuthorizer"];

async function abiOf(name) {
  const artifact = path.join(out, `${name}.sol`, `${name}.json`);
  if (!existsSync(artifact)) {
    throw new Error(
      `${name} has not been compiled. Run \`forge build\` in contracts/ — the ABIs are read from ` +
        `its output, because the contracts are the only source for what the errors are called.`,
    );
  }
  const { abi } = JSON.parse(await readFile(artifact, "utf8"));
  return abi;
}

async function generateAbis() {
  // The generated file is committed, and on a hosting build it is the only copy there is.
  //
  // These ABIs are a projection of `contracts/out`, which is Foundry's build output: gitignored,
  // machine-local, and absent from a git checkout. Vercel has no Foundry and never will, so a build
  // there cannot regenerate them — it can only use what was committed. Regenerating locally, where
  // the contracts have actually been compiled, keeps the file honest; skipping the regeneration when
  // there is nothing to regenerate *from* is what lets the same script serve both places.
  //
  // The failure this replaces was loud but misleading: "CreatorRegistry has not been compiled. Run
  // `forge build`" — sound advice on a laptop, impossible on a build machine that has no contracts
  // directory to compile.
  const generated = path.join(web, "lib", "chain", "generated", "abi.ts");
  if (!existsSync(path.join(root, "contracts", "out")) && existsSync(generated)) {
    console.log("  abi.ts — using the committed copy (contracts/out is not in this checkout)");
    return;
  }

  const entries = [];

  for (const [key, name] of Object.entries(CONTRACTS)) {
    entries.push(`  ${key}: ${JSON.stringify(await abiOf(name))} as const,`);
  }
  for (const name of INTERFACES) {
    entries.push(`  ${JSON.stringify(name)}: ${JSON.stringify(await abiOf(name))} as const,`);
  }

  const file = [
    "// Generated from contracts/out by scripts/sync-artifacts.mjs. Do not edit.",
    "//",
    "// The contracts are the single source of what this protocol's rules are called. Every custom",
    "// error the surfaces render by name — AlreadySold, OverCeiling, UnknownCreatorSignature — is",
    "// decoded out of these ABIs, so the sentence a page shows a buyer can never drift from the rule",
    "// that actually refused them.",
    "",
    "export const abi = {",
    ...entries,
    "};",
    "",
    "export type ContractName = keyof typeof abi;",
    "",
  ].join("\n");

  const dir = path.join(web, "lib", "chain", "generated");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "abi.ts"), file);
  console.log(`  abi.ts — ${Object.keys(CONTRACTS).length + INTERFACES.length} contracts`);
}

async function copyDeployments() {
  const from = path.join(root, "artifacts", "deployments");
  if (!existsSync(from)) {
    console.log("  no deployments yet (deploy first; the page will say so plainly)");
    return;
  }

  const to = path.join(web, "public", "deployments");
  await mkdir(to, { recursive: true });

  const files = (await readdir(from)).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    await cp(path.join(from, file), path.join(to, file));
  }
  console.log(`  deployments — ${files.join(", ") || "none"}`);
}

/**
 * The published paperwork: the vouchers the creator signed and the tag set they belong to.
 *
 * On a development chain these live in the local store. Copying them under public/ is what "the web
 * serves them itself" means: the browser fetches a voucher from its own origin, hashes the bytes,
 * checks the signature against the chain, and never asks the operator for anything. Against 0G
 * Storage the same fetch goes to the public indexer instead, and nothing else about verification
 * changes — which is the whole reason the store is a seam.
 */
async function copyPublishedBlobs() {
  // One shelf per chain. A consignment belongs to the deployment that posted it — its tranche id, its
  // root and its leaves are that chain's — so two networks cannot share a file without the second one
  // silently erasing the first. The relayer names the directory; this reads the same variable.
  //
  // A relative value is resolved against the REPO ROOT, not against this script's working directory.
  // The relayer's scripts export it as a repo-root path, and a hosting provider's dashboard is a
  // natural place to type `artifacts/demo/16602` — which, resolved from `web/`, points at nothing.
  // That is not a crash: the sync shrugs, the build succeeds, and the deployed shop has an empty
  // shelf. It cost a deploy to find, once.
  const configured = process.env.GLASS_DATA_DIR;
  const demo = configured
    ? path.resolve(root, configured)
    : path.join(root, "artifacts", "demo");

  if (!existsSync(path.join(demo, "consignment.json"))) {
    // On a development chain this is an ordinary state — nothing has been seeded yet, and the pages
    // say so plainly. On any other chain it is a shop with no goods and no provable tags, and it
    // must not be possible to ship it by accident.
    const chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
    if (chain !== 31337 && chain !== 1337) {
      throw new Error(
        `no consignment at ${demo}, and this build targets chain ${chain}. Shipping it would put a ` +
          `shop on screen with an empty shelf and not one tag a reader could verify — which looks ` +
          `like a finished site, not a broken one. Point GLASS_DATA_DIR at that chain's shelf ` +
          `(e.g. artifacts/demo/${chain}, relative to the repo root) and make sure it is committed: ` +
          `a hosting build sees the git checkout and nothing else.`,
      );
    }
    console.log("  no consignment yet (seed first; the pages will say so plainly)");
    return;
  }

  const consignment = JSON.parse(await readFile(path.join(demo, "consignment.json"), "utf8"));

  // The paperwork has to belong to the chain this page is being built for.
  //
  // Build the page for one network with another network's consignment and it does not break — it
  // *lies*. The tags render, the browser fetches the voucher each one names, finds nothing at that
  // pointer in this chain's store, and reports the dress as **forged**: a shop where every genuine
  // item is condemned, by a verifier that is working perfectly and reading the wrong shelf. Nothing
  // downstream can catch it, because a forged verdict is exactly what a forged tag looks like.
  //
  // It is one forgotten environment variable away, so it is refused here rather than documented.
  const chain = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
  if (consignment.chainId !== chain) {
    throw new Error(
      `this consignment was posted on chain ${consignment.chainId ?? "an unrecorded chain"}, and the ` +
        `page is being built for chain ${chain}. Serving it would condemn every genuine tag in the ` +
        `shop as forged, because the vouchers it points at were published to a store this chain has ` +
        `never written to. Point GLASS_DATA_DIR at chain ${chain}'s shelf (the relayer's scripts ` +
        `export it) and seed it, then run this again.`,
    );
  }

  await cp(path.join(demo, "consignment.json"), path.join(web, "public", "consignment.json"));

  const from = path.join(demo, "blobs");
  const to = path.join(web, "public", "blobs");
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });

  // No local blobs is a legitimate state, not a broken checkout.
  //
  // On a public chain the vouchers are published to 0G Storage and the directory here is only a
  // cache — gitignored, machine-local, and absent from a hosting build. The browser fetches each
  // voucher from the 0G indexer by its pointer and hashes it itself, so serving them from this
  // origin would be a convenience and never the mechanism. Refusing to build over it would refuse
  // exactly the deployment this project is for.
  if (!existsSync(from)) {
    console.log("  blobs — none local; the vouchers are read from 0G Storage by pointer");
    return;
  }

  // Only the content-addressed copies: a reader who has the pointer from a tag is the reader this
  // store exists for, and the human-readable aliases beside them are a debugging convenience that
  // nothing verifies against.
  const blobs = (await readdir(from)).filter((f) => f.startsWith("0x") && f.endsWith(".blob"));
  for (const blob of blobs) {
    await cp(path.join(from, blob), path.join(to, blob));
  }
  console.log(`  blobs — ${blobs.length} published, content-addressed`);
}

console.log("syncing artifacts into the web app:");
await generateAbis();
await copyDeployments();
await copyPublishedBlobs();
