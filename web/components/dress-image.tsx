/**
 * A stand-in product photo for a dress.
 *
 * Real photography would come from the creator's listing; here each item gets a drawn silhouette in a
 * colour of its own, generated from its id. It is an SVG rendered in the browser rather than a fetch to
 * some image host — the same reason the vouchers are content-addressed: a page that keeps working with
 * the shop switched off should not quietly depend on a shop's CDN either. A clone shares its original's
 * id, so it shares its picture — which is the whole point of a clone.
 */

const LOOKS: { c: string; b: string }[] = [
  { c: "#c67b7b", b: "#f6eaea" }, // rose
  { c: "#7f9d84", b: "#eaf1ec" }, // sage
  { c: "#c68a63", b: "#f6ede4" }, // terracotta
  { c: "#7e9bc0", b: "#e9eff7" }, // dusty blue
  { c: "#c5a250", b: "#f5efe1" }, // mustard
  { c: "#a3789c", b: "#f1eaf0" }, // plum
  { c: "#5fa397", b: "#e5f0ee" }, // teal
  { c: "#b08968", b: "#f3ece4" }, // clay
  { c: "#74787f", b: "#eceef0" }, // charcoal
];

export function DressImage({ id, className = "", label }: { id: number; className?: string; label?: string }) {
  const look = LOOKS[Math.abs(id) % LOOKS.length];
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ background: `linear-gradient(155deg, ${look.b}, #ffffff 85%)` }}
      role="img"
      aria-label={label ?? "An item"}
    >
      <svg viewBox="0 0 100 120" className="absolute inset-0 size-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
        {/* straps */}
        <path d="M41 31 L45 20 M59 31 L55 20" stroke={look.c} strokeWidth="3.2" strokeLinecap="round" fill="none" />
        {/* dress body — scoop neck, fitted waist, A-line skirt */}
        <path d="M38 32 Q50 43 62 32 L64.5 44 Q60.5 55 60 58 L75 104 Q50 110 25 104 L40 58 Q39.5 55 35.5 44 Z" fill={look.c} />
        {/* waist belt */}
        <path d="M40 58 Q50 63 60 58 L60.6 62.5 Q50 67 39.4 62.5 Z" fill="rgba(0,0,0,0.16)" />
        {/* fold highlight */}
        <path d="M47 37 Q48 60 41 101 L37 100 Q45 60 44 38 Z" fill="rgba(255,255,255,0.2)" />
      </svg>
    </div>
  );
}
