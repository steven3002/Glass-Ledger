"use client";

/**
 * The landlords: found, not registered.
 *
 * There is no landlord registry, on purpose — a shop that could write who the landlord is would be
 * asserting the very record it must later prove against. A landlord is the address a creator's
 * tranche names, which registered its own payout account from its own key, and which the 5% legs
 * paid or defaulted on. This page derives exactly that, address by address.
 */

import Link from "next/link";

import { CardSkeleton, ChainError, PageHeader, pct, useLedger } from "@/components/ledger-view";
import { Avatar } from "@/components/product";
import { Badge, Empty, Meter } from "@/components/ui";
import { naira } from "@/lib/format";
import { profilesOf } from "@/lib/ledger/profiles";

export default function LandlordsPage() {
  const { cage, holdings, problem } = useLedger();

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const landlords = holdings ? profilesOf(holdings, "landlord") : undefined;
  const totalOwed = landlords?.reduce((s, p) => s + p.purse.minted, 0n) ?? 0n;

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-6 lg:p-8">
      <PageHeader
        title="Landlords"
        sub="Nobody registers a landlord. The creator's tranche names one, his own key files his account, and the 5% legs do the rest — a profile is what those facts add up to."
      />

      {landlords && landlords.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Summary label="Landlords" value={String(landlords.length)} />
          <Summary label="Locations" value={String(new Set(landlords.flatMap((p) => p.tranches.map((t) => t.location))).size)} />
          <Summary label="Paid to spaces" value={naira(totalOwed)} />
          <Summary
            label="Defaults suffered"
            value={String(landlords.reduce((n, p) => n + p.purse.defaultedCount, 0))}
            tone={landlords.some((p) => p.purse.defaultedCount > 0) ? "alarm" : "plain"}
          />
        </div>
      )}

      {!landlords ? (
        <CardSkeleton rows={3} title tall />
      ) : landlords.length === 0 ? (
        <section className="card p-6">
          <Empty>No tranche has named a landlord yet.</Empty>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {landlords.map((profile) => {
            const place = profile.tranches[0]?.location ?? "a landlord the legs remember";
            const owedNow = profile.purse.owedNow;
            const provenPct = pct(profile.purse.proven, profile.purse.proven + owedNow + profile.purse.defaulted);
            return (
              <Link key={profile.address} href={`/who/${profile.address}`} className="card-tap flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <Avatar name={place} className="size-12" text="text-sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold text-ink">
                      {profile.tranches.length > 0 ? profile.tranches.map((t) => t.location).join(" · ") : place}
                    </div>
                    <div className="mt-0.5 font-mono text-[0.68rem] text-faint">{profile.address}</div>
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

                <div className="mt-4">
                  <Meter
                    segments={[
                      { pct: provenPct, tone: "good", label: "proven paid" },
                      { pct: pct(owedNow, profile.purse.proven + owedNow + profile.purse.defaulted), tone: "warn", label: "owed now" },
                      { pct: pct(profile.purse.defaulted, profile.purse.proven + owedNow + profile.purse.defaulted), tone: "alarm", label: "pool covered" },
                    ]}
                  />
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <Mini label="ever owed" value={naira(profile.purse.minted)} />
                    <Mini label="owed now" value={naira(owedNow)} />
                    <Mini label="proven paid" value={naira(profile.purse.proven)} tone="good" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <p className="px-1 text-xs leading-relaxed text-faint">
        The shop names none of these addresses. Each appears here because a creator&rsquo;s consignment named it, or because a
        sale minted a leg to it. The names of places are the tranche&rsquo;s own label; the money is the chain&rsquo;s.
      </p>
    </main>
  );
}

function Summary({ label, value, tone = "plain" }: { label: string; value: string; tone?: "plain" | "good" | "alarm" }) {
  return (
    <div className="card p-4">
      <div className="text-[0.62rem] font-medium uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone === "good" ? "text-good" : tone === "alarm" ? "text-bad" : "text-ink"}`}>
        {value}
      </div>
    </div>
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
