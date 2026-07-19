"use client";

/**
 * The item dossier: one dress, its whole life.
 *
 * This is the page a scanned tag resolves to, and it answers every question a stranger could ask of
 * one item without asking the shop any of them: what the paperwork says (the leaf, verified against
 * the root in this browser), what the chain holds (the state machine's slot, the price in force, the
 * certificate), where the money went (every debt the sale minted, and every claim that touched them),
 * and the life itself — the narrated log, cut down to this item's lines.
 *
 * An item sells once, so there is no separate "sale page": the sale is a chapter of the dossier.
 */

import Link from "next/link";
import { use, useEffect, useState } from "react";

import { FiguresRow, PageFigure } from "@/components/browse";
import { DressImage } from "@/components/dress-image";
import { Fact, Facts, ItemMoney, Paperwork, WhoLink } from "@/components/entity";
import {
  CardSkeleton,
  ChainError,
  itemTone,
  shelfWord,
  Timeline,
  useLedger,
} from "@/components/ledger-view";
import { Badge, Bytes, Panel, Skeleton } from "@/components/ui";
import { abi, deployment, publicClient } from "@/lib/chain";
import { naira, shortHash, untilDeadline, when } from "@/lib/format";
import type { Holdings } from "@/lib/ledger";
import { claimsTouching, linesAbout } from "@/lib/ledger/profiles";
import { genuineTags, loadConsignment, rootOf, type Consignment, type WallTag } from "@/lib/tags";
import { TagQR } from "@/lib/qr";
import { verifyMembership } from "@/lib/verify";

/** The chain's answers that live outside the ledger read: the certificate and the price schedule. */
type Extras = {
  certificate?: { claimCodeHash: string; commitment: string };
  schedule?: { current: bigint; pending: bigint; effectiveAt: bigint };
};

