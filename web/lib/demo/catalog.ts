/**
 * The demo catalog — a stand-in for the indexer.
 *
 * This is NOT chain data. It is hand-written demo content so the merchandising surfaces (collections →
 * items → an item's locations, prices, stock and activity) can take shape before the real index and the
 * signed metadata of s12 exist. When that lands, this module is what gets replaced: the shapes here are
 * the shapes the indexer will serve.
 *
 * The hierarchy is the one the protocol implies:
 *   Collection   a creator's line — "Àṣẹ Atelier". Not a chain object; a grouping in signed metadata.
 *   Item         a unique product in it — "Burnt Wood". Has stock, and a price that varies by location.
 *   (a unit)     one physical piece — one on-chain leaf that sells once. Units show up as activity.
 *
 * Price and location are the kind of thing the chain proves per-unit; stock, the roll-up by design, and
 * the activity feed are the kind of thing an indexer derives. The UI says which is which.
 */

export type Availability = {
  location: string;
  /** NGN, whole naira (demo values are plain numbers, not on-chain wei). */
  price: number;
  /** Units on the shelf at this location right now. */
  stock: number;
  /** Units sold at this location to date. */
  sold: number;
};

export type CatalogItem = {
  id: string;
  name: string;
  blurb: string;
  /** Where it is, and for how much — the same design at different prices in different places. */
  at: Availability[];
};

export type Collection = {
  id: string;
  name: string;
  creatorId: number;
  creatorName: string;
  /** The line's shelf in the shop — fashion, fragrance, lifestyle… A browsing facet, not a chain fact. */
  category: string;
  blurb: string;
  items: CatalogItem[];
};

export type Txn = {
  id: string;
  location: string;
  price: number;
  buyer: string;
  /** Seconds ago, for a relative label. */
  ago: number;
  kind: "sold" | "claimed";
};

/** Whole naira, for the demo's plain numbers. */
export const ngn = (n: number) => `₦${n.toLocaleString("en-NG")}`;

export const CATALOG: Collection[] = [
  {
    id: "ase-atelier",
    name: "Àṣẹ Atelier",
    creatorId: 1,
    creatorName: "Amara Okonkwo",
    category: "Fragrance",
    blurb: "Hand-poured incense and perfume oils, blended in Lagos and carried by hand to the counters that stock them.",
    items: [
      {
        id: "burnt-wood",
        name: "Burnt Wood",
        blurb: "Smoked cedar and a dry ember finish. The one that started the line.",
        at: [
          { location: "Lagos · Ikoyi", price: 28000, stock: 40, sold: 61 },
          { location: "Lagos · Lekki", price: 30000, stock: 25, sold: 22 },
          { location: "Abuja", price: 32000, stock: 18, sold: 9 },
          { location: "London", price: 52000, stock: 12, sold: 6 },
        ],
      },
      {
        id: "rose-coal",
        name: "Rose Coal",
        blurb: "Damask rose over warm coal — softer than it sounds.",
        at: [
          { location: "Lagos · Ikoyi", price: 26000, stock: 30, sold: 48 },
          { location: "Abuja", price: 29000, stock: 20, sold: 14 },
          { location: "London", price: 48000, stock: 10, sold: 8 },
        ],
      },
      {
        id: "oud-ember",
        name: "Oud Ember",
        blurb: "The atelier's deepest oud. Poured in small batches, priced like it.",
        at: [
          { location: "Lagos · Ikoyi", price: 45000, stock: 15, sold: 31 },
          { location: "Lagos · Lekki", price: 47000, stock: 10, sold: 12 },
          { location: "London", price: 85000, stock: 6, sold: 9 },
        ],
      },
      {
        id: "vanilla-ash",
        name: "Vanilla Ash",
        blurb: "Bourbon vanilla with a grey, smoky tail. The easy one to wear.",
        at: [
          { location: "Lagos · Ikoyi", price: 22000, stock: 50, sold: 35 },
          { location: "Port Harcourt", price: 24000, stock: 20, sold: 10 },
        ],
      },
      {
        id: "harmattan-musk",
        name: "Harmattan Musk",
        blurb: "Dry, dusty, warm — a season in a bottle.",
        at: [
          { location: "Lagos · Ikoyi", price: 31000, stock: 28, sold: 40 },
          { location: "Abuja", price: 33000, stock: 16, sold: 12 },
        ],
      },
    ],
  },
  {
    id: "waxwork-lagos",
    name: "Waxwork Lagos",
    creatorId: 2,
    creatorName: "Tunde Bakare",
    category: "Home & Lifestyle",
    blurb: "Small-batch soy candles, hand-numbered, with a burn time you can read off the base.",
    items: [
      {
        id: "palm-smoke",
        name: "Palm & Smoke",
        blurb: "Palm wax and a whisper of woodsmoke.",
        at: [
          { location: "Lagos · Ikoyi", price: 9000, stock: 60, sold: 88 },
          { location: "Lagos · Lekki", price: 9500, stock: 34, sold: 41 },
          { location: "Port Harcourt", price: 10000, stock: 22, sold: 15 },
        ],
      },
      {
        id: "ginger-lily",
        name: "Ginger Lily",
        blurb: "Bright ginger, soft lily — the bestseller in Lekki.",
        at: [
          { location: "Lagos · Lekki", price: 8500, stock: 28, sold: 66 },
          { location: "Lagos · Ikoyi", price: 8000, stock: 45, sold: 52 },
        ],
      },
      {
        id: "sea-salt-sage",
        name: "Sea Salt & Sage",
        blurb: "Clean, herbal, a little coastal.",
        at: [
          { location: "Lagos · Ikoyi", price: 7500, stock: 40, sold: 30 },
          { location: "Port Harcourt", price: 8000, stock: 18, sold: 12 },
        ],
      },
      {
        id: "cocoa-butter",
        name: "Cocoa Butter",
        blurb: "Rich, sweet, unmistakable. Sells out every December.",
        at: [
          { location: "Lagos · Ikoyi", price: 12000, stock: 20, sold: 74 },
          { location: "Abuja", price: 12500, stock: 12, sold: 20 },
        ],
      },
    ],
  },
  {
    id: "ade-leather",
    name: "Adé Leather",
    creatorId: 3,
    creatorName: "Ngozi Eze",
    category: "Fashion",
    blurb: "Vegetable-tanned leather goods, stitched in Surulere. Made to be repaired, not replaced.",
    items: [
      {
        id: "ikoyi-tote",
        name: "Ikoyi Tote",
        blurb: "A full-grain everyday tote that softens with use.",
        at: [
          { location: "Lagos · Ikoyi", price: 85000, stock: 12, sold: 28 },
          { location: "London", price: 140000, stock: 5, sold: 7 },
        ],
      },
      {
        id: "market-satchel",
        name: "Market Satchel",
        blurb: "The bigger carry — a weekend, a laptop, a market run.",
        at: [
          { location: "Lagos · Ikoyi", price: 120000, stock: 8, sold: 15 },
          { location: "London", price: 190000, stock: 4, sold: 5 },
        ],
      },
      {
        id: "card-sleeve",
        name: "Card Sleeve",
        blurb: "Four cards and a note. The gift that starts people on the brand.",
        at: [{ location: "Lagos · Ikoyi", price: 18000, stock: 50, sold: 96 }],
      },
    ],
  },
];

