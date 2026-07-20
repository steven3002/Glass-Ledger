/**
 * The indexer, as the browser sees it.
 *
 * A collection groups a creator's items into products and gives them names. None of that is on
 * chain, because none of it is a fact the contract could hold: "these two candles are the same
 * candle" is a decision somebody made, and it changes without any state changing. So it comes from
 * the indexer, over HTTP, and the split is strict in one direction:
 *
 *   the indexer says   which items are grouped, what the group is called, whose line it is
 *   the chain says     price, state, owner, where it stands, and everything that ever happened
 *
 * Notice what is absent from the types below: no price, no stock, no state. That absence is load
 * bearing. A catalog carrying its own prices would be a second source of truth about money, and
 * everything this product argues would be undermined by its own shop page. The frontend joins the
 * two halves on the one identifier they share — the item id — and reads every number from the chain.
 *
 * If the indexer is down, collections stop working and nothing else does. The ledger, the shelf,
 * every item, debt, claim and the commons read the chain directly and never touch this. That is the
 * right way round: the half that must survive an outage is the half that proves things.
 */

const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID ?? "31337";

/**
 * Where the indexer lives, from the browser's point of view.
 *
 * The subtlety that bit once already: this fetch runs in the reader's browser, so a baked-in
 * `localhost:8090` means *their* machine. It works perfectly when the app is opened on the same box
 * that serves it and fails for everybody else, which is the worst way for a URL to be wrong — it
 * looks correct in every test you run locally.
 *
 * So unless an explicit URL is configured, the indexer is assumed to sit on the same host the page
 * was served from, on its own port. Opened at localhost:3100 it resolves to localhost; opened at
 * 172.31.x.x:3100 it resolves to 172.31.x.x. Evaluated per call rather than at module load, because
 * this module is imported during prerender too, where there is no window to ask.
 */
const INDEXER_PORT = process.env.NEXT_PUBLIC_INDEXER_PORT ?? "8090";

function base(): string {
  const configured = process.env.NEXT_PUBLIC_INDEXER_URL;
  if (configured) return configured;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:${INDEXER_PORT}`;
  }
  return `http://localhost:${INDEXER_PORT}`;
}

/** One tagged item on chain: an id, and the consignment it was published under. */
export type IndexedUnit = { itemId: number; trancheId: number };

/**
 * A size or a format — XL, XXL, 50 ml.
 *
 * Not a different product. The shop sells "Burnt Wood"; the size is how a buyer picks which one to
 * take home. The contract disagrees — to it every unit under here is an unrelated item that happens
 * to share a name in a database it cannot read — and that disagreement is why this layer is off chain.
 */
export type IndexedVariant = {
  id: string;
  name: string;
  units: IndexedUnit[];
};

/**
 * A product: an identity backed by one or more units.
 *
 * The protocol has no concept of this. Every unit is its own item with its own id, and two units of
 * one product are, to the contract, unrelated things that happen to cost the same.
 */
export type IndexedProduct = {
  id: string;
  name: string;
  blurb: string;
  variants: IndexedVariant[];
};

export type IndexedCollection = {
  id: string;
  creatorId: number;
  name: string;
  creatorName: string;
  category: string;
  blurb: string;
  products: IndexedProduct[];
};

export type CatalogIndex = {
  chainId: number;
  collections: IndexedCollection[];
};

export async function loadIndex(): Promise<CatalogIndex> {
  let response: Response;
  try {
    response = await fetch(`${base()}/catalog/${CHAIN_ID}`);
  } catch {
    // A refused connection is the case a reader actually meets, and the browser's own words for it
    // are "Failed to fetch" — which names nothing and reassures nobody. Say which part is down and,
    // more usefully, which parts are not: the ledger never touches this service.
    throw new Error(
      `The catalog indexer at ${base()} is not answering, so the shop's grouping cannot be read. ` +
        `Nothing else on this site depends on it — the ledger, the shelf and every item, debt and claim ` +
        `are read straight from the chain and are unaffected.`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `The catalog indexer answered ${response.status}. Only the shop's grouping comes from it; ` +
        `the ledger is read from the chain and is unaffected.`,
    );
  }
  return (await response.json()) as CatalogIndex;
}

export const collectionOf = (index: CatalogIndex, id: string): IndexedCollection | undefined =>
  index.collections.find((c) => c.id === id);

export const productOf = (collection: IndexedCollection, id: string): IndexedProduct | undefined =>
  collection.products.find((p) => p.id === id);

/** Which line, product and size a unit is — the reverse lookup the item dossier wants. */
export function collectionForItem(
  index: CatalogIndex,
  itemId: bigint | number,
): { collection: IndexedCollection; product: IndexedProduct; variant: IndexedVariant } | undefined {
  const id = Number(itemId);
  for (const collection of index.collections) {
    for (const product of collection.products) {
      const variant = product.variants.find((v) => v.units.some((u) => u.itemId === id));
      if (variant) return { collection, product, variant };
    }
  }
  return undefined;
}

/** Every unit of a product, across all its sizes. */
export const productUnits = (product: IndexedProduct): IndexedUnit[] =>
  product.variants.flatMap((v) => v.units);

/** Every item id the catalog knows, for joining against the chain's shelf in one pass. */
export const unitIds = (collection: IndexedCollection): number[] =>
  collection.products.flatMap((p) => productUnits(p).map((u) => u.itemId));

/* ---- The creator, seen through her lines ----------------------------------------------------------- */

/**
 * A creator's collections.
 *
 * Every "what has she published" question comes through here rather than through a hand-written list.
 * The registry issues ids and holds keys; it has never held a name or a line, and it never will —
 * which means anything the pages want to say about a creator beyond her key has exactly one source,
 * and it is this.
 */
export const linesOf = (index: CatalogIndex | undefined, creatorId: bigint | number): IndexedCollection[] =>
  (index?.collections ?? []).filter((c) => c.creatorId === Number(creatorId));

/**
 * What to call her.
 *
 * Her own lines name her. A creator who has published nothing has no name here and is her id — the
 * registry was never asked for one, so inventing a placeholder would be the page making it up.
 */
export const creatorNameOf = (index: CatalogIndex | undefined, creatorId: bigint | number): string =>
  linesOf(index, creatorId)[0]?.creatorName ?? `Creator #${Number(creatorId)}`;

/** The categories she works in, deduplicated — one creator may keep lines in several. */
export const categoriesOf = (index: CatalogIndex | undefined, creatorId: bigint | number): string[] =>
  [...new Set(linesOf(index, creatorId).map((c) => c.category))];

/** Every category the whole catalog uses, for a filter that can only offer what exists. */
export const categoriesIn = (index: CatalogIndex | undefined): string[] =>
  [...new Set((index?.collections ?? []).map((c) => c.category))].sort();