export default function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const itemId = /^\d+$/.test(id) ? BigInt(id) : undefined;

  const { cage, holdings, history, problem, now } = useLedger();
  const [consignment, setConsignment] = useState<Consignment>();
  const [extras, setExtras] = useState<Extras>({});

  useEffect(() => {
    void loadConsignment().then(setConsignment).catch(() => setConsignment(undefined));
  }, []);

  const item = holdings?.items.find((i) => i.id === itemId);
  const state = item?.state;

  // The certificate and the schedule are re-asked whenever the item's state moves — a sale writes both.
  useEffect(() => {
    if (itemId === undefined) return;
    void (async () => {
      const where = await deployment();
      const [certificate, schedule] = await Promise.all([
        publicClient
          .readContract({ address: where.gateway, abi: abi.gateway, functionName: "certificateOf", args: [itemId] })
          .catch(() => undefined),
        publicClient
          .readContract({ address: where.prices, abi: abi.prices, functionName: "scheduleOf", args: [itemId] })
          .catch(() => undefined),
      ]);
      setExtras({
        certificate:
          certificate && certificate.claimCodeHash !== `0x${"0".repeat(64)}`
            ? { claimCodeHash: certificate.claimCodeHash, commitment: certificate.commitment }
            : undefined,
        schedule: schedule
          ? { current: schedule.current, pending: schedule.pending, effectiveAt: schedule.effectiveAt }
          : undefined,
      });
    })();
  }, [itemId, state]);

  if (itemId === undefined) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <Panel title="Not an item" tone="alarm">
          <p className="text-sm leading-relaxed text-ink-2">
            &ldquo;{id}&rdquo; is not an item number. A tag names its item by number — try the search, or
            scan the tag on the <Link href="/creator" className="underline">verify page</Link>.
          </p>
        </Panel>
      </main>
    );
  }

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  // The paperwork side: the leaf, its path, and the root this browser computes from the published set.
  const tag = consignment ? genuineTags(consignment).find((t) => BigInt(t.itemId) === itemId) : undefined;
  const tranche = holdings?.tranches.find((t) => consignment && t.id === BigInt(consignment.trancheId));

  if (holdings && consignment && !tag) return <NoPaperwork itemId={itemId} count={consignment.items.length} />;

  const debts = holdings?.debts.filter((d) => d.itemId === itemId) ?? [];
  const debtIds = new Set(debts.map((d) => d.id));
  const claims = holdings ? claimsTouching(holdings, debtIds) : [];
  const lines = history
    ? linesAbout(history.entries, { itemIds: new Set([itemId]), debtIds, claimIds: new Set(claims.map((c) => c.id)) })
    : [];

  return (
    <main className="mx-auto max-w-[1200px] space-y-5 p-6 lg:p-8">
      <Masthead itemId={itemId} item={item} tag={tag} consignment={consignment} tranche={tranche} />

      <div className="grid gap-5 [&>*]:min-w-0 lg:grid-cols-2">
        <div className="space-y-5">
          {item && tranche ? (
            <ChainFacts itemId={itemId} item={item} extras={extras} now={now} />
          ) : (
            <CardSkeleton rows={5} title />
          )}
          {tag && consignment && tranche ? (
            <PaperworkFacts tag={tag} consignment={consignment} chainRoot={tranche.root} />
          ) : (
            <CardSkeleton rows={4} title />
          )}
        </div>

        <div className="space-y-5">
          {holdings ? <ItemMoney debts={debts} claims={claims} now={now} /> : <CardSkeleton rows={4} tall />}
          <Panel
            title="The life"
            hint="Every line of the public record that is this item's business — the same sentences the history page holds, none written for this page."
          >
            {history ? (
              <Timeline entries={lines} empty="Nothing has happened to this item yet. It is paperwork and a price, waiting." />
            ) : (
              <div className="space-y-2.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </main>
  );
}

/* ---- The masthead --------------------------------------------------------------------------------- */

function Masthead({
  itemId,
  item,
  tag,
  consignment,
  tranche,
}: {
  itemId: bigint;
  item?: Holdings["items"][number];
  tag?: WallTag;
  consignment?: Consignment;
  tranche?: Holdings["tranches"][number];
}) {
  return (
    <section className="card p-6" style={{ boxShadow: "var(--shadow-pop)" }}>
      <div className="flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-start sm:gap-6">
        <DressImage
          id={Number(itemId)}
          label={item?.name ?? `Item ${String(itemId)}`}
          className="aspect-[4/5] w-36 shrink-0 rounded-2xl border border-line"
        />

        <div className="min-w-0 flex-1">
          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
            Item dossier
            {tranche && (
              <>
                {" · "}
                <span>consignment #{String(tranche.id)} — {tranche.location}</span>
              </>
            )}
          </div>
          {item ? (
            <h1 className="mt-1.5 flex flex-wrap items-center gap-3 text-3xl font-semibold tracking-tight">
              {item.name}
              <Badge tone={itemTone(item.state)}>{shelfWord(item.state)}</Badge>
            </h1>
          ) : (
            <Skeleton className="mt-2 h-8 w-40" />
          )}
          {consignment && tranche && (
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-mut">
              Signed by{" "}
              <Link href={`/creators/${consignment.creatorId}`} className="font-medium text-ink-2 underline-offset-2 hover:underline">
                creator #{consignment.creatorId}
              </Link>
              , consigned to the shop at {tranche.location} under landlord <WhoLink address={tranche.landlord} />, posted{" "}
              {when(tranche.postedAt)}.
            </p>
          )}

          <FiguresRow className="mt-6">
            <PageFigure label="Price" value={item ? naira(item.price) : undefined} first />
            <PageFigure label="Item" value={String(itemId)} />
            {tranche && <PageFigure label="Consignment" value={`#${String(tranche.id)}`} />}
            {tranche && <PageFigure label="Location" value={tranche.location} />}
          </FiguresRow>
        </div>

        {tag && (
          <div className="shrink-0 text-center">
            <span className="inline-block rounded-xl bg-white p-2 shadow-md ring-1 ring-line/70">
              <TagQR value={tag.payload} size={96} />
            </span>
            <div className="mt-1.5 text-[0.62rem] uppercase tracking-wider text-faint">the tag, as printed</div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ---- The chain's side ----------------------------------------------------------------------------- */

function ChainFacts({
  itemId,
  item,
  extras,
  now,
}: {
  itemId: bigint;
  item: Holdings["items"][number];
  extras: Extras;
  now: number;
}) {
  const committed = item.state === "COMMITTED";
  const clock = committed ? untilDeadline(item.committedUntil, now) : undefined;
  const pending =
    extras.schedule && extras.schedule.effectiveAt !== 0n && Number(extras.schedule.effectiveAt) > now
      ? extras.schedule
      : undefined;

  return (
    <Panel
      title="What the chain holds"
      hint="The state machine's own slot — written only when something happened, readable with the shop switched off."
    >
      <Facts>
        <Fact label="State">
          <Badge tone={itemTone(item.state)} dot>
            {shelfWord(item.state)}
          </Badge>
        </Fact>
        <Fact label="Price in force">
          <span className="font-semibold tabular-nums">{naira(item.price)}</span>
          {pending && (
            <span className="ml-2 text-xs text-mut">
              → {naira(pending.pending)} from {when(pending.effectiveAt)} — posted publicly, never retroactive
            </span>
          )}
        </Fact>
        <Fact label="On-chain slot">
          {item.trancheId === 0n ? (
            <span className="text-mut">
              never written — until a sale touches item {String(itemId)}, its entire footprint is one leaf under the root
            </span>
          ) : (
            <span className="text-mut">materialized, in collection #{String(item.trancheId)}</span>
          )}
        </Fact>
        <Fact label="Held by">
          {item.owner === "0x0000000000000000000000000000000000000000" ? (
            <span className="text-mut">nobody yet</span>
          ) : (
            <WhoLink address={item.owner} />
          )}
        </Fact>
        {committed && clock && (
          <Fact label="Hand-over deadline" wide>
            <span className={clock.overdue ? "font-semibold text-bad" : "text-accent"}>
              {clock.text}
              {clock.overdue && " — the buyer's refund is collectable by anyone"}
            </span>
          </Fact>
        )}
        <Fact label="Certificate" wide>
          {extras.certificate ? (
            <span className="text-mut">
              committed on-chain · claim code hash <Bytes>{shortHash(extras.certificate.claimCodeHash)}</Bytes> — the code
              itself left on the buyer&rsquo;s receipt, and only its holder can redeem
            </span>
          ) : (
            <span className="text-mut">none — no sale has issued one</span>
          )}
        </Fact>
      </Facts>
    </Panel>
  );
}

/* ---- The paperwork's side ------------------------------------------------------------------------- */

function PaperworkFacts({
  tag,
  consignment,
  chainRoot,
}: {
  tag: WallTag;
  consignment: Consignment;
  chainRoot: `0x${string}`;
}) {
  const computed = rootOf(consignment);
  const rootAgrees = computed.toLowerCase() === chainRoot.toLowerCase();
  const belongs = verifyMembership(tag.digest, tag.proof, chainRoot);
  const intake = consignment.items.find((i) => i.id === tag.itemId);

  return (
    <Paperwork
      title="What the paperwork says"
      hint="The published consignment — the creator's signed leaf and the path that places it under the root. Verified here, in this browser, not quoted."
    >
      <Facts>
        <Fact label="The leaf she signed" wide>
          <Bytes>{tag.digest}</Bytes>
        </Fact>
        <Fact label="Voucher pointer" wide>
          <Bytes>{tag.tag.pointer}</Bytes>
        </Fact>
        <Fact label="Priced at intake">{intake ? naira(BigInt(intake.price)) : "—"}</Fact>
        <Fact label="Its place">
          one of {consignment.items.length} leaves · {tag.proof.length}-step path
        </Fact>
      </Facts>

      <p className={`mt-4 text-sm leading-relaxed ${belongs && rootAgrees ? "text-good" : "text-bad"}`}>
        {belongs && rootAgrees ? (
          <>
            This browser walked the leaf up its path and landed on the root the chain holds. The paperwork is telling the
            truth — see{" "}
            <Link href="/creator" className="underline">
              the wall
            </Link>{" "}
            for the walk itself.
          </>
        ) : (
          <>The walk from this leaf does not reach the root the chain holds. This paperwork is not part of the consignment.</>
        )}
      </p>
    </Paperwork>
  );
}

/* ---- The honest dead end -------------------------------------------------------------------------- */

function NoPaperwork({ itemId, count }: { itemId: bigint; count: number }) {
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6 lg:p-8">
      <Panel title={`Item ${String(itemId)}: no paperwork names it`} tone="alarm">
        <p className="text-sm leading-relaxed text-ink-2">
          The published consignment commits to {count} leaves, and none of them is item {String(itemId)}. No creator signed
          a voucher for it, and no path leads from it to the root the chain holds. A tag claiming this number is a forgery
          — plausible-looking paperwork for an item that was never made.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-mut">
          That is the check working, not failing: the registry is asked who signed, never the tag. Try it live on the{" "}
          <Link href="/creator" className="underline">
            buyer&rsquo;s page
          </Link>
          .
        </p>
      </Panel>
    </main>
  );
}
