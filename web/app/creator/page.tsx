"use client";

/**
 * Inspect — the scanner.
 *
 * A tag lives on the dress, so the only honest way to meet one is to scan it: a camera on its QR, or a
 * phone tapped to its NFC chip. And a scan answers more than "is this real" — it opens the item's whole
 * public record: is it genuine, has it sold, and did the money reach the people it was owed to. So the
 * order is the argument — authenticity first, entirely in the browser; then the item's state and where
 * its money went, read from the chain; and only for a genuine, unsold tag, the option to buy. Buying is
 * the one thing this page asks the shop for; everything before it works with the shop switched off.
 *
 * The wall of tags used to live here; it moved to *how it works*, because a wall of QR codes is a thing
 * you scan, not a thing you shop. This page is the scanner; that page is what you point it at.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { DressImage } from "@/components/dress-image";
import { ItemMoney } from "@/components/entity";
import { itemTone, shelfWord, useLedger } from "@/components/ledger-view";
import { VerificationReport } from "@/components/report";
import { Badge, Empty, Panel } from "@/components/ui";
import { abi, deployment, publicClient, type Deployment } from "@/lib/chain";
import { refusalFromMessage } from "@/lib/chain/errors";
import { dryRun, type DryRun } from "@/lib/counter";
import { naira, shortAddress } from "@/lib/format";
import { claimsTouching } from "@/lib/ledger/profiles";
import { Scanner } from "@/lib/qr";
import { buy, redeem } from "@/lib/relayer";
import { parseTag, verifyTag, type Report } from "@/lib/verify";

type Sale = { itemId: bigint; claimCode: string; owner?: string };

export default function InspectPage() {
  const { holdings, now } = useLedger();
  const [where, setWhere] = useState<Deployment>();
  const [report, setReport] = useState<Report>();
  const [rails, setRails] = useState<DryRun[]>();
  const [checking, setChecking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [nfcNote, setNfcNote] = useState<string>();
  const [sale, setSale] = useState<Sale>();
  const [refused, setRefused] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const lastPayload = useRef<string | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      try {
        setWhere(await deployment());
      } catch (error) {
        setProblem(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);

  const check = useCallback(
    async (payload: string, keepReceipt = false) => {
      if (!where) return;

      setChecking(true);
      setReport(undefined);
      setRails(undefined);
      setRefused(undefined);
      setScanning(false);
      lastPayload.current = payload;
      if (!keepReceipt) setSale(undefined);

      try {
        const verified = await verifyTag(payload, where);
        setReport(verified);

        // Reconstruct the tag from the scanned bytes so the counter can be dry-run — a scanned tag
        // carries everything a clicked one did.
        let parsed;
        try {
          parsed = parseTag(payload);
        } catch {
          parsed = undefined;
        }

        if (parsed && (parsed.pointer || parsed.voucher) && verified.verdict !== "UNREADABLE") {
          const published = verified.voucher ?? parsed.voucher;
          if (published) setRails(await dryRun(parsed, published, where));
        }
      } catch (error) {
        setProblem(error instanceof Error ? error.message : String(error));
      } finally {
        setChecking(false);
      }
    },
    [where],
  );

  const scanNfc = useCallback(async () => {
    setNfcNote(undefined);
    if (typeof window === "undefined" || !("NDEFReader" in window)) {
      setNfcNote("This device can't read NFC in the browser — it needs Chrome on Android, over HTTPS. Use the camera instead.");
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Web NFC is not in the DOM lib yet.
      const reader = new (window as any).NDEFReader();
      await reader.scan();
      setNfcNote("Hold a tag to the top of the phone…");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reader.onreading = (event: any) => {
        for (const record of event.message.records) {
          if (record.recordType === "text" || record.recordType === "url") {
            const text = new TextDecoder().decode(record.data);
            setNfcNote(undefined);
            void check(text);
            return;
          }
        }
        setNfcNote("That tag carried no readable payload.");
      };
    } catch {
      setNfcNote("NFC was refused or is switched off. Use the camera instead.");
    }
  }, [check]);

  const purchase = useCallback(async () => {
    if (!report?.itemId) return;
    setRefused(undefined);
    try {
      const receipt = await buy(report.itemId);
      setSale({ itemId: report.itemId, claimCode: receipt.claimCode });
      if (lastPayload.current) void check(lastPayload.current, true);
    } catch (error) {
      setRefused(error instanceof Error ? error.message : String(error));
    }
  }, [report, check]);

  const claim = useCallback(async () => {
    if (!sale) return;
    setRefused(undefined);
    try {
      const certificate = await redeem(sale.itemId, sale.claimCode);
      setSale({ ...sale, owner: certificate.owner });
      if (lastPayload.current) void check(lastPayload.current, true);
    } catch (error) {
      setRefused(error instanceof Error ? error.message : String(error));
    }
  }, [sale, check]);

  if (problem) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <Panel title="Nothing to check yet" tone="alarm">
          <p className="text-sm leading-relaxed text-ink-2">{problem}</p>
        </Panel>
      </main>
    );
  }

  const buyable = report?.verdict === "GENUINE";
  const item = report?.itemId ? holdings?.items.find((i) => i.id === report.itemId) : undefined;
  const itemDebts = report?.itemId ? (holdings?.debts ?? []).filter((d) => d.itemId === report.itemId) : [];
  const itemClaims = holdings && itemDebts.length > 0 ? claimsTouching(holdings, new Set(itemDebts.map((d) => d.id))) : [];

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-6 py-8">
      <header>
        <span className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_oklab,var(--color-accent-fill)_45%,white)] bg-[color-mix(in_oklab,var(--color-accent-fill)_10%,white)] px-3 py-1 text-xs font-medium text-accent">
          <span className="size-1.5 rounded-full bg-accent-fill" />
          Inspect
        </span>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Scan a tag to inspect the item.</h1>
        <p className="mt-2 leading-relaxed text-mut">
          Point the camera at its QR, or tap the phone to its chip. One scan opens the item&rsquo;s whole record — whether
          it&rsquo;s genuine, whether it has sold, and whether the money reached the creator, the landlord and the
          community. All of it read from the chain, none of it from the shop. If it&rsquo;s genuine and unsold, there&rsquo;s
          a button to buy.
        </p>
      </header>

      <Panel title="The tag" hint="Scan a real one — or point the camera at the wall on “how it works”.">
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            onClick={() => setScanning(!scanning)}
            className="flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
          >
            {scanning ? "stop the camera" : "scan with the camera"}
          </button>
          <button
            onClick={() => void scanNfc()}
            className="flex items-center justify-center gap-2 rounded-xl border border-line-strong px-4 py-3 text-sm font-semibold text-ink transition-colors hover:bg-raised"
          >
            tap an NFC tag
          </button>
        </div>

        {scanning && (
          <div className="mt-3">
            <Scanner onScan={(payload) => void check(payload)} />
          </div>
        )}
        {nfcNote && <p className="mt-3 text-sm leading-relaxed text-mut">{nfcNote}</p>}

        <p className="mt-3 text-xs leading-relaxed text-faint">
          No tag in hand?{" "}
          <Link href="/creator/understand" className="font-medium text-mut underline-offset-2 hover:text-ink hover:underline">
            Open the wall of tags
          </Link>{" "}
          on another screen and scan one — or click through it to see exactly how the check works.
        </p>
      </Panel>

      {checking && <Empty>Checking against the chain…</Empty>}

      {report && !checking && (
        <>
          {report.itemId && (
            <Link
              href={`/item/${String(report.itemId)}`}
              className="card-tap flex items-center gap-3 p-3"
            >
              <DressImage id={Number(report.itemId)} label={`Item ${String(report.itemId)}`} className="size-14 shrink-0 rounded-xl border border-line" />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-semibold text-ink">Item {String(report.itemId)}</span>
                <div className="text-xs text-mut">open the full dossier — its price, its proof, and its whole life →</div>
              </div>
              {item && (
                <Badge tone={itemTone(item.state)} dot>
                  {shelfWord(item.state)}
                </Badge>
              )}
            </Link>
          )}

          <VerificationReport report={report} />

          {/* Where the money went — shown for any item the chain actually knows (genuine, or a clone of a sold one). */}
          {item && <ItemMoney debts={itemDebts} claims={itemClaims} now={now} />}

          {rails && <Counter rails={rails} price={report.price} />}

          {sale ? (
            <Panel title="Your receipt" tone="good">
              <p className="text-sm leading-relaxed text-ink-2">
                Bought. You have no wallet, no account and no gas — the shop sponsored the transaction, and the only thing
                you walk out with is the code below.
              </p>
              <div className="mt-3 rounded-lg border border-line bg-sunken p-3">
                <div className="text-xs uppercase tracking-wider text-faint">claim code</div>
                <code className="mt-1 block font-mono text-sm break-all text-good">{sale.claimCode}</code>
              </div>
              {sale.owner ? (
                <p className="mt-3 text-sm leading-relaxed text-good">
                  The certificate is yours, bound on-chain to {shortAddress(sale.owner)} — an account the shop opened for
                  you, because you never had one. Anybody who scans this item from now on is told it is sold, and who holds
                  it.
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
                className="w-full rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-ink/90"
              >
                buy it — {naira(report.price)}
              </button>
            )
          )}

          {refused && <Refused message={refused} />}
        </>
      )}

      {!report && !checking && (
        <Panel>
          <p className="leading-relaxed text-mut">
            Nothing scanned yet. Every genuine tag comes back with its dossier and a way to buy; a forgery or a
            sold-already clone comes back refused, and told why — the check is the same either way.
          </p>
        </Panel>
      )}
    </main>
  );
}

