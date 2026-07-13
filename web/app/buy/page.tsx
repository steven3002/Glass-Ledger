"use client";

/**
 * The buyer's page: scan, check, and only then decide.
 *
 * The order is the argument. Verification happens first and happens entirely here — the voucher comes
 * from public storage, the signature is recovered in this browser, the consignment's proof is walked in
 * this browser, and the item's state is read from the chain over a public connection. None of it asks
 * Good anything, and none of it can: `lib/verify` has no import path to the operator's client, and the
 * build refuses to compile one.
 *
 * Then the counter is dry-run — `authorize` is a `view` function and ungated, so the ceiling can be
 * asked what it would say before anything is sent. Only after all of that is there a button, and
 * pressing it is the single call this page makes to Good: a sale is the one thing nobody else can do.
 *
 * Kill the operator and this page still verifies every tag, still shows every rule, and still tells the
 * truth about the till: it is shut, and here is what you would have been able to check anyway.
 */

import { useCallback, useEffect, useState } from "react";

import { VerificationReport } from "@/components/report";
import { Badge, Empty, Panel } from "@/components/ui";
import { TagQR, Scanner } from "@/lib/qr";
import { deployment, type Deployment } from "@/lib/chain";
import { refusalFromMessage } from "@/lib/chain/errors";
import { dryRun, type DryRun } from "@/lib/counter";
import { naira, shortAddress } from "@/lib/format";
import { buy, redeem } from "@/lib/relayer";
import { loadConsignment, wall, type WallTag } from "@/lib/tags";
import { publicClient, abi } from "@/lib/chain";
import { verifyTag, type Report } from "@/lib/verify";

type Sale = { itemId: bigint; claimCode: string; owner?: string };

