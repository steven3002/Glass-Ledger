"use client";

/**
 * How a tag proves itself — the wall we scan in the demo.
 *
 * A tag cannot be understood in the abstract, so here is the shop's whole published set laid out like
 * dresses on a rack, each with the QR a phone would read. Point the camera of a device that has Verify
 * open at any of them and the real check runs; or click one here to see the same check in place, ending
 * on the walk from the creator's signed leaf, up its path, to the root the chain has held since the
 * shipment came in. Two of these are worthless — one forged, one a clone of something already sold —
 * and they look identical to the rest until the walk is taken.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { DressImage } from "@/components/dress-image";
import { VerificationReport } from "@/components/report";
import { Badge, Bytes, Empty, Panel } from "@/components/ui";
import { abi, deployment, publicClient, type Deployment } from "@/lib/chain";
import { naira } from "@/lib/format";
import { TagQR } from "@/lib/qr";
import { loadConsignment, rootOf, wall, type WallTag } from "@/lib/tags";
import { verifyTag, type Report } from "@/lib/verify";

export default function UnderstandPage() {
  const [where, setWhere] = useState<Deployment>();
  const [tags, setTags] = useState<WallTag[]>([]);
  const [computedRoot, setComputedRoot] = useState<string>();
  const [chainRoot, setChainRoot] = useState<string>();
  const [chosen, setChosen] = useState<WallTag>();
  const [report, setReport] = useState<Report>();
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    void (async () => {
      try {
        const [deployed, consignment] = await Promise.all([deployment(), loadConsignment()]);
        const [splitPolicy, tranche] = await Promise.all([
          publicClient.readContract({ address: deployed.gateway, abi: abi.gateway, functionName: "splitPolicy" }),
          publicClient.readContract({
            address: deployed.items,
            abi: abi.items,
            functionName: "tranche",
            args: [BigInt(consignment.trancheId)],
          }),
        ]);

        setWhere(deployed);
        setTags(await wall(consignment, deployed, splitPolicy));
        setComputedRoot(rootOf(consignment));
        setChainRoot(tranche.root);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);

  const inspect = useCallback(
    async (tag: WallTag) => {
      if (!where) return;
      setChosen(tag);
      setReport(undefined);
      setReport(await verifyTag(tag.payload, where));
    },
    [where],
  );

  if (problem) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <Panel title="No consignment to show" tone="alarm">
          <p className="text-sm leading-relaxed text-ink-2">{problem}</p>
        </Panel>
      </main>
    );
  }

  const agrees = Boolean(computedRoot && chainRoot && computedRoot.toLowerCase() === chainRoot.toLowerCase());

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-6 py-8">
      <header>
        <Link href="/creator" className="text-sm font-medium text-mut transition-colors hover:text-ink">
          ← back to the scanner
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">How a tag proves itself</h1>
        <p className="mt-2 max-w-3xl leading-relaxed text-mut">
          The shop&rsquo;s whole published set, as printed. Point a phone with{" "}
          <Link href="/creator" className="underline">
            Inspect
          </Link>{" "}
          open at any QR to run the check for real — this is the wall we scan in the demo — or click a tag here to see the
          same four checks in place, ending on the walk from the leaf the creator signed to the root the chain holds.
        </p>
      </header>

      <Panel
        title="The consignment"
        hint="One root stands for every tag below. It was posted once, and the creator signed each leaf under it."
        tone={agrees ? "good" : "plain"}
      >
        {computedRoot && chainRoot ? (
          <div className="space-y-3">
            <div className="grid gap-1 sm:grid-cols-[18rem_1fr] sm:gap-3">
              <div className="text-xs text-faint">the root this browser just computed</div>
              <Bytes>{computedRoot}</Bytes>
            </div>
            <div className="grid gap-1 sm:grid-cols-[18rem_1fr] sm:gap-3">
              <div className="text-xs text-faint">the root the chain holds</div>
              <Bytes>{chainRoot}</Bytes>
            </div>
            <p className={`text-sm leading-relaxed ${agrees ? "text-good" : "text-bad"}`}>
              {agrees
                ? "They agree. The tags in front of you are the tags the chain committed to — nobody had to tell you so, and nobody could have told you otherwise."
                : "They do not agree. Something in this consignment is not what the chain committed to."}
            </p>
          </div>
        ) : (
          <Empty>Rebuilding the root from the tags…</Empty>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1fr_28rem]">
        <Panel title="The wall" hint="Every tag the creator signed, plus the two nobody should trust.">
          {tags.length === 0 ? (
            <Empty>Loading the tags…</Empty>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {tags.map((tag) => (
                <li key={tag.id}>
                  <button
                    onClick={() => void inspect(tag)}
                    data-active={chosen?.id === tag.id}
                    className="card-tap w-full overflow-hidden p-0 text-left hover:-translate-y-0.5"
                  >
                    <div className="relative">
                      <DressImage id={tag.itemId} label={tag.label} className="aspect-[4/5]" />
                      {tag.kind !== "genuine" && (
                        <span className="absolute left-2 top-2">
                          <Badge tone="warn" dot>
                            {tag.kind === "forged" ? "a forgery" : "a clone"}
                          </Badge>
                        </span>
                      )}
                      <span className="absolute right-2 bottom-2 rounded-lg bg-white p-1 shadow-md ring-1 ring-line/70">
                        <TagQR value={tag.payload} size={54} />
                      </span>
                    </div>
                    <div className="p-3">
                      <div className="text-sm font-semibold text-ink">{tag.label}</div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-faint">
                          {tag.kind === "genuine" ? `item ${tag.itemId}` : "not listed"}
                        </span>
                        {tag.price && <span className="text-sm font-semibold tabular-nums text-ink">{naira(BigInt(tag.price))}</span>}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-4">
          {!chosen && (
            <Panel>
              <p className="leading-relaxed text-mut">
                Pick a tag. You will get the same four checks a buyer gets at the counter — and, for the genuine ones, the
                walk from the leaf the creator signed, up its path, to the root the chain has been holding since the shop
                took the consignment in.
              </p>
            </Panel>
          )}

          {chosen && !report && <Empty>Checking against the chain…</Empty>}

          {chosen && report && (
            <>
              {report.digest && report.root && report.proof && report.proof.length > 0 && (
                <MerkleWalk leaf={report.digest} proof={report.proof} computed={report.computedRoot ?? ""} root={report.root} />
              )}
              <VerificationReport report={report} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function MerkleWalk({
  leaf,
  proof,
  computed,
  root,
}: {
  leaf: string;
  proof: readonly string[];
  computed: string;
  root: string;
}) {
  const agrees = computed.toLowerCase() === root.toLowerCase();

  return (
    <Panel
      title="The proof, walked"
      hint="The digest she signed is the leaf the consignment commits to — the same thirty-two bytes, which is why a tag cannot be genuinely signed and yet missing from the shipment."
      tone={agrees ? "good" : "alarm"}
    >
      <ol className="space-y-2">
        <li className="rounded-lg border border-line bg-sunken p-2.5">
          <div className="text-xs uppercase tracking-wider text-faint">the leaf — what she signed</div>
          <Bytes>{leaf}</Bytes>
        </li>

        {proof.map((sibling, i) => (
          <li key={sibling} className="rounded-lg border border-line bg-sunken p-2.5">
            <div className="text-xs uppercase tracking-wider text-faint">
              hashed with its neighbour — step {i + 1} of {proof.length}
            </div>
            <Bytes>{sibling}</Bytes>
          </li>
        ))}

        <li
          className={`rounded-lg border p-2.5 ${
            agrees
              ? "border-[color-mix(in_oklab,var(--color-good-fill)_35%,white)] bg-[color-mix(in_oklab,var(--color-good-fill)_8%,white)]"
              : "border-[color-mix(in_oklab,var(--color-bad-fill)_35%,white)] bg-[color-mix(in_oklab,var(--color-bad-fill)_8%,white)]"
          }`}
        >
          <div className="text-xs uppercase tracking-wider text-mut">
            {agrees ? "the root — and the chain holds exactly this" : "the root this path computes"}
          </div>
          <Bytes>{computed}</Bytes>
          {!agrees && (
            <p className="mt-2 text-sm text-bad">
              The chain holds {root.slice(0, 12)}… instead. This tag is not in the consignment.
            </p>
          )}
        </li>
      </ol>
    </Panel>
  );
}