/**
 * A refusal from the counter itself — the rule is the contract's, named by the contract, and this page
 * turns the name back into the rule it stands for.
 */
function Refused({ message }: { message: string }) {
  const rule = refusalFromMessage(message);

  return (
    <Panel title="The counter said no" tone="alarm">
      <p className="text-sm leading-relaxed text-ink">{rule ? rule.sentence : message}</p>
      {rule && (
        <p className="mt-1.5 font-mono text-xs text-bad">
          {rule.name}
          {rule.detail ? ` — ${rule.detail}` : ""}
        </p>
      )}
    </Panel>
  );
}

/**
 * What the till would do, asked before anything is sent — both rails, because the difference between
 * them is the argument.
 */
function Counter({ rails, price }: { rails: DryRun[]; price?: bigint }) {
  return (
    <Panel
      title="What the counter would do"
      hint="Asked, not guessed: the ceiling is a public read, so this runs the sale against the chain's current state before a single transaction is sent. This is a walk-in sale with no referral attached — three debts, not four."
    >
      <ul className="space-y-3">
        {rails.map((rail) => (
          <li key={rail.rail} className="border-t border-line pt-3 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={rail.allowed ? "good" : "alarm"}>{rail.allowed ? "would sell" : "refused"}</Badge>
              <span className="text-sm font-medium text-ink">
                {rail.rail === "instant" ? "Paying by card — the instant rail" : "Paying cash — Good holds the money"}
              </span>
              {price !== undefined && price > 0n && <span className="text-xs text-faint">{naira(price)}</span>}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-mut">
              {rail.allowed
                ? rail.rail === "instant"
                  ? "The payment splits at the point of sale. Good never holds anybody's money, so the ceiling has nothing to ration and the sale passes."
                  : "Good takes the money into its own hands and owes it onward. The ceiling has room for that today."
                : rail.refusal?.sentence}
            </p>
            {!rail.allowed && rail.refusal && (
              <p className="mt-1.5 font-mono text-xs text-bad">
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
