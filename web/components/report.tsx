"use client";

/**
 * A verdict, and the four questions behind it.
 *
 * The verdict is the headline because that is what a person standing in a shop needs. The four checks
 * are underneath it, in the order the checkout itself asks them, because a verdict nobody can audit is
 * just another authority telling you what to think — and the whole point is that this one is not an
 * authority. Every line of evidence is bytes the reader can compare against the chain themselves.
 */

import { useState } from "react";

import { Badge, Bytes, Panel } from "@/components/ui";
import { naira } from "@/lib/format";
import type { Report, Verdict } from "@/lib/verify";

const HEADLINE: Record<Verdict, { tone: "good" | "alarm" | "plain"; word: string }> = {
  GENUINE: { tone: "good", word: "Genuine" },
  RESERVED: { tone: "plain", word: "Genuine · ordered" },
  ALREADY_SOLD: { tone: "alarm", word: "Already sold" },
  FORGED: { tone: "alarm", word: "Forged" },
  WRITTEN_OFF: { tone: "alarm", word: "Written off" },
  UNREADABLE: { tone: "alarm", word: "Not a tag" },
};

export function VerificationReport({ report }: { report: Report }) {
  const headline = HEADLINE[report.verdict];

  return (
    <div className="space-y-4">
      <Panel tone={headline.tone === "plain" ? "plain" : headline.tone}>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={headline.tone === "good" ? "good" : headline.tone === "alarm" ? "alarm" : "plain"}>
            {headline.word}
          </Badge>
          {report.itemId !== undefined && (
            <span className="text-sm text-neutral-500">item {String(report.itemId)}</span>
          )}
          {report.price !== undefined && report.price > 0n && (
            <span className="text-sm text-neutral-500">{naira(report.price)}</span>
          )}
        </div>

        <h2 className="mt-3 text-2xl font-semibold tracking-tight">{report.headline}</h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-neutral-300">{report.meaning}</p>
      </Panel>

      <Panel
        title="What your browser just checked"
        hint={`Four questions, asked in the order the counter asks them. The voucher came from ${report.source} — no part of this went through the shop.`}
      >
        <ol className="space-y-3">
          {report.checks.map((check) => (
            <Check key={check.title} check={check} />
          ))}
        </ol>
      </Panel>
    </div>
  );
}

function Check({ check }: { check: Report["checks"][number] }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-t border-neutral-900 pt-3 first:border-0 first:pt-0">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            check.passed ? "bg-emerald-900 text-emerald-300" : "bg-red-900 text-red-300"
          }`}
          aria-hidden
        >
          {check.passed ? "✓" : "✕"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-neutral-200">{check.title}</div>
          <p className="mt-0.5 text-sm leading-relaxed text-neutral-400">{check.detail}</p>

          {check.evidence && check.evidence.length > 0 && (
            <>
              <button
                onClick={() => setOpen(!open)}
                className="mt-1.5 text-xs text-neutral-500 underline underline-offset-4 hover:text-neutral-300"
              >
                {open ? "hide the bytes" : "show me the bytes"}
              </button>

              {open && (
                <dl className="mt-2 space-y-1.5 rounded-lg border border-neutral-900 bg-black/40 p-3">
                  {check.evidence.map((line, i) => (
                    <div key={`${line.label}-${i}`} className="grid gap-0.5 sm:grid-cols-[13rem_1fr] sm:gap-3">
                      <dt className="text-xs text-neutral-600">{line.label}</dt>
                      <dd>
                        <Bytes>{line.value}</Bytes>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}
