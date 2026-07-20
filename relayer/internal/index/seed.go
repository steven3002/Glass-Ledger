package index

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"sort"

	"github.com/jackc/pgx/v5/pgxpool"
)

/* ---- What the seeder declares ---------------------------------------------------------------------

The grouping is stated, not inferred. Inference was a migration — see Group below — and it is retired
for anything minted from here, because the thing a shop actually wants breaks it in both directions:
one product priced differently in two locations gets split, and two different products that happen to
cost the same get merged. A catalog is a set of decisions somebody made; it has to be written down.
---------------------------------------------------------------------------------------------------- */

type Declared struct {
	Collections []DeclaredCollection
}

type DeclaredCollection struct {
	ID          string
	CreatorID   int64
	Name        string
	CreatorName string
	Category    string
	Blurb       string
	Products    []DeclaredProduct
}

type DeclaredProduct struct {
	ID       string
	Name     string
	Blurb    string
	Variants []DeclaredVariant
}

type DeclaredVariant struct {
	ID   string
	Name string
	// The tagged units that are this size. Each is a real item id the scenario minted.
	Units []DeclaredUnit
}

type DeclaredUnit struct {
	ItemID    int64
	TrancheID int64
}

/* ---- The published paperwork ----------------------------------------------------------------------- */

// Consignment is the published paperwork, as the seeder needs it.
//
// It is the only source that can attribute an *unsold* item to a creator. The chain cannot: an item's
// `trancheId` slot stays zero until a sale touches it, and a tranche records an item count and a
// merkle root but never the ids underneath. So a shelf full of unsold goods is, to the contract, a
// number and a hash — the correct design for the chain and a dead end for a catalog.
type Consignment struct {
	ChainID   int64           `json:"chainId"`
	CreatorID int64           `json:"creatorId"`
	TrancheID int64           `json:"trancheId"`
	Items     []ConsignedItem `json:"items"`
	Farm      *Consignment    `json:"farm,omitempty"`
}

type ConsignedItem struct {
	ID int64 `json:"id"`
}

func LoadConsignment(path string) (Consignment, error) {
	var c Consignment
	raw, err := os.ReadFile(path)
	if err != nil {
		return c, fmt.Errorf("read consignment: %w", err)
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, fmt.Errorf("parse consignment: %w", err)
	}
	return c, nil
}

/* ---- The editorial layer for the pre-existing items ------------------------------------------------ */

// Line is the editorial layer, written down.
//
// These names are the shop's, not the chain's, and they are kept here rather than derived because
// there is nothing to derive them from — "Burnt Wood" is not a fact about item 1001, it is a decision
// somebody made about it.
type Line struct {
	ID          string
	Name        string
	CreatorName string
	Category    string
	Blurb       string
	Products    []ProductName
}

type ProductName struct {
	ID    string
	Name  string
	Blurb string
}

var LINES = map[int64]Line{
	1: {
		ID:          "ase-atelier",
		Name:        "Àṣẹ Atelier",
		CreatorName: "Amara Okonkwo",
		Category:    "Fragrance",
		Blurb:       "Distilled in Lagos from materials cut within a day's drive of the shop. One nose, one still, nothing outsourced — and a price that climbs with the age of the wood.",
		Products: []ProductName{
			{"burnt-wood", "Burnt Wood", "Dry oak over a low resin. The first thing the line was known for."},
			{"rose-coal", "Rose Coal", "Rose taken past sweetness and held over heat."},
			{"oud-ember", "Oud Ember", "Oud without the varnish most houses put on it."},
			{"vanilla-ash", "Vanilla Ash", "Vanilla with the sugar burned off — closer to smoke than dessert."},
			{"harmattan-musk", "Harmattan Musk", "The dry season, bottled: dust, cold air, and the amber underneath."},
			{"tamarind-dusk", "Tamarind Dusk", "Sour fruit and warm stone, the hour after the market shuts."},
			{"shea-ash", "Shea & Ash", "Raw shea over cold hearth. The quietest thing she makes."},
			{"indigo-resin", "Indigo Resin", "Adire dye pots — bitter, mineral, and faintly sweet at the end."},
			{"iroko-smoke", "Iroko Smoke", "Iroko heartwood, smoked rather than pressed. Heavy, and slow to leave."},
			{"kola-amber", "Kola Amber", "Bitter kola cut with amber until the bitterness reads as depth."},
			{"night-jasmine", "Night Jasmine", "Jasmine that only opens after dark, picked the way it has to be."},
			{"cedar-salt", "Cedar Salt", "Cedar carried in off the lagoon, with the salt still on it."},
			{"benin-myrrh", "Benin Myrrh", "Myrrh and old bronze. The most expensive bottle on the shelf, and the least loud."},
		},
	},
	2: {
		ID:          "waxwork-lagos",
		Name:        "Waxwork Lagos",
		CreatorName: "Tunde Bakare",
		Category:    "Home & Lifestyle",
		Blurb:       "Poured candles in reclaimed vessels. Small runs, identical units — the same object made again and again, exactly as intended.",
		Products: []ProductName{
			{"palm-smoke", "Palm & Smoke", "Palm wax over a smoked wick. Poured in identical runs, which is why several units share one price."},
			{"ginger-lily", "Ginger Lily", "Ginger over white lily, poured in the same vessel."},
			{"sea-salt-sage", "Sea Salt & Sage", "Salt and sage, the lagoon at the end of the day."},
			{"cocoa-butter", "Cocoa Butter", "Unrefined cocoa butter, barely scented."},
		},
	},
}

