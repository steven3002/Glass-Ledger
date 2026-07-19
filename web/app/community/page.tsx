"use client";

/**
 * The community: the 2.5% that walked in with the buyer.
 *
 * A community owner exists per sale, bound by the voucher presented at checkout — half a referral is
 * not a referral, so the leg needs a recipient and a voucher hash or neither. The page wears the browse
 * standard; the board itself keeps its own shape — ranked rows, medals for the podium — with a card
 * variant when the grid is asked for. Absolute amounts only: no rates, no averages, because a rate has
 * a denominator and a denominator is what a farmer manufactures.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import { BrowseControls, FiguresRow, FilterRow, GRID_OF, PageFigure, type View } from "@/components/browse";
import { Dropdown } from "@/components/dropdown";
import { ChainError, useLedger } from "@/components/ledger-view";
import { usePaged } from "@/components/paged";
import { Avatar } from "@/components/product";
import { TableShell, Td, Th, Tr } from "@/components/table";
import { Badge, Skeleton } from "@/components/ui";
import { naira, shortAddress } from "@/lib/format";
import { profilesOf, type Profile } from "@/lib/ledger/profiles";

const MEDAL = ["#d9a441", "#a9b0bb", "#c08457"]; // gold, silver, bronze

type Rank = "minted" | "owedNow" | "proven";
const RANKS: { value: Rank; label: string }[] = [
  { value: "minted", label: "Ever minted" },
  { value: "owedNow", label: "Owed now" },
  { value: "proven", label: "Proven paid" },
];

export default function CommunityPage() {
  const { cage, holdings, problem } = useLedger();
  const [rank, setRank] = useState<Rank>("minted");
  const [view, setView] = useState<View>("list");
  const [show, setShow] = useState(10);

  const owners = useMemo(() => {
    if (!holdings) return undefined;
    const all = [...profilesOf(holdings, "community")];
    all.sort((a, b) => (b.purse[rank] > a.purse[rank] ? 1 : b.purse[rank] < a.purse[rank] ? -1 : 0));
    return all;
  }, [holdings, rank]);

  const paged = usePaged(owners ?? [], show);

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const totalMinted = owners?.reduce((s, p) => s + p.purse.minted, 0n);
  const totalReferrals = owners?.reduce((n, p) => n + p.purse.mintedCount, 0);
  const defaults = owners?.reduce((n, p) => n + p.purse.defaultedCount, 0);

  return (
    <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10 lg:px-12">
      <h1 className="text-[32px] font-bold tracking-tight text-ink">Community</h1>
      <p className="mt-1 max-w-3xl text-sm text-mut">
        Whoever brought the buyer, paid by the sale itself: the 2.5% leg mints against a voucher presented at the counter,
        and the ledger remembers every one.
      </p>

      <FiguresRow>
        <PageFigure label="Referrers" value={owners ? String(owners.length) : undefined} first />
        <PageFigure label="Referrals" value={totalReferrals !== undefined ? String(totalReferrals) : undefined} />
        <PageFigure label="Paid to community" value={totalMinted !== undefined ? naira(totalMinted) : undefined} tone="good" />
        <PageFigure label="Defaults" value={defaults !== undefined ? String(defaults) : undefined} tone={(defaults ?? 0) > 0 ? "alarm" : "plain"} />
      </FiguresRow>

      <FilterRow>
        <Dropdown prefix="Rank by" value={rank} onChange={setRank} options={RANKS} />
        <span className="font-mono text-xs text-faint">
          {owners ? `${owners.length} ${owners.length === 1 ? "referrer" : "referrers"}` : "…"}
        </span>
      </FilterRow>

      <BrowseControls cursor={paged} view={view} onView={setView} show={show} onShow={setShow} sizes={[10, 20, 50]} />

      {!owners ? (
        <Skeleton className="mt-8 h-64 w-full rounded-[var(--radius-card)]" />
      ) : paged.slice.length === 0 ? (
        <p className="mt-16 text-center text-sm text-faint">
          No sale has carried a community voucher yet. The leg exists the moment one is presented at checkout.
        </p>
      ) : view === "list" ? (
        <TableShell
          head={
            <>
              <Th className="w-12">#</Th>
              <Th>Referrer</Th>
              <Th className="text-right">Referrals</Th>
              <Th className="text-right">Owed now</Th>
              <Th className="text-right">Proven paid</Th>
              <Th className="text-right">Ever minted</Th>
              <Th>Status</Th>
            </>
          }
        >
          {paged.slice.map((profile, i) => (
            <BoardRow key={profile.address} profile={profile} rank={paged.start + i} highlight={rank} />
          ))}
        </TableShell>
      ) : (
        <ol className={`mt-8 grid gap-5 ${GRID_OF[view]}`}>
          {paged.slice.map((profile, i) => (
            <BoardCard key={profile.address} profile={profile} rank={paged.start + i} highlight={rank} />
          ))}
        </ol>
      )}
    </main>
  );
}

/* ---- The medal, shared by both shapes ------------------------------------------------------------- */

