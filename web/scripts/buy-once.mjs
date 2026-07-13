/**
 * Drives one purchase through the buyer's page, in a real browser, against a real chain.
 *
 * This exists because of a bug that shipped. The deployment lookup in the operator's service walked up
 * from the data directory to find its addresses, which is correct until the data directory moves — and
 * when it moved to one shelf per chain, the service came up on testnet with its till *shut*. It said so,
 * once, in a log line nobody was reading, and then served a whole twenty-three-minute rehearsal without
 * a counter. Every one of the seven proofs passed, because the demo drives them from the CLI and none of
 * them touches the till.
 *
 * But the buy button does. And the buy button is where the most human moment of the demo lives: a woman
 * with no wallet, no account and no gas walks out owning the certificate. On stage, that button would
 * have failed.
 *
 * So the till is no longer taken on trust. This clicks the real button on the real page, against the
 * real deployment, and refuses to pass unless a certificate actually comes back bound on-chain.
 *
 *   node scripts/buy-once.mjs               # item 1010, http://127.0.0.1:3000
 *   GLASS_BUY_ITEM=1011 node scripts/buy-once.mjs
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const ORIGIN = process.env.WEB_ORIGIN ?? "http://127.0.0.1:3000";
const ITEM = Number(process.env.GLASS_BUY_ITEM ?? 1010);
const PORT = Number(process.env.GLASS_CDP_PORT ?? 9333);

const say = (line) => console.log(line);
const fail = (line) => {
  console.error(`\n  ✗ ${line}\n`);
  process.exit(1);
};

// --- A browser, and a wire to it -------------------------------------------------------------------

const chrome = spawn(
  "chromium",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

process.on("exit", () => chrome.kill());
process.on("SIGINT", () => process.exit(130));

/** The page target, once the browser has one. */
async function target() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await response.json()).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // The browser is still coming up. That is not an error yet.
    }
    await sleep(250);
  }
  fail("chromium never opened a page to drive");
}

const socket = new WebSocket(await target());
await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

let nextId = 0;
const pending = new Map();

socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  const waiting = pending.get(message.id);
  if (!waiting) return;

  pending.delete(message.id);
  if (message.error) waiting.reject(new Error(message.error.message));
  else waiting.resolve(message.result);
});

function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

/** Runs an expression in the page and hands back its value. */
async function evaluate(expression) {
  const { result, exceptionDetails } = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? "page threw");
  return result.value;
}

/**
 * Waits for something to become true on the page, and says what it was waiting for when it does not.
 *
 * Every beat of a purchase is a round trip — to the chain, to the store, to the operator — so the page
 * is asked repeatedly rather than assumed to be ready. A step that times out names itself, because a
 * checkout that silently did nothing is the failure this file exists to catch.
 */
async function until(what, expression, seconds = 60) {
  for (let attempt = 0; attempt < seconds * 4; attempt++) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(250);
  }
  fail(`${what} — it never happened`);
}

/** Clicks the first button whose label contains this text. */
const clickButton = (text) =>
  `(() => {
     const button = [...document.querySelectorAll("button")]
       .find((b) => b.textContent && b.textContent.includes(${JSON.stringify(text)}));
     if (!button) return false;
     button.click();
     return true;
   })()`;

const pageSays = (text) =>
  `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`;

// --- The purchase ----------------------------------------------------------------------------------

say(`\n  the buyer's page at ${ORIGIN}, in a real browser, buying item ${ITEM}\n`);

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: `${ORIGIN}/buy` });

await until("the shop's tags never loaded", `!${pageSays("Loading the shop")}`, 90);
say("  ✓ the shop's tags are on the page — fetched from the chain and the public store");

// The tag itself, clicked the way a buyer clicks it. The page then verifies it — against the chain and
// against 0G, and against nothing of the operator's — before it will offer to sell anything.
await until(`no tag on the page for item ${ITEM}`, clickButton(`item ${ITEM}`), 30);
await until("the page never reached a verdict on the tag", pageSays("Genuine"), 90);
say(`  ✓ item ${ITEM} verified GENUINE by the browser itself, before the shop was asked anything`);

// And now the till. This is the line that was broken: with the deployment lookup wrong, the service
// answered "the counter is closed" here and the demo died on stage.
await until("the buy button never appeared", clickButton("buy it —"), 30);
await until(
  "the counter never sold it — is the till shut? (check relayerd's deployment lookup)",
  pageSays("Your receipt"),
  120,
);
say("  ✓ the counter sold it — sponsored by the operator, with no wallet and no gas from the buyer");

await until("the redeem button never appeared", clickButton("redeem the certificate with this code"), 30);
await until("the certificate was never bound on-chain", pageSays("The certificate is yours"), 120);
say("  ✓ the certificate is bound on-chain to an account the shop opened for her");

const owned = await until(
  "the page never showed who holds it",
  `(() => {
     const m = document.body.innerText.match(/bound on-chain to (0x[0-9a-fA-F…]+)/);
     return m ? m[1] : false;
   })()`,
  30,
);

say(`\n  ✓ item ${ITEM} is OWNED, and the certificate is held by ${owned}.`);
say("    She never had a wallet. She never saw a chain. The code on the receipt was the whole of it.\n");

socket.close();
chrome.kill();
process.exit(0);
