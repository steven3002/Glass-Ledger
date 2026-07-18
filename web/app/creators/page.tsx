"use client";

/**
 * The creators: the only identity the protocol registers.
 *
 * Each is a registered signing key and everything the ledger has come to know around it — her
 * collections, her money, and the capacity Good has earned *with her*, the number a farmer cannot
 * manufacture. The catalog lends a face and a name; the chain lends the money and the till.
 */

import Link from "next/link";

import { CardSkeleton, ChainError, PageHeader, pct, useLedger } from "@/components/ledger-view";
import { Avatar, ProductTile } from "@/components/product";
import { Badge, Empty, Meter } from "@/components/ui";
import { naira, shortAddress } from "@/lib/format";
import { byCreator, creatorName } from "@/lib/demo/catalog";
import { purseOf } from "@/lib/ledger/profiles";

export default function CreatorsPage() {
  const { cage, holdings, problem } = useLedger();

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const totalVolume = (holdings?.debts ?? [])
    .filter((d) => d.role !== "buyer")
    .reduce((sum, d) => sum + d.amount, 0n);

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-6 lg:p-8">
      <PageHeader
        title="Creators"
        sub="The registry's whole population: a creator is a signing key, and every voucher is checked against it — nothing else is ever asked."
      />

      {cage && cage.capacity.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Summary label="Creators" value={String(cage.capacity.length)} />
          <Summary label="Open tills" value={String(cage.capacity.filter((c) => c.headroom > 0n).length)} tone="good" />
          <Summary label="Volume" value={holdings ? naira(totalVolume) : undefined} />
          <Summary label="Collections" value={String(new Set(cage.capacity.flatMap((c) => byCreator(Number(c.creatorId)).map((x) => x.id))).size)} />
        </div>
      )}

      {!cage ? (
        <CardSkeleton rows={3} title tall />
      ) : cage.capacity.length === 0 ? (
        <section className="card p-6">
          <Empty>Nobody has registered yet. A creator exists the moment her key does.</Empty>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {cage.capacity.map((row) => {
            const id = Number(row.creatorId);
            const purse = purseOf((holdings?.debts ?? []).filter((d) => d.role === "creator" && d.creatorId === row.creatorId));
            const lines = byCreator(id);
            const name = creatorName(id) ?? `Creator #${id}`;
            const shut = row.headroom === 0n;

            return (
              <Link key={String(row.creatorId)} href={`/creators/${String(row.creatorId)}`} className="card-tap group flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <Avatar name={name} className="size-12" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-semibold text-ink group-hover:underline">{name}</span>
                      <span className="shrink-0 rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[0.62rem] text-mut">#{id}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[0.68rem] text-faint">signs as {shortAddress(row.key)}</div>
                  </div>
                  <Badge tone={shut ? "alarm" : "good"} dot>
                    {shut ? "till shut" : "till open"}
                  </Badge>
                </div>

                {/* Her lines, as a strip of covers — the visual life of the card. */}
                {lines.length > 0 && (
                  <div className="mt-4 flex gap-2">
                    {lines.map((c) => (
                      <div key={c.id} className="min-w-0 flex-1">
                        <ProductTile name={c.name} className="aspect-[16/10] w-full rounded-lg" />
                        <div className="mt-1 truncate text-[0.68rem] font-medium text-mut">{c.name}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4">
                  <Meter segments={[{ pct: pct(row.outstanding, row.outstanding + row.headroom), tone: shut ? "alarm" : "ink", label: "held" }]} />
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <Mini label="sales" value={holdings ? String(purse.mintedCount) : undefined} />
                    <Mini label="owed now" value={holdings ? naira(purse.owedNow) : undefined} />
                    <Mini label="headroom" value={naira(row.headroom)} tone={shut ? "alarm" : "good"} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}

function Summary({ label, value, tone = "plain" }: { label: string; value?: string; tone?: "plain" | "good" }) {
  return (
    <div className="card p-4">
      <div className="text-[0.62rem] font-medium uppercase tracking-[0.12em] text-faint">{label}</div>
      {value !== undefined ? (
        <div className={`mt-1 text-xl font-semibold tabular-nums ${tone === "good" ? "text-good" : "text-ink"}`}>{value}</div>
      ) : (
        <div className="skeleton mt-1.5 h-6 w-16" />
      )}
    </div>
  );
}

function Mini({ label, value, tone = "plain" }: { label: string; value?: string; tone?: "plain" | "good" | "alarm" }) {
  return (
    <div>
      <div className="text-[0.6rem] uppercase tracking-wider text-faint">{label}</div>
      {value !== undefined ? (
        <div className={`mt-0.5 font-semibold tabular-nums ${tone === "good" ? "text-good" : tone === "alarm" ? "text-bad" : "text-ink-2"}`}>{value}</div>
      ) : (
        <div className="skeleton mt-1 h-3.5 w-12" />
      )}
    </div>
  );
}
