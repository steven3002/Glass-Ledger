"use client";

/**
 * The globe: the world as a sphere you can spin, with a pin wherever a consignment stands.
 *
 * It is a real orthographic projection — d3 rotates the whole earth and clips the far hemisphere, so a
 * pin on the back of the world is genuinely gone until you turn to it, not merely hidden. The landmass
 * ships inside the bundle (Natural Earth 1:110m), because the one thing this site refuses is a map that
 * goes blank when someone else's tile server does.
 *
 * Three motions share one loop: it drifts on its own, you can grab and turn it, and a caller can aim it
 * at a place. Reduced-motion stops the drift. The pins are the only colour — the globe has no series to
 * tell apart, so amber means exactly one thing: here.
 */

import { geoDistance, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { feature } from "topojson-client";

import land110 from "world-atlas/land-110m.json";

/* eslint-disable @typescript-eslint/no-explicit-any -- world-atlas ships untyped TopoJSON. */
const topo = land110 as any;
const world = feature(topo, topo.objects.land) as any;
/* eslint-enable @typescript-eslint/no-explicit-any */
const graticule = geoGraticule10();

export type GlobePoint = {
  key: string;
  label: string;
  /** What stands there, said in the tooltip. */
  sub: string;
  lat: number;
  lon: number;
  href?: string;
};

export function Globe({
  points,
  size = 560,
  focusKey,
}: {
  points: GlobePoint[];
  size?: number;
  /** When this changes, the globe turns to face that pin. */
  focusKey?: string;
}) {
  const router = useRouter();
  const rotation = useRef<[number, number]>([-3.4, -6.5]); // opens on Lagos, where the demo stands
  const dragging = useRef(false);
  const moved = useRef(false);
  const last = useRef<[number, number] | null>(null);
  const lastMoveAt = useRef(0);
  const velocity = useRef<[number, number]>([0, 0]); // deg/sec, the fling left on release
  const grabbed = useRef(false); // once the user takes hold, the ambient drift steps aside for good
  const focusTo = useRef<[number, number] | null>(null);
  const [, force] = useState(0);
  const [active, setActive] = useState<string>();

  const radius = size / 2 - 6;
  const projection = geoOrthographic()
    .scale(radius)
    .translate([size / 2, size / 2])
    .rotate([rotation.current[0], rotation.current[1]]);
  const draw = geoPath(projection);
  const landPath = draw(world) ?? "";
  const gridPath = draw(graticule) ?? "";

  // Aim: turn to a pin by the shortest way round.
  useEffect(() => {
    if (!focusKey) return;
    const pt = points.find((p) => p.key === focusKey);
    if (!pt) return;
    let targetLon = -pt.lon;
    const current = rotation.current[0];
    while (targetLon - current > 180) targetLon -= 360;
    while (targetLon - current < -180) targetLon += 360;
    focusTo.current = [targetLon, -pt.lat];
  }, [focusKey, points]);

  // The one loop, in priority order: ease toward an aim, coast on a fling, or drift when untouched.
  //
  // The fling is the point of it — release a drag and the world keeps turning the way you sent it,
  // shedding speed to a stop, so you can flick it toward a place and let it coast there. Dragging holds
  // it while the hand is down; once anything has been grabbed, the ambient drift stays out of the way,
  // because a globe that wanders off the moment you stop reading it is a globe fighting you.
  useEffect(() => {
    const reduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let prev = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - prev) / 1000);
      prev = t;

      if (focusTo.current) {
        const [tl, tp] = focusTo.current;
        const [l, p] = rotation.current;
        const nl = l + (tl - l) * Math.min(1, dt * 4.5);
        const np = p + (tp - p) * Math.min(1, dt * 4.5);
        if (Math.abs(tl - nl) < 0.15 && Math.abs(tp - np) < 0.15) {
          rotation.current = [tl, tp];
          focusTo.current = null;
        } else {
          rotation.current = [nl, np];
        }
        velocity.current = [0, 0];
        force((x) => x + 1);
      } else if (dragging.current) {
        // The hand is in charge; onMove drives the rotation directly.
      } else if (Math.hypot(velocity.current[0], velocity.current[1]) > 3) {
        const [vl, vp] = velocity.current;
        const [l, p] = rotation.current;
        rotation.current = [l + vl * dt, Math.max(-90, Math.min(90, p + vp * dt))];
        // Friction, frame-rate independent: ~0.94 per 60fps frame → a second-or-two glide to rest.
        const decay = Math.pow(0.94, dt / (1 / 60));
        velocity.current = [vl * decay, vp * decay];
        force((x) => x + 1);
      } else if (!grabbed.current && !active && !reduced) {
        rotation.current = [rotation.current[0] + dt * 5, rotation.current[1]];
        force((x) => x + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    dragging.current = true;
    grabbed.current = true;
    moved.current = false;
    last.current = [e.clientX, e.clientY];
    lastMoveAt.current = performance.now();
    velocity.current = [0, 0]; // a fresh grab starts from rest, not from the old fling
    focusTo.current = null;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragging.current || !last.current) return;
    const k = 0.26;
    const dx = e.clientX - last.current[0];
    const dy = e.clientY - last.current[1];
    if (Math.abs(dx) + Math.abs(dy) > 3) moved.current = true;
    last.current = [e.clientX, e.clientY];

    // Instantaneous velocity, in deg/sec, smoothed a touch and capped so a hard flick can't spin wild.
    const now = performance.now();
    const ms = Math.max(8, now - lastMoveAt.current);
    lastMoveAt.current = now;
    const vl = Math.max(-500, Math.min(500, ((dx * k) / ms) * 1000));
    const vp = Math.max(-500, Math.min(500, ((-dy * k) / ms) * 1000));
    velocity.current = [velocity.current[0] * 0.3 + vl * 0.7, velocity.current[1] * 0.3 + vp * 0.7];

    const [l, p] = rotation.current;
    rotation.current = [l + dx * k, Math.max(-90, Math.min(90, p - dy * k))];
    force((x) => x + 1);
  };
  const onUp = () => {
    dragging.current = false;
    last.current = null;
    // If the release came after a pause (no recent movement), there is no fling to carry.
    if (performance.now() - lastMoveAt.current > 80) velocity.current = [0, 0];
  };

  const placed = points
    .map((pt) => {
      const xy = projection([pt.lon, pt.lat]);
      const centre: [number, number] = [-rotation.current[0], -rotation.current[1]];
      const onNearSide = geoDistance([pt.lon, pt.lat], centre) < Math.PI / 2 - 0.02;
      return xy && onNearSide ? { ...pt, x: xy[0], y: xy[1] } : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const shown = placed.find((p) => p.key === active);

  return (
    <div className="relative select-none" style={{ maxWidth: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="w-full cursor-grab touch-none active:cursor-grabbing"
        style={{ filter: "drop-shadow(0 18px 34px rgba(20,22,28,0.16))" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        role="img"
        aria-label="An interactive globe with a pin at every location a consignment names. Drag to turn it."
      >
        <defs>
          <radialGradient id="globe-face" cx="34%" cy="30%" r="80%">
            <stop offset="0%" stopColor="var(--color-surface)" />
            <stop offset="60%" stopColor="var(--color-sunken)" />
            <stop offset="100%" stopColor="var(--color-raised)" />
          </radialGradient>
        </defs>

        <circle cx={size / 2} cy={size / 2} r={radius} fill="url(#globe-face)" stroke="var(--color-line-strong)" strokeWidth={1} />
        <path d={gridPath} fill="none" stroke="var(--color-line-strong)" strokeOpacity={0.45} strokeWidth={0.5} />
        <path
          d={landPath}
          fill="color-mix(in oklab, var(--color-ink-2) 16%, var(--color-sunken))"
          stroke="color-mix(in oklab, var(--color-ink-2) 28%, var(--color-sunken))"
          strokeWidth={0.4}
        />

        {placed.map((pin) => (
          <g
            key={pin.key}
            transform={`translate(${pin.x}, ${pin.y})`}
            role={pin.href ? "link" : "img"}
            tabIndex={0}
            aria-label={`${pin.label} — ${pin.sub}`}
            className="cursor-pointer outline-none"
            onMouseEnter={() => setActive(pin.key)}
            onMouseLeave={() => setActive((a) => (a === pin.key ? undefined : a))}
            onFocus={() => setActive(pin.key)}
            onBlur={() => setActive((a) => (a === pin.key ? undefined : a))}
            onClick={() => {
              if (moved.current) return; // a drag that ended on a pin is not a click
              if (pin.href) router.push(pin.href);
            }}
            onKeyDown={(e) => {
              if (pin.href && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                router.push(pin.href);
              }
            }}
          >
            <circle className="map-ping" r={9} fill="var(--color-accent-fill)" />
            <circle r={4.5} fill="var(--color-accent-fill)" stroke="#ffffff" strokeWidth={1.5} />
            <circle r={15} fill="transparent" />
          </g>
        ))}
      </svg>

      {shown && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-line bg-surface px-3 py-2 shadow-md"
          style={{ left: `${(shown.x / size) * 100}%`, top: `${((shown.y - 12) / size) * 100}%` }}
        >
          <div className="text-sm font-semibold whitespace-nowrap text-ink">{shown.label}</div>
          <div className="mt-0.5 text-xs whitespace-nowrap text-mut">{shown.sub}</div>
        </div>
      )}
    </div>
  );
}