/* ---- Reads (what the indexer would serve) --------------------------------------------------------- */

export const collections = (): Collection[] => CATALOG;

/** The collections a creator has published — the demo's link from an on-chain creator id to her line. */
export const byCreator = (creatorId: number): Collection[] => CATALOG.filter((c) => c.creatorId === creatorId);

/** The name behind a creator id, when the catalog knows it. */
export const creatorName = (creatorId: number): string | undefined => byCreator(creatorId)[0]?.creatorName;

/** The shelves a browser can filter by. The catalog's own, plus the ones the shop plans to stock. */
export const CATEGORIES: string[] = [...new Set([...CATALOG.map((c) => c.category), "Food & Drink"])].sort();

/** The shelves a creator's lines sit on. */
export const categoriesOf = (creatorId: number): string[] => [...new Set(byCreator(creatorId).map((c) => c.category))];

export const collection = (id: string): Collection | undefined => CATALOG.find((c) => c.id === id);

export function findItem(collectionId: string, itemId: string): { collection: Collection; item: CatalogItem } | undefined {
  const c = collection(collectionId);
  const item = c?.items.find((i) => i.id === itemId);
  return c && item ? { collection: c, item } : undefined;
}

export function itemTotals(item: CatalogItem) {
  const stock = item.at.reduce((n, a) => n + a.stock, 0);
  const sold = item.at.reduce((n, a) => n + a.sold, 0);
  const prices = item.at.map((a) => a.price);
  return { stock, sold, locations: item.at.length, low: Math.min(...prices), high: Math.max(...prices) };
}

export function collectionTotals(c: Collection) {
  const locations = new Set<string>();
  let stock = 0;
  let sold = 0;
  for (const item of c.items)
    for (const a of item.at) {
      locations.add(a.location);
      stock += a.stock;
      sold += a.sold;
    }
  return { items: c.items.length, stock, sold, locations: locations.size };
}

/* ---- A derived activity feed (the indexer's other job) -------------------------------------------- */

/** A tiny deterministic RNG, so the demo's "recent activity" is stable across renders and reloads. */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (rng: () => number, n: number) =>
  Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rng() * 16)]).join("");

/** The recent purchases of a design, spread across its locations, weighted by where it sells. */
export function activityFor(item: CatalogItem, count = 10): Txn[] {
  const rng = seeded(item.id);
  const weighted = item.at.flatMap((a) => Array<Availability>(Math.max(1, Math.round(a.sold / 6))).fill(a));
  const feed: Txn[] = [];
  let ago = 60 * (10 + Math.floor(rng() * 400));
  for (let i = 0; i < count; i++) {
    const a = weighted[Math.floor(rng() * weighted.length)] ?? item.at[0];
    feed.push({
      id: `${item.id}-${i}`,
      location: a.location,
      price: a.price,
      buyer: `0x${hex(rng, 4)}…${hex(rng, 4)}`,
      ago,
      kind: rng() > 0.35 ? "sold" : "claimed",
    });
    ago += 60 * (30 + Math.floor(rng() * 900));
  }
  return feed;
}

/** Seconds → the words a person would use. */
export function since(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}
