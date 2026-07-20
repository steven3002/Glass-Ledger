"use client";

/**
 * The catalog's word for an item, wherever one is shown.
 *
 * The chain has no name for anything. `readItems` synthesises `Item {id - 1000}` so a row is not
 * blank, and that placeholder is wrong twice over: it says nothing a shopper recognises, and on the
 * second consignment it is actively misleading — item 2001 comes out as "Item 1001", a label that
 * belongs to a different item entirely.
 *
 * So every surface that prints an item's name asks here instead, and they all fall back the same way
 * when the indexer is unreachable. One hook rather than one lookup per page, because a name that
 * differs between the shelf and the dossier is worse than no name at all.
 */

import { useCallback, useEffect, useState } from "react";

import { collectionForItem, loadIndex, type CatalogIndex } from "@/lib/index";

export function useCatalog() {
  const [index, setIndex] = useState<CatalogIndex>();

  useEffect(() => {
    // Failure is silence, deliberately. The catalog is editorial; a page that showed an error banner
    // because it could not fetch a *name* would be treating the shop's opinion as load bearing.
    void loadIndex()
      .then(setIndex)
      .catch(() => setIndex(undefined));
  }, []);

  const nameOf = useCallback(
    (itemId: bigint | number, fallback?: string): string =>
      collectionForItem(index ?? { chainId: 0, collections: [] }, itemId)?.product.name ??
      fallback ??
      `Item ${String(itemId)}`,
    [index],
  );

  const lineOf = useCallback(
    (itemId: bigint | number) => (index ? collectionForItem(index, itemId) : undefined),
    [index],
  );

  return { index, nameOf, lineOf };
}