/* ---- The retired heuristic, kept only for what it already grouped ---------------------------------- */

// Group applies the old rule: within one creator, units that cost the same are units of one product.
//
// **Retired for anything minted from here.** It was a clean-up of contract state that existed before
// the catalog did — a way to get already-minted items grouped so the UI showed no unlabelled data. It
// cannot express what a shop needs: one product priced differently in two locations comes out as two
// products, and two unrelated products that happen to cost the same come out as one. New items are
// declared, not inferred.
//
// Products are ordered by price so the naming is stable across runs: the cheapest is always the first
// name in the line, whatever order the chain returned items in.
func Group(items map[int64][]int64, prices map[int64]*big.Int) map[int64][][]int64 {
	grouped := map[int64][][]int64{}

	for creatorID, itemIDs := range items {
		buckets := map[string][]int64{}
		for _, id := range itemIDs {
			price, ok := prices[id]
			if !ok || price == nil {
				continue
			}
			buckets[price.String()] = append(buckets[price.String()], id)
		}

		keys := make([]string, 0, len(buckets))
		for k := range buckets {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool {
			a, _ := new(big.Int).SetString(keys[i], 10)
			b, _ := new(big.Int).SetString(keys[j], 10)
			return a.Cmp(b) < 0
		})

		for _, k := range keys {
			units := buckets[k]
			sort.Slice(units, func(i, j int) bool { return units[i] < units[j] })
			grouped[creatorID] = append(grouped[creatorID], units)
		}
	}

	return grouped
}

// DeclaredFromGroups turns the retired heuristic's output into a declaration.
//
// Every product gets a single variant called "standard". The pre-existing items have no sizes — they
// were minted before the catalog had a word for one — and a null variant would be a join every reader
// has to special-case. One honest row beats a special case nobody remembers.
func DeclaredFromGroups(grouped map[int64][][]int64, trancheOf map[int64]int64) Declared {
	creators := make([]int64, 0, len(grouped))
	for id := range grouped {
		creators = append(creators, id)
	}
	sort.Slice(creators, func(i, j int) bool { return creators[i] < creators[j] })

	declared := Declared{}
	for _, creatorID := range creators {
		line, ok := LINES[creatorID]
		if !ok {
			// A creator the editorial layer has never heard of. Named plainly rather than skipped: an
			// item on chain and missing from the catalog is the exact failure this is meant to remove.
			line = Line{
				ID:          fmt.Sprintf("creator-%d", creatorID),
				Name:        fmt.Sprintf("Creator #%d", creatorID),
				CreatorName: fmt.Sprintf("Creator #%d", creatorID),
				Category:    "Unclassified",
				Blurb:       "A line the catalog has no name for yet. Its items are on chain and its money is real; only the label is missing.",
			}
		}

		collection := DeclaredCollection{
			ID: line.ID, CreatorID: creatorID, Name: line.Name,
			CreatorName: line.CreatorName, Category: line.Category, Blurb: line.Blurb,
		}

		for i, group := range grouped[creatorID] {
			name := ProductName{ID: fmt.Sprintf("%s-%d", line.ID, i+1), Name: fmt.Sprintf("%s No. %d", line.Name, i+1)}
			if i < len(line.Products) {
				name = line.Products[i]
			}

			units := make([]DeclaredUnit, 0, len(group))
			for _, itemID := range group {
				units = append(units, DeclaredUnit{ItemID: itemID, TrancheID: trancheOf[itemID]})
			}

			collection.Products = append(collection.Products, DeclaredProduct{
				ID: name.ID, Name: name.Name, Blurb: name.Blurb,
				Variants: []DeclaredVariant{{ID: name.ID + "-standard", Name: "standard", Units: units}},
			})
		}

		declared.Collections = append(declared.Collections, collection)
	}
	return declared
}

/* ---- Writing ---------------------------------------------------------------------------------------- */

