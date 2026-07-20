"use client";

/**
 * The shop's activity feed: what happened, in one word each.
 *
 * This is deliberately not the lifecycle spine. That belongs on an item's dossier, where a reader has
 * come to follow one thing's whole story and wants the causal order, the gaps between moments and the
 * transaction hashes. Here they are browsing a shop. The question is "is this line moving" — and the
 * answer is a run of rows saying minted, sold, claimed, each one a door back to the unit it happened
 * to.
 *
 * So the narration is thrown away on purpose. The same events that read as sentences on the item page
 * read here as a verb, a unit and a date, because a catalog page that made you read four lines of
 * prose per event would be answering a question nobody asked it.
 */

import Link from "next/link";

import { Pager, usePaged } from "./paged";
import { Empty } from "./ui";
import { age, naira } from "@/lib/format";
import type { Entry, Holdings } from "@/lib/ledger";

/**
 * The events a shopper recognises, and nothing else.
 *
 * Everything the protocol does to an item is in the log — allowance write-downs, penalties accruing,
 * claims being challenged — and almost none of it belongs on a shop page. What survives is what a
 * person browsing a line would understand without being taught the protocol first.
 */
const KINDS: Record<string, { code: string; label: string; tone: "plain" | "good" | "warn" | "alarm" }> = {
  PriceSeeded: { code: "new", label: "priced by the creator", tone: "plain" },
  Committed: { code: "ord", label: "ordered", tone: "warn" },
  Sold: { code: "buy", label: "sold", tone: "plain" },
  CertificateRedeemed: { code: "clm", label: "claimed by the buyer", tone: "good" },
  Fulfilled: { code: "out", label: "handed over", tone: "good" },
  CommitmentExpired: { code: "ret", label: "not handed over — refund due", tone: "alarm" },
  Burned: { code: "off", label: "written off", tone: "alarm" },
};

const SQUARE: Record<string, string> = {
  good: "border-[color-mix(in_oklab,var(--color-good-fill)_35%,white)] bg-[color-mix(in_oklab,var(--color-good-fill)_10%,white)] text-good",
  warn: "border-[color-mix(in_oklab,var(--color-accent-fill)_40%,white)] bg-[color-mix(in_oklab,var(--color-accent-fill)_12%,white)] text-accent",
  alarm: "border-[color-mix(in_oklab,var(--color-bad-fill)_35%,white)] bg-[color-mix(in_oklab,var(--color-bad-fill)_10%,white)] text-bad",
  plain: "border-line bg-sunken text-ink-2",
};

/** Whether a log line is one a shopper would recognise. */
export const isShopEvent = (entry: Entry): boolean => entry.itemId !== undefined && entry.name in KINDS;

export function Activity({
  entries,
  holdings,
  now,
  size = 8,
  empty = "Nothing has happened here yet.",
}: {
  /** Already narrowed to the units in question — this component does no filtering of its own. */
  entries: Entry[];
  holdings?: Holdings;
  now: number;
  size?: number;
  empty?: string;
}) {
  // Newest first. A shop feed is checked, not followed: the thing a reader wants is the most recent
  // sale, which is the opposite of what an item's life wants and worth the inconsistency.
  const feed = entries.filter(isShopEvent).slice().sort((a, b) => Number(b.at) - Number(a.at));
  const paged = usePaged(feed, size);

  if (feed.length === 0) return <Empty>{empty}</Empty>;

  return (
    <>
      <ul className="divide-y divide-line">
        {paged.slice.map((entry) => {
          const kind = KINDS[entry.name];
          const itemId = entry.itemId as bigint;
          const unit = holdings?.items.find((i) => i.id === itemId);

          return (
            <li key={entry.key} className="first:pt-0">
              {/* The whole row is the door back to the unit this happened to — a shopper who sees
                  "sold" wants to know which one, and that answer is the item's own page. */}
              <Link
                href={`/item/${String(itemId)}`}
                className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 text-sm transition-colors hover:bg-sunken"
              >
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-lg border text-[0.6rem] font-semibold uppercase ${
                    SQUARE[kind.tone]
                  }`}
                >
                  {kind.code}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink group-hover:underline">{kind.label}</div>
                  <div className="truncate font-mono text-[0.66rem] text-faint">
                    item {String(itemId)} · {age(entry.at, now)} ago
                  </div>
                </div>

                {unit && unit.price > 0n && (
                  <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-ink">
                    {naira(unit.price)}
                  </div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <Pager
        page={paged.page}
        pages={paged.pages}
        start={paged.start}
        size={paged.size}
        total={paged.total}
        onPrev={paged.prev}
        onNext={paged.next}
        noun="events"
      />
    </>
  );
}
