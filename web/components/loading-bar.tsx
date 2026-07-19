"use client";

/**
 * The thin line across the top of every page that says the ledger is still arriving.
 *
 * It is pinned above the header rather than inside it, because the header has a `backdrop-blur` and
 * an ancestor with a backdrop filter becomes the containing block for `position: fixed` descendants —
 * the same trap that once rendered the mobile drawer at exactly the header's size. Sitting outside
 * that subtree, `fixed inset-x-0 top-0` means the viewport, which is what it looks like it means.
 *
 * What it draws is the read's real shape: a third when the cage lands, two thirds at the holdings,
 * full when the history — the heaviest stage, a log scan from block zero — finally answers. There is
 * no invented creep toward 90%. A progress bar that makes up its own progress is a small lie told
 * for comfort, and this is not a product that gets to tell those.
 *
 * It also stays out of the way when there is nothing to say: after the first complete read it
 * disappears and the three-second re-poll never brings it back, because data already on screen being
 * refreshed is not something a reader needs to watch.
 */

import { useEffect, useState } from "react";

import { loading, progress, subscribe } from "@/lib/progress";

export function LoadingBar() {
  const [shown, setShown] = useState(false);
  const [width, setWidth] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // The fade timer is held here rather than returned from `apply`, because `apply` is also a
    // subscriber callback and a subscriber's return value goes nowhere — a cleanup handed to
    // something that does not call cleanups is not a cleanup, it is a leak with good intentions.
    let fade: number | undefined;

    const apply = () => {
      setWidth(progress());
      if (loading()) {
        if (fade !== undefined) window.clearTimeout(fade);
        fade = undefined;
        setShown(true);
        setDone(false);
        return;
      }
      // Let the bar reach the right edge before it goes, so finishing is something a reader sees
      // happen rather than a bar that was there and then simply was not.
      setDone(true);
      if (fade === undefined) fade = window.setTimeout(() => setShown(false), 420);
    };

    apply();
    const unsubscribe = subscribe(apply);
    return () => {
      unsubscribe();
      if (fade !== undefined) window.clearTimeout(fade);
    };
  }, []);

  if (!shown) return null;

  return (
    <div
      role="progressbar"
      aria-label="Reading the ledger from the chain"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width * 100)}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5"
    >
      <div
        className="relative h-full bg-accent-fill transition-[width,opacity] duration-500 ease-out"
        style={{
          width: `${Math.max(width, 0.06) * 100}%`,
          opacity: done ? 0 : 1,
          boxShadow: "0 0 8px color-mix(in oklab, var(--color-accent-fill) 70%, transparent)",
        }}
      >
        {/* Between stages the width does not move for seconds at a time, because nothing has
            happened. The tip pulses so that stillness reads as waiting rather than as broken. */}
        {!done && (
          <span
            aria-hidden
            className="gl-bar-tip absolute right-0 top-0 h-full w-16 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, transparent, color-mix(in oklab, var(--color-accent-fill) 85%, white))",
            }}
          />
        )}
      </div>
    </div>
  );
}