function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className="grid size-8 shrink-0 place-items-center rounded-lg text-sm font-bold tabular-nums"
      style={
        rank < 3
          ? { background: `color-mix(in oklab, ${MEDAL[rank]} 22%, white)`, color: `color-mix(in oklab, ${MEDAL[rank]} 70%, black)` }
          : { background: "var(--color-sunken)", color: "var(--color-mut)" }
      }
    >
      {rank + 1}
    </span>
  );
}

/** The number the board is currently ranked by, said loudest. */
function headline(profile: Profile, highlight: Rank): { value: string; caption: string } {
  if (highlight === "owedNow") return { value: naira(profile.purse.owedNow), caption: "owed now" };
  if (highlight === "proven") return { value: naira(profile.purse.proven), caption: "proven paid" };
  return { value: naira(profile.purse.minted), caption: "ever minted" };
}

/* ---- The board row: the leaderboard as a table row, the medal kept ------------------------------- */

function BoardRow({ profile, rank, highlight }: { profile: Profile; rank: number; highlight: Rank }) {
  const lead = (col: Rank) => (col === highlight ? "font-semibold text-ink" : "text-ink-2");
  return (
    <Tr more>
      <Td label="Rank" secondary>
        <RankBadge rank={rank} />
      </Td>
      <Td label="Referrer" headline>
        <Link href={`/who/${profile.address}`} className="group flex items-center gap-3">
          <Avatar name={profile.address} className="size-9" text="text-xs" />
          <span className="font-mono text-sm font-medium text-ink group-hover:underline">{shortAddress(profile.address)}</span>
        </Link>
      </Td>
      <Td label="Referrals" secondary className="text-right tabular-nums text-ink-2">
        {profile.purse.mintedCount}
      </Td>
      <Td label="Owed now" className={`text-right tabular-nums ${lead("owedNow")}`}>
        {naira(profile.purse.owedNow)}
      </Td>
      <Td
        label="Proven paid"
        secondary
        className={`text-right tabular-nums ${highlight === "proven" ? "font-semibold" : ""} text-good`}
      >
        {naira(profile.purse.proven)}
      </Td>
      <Td label="Ever minted" secondary className={`text-right tabular-nums ${lead("minted")}`}>
        {naira(profile.purse.minted)}
      </Td>
      <Td label="Status">
        {profile.purse.defaultedCount > 0 ? (
          <Badge tone="alarm">
            {profile.purse.defaultedCount} {profile.purse.defaultedCount === 1 ? "default" : "defaults"}
          </Badge>
        ) : (
          <Badge tone="good">paid clean</Badge>
        )}
      </Td>
    </Tr>
  );
}

/* ---- The card variant, for the grids -------------------------------------------------------------- */

function BoardCard({ profile, rank, highlight }: { profile: Profile; rank: number; highlight: Rank }) {
  const top = headline(profile, highlight);
  return (
    <li>
      <Link href={`/who/${profile.address}`} className="card flex h-full flex-col p-5 transition-shadow hover:shadow-md">
        <div className="flex items-start gap-3">
          <RankBadge rank={rank} />
          <Avatar name={profile.address} className="size-10" text="text-xs" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-sm font-semibold text-ink">{shortAddress(profile.address)}</div>
            <div className="mt-0.5 text-xs text-mut">
              {profile.purse.mintedCount} {profile.purse.mintedCount === 1 ? "referral" : "referrals"}
            </div>
          </div>
          {profile.purse.defaultedCount > 0 && (
            <Badge tone="alarm" dot>
              {profile.purse.defaultedCount}
            </Badge>
          )}
        </div>
        <div className="mt-4 flex items-end justify-between border-t border-line pt-3">
          <div>
            <div className="text-[0.6rem] uppercase tracking-wider text-faint">{top.caption}</div>
            <div className="mt-0.5 text-lg font-bold tabular-nums text-ink">{top.value}</div>
          </div>
          <div className="text-right text-xs text-mut">
            <div>
              proven <strong className="font-semibold tabular-nums text-good">{naira(profile.purse.proven)}</strong>
            </div>
            <div className="mt-0.5">
              owed now <strong className="font-semibold tabular-nums text-ink-2">{naira(profile.purse.owedNow)}</strong>
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}