export default function BuyPage() {
  const [where, setWhere] = useState<Deployment>();
  const [tags, setTags] = useState<WallTag[]>([]);
  const [chosen, setChosen] = useState<WallTag>();
  const [report, setReport] = useState<Report>();
  const [rails, setRails] = useState<DryRun[]>();
  const [checking, setChecking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [sale, setSale] = useState<Sale>();
  const [refused, setRefused] = useState<string>();
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    void (async () => {
      try {
        const [deployed, consignment] = await Promise.all([deployment(), loadConsignment()]);
        const splitPolicy = await publicClient.readContract({
          address: deployed.gateway,
          abi: abi.gateway,
          functionName: "splitPolicy",
        });

        setWhere(deployed);
        setTags(await wall(consignment, deployed, splitPolicy));
      } catch (error) {
        setProblem(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);

  // `keepReceipt` exists for exactly one case: re-reading the chain straight after a purchase, so the
  // page shows the item as sold. The claim code is the only thing the buyer walks out with, and a
  // refresh that swept it off the screen would be taking it back.
  const check = useCallback(
    async (tag: WallTag | undefined, payload: string, keepReceipt = false) => {
      if (!where) return;

      setChecking(true);
      setChosen(tag);
      setReport(undefined);
      setRails(undefined);
      setRefused(undefined);
      setScanning(false);
      if (!keepReceipt) setSale(undefined);

      try {
        const verified = await verifyTag(payload, where);
        setReport(verified);

        // The counter is only worth dry-running for a tag that could conceivably be rung up. For a tag
        // with no paperwork at all there is nothing to hand it.
        if (tag && (tag.tag.pointer || tag.tag.voucher) && verified.verdict !== "UNREADABLE") {
          const published = verified.voucher ?? tag.tag.voucher;
          if (published) setRails(await dryRun(tag.tag, published, where));
        }
      } catch (error) {
        setProblem(error instanceof Error ? error.message : String(error));
      } finally {
        setChecking(false);
      }
    },
    [where],
  );

  const purchase = useCallback(async () => {
    if (!report?.itemId) return;
    setRefused(undefined);

    try {
      const receipt = await buy(report.itemId);
      setSale({ itemId: report.itemId, claimCode: receipt.claimCode });
      if (chosen) void check(chosen, chosen.payload, true);
    } catch (error) {
      setRefused(error instanceof Error ? error.message : String(error));
    }
  }, [report, chosen, check]);

  const claim = useCallback(async () => {
    if (!sale) return;
    setRefused(undefined);

    try {
      const certificate = await redeem(sale.itemId, sale.claimCode);
      setSale({ ...sale, owner: certificate.owner });
      if (chosen) void check(chosen, chosen.payload, true);
    } catch (error) {
      setRefused(error instanceof Error ? error.message : String(error));
    }
  }, [sale, chosen, check]);

  if (problem) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <Panel title="Nothing to check yet" tone="alarm">
          <p className="text-sm leading-relaxed text-neutral-300">{problem}</p>
        </Panel>
      </main>
    );
  }

  const buyable = report?.verdict === "GENUINE";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Buy</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-neutral-500">
          Scan the tag on a dress — or click one below. Your browser checks it against the chain before
          anybody sells you anything, and the shop is not asked for its opinion at any point.
        </p>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          <Panel title="The tag" hint="Point a camera at one, or click one of the shop's own.">
            <button
              onClick={() => setScanning(!scanning)}
              className="w-full rounded-lg border border-neutral-700 px-3 py-2 text-sm font-medium text-neutral-200 transition-colors hover:border-neutral-500 hover:bg-neutral-900"
            >
              {scanning ? "stop the camera" : "scan with the camera"}
            </button>

            {scanning && (
              <div className="mt-3">
                <Scanner onScan={(payload) => void check(undefined, payload)} />
              </div>
            )}

            {tags.length === 0 ? (
              <Empty>Loading the shop&rsquo;s tags…</Empty>
            ) : (
              <ul className="mt-4 grid grid-cols-2 gap-2">
                {tags.map((tag) => (
                  <li key={tag.id}>
                    <button
                      onClick={() => void check(tag, tag.payload)}
                      className={`w-full rounded-lg border p-2 text-left transition-colors ${
                        chosen?.id === tag.id
                          ? "border-neutral-500 bg-neutral-900"
                          : "border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900/60"
                      }`}
                    >
                      <div className="flex justify-center">
                        <TagQR value={tag.payload} size={92} />
                      </div>
                      <div className="mt-2 truncate text-xs font-medium text-neutral-300">{tag.label}</div>
                      <div className="mt-0.5">
                        {tag.kind === "genuine" ? (
                          <span className="text-[11px] text-neutral-600">item {tag.itemId}</span>
                        ) : (
                          <Badge tone="warn">{tag.kind === "forged" ? "a forgery" : "a clone"}</Badge>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          {checking && <Empty>Checking against the chain…</Empty>}

          {!checking && !report && (
            <Panel>
              <p className="leading-relaxed text-neutral-400">
                Nothing checked yet. Every tag on the left is real, in the sense that somebody printed
                it — including the two that are worthless. Pick any of them; you will be told which is
                which, and shown why.
              </p>
            </Panel>
          )}

          {report && !checking && (
            <>
              {chosen?.kind === "cloned" && (
                <Panel tone="alarm">
                  <p className="text-sm leading-relaxed text-neutral-300">
                    <strong className="font-semibold text-neutral-100">This is the clone.</strong> It is
                    a byte-for-byte copy of a genuine tag, and there is nothing wrong with it — that is
                    what makes it a clone. Everything about it checks out except the one thing that
                    cannot be copied: the item it names has already been sold, and an item sells once.
                  </p>
                </Panel>
              )}

              <VerificationReport report={report} />

              {rails && <Counter rails={rails} price={report.price} />}

              {sale ? (
                <Panel title="Your receipt" tone="good">
                  <p className="text-sm leading-relaxed text-neutral-300">
                    Bought. You have no wallet, no account and no gas — the shop sponsored the
                    transaction, and the only thing you walk out with is the code below.
                  </p>
                  <div className="mt-3 rounded-lg border border-neutral-800 bg-black/50 p-3">
                    <div className="text-xs uppercase tracking-wider text-neutral-600">claim code</div>
                    <code className="mt-1 block font-mono text-sm break-all text-emerald-300">
                      {sale.claimCode}
                    </code>
                  </div>

                  {sale.owner ? (
                    <p className="mt-3 text-sm leading-relaxed text-emerald-300">
                      The certificate is yours, bound on-chain to {shortAddress(sale.owner)} — an account
                      the shop opened for you, because you never had one. Anybody who scans this dress
                      from now on is told it is sold, and who holds it.
                    </p>
                  ) : (
                    <button
                      onClick={() => void claim()}
                      className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                    >
                      redeem the certificate with this code
                    </button>
                  )}
                </Panel>
              ) : (
                buyable && (
                  <button
                    onClick={() => void purchase()}
                    className="w-full rounded-lg bg-neutral-100 px-4 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-white"
                  >
                    buy it — {naira(report.price)}
                  </button>
                )
              )}

              {refused && <Refused message={refused} />}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * A refusal from the counter itself.
 *
 * The rule is the contract's, and it is named by the contract — the relayer decodes it against the same
 * ABIs this page holds, and this page turns the name back into the rule it stands for. A buyer who is
 * told "no" is told which published rule said it, and can go and read that rule without asking the shop
 * for anything. A shop that could only answer "system error" would be a shop with a story.
 */
function Refused({ message }: { message: string }) {
  const rule = refusalFromMessage(message);

  return (
    <Panel title="The counter said no" tone="alarm">
      <p className="text-sm leading-relaxed text-neutral-200">{rule ? rule.sentence : message}</p>
      {rule && (
        <p className="mt-1.5 font-mono text-xs text-red-400">
          {rule.name}
          {rule.detail ? ` — ${rule.detail}` : ""}
        </p>
      )}
    </Panel>
  );
}

/**
 * What the till would do, asked before anything is sent.
 *
 * Both rails, always, because the difference between them is the argument: the cash rail is money Good
 * takes into its own hands and is therefore rationed by the ceiling; the instant rail never passes
 * through Good at all, and goes through even when the ceiling is shut.
 */
function Counter({ rails, price }: { rails: DryRun[]; price?: bigint }) {
  return (
    <Panel
      title="What the counter would do"
      hint="Asked, not guessed: the ceiling is a public read, so this page runs the sale against the chain's current state before a single transaction is sent. This is a walk-in sale with no referral attached — three debts, not four."
    >
      <ul className="space-y-3">
        {rails.map((rail) => (
          <li key={rail.rail} className="border-t border-neutral-900 pt-3 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={rail.allowed ? "good" : "alarm"}>{rail.allowed ? "would sell" : "refused"}</Badge>
              <span className="text-sm font-medium text-neutral-200">
                {rail.rail === "instant" ? "Paying by card — the instant rail" : "Paying cash — Good holds the money"}
              </span>
              {price !== undefined && price > 0n && (
                <span className="text-xs text-neutral-600">{naira(price)}</span>
              )}
            </div>

            <p className="mt-1 text-sm leading-relaxed text-neutral-400">
              {rail.allowed
                ? rail.rail === "instant"
                  ? "The payment splits at the point of sale. Good never holds anybody's money, so the ceiling has nothing to ration and the sale passes."
                  : "Good takes the money into its own hands and owes it onward. The ceiling has room for that today."
                : rail.refusal?.sentence}
            </p>

            {!rail.allowed && rail.refusal && (
              <p className="mt-1.5 font-mono text-xs text-red-400">
                {rail.refusal.name}
                {rail.refusal.detail ? ` — ${rail.refusal.detail}` : ""}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
