"use client";

/**
 * The map, full-bleed: the globe is the background of the whole view, and everything else floats over it.
 *
 * The layout is layered, not stacked. The window itself does not scroll — the body is pinned — so the
 * mouse wheel belongs to the globe (it zooms) rather than to the page. The world is a fixed layer flush
 * to the content edge; the places along the foot of it are a second fixed layer above. Click the world
 * and the left rail folds away, because a map wants the room. Nothing here sits in the document flow.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Globe, type GlobePoint } from "@/components/globe";
import { ChainError, useLedger } from "@/components/ledger-view";
import { Badge } from "@/components/ui";
import { naira, shortAddress } from "@/lib/format";
import type { Holdings } from "@/lib/ledger";
import { placeOf } from "@/lib/places";

type Location = {
  key: string;
  label: string;
  lat: number;
  lon: number;
  collections: number;
  items: number;
  sales: number;
  landlords: string[];
};

function salesByCreator(holdings?: Holdings): Map<string, number> {
  const map = new Map<string, number>();
  for (const debt of holdings?.debts ?? []) {
    if (debt.role !== "creator") continue;
    const key = String(debt.creatorId);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

export default function MapPage() {
  const { cage, holdings, problem } = useLedger();
  const [focus, setFocus] = useState<string>();
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // The window must not scroll, so the wheel is the globe's to zoom. Restored when the map is left.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // The wheel and the pinch belong to the globe, not the browser.
  //
  // A trackpad pinch reaches the page as a wheel event with `ctrlKey` set, and the browser reads that
  // as page-zoom. React binds onWheel passively, so it cannot cancel it — which is why a pinch was
  // zooming the page *and* the globe at once. The cure is a native, non-passive listener that calls
  // preventDefault, so the gesture never reaches the browser's zoom. Safari sends its own gesture
  // events for the same pinch, so those are caught too.
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;

    const set = (factor: number) => setZoom((z) => Math.min(2.6, Math.max(0.7, z * factor)));

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      set(e.ctrlKey ? Math.exp(-e.deltaY / 120) : e.deltaY < 0 ? 1.1 : 0.91);
    };

    let base = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      base = zoomRef.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const scale = (e as Event & { scale?: number }).scale ?? 1;
      setZoom(Math.min(2.6, Math.max(0.7, base * scale)));
    };
    const onGestureEnd = (e: Event) => e.preventDefault();

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart, { passive: false });
    el.addEventListener("gesturechange", onGestureChange, { passive: false });
    el.addEventListener("gestureend", onGestureEnd, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
    };
  }, []);

  const { list, unplaced } = useMemo(() => {
    const sales = salesByCreator(holdings);
    const groups = new Map<string, Location & { landlordSet: Set<string> }>();
    const un: string[] = [];

    for (const tranche of holdings?.tranches ?? []) {
      const place = placeOf(tranche.location);
      if (!place) {
        if (!un.includes(tranche.location)) un.push(tranche.location);
        continue;
      }
      const group =
        groups.get(place.name) ??
        ({
          key: place.name,
          label: place.name,
          lat: place.lat,
          lon: place.lon,
          collections: 0,
          items: 0,
          sales: 0,
          landlordSet: new Set<string>(),
          landlords: [],
        } as Location & { landlordSet: Set<string> });
      group.collections += 1;
      group.items += tranche.itemCount;
      group.sales += sales.get(String(tranche.creatorId)) ?? 0;
      group.landlordSet.add(tranche.landlord);
      groups.set(place.name, group);
    }

    const list: Location[] = [...groups.values()]
      .map((g) => ({ ...g, landlords: [...g.landlordSet] }))
      .sort((a, b) => b.sales - a.sales || b.collections - a.collections);

    return { list, unplaced: un };
  }, [holdings]);

  const points = useMemo<GlobePoint[]>(
    () =>
      list.map((l) => ({
        key: l.key,
        label: l.label,
        sub:
          `${l.collections} ${l.collections === 1 ? "collection" : "collections"} · ` +
          `${l.landlords.length === 1 ? `landlord ${shortAddress(l.landlords[0])}` : `${l.landlords.length} landlords`}`,
        lat: l.lat,
        lon: l.lon,
        href: "/collections",
      })),
    [list],
  );

  // The globe is memoised on its own inputs, so a zoom change re-renders only the transform around it —
  // never the globe itself. Re-rendering the globe (it recomputes its land path) on every pinch delta
  // is what made the zoom judder.
  const globe = useMemo(() => <Globe points={points} focusKey={focus} size={680} />, [points, focus]);

  if (problem && !cage) {
    return (
      <main className="mx-auto max-w-3xl p-6 lg:p-8">
        <ChainError problem={problem} />
      </main>
    );
  }

  const foldRail = () => window.dispatchEvent(new Event("gl-sidebar-collapse"));
  const edge = { left: "var(--gl-sidebar-w, 0px)" };

  return (
    <>
      {/* The world — the background layer, flush to the content edge, behind the floating cards. */}
      <div
        ref={mapRef}
        className="fixed top-0 right-0 bottom-0 z-0 flex touch-none items-center justify-center overflow-hidden overscroll-none transition-[left] duration-200"
        style={edge}
        onClick={foldRail}
      >
        {!holdings ? (
          <div className="skeleton aspect-square w-full max-w-[min(74vh,720px)] rounded-full" />
        ) : points.length === 0 ? (
          <p className="max-w-sm px-6 text-center text-sm text-faint">
            No consignment names a location yet. The world fills in as roots are posted.
          </p>
        ) : (
          <div
            className="w-full max-w-[min(78vh,760px)] px-4"
            style={{ transform: `scale(${zoom})`, transformOrigin: "center", willChange: "transform" }}
          >
            {globe}
          </div>
        )}

        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-[0.7rem] text-faint">
          scroll to zoom · drag to turn · click to clear the rail
        </div>
      </div>

      {/* The places — a second fixed layer, floating over the world at the foot of the screen. */}
      <div
        className="fixed right-0 bottom-0 z-10 transition-[left] duration-200"
        style={edge}
      >
        <div className="pointer-events-none bg-gradient-to-t from-bg/70 to-transparent px-4 pt-10 pb-4 sm:px-6">
          <div className="pointer-events-auto flex items-stretch gap-3 overflow-x-auto pb-1">
            {!holdings
              ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-[4.75rem] w-60 shrink-0 rounded-xl" />)
              : list.map((l) => (
                  <button
                    key={l.key}
                    type="button"
                    onClick={() => setFocus(l.key)}
                    data-active={focus === l.key}
                    className="card w-60 shrink-0 p-3 text-left transition-transform hover:-translate-y-0.5"
                    style={{ boxShadow: "var(--shadow-pop)" }}
                    title={`Turn the globe to ${l.label}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-ink">{l.label}</span>
                      <span className="size-1.5 shrink-0 rounded-full bg-accent-fill" aria-hidden />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[0.68rem] text-faint">
                      <span>{l.collections} coll.</span>
                      <span>{l.items} items</span>
                      <span>
                        {l.sales} {l.sales === 1 ? "sale" : "sales"}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="truncate text-[0.66rem] text-faint">
                        {l.landlords.length === 1 ? shortAddress(l.landlords[0]) : `${l.landlords.length} landlords`}
                      </span>
                      <Link
                        href="/collections"
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0 text-[0.7rem] font-medium text-mut transition-colors hover:text-ink"
                      >
                        open →
                      </Link>
                    </div>
                  </button>
                ))}

            {holdings &&
              unplaced.map((label) => (
                <div key={label} className="w-60 shrink-0 rounded-[var(--radius-inner)] border border-dashed border-line-strong bg-raised/80 p-3 backdrop-blur">
                  <div className="truncate text-sm font-semibold text-ink-2">{label}</div>
                  <div className="mt-1 text-[0.68rem] text-faint">named on chain · not on this atlas</div>
                  <div className="mt-2">
                    <Badge tone="quiet">unplotted</Badge>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}
