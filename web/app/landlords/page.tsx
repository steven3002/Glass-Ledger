"use client";

/**
 * The landlords: found, not registered.
 *
 * There is no landlord registry, on purpose — a shop that could write who the landlord is would be
 * asserting the very record it must later prove against. A landlord is the address a creator's
 * tranche names, which registered its own payout account from its own key, and which the 5% legs
 * paid or defaulted on. This page derives exactly that, address by address — arranged the way every
 * browse page here is: figures on one line, a filter ruled off, the cursor and format under the rule.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import { BrowseControls, FiguresRow, FilterRow, GRID_OF, PageFigure, type View } from "@/components/browse";
import { Dropdown } from "@/components/dropdown";
import { ChainError, pct, useLedger } from "@/components/ledger-view";
import { usePaged } from "@/components/paged";
import { Avatar } from "@/components/product";
import { TableShell, Td, Th, Tr } from "@/components/table";
import { Badge, Meter, Skeleton } from "@/components/ui";
import { naira, shortAddress } from "@/lib/format";
import { profilesOf, type Profile } from "@/lib/ledger/profiles";

export default function LandlordsPage() {
  const { cage, holdings, problem } = useLedger();
  const [place, setPlace] = useState("all");
  const [view, setView] = useState<View>("grid3");
  const [show, setShow] = useState(6);

  const landlords = useMemo(() => (holdings ? profilesOf(holdings, "landlord") : undefined), [holdings]);

  const places = useMemo(
    () => [...new Set((landlords ?? []).flatMap((p) => p.tranches.map((t) => t.location)))].sort(),
    [landlords],
  );

  const rows = useMemo(() => {
    const all = landlords ?? [];
    if (place === "all") return all;
    return all.filter((p) => p.tranches.some((t) => t.location === place));
  }, [landlords, place]);

  const paged = usePaged(rows, show);

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const totalOwed = landlords?.reduce((s, p) => s + p.purse.minted, 0n);
  const defaults = landlords?.reduce((n, p) => n + p.purse.defaultedCount, 0);

  return (
    <main className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10 lg:px-12">
      <h1 className="text-[32px] font-bold tracking-tight text-ink">Landlords</h1>
      <p className="mt-1 max-w-3xl text-sm text-mut">
        Nobody registers a landlord. The creator&rsquo;s tranche names one, his own key files his account, and the 5% legs do
        the rest — a profile is what those facts add up to.
      </p>

      <FiguresRow>
        <PageFigure label="Landlords" value={landlords ? String(landlords.length) : undefined} first />
        <PageFigure label="Locations" value={landlords ? String(places.length) : undefined} />
        <PageFigure label="Paid to spaces" value={totalOwed !== undefined ? naira(totalOwed) : undefined} />
        <PageFigure
          label="Defaults suffered"
          value={defaults !== undefined ? String(defaults) : undefined}
          tone={(defaults ?? 0) > 0 ? "alarm" : "plain"}
        />
      </FiguresRow>

      <FilterRow>
        <Dropdown
          prefix="Location"
          value={place}
          onChange={setPlace}
          options={[{ value: "all", label: "All" }, ...places.map((p) => ({ value: p, label: p }))]}
        />
        <span className="font-mono text-xs text-faint">
          {landlords ? `${rows.length} ${rows.length === 1 ? "landlord" : "landlords"}` : "…"}
        </span>
      </FilterRow>

      <BrowseControls cursor={paged} view={view} onView={setView} show={show} onShow={setShow} />

      {!landlords ? (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-52 w-full rounded-[var(--radius-card)]" />
          ))}
        </div>
      ) : paged.slice.length === 0 ? (
        <p className="mt-16 text-center text-sm text-faint">No landlord at this location yet — a tranche posting names one.</p>
      ) : view === "list" ? (
        <LandlordsTable rows={paged.slice} />
      ) : (
        <ul className={`mt-8 grid gap-5 ${GRID_OF[view]}`}>
          {paged.slice.map((profile) => (
            <LandlordCard key={profile.address} profile={profile} />
          ))}
        </ul>
      )}

      <p className="mt-10 px-1 text-xs leading-relaxed text-faint">
        The shop names none of these addresses. Each appears here because a creator&rsquo;s consignment named it, or because a
        sale minted a leg to it. The names of places are the tranche&rsquo;s own label; the money is the chain&rsquo;s.
      </p>
    </main>
  );
}

/** The list view: one landlord per row, as a real table. */
function LandlordsTable({ rows }: { rows: Profile[] }) {
  return (
    <TableShell
      head={
        <>
          <Th>Location</Th>
          <Th secondary>Address</Th>
          <Th secondary className="text-right">Ever owed</Th>
          <Th className="text-right">Owed now</Th>
          <Th secondary className="text-right">Proven paid</Th>
          <Th>Status</Th>
        </>
      }
    >
      {rows.map((profile) => {
        const place = profile.tranches[0]?.location ?? "a landlord the legs remember";
        return (
          <Tr key={profile.address} more>
            <Td label="Location" headline>
              <Link href={`/who/${profile.address}`} className="group flex items-center gap-3">
                <Avatar name={place} className="size-9" text="text-xs" />
                <span className="font-medium text-ink group-hover:underline">
                  {profile.tranches.length > 0 ? profile.tranches.map((t) => t.location).join(" · ") : place}
                </span>
              </Link>
            </Td>
            <Td label="Address" secondary className="font-mono text-xs text-mut">
              {shortAddress(profile.address)}
            </Td>
            <Td label="Ever owed" secondary className="text-right tabular-nums text-ink-2">
              {naira(profile.purse.minted)}
            </Td>
            <Td label="Owed now" className="text-right tabular-nums text-ink-2">
              {naira(profile.purse.owedNow)}
            </Td>
            <Td label="Proven paid" secondary className="text-right font-semibold tabular-nums text-good">
              {naira(profile.purse.proven)}
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
      })}
    </TableShell>
  );
}

/* ---- The card: the landlord's own design, kept — avatar, places, the money meter, the minis. ------- */

function LandlordCard({ profile }: { profile: Profile }) {
  const place = profile.tranches[0]?.location ?? "a landlord the legs remember";
  const owedNow = profile.purse.owedNow;
  const whole = profile.purse.proven + owedNow + profile.purse.defaulted;

  const head = (
    <div className="flex items-start gap-3">
      <Avatar name={place} className="size-12" text="text-sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-bold text-ink">
          {profile.tranches.length > 0 ? profile.tranches.map((t) => t.location).join(" · ") : place}
        </div>
        {/* Broken anywhere, not on words — an address has no words, so a card too narrow to hold it
            wraps it rather than shoving the row off the screen. The whole address stays readable:
            it is the identity here, and the tail is the half people actually compare. */}
        <div className="mt-0.5 font-mono text-[0.68rem] break-all text-faint">{profile.address}</div>
      </div>
      {profile.purse.defaultedCount > 0 ? (
        <Badge tone="alarm" dot>
          {profile.purse.defaultedCount} {profile.purse.defaultedCount === 1 ? "default" : "defaults"}
        </Badge>
      ) : (
        <Badge tone="good" dot>
          paid clean
        </Badge>
      )}
    </div>
  );

  const money = (
    <div>
      <Meter
        segments={[
          { pct: pct(profile.purse.proven, whole), tone: "good", label: "proven paid" },
          { pct: pct(owedNow, whole), tone: "warn", label: "owed now" },
          { pct: pct(profile.purse.defaulted, whole), tone: "alarm", label: "pool covered" },
        ]}
      />
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <Mini label="ever owed" value={naira(profile.purse.minted)} />
        <Mini label="owed now" value={naira(owedNow)} />
        <Mini label="proven paid" value={naira(profile.purse.proven)} tone="good" />
      </div>
    </div>
  );

  return (
    <li>
      <Link href={`/who/${profile.address}`} className="card group flex h-full flex-col p-5 transition-shadow hover:shadow-md">
        {head}
        <div className="mt-4">{money}</div>
      </Link>
    </li>
  );
}

function Mini({ label, value, tone = "plain" }: { label: string; value: string; tone?: "plain" | "good" | "alarm" }) {
  return (
    <div>
      <div className="text-[0.6rem] uppercase tracking-wider text-faint">{label}</div>
      <div className={`mt-0.5 font-semibold tabular-nums ${tone === "good" ? "text-good" : tone === "alarm" ? "text-bad" : "text-ink-2"}`}>{value}</div>
    </div>
  );
}