// Merge keeps whatever another writer already declared for this chain.
//
// Write replaces a chain's whole catalog, which is right when one writer owns it and wrong the moment
// there are two: the legacy migration owns the pre-existing consignment and the scenario owns what it
// minted, and neither may silently delete the other's rows. So the stored catalog is read back and
// anything the incoming declaration does not name is carried through unchanged.
//
// Keyed on collection id. A writer that re-declares a collection replaces it wholesale, which is what
// re-running a seeder should do; a writer that has never heard of one leaves it alone.
func Merge(ctx context.Context, pool *pgxpool.Pool, chainID int64, fresh Declared) (Declared, error) {
	stored, err := Load(ctx, pool, chainID)
	if err != nil {
		return fresh, err
	}

	incoming := map[string]bool{}
	for _, c := range fresh.Collections {
		incoming[c.ID] = true
	}

	merged := Declared{}
	for _, c := range stored.Collections {
		if incoming[c.ID] {
			continue
		}
		kept := DeclaredCollection{
			ID: c.ID, CreatorID: c.CreatorID, Name: c.Name,
			CreatorName: c.CreatorName, Category: c.Category, Blurb: c.Blurb,
		}
		for _, p := range c.Products {
			kp := DeclaredProduct{ID: p.ID, Name: p.Name, Blurb: p.Blurb}
			for _, v := range p.Variants {
				kv := DeclaredVariant{ID: v.ID, Name: v.Name}
				for _, u := range v.Units {
					kv.Units = append(kv.Units, DeclaredUnit{ItemID: u.ItemID, TrancheID: u.TrancheID})
				}
				kp.Variants = append(kp.Variants, kv)
			}
			kept.Products = append(kept.Products, kp)
		}
		merged.Collections = append(merged.Collections, kept)
	}
	merged.Collections = append(merged.Collections, fresh.Collections...)
	return merged, nil
}

// Counts is what a seed run did, for the log line that says so.
type Counts struct{ Collections, Products, Variants, Units int }

// Write replaces the catalog for one chain, in a transaction.
//
// Replace rather than upsert: the whole thing is derived, so a partial rewrite would leave rows from a
// previous rule alive beside rows from the current one, and no reader could tell which was which.
func Write(ctx context.Context, pool *pgxpool.Pool, chainID int64, declared Declared) (Counts, error) {
	var counts Counts

	tx, err := pool.Begin(ctx)
	if err != nil {
		return counts, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `delete from collections where chain_id = $1`, chainID); err != nil {
		return counts, fmt.Errorf("clear: %w", err)
	}
	if _, err := tx.Exec(ctx, `delete from units where chain_id = $1`, chainID); err != nil {
		return counts, fmt.Errorf("clear units: %w", err)
	}

	for ci, collection := range declared.Collections {
		if _, err := tx.Exec(ctx, `
            insert into collections (id, chain_id, creator_id, name, creator_name, category, blurb, position)
            values ($1, $2, $3, $4, $5, $6, $7, $8)`,
			collection.ID, chainID, collection.CreatorID, collection.Name,
			collection.CreatorName, collection.Category, collection.Blurb, ci); err != nil {
			return counts, fmt.Errorf("insert collection %s: %w", collection.ID, err)
		}
		counts.Collections++

		for pi, product := range collection.Products {
			if _, err := tx.Exec(ctx, `
                insert into products (chain_id, id, collection_id, name, blurb, position)
                values ($1, $2, $3, $4, $5, $6)`,
				chainID, product.ID, collection.ID, product.Name, product.Blurb, pi); err != nil {
				return counts, fmt.Errorf("insert product %s: %w", product.ID, err)
			}
			counts.Products++

			for vi, variant := range product.Variants {
				if _, err := tx.Exec(ctx, `
                    insert into variants (chain_id, id, product_id, name, position)
                    values ($1, $2, $3, $4, $5)`,
					chainID, variant.ID, product.ID, variant.Name, vi); err != nil {
					return counts, fmt.Errorf("insert variant %s: %w", variant.ID, err)
				}
				counts.Variants++

				for _, unit := range variant.Units {
					if _, err := tx.Exec(ctx, `
                        insert into units (chain_id, item_id, variant_id, tranche_id)
                        values ($1, $2, $3, $4)
                        on conflict (chain_id, item_id) do update
                            set variant_id = excluded.variant_id,
                                tranche_id = excluded.tranche_id`,
						chainID, unit.ItemID, variant.ID, unit.TrancheID); err != nil {
						return counts, fmt.Errorf("insert unit %d: %w", unit.ItemID, err)
					}
					counts.Units++
				}
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return counts, err
	}
	return counts, nil
}
