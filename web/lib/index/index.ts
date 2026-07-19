/**
 * The indexer — the part of a catalog that was never going to be on chain.
 *
 * A tag proves one unit is genuine and a consignment root commits to a batch of them, but neither
 * says that item 1001 and item 1002 are the same perfume in two bottle sizes, or that both belong to
 * a line called Local Wood. That grouping is editorial: somebody decides it, it changes without any
 * state changing, and putting it on chain would be paying to store an opinion.
 *
 * So it lives here, in a JSON file, and the split is strict in one direction:
 *
 *   the indexer says   which items are grouped, what to call them, which variant of a design each is
 *   the chain says     price, state, owner, and — through the item's tranche — where it stands
 *
 * Nothing in this module returns a price or a state, and it must stay that way. An indexer that
 * carried its own prices would be a second source of truth about money, and the whole product is an
 * argument against having one of those. Where a reader wants the chain's answer about a single unit,
 * the shelf and the item dossier are already there to give it.
 *
 * This file is a stand-in for a real indexer, not a pretence that one exists. When one is built it
 * replaces the fetch below and nothing above it has to change.
 */

export type IndexedItem = {
  /** A real item id on chain. The whole point: everything here hangs off an id the contract knows. */
  id: number;
  /**
   * Which design this unit is a copy of.
   *
   * Two units of the same design differ only by variant. The protocol has no concept of this — every
   * physical unit is its own tagged item with its own id — so "the 50 ml Oak Wood" is a fact about
   * the shop's catalog, not about the ledger.
   */
  design: string;
  name: string;
  /** The size, the fit — whatever distinguishes two units of one design. */
  variant: string;
  blurb: string;
};

export type IndexedCollection = {
  id: string;
  name: string;
  category: string;
  blurb: string;
  items: IndexedItem[];
};

export type CatalogIndex = {
  chainId: number;
  creatorId: number;
  collections: IndexedCollection[];
};

/** The published index. Fetched, not imported, so replacing it never needs a rebuild. */
export async function loadIndex(): Promise<CatalogIndex> {
  const response = await fetch("/index/collections.json");
  if (!response.ok) {
    throw new Error("No catalog index has been published. Expected /index/collections.json.");
  }
  return (await response.json()) as CatalogIndex;
}

export const collectionOf = (index: CatalogIndex, id: string): IndexedCollection | undefined =>
  index.collections.find((c) => c.id === id);

/** Which collection an item belongs to — the reverse lookup an item dossier wants. */
export function collectionForItem(index: CatalogIndex, itemId: bigint | number): IndexedCollection | undefined {
  const id = Number(itemId);
  return index.collections.find((c) => c.items.some((i) => i.id === id));
}

export function indexedItem(index: CatalogIndex, itemId: bigint | number): IndexedItem | undefined {
  const id = Number(itemId);
  for (const collection of index.collections) {
    const found = collection.items.find((i) => i.id === id);
    if (found) return found;
  }
  return undefined;
}

/**
 * A collection's items grouped by design — the shape a shop page wants.
 *
 * One row per design, each carrying its units. A reader sees "Oak Wood, 100 ml and 50 ml" rather
 * than two unrelated rows that happen to share a word.
 */
export function byDesign(collection: IndexedCollection): { design: string; name: string; units: IndexedItem[] }[] {
  const groups = new Map<string, { design: string; name: string; units: IndexedItem[] }>();
  for (const item of collection.items) {
    const existing = groups.get(item.design);
    if (existing) existing.units.push(item);
    else groups.set(item.design, { design: item.design, name: item.name, units: [item] });
  }
  return [...groups.values()];
}
