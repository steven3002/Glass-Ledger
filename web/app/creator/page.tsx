"use client";

/**
 * The tag wall.
 *
 * Every tag the creator signed, printed on screen — plus a forgery and a clone sitting among them,
 * looking exactly as convincing. That is the honest starting position: you cannot tell them apart by
 * looking, and neither can a shop assistant, and neither can a customs officer.
 *
 * What you can do is check. The wall rebuilds the consignment's Merkle root from the tags themselves,
 * in this browser, and asks the chain whether it agrees. Then, tag by tag, it walks each leaf up its
 * path to that root and shows the walk. The forgery has no path to walk. The clone has a perfect one,
 * and the item it names has already been sold.
 *
 * None of this asks the shop anything. The creator's own key signed the vouchers, the chain holds the
 * root, and the browser does the arithmetic.
 */

import { useCallback, useEffect, useState } from "react";

import { VerificationReport } from "@/components/report";
import { Badge, Bytes, Empty, Panel } from "@/components/ui";
import { abi, deployment, publicClient, type Deployment } from "@/lib/chain";
import { TagQR } from "@/lib/qr";
import { loadConsignment, rootOf, wall, type WallTag } from "@/lib/tags";
import { verifyTag, type Report } from "@/lib/verify";

export default function CreatorPage() {
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
          publicClient.readContract({
            address: deployed.gateway,
            abi: abi.gateway,
            functionName: "splitPolicy",
          }),
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
          <p className="text-sm leading-relaxed text-neutral-300">{problem}</p>
        </Panel>
      </main>
    );
  }

  const agrees = Boolean(
    computedRoot && chainRoot && computedRoot.toLowerCase() === chainRoot.toLowerCase(),
  );

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">The tags</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-neutral-500">
          The whole consignment, as printed. Two of these tags are worthless — one forged, one a copy of
          something already sold — and they look exactly like the rest. Click any of them and the check
          runs here, in your browser, against the chain.
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
              <div className="text-xs text-neutral-600">the root this browser just computed</div>
              <Bytes>{computedRoot}</Bytes>
            </div>
            <div className="grid gap-1 sm:grid-cols-[18rem_1fr] sm:gap-3">
              <div className="text-xs text-neutral-600">the root the chain holds</div>
              <Bytes>{chainRoot}</Bytes>
            </div>
            <p className={`text-sm leading-relaxed ${agrees ? "text-emerald-300" : "text-red-300"}`}>
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
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      chosen?.id === tag.id
                        ? "border-neutral-500 bg-neutral-900"
                        : "border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900/60"
                    }`}
                  >
                    <div className="flex justify-center">
                      <TagQR value={tag.payload} size={108} />
                    </div>
                    <div className="mt-2 text-sm font-medium text-neutral-200">{tag.label}</div>
                    <div className="mt-1">
                      {tag.kind === "genuine" ? (
                        <span className="text-xs text-neutral-600">item {tag.itemId}</span>
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

        <div className="space-y-4">
          {!chosen && (
            <Panel>
              <p className="leading-relaxed text-neutral-400">
                Pick a tag. You will get the same four checks a buyer gets at the counter — and, for the
                genuine ones, the walk from the leaf the creator signed, up its path, to the root the
                chain has been holding since the shop took the consignment in.
              </p>
            </Panel>
          )}

          {chosen && !report && <Empty>Checking against the chain…</Empty>}

          {chosen && report && (
            <>
              {report.digest && report.root && report.proof && report.proof.length > 0 && (
                <MerkleWalk
                  leaf={report.digest}
                  proof={report.proof}
                  computed={report.computedRoot ?? ""}
                  root={report.root}
                />
              )}
              <VerificationReport report={report} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * Leaf → path → root, shown as the walk it is.
 *
 * A handful of hashes, done in the browser, ending on a number the chain has held since the shipment
 * was taken in. This is the entire mechanism by which a stranger proves a dress belongs to a
 * consignment nobody has told them anything about.
 */
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
        <li className="rounded-lg border border-neutral-800 bg-black/40 p-2.5">
          <div className="text-xs uppercase tracking-wider text-neutral-600">the leaf — what she signed</div>
          <Bytes>{leaf}</Bytes>
        </li>

        {proof.map((sibling, i) => (
          <li key={sibling} className="rounded-lg border border-neutral-900 bg-black/20 p-2.5">
            <div className="text-xs uppercase tracking-wider text-neutral-700">
              hashed with its neighbour — step {i + 1} of {proof.length}
            </div>
            <Bytes>{sibling}</Bytes>
          </li>
        ))}

        <li
          className={`rounded-lg border p-2.5 ${
            agrees ? "border-emerald-900 bg-emerald-950/30" : "border-red-900 bg-red-950/30"
          }`}
        >
          <div className="text-xs uppercase tracking-wider text-neutral-500">
            {agrees ? "the root — and the chain holds exactly this" : "the root this path computes"}
          </div>
          <Bytes>{computed}</Bytes>
          {!agrees && (
            <p className="mt-2 text-sm text-red-300">
              The chain holds {root.slice(0, 12)}… instead. This tag is not in the consignment.
            </p>
          )}
        </li>
      </ol>
    </Panel>
  );
}
