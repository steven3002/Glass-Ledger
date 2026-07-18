/**
 * A product's stand-in image.
 *
 * The demo has no photographs, and its goods are not dresses, so an item shows as a tinted panel with
 * its monogram — a colour derived from the name, stable across the app. When real listings arrive the
 * photo takes this slot; until then this reads as "a product" without pretending to be one in
 * particular.
 */

const LOOKS: { from: string; to: string; ink: string }[] = [
  { from: "#f3e7e7", to: "#e7c9c9", ink: "#9d5a5a" }, // rose
  { from: "#e9f0ea", to: "#cadfce", ink: "#4f7a5f" }, // sage
  { from: "#f6ede2", to: "#e8d3ba", ink: "#a5713f" }, // terracotta
  { from: "#e9eff7", to: "#cddcf0", ink: "#4a6a97" }, // dusty blue
  { from: "#f5efe1", to: "#e7d7ad", ink: "#8a6f2f" }, // mustard
  { from: "#f1eaf0", to: "#dcc7db", ink: "#7a5175" }, // plum
  { from: "#e5f0ee", to: "#c4e0da", ink: "#3f7a70" }, // teal
  { from: "#f3ece4", to: "#e2cbb2", ink: "#8a6547" }, // clay
];

function look(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return LOOKS[h % LOOKS.length];
}

const monogram = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

export function ProductTile({ name, className = "" }: { name: string; className?: string }) {
  const l = look(name);
  return (
    <div
      className={`relative grid place-items-center overflow-hidden ${className}`}
      style={{ background: `linear-gradient(150deg, ${l.from}, ${l.to})` }}
      role="img"
      aria-label={name}
    >
      <span className="text-[2rem] font-semibold tracking-tight opacity-90 sm:text-[2.4rem]" style={{ color: l.ink }}>
        {monogram(name)}
      </span>
    </div>
  );
}

/** The same colour language, small and round — a person or a place, worn as a monogram. */
export function Avatar({ name, className = "size-11", text = "text-base" }: { name: string; className?: string; text?: string }) {
  const l = look(name);
  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-2xl ${className}`}
      style={{ background: `linear-gradient(150deg, ${l.from}, ${l.to})` }}
      aria-hidden
    >
      <span className={`font-bold tracking-tight ${text}`} style={{ color: l.ink }}>
        {monogram(name)}
      </span>
    </span>
  );
}
