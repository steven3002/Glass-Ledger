// Command sellcatalog trades the s13 catalog, and does not trade it well.
//
// seedcatalog puts the goods on the shelf; this sells them. Roughly half the sales go the way a shop
// wants them to — the money is claimed, nobody objects, the claim settles and the operator's capacity
// grows. The rest are the reason the protocol exists: a claim its own creator challenges and the
// operator cannot answer, a claim nobody challenges and the sweep never covers, sales whose money is
// simply never accounted for, a buyer's deposit taken against stock that is not there, and a fund that
// runs out halfway through compensating the people all of that fell on.
//
// Nothing is staged. Every transaction here is one an operator could send; the punishments are sent
// from a stranger's key, and the challenge from the creator's own. Where the protocol refuses
// something, the refusal is printed by name.
//
// It reads the catalog from Postgres rather than hard-coding item ids, because the ids are whatever
// the chain issued and a scenario that assumed them would sell the wrong goods the first time
// anything upstream shifted by one.
package main

import (
	"context"
	"flag"
	"fmt"
	"math/big"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/jackc/pgx/v5/pgxpool"

	"goodhouse/relayer/internal/catalog"
	"goodhouse/relayer/internal/index"
	"goodhouse/relayer/internal/ops"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "\nsellcatalog: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	settings := ops.Flags(flag.CommandLine)
	devTime := flag.Bool("dev-time", true, "advance a development chain's clock instead of waiting for it")

	// Whether to let the unpaid debts actually default.
	//
	// The default is the whole back half of the story — the fund pays the people the operator did not,
	// runs out doing it, and the ceiling shuts on somebody innocent. It is also the only part that
	// cannot be undone: the pool ends near zero and the operator's growth is frozen until it repays.
	// On a chain whose figures are quoted in a document, that is a decision somebody should make on
	// purpose, so it is a flag rather than an assumption.
	fromAct := flag.Int("from-act", 1,
		"skip straight to this act. For resuming a run that stopped partway on a chain that cannot "+
			"be rewound; the earlier acts' effects are already on it")
	defaults := flag.Bool("defaults", true,
		"let the aged debts default: the fund pays out, runs short, and the ceiling shuts. "+
			"With -defaults=false the run stops with the debts still aging and the pool untouched")
	flag.Parse()

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	// Generous, because this is a backstop and not a schedule.
	//
	// Most of the run is spent waiting for the deployed contracts' own clocks, and on a public chain
	// those cannot be pushed — six honest cycles alone are six challenge windows in real time. A
	// timeout tight enough to be a useful limit is tight enough to kill a healthy run in the middle
	// of one, which on a chain that cannot be rewound is much the worse outcome of the two.
	ctx, stop := context.WithTimeout(ctx, 90*time.Minute)
	defer stop()

	o, err := ops.Open(ctx, settings, func(format string, args ...any) {
		fmt.Printf(format+"\n", args...)
	})
	if err != nil {
		return err
	}
	defer o.Client.Close()

	// The clocks in this scenario are the deployed contracts' own, and several of the acts turn on a
	// deadline passing. On a development chain the clock is pushed; on a public one it is waited out.
	o.Client.DevTime = *devTime

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return fmt.Errorf("DATABASE_URL is not set — the catalog lives there, and the item ids with it")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return err
	}
	defer pool.Close()

	loaded, err := index.Load(ctx, pool, o.Client.ChainID.Int64())
	if err != nil {
		return fmt.Errorf("read the catalog: %w", err)
	}
	shelf, err := newShelf(loaded)
	if err != nil {
		return err
	}

	// Every catalog creator's signing key, against the id the registry issued her. Without this the
	// operator cannot assemble a sale for her goods at all — her vouchers are checked against her key
	// and the operator does not hold it, which is the entire reason a creator has one.
	keys, err := shelf.creatorKeys()
	if err != nil {
		return err
	}
	o.CreatorKeys = keys

	// The shelf asks the chain what is still for sale, so a resumed run reaches for fresh stock.
	shelf.inStore = func(itemID uint64) bool {
		item, err := o.C.Items.ItemOf(&bind.CallOpts{Context: ctx}, new(big.Int).SetUint64(itemID))
		if err != nil {
			return false
		}
		// ItemState.IN_STORE is the zero value, and an untouched item's slot is all zeroes — so a
		// unit nothing has happened to reads as available, which is exactly what it is.
		return item.State == 0
	}

	return scenario(ctx, o, shelf, *defaults, *fromAct)
}

/* ---- The shelf: names in, item ids out ------------------------------------------------------------- */

// shelf is the catalog with a memory of what it has already handed out.
//
// Picking by name rather than by id is not a convenience. The ids depend on the order the seeder
// happened to mint in, and a scenario written against them would keep running after that order
// changed — selling the wrong goods, in the wrong town, at prices that no longer match the story
// being narrated over them. A name is the thing the story is actually about.
type shelf struct {
	index index.Catalog
	taken map[int64]bool
	// inStore answers whether the chain still has this unit for sale. Nil means "do not ask", which
	// is right for a fresh chain and wrong for any chain that has traded before.
	inStore func(uint64) bool
}

func newShelf(c index.Catalog) (*shelf, error) {
	if len(c.Collections) == 0 {
		return nil, fmt.Errorf("the catalog is empty for this chain — has seedcatalog run against it?")
	}
	return &shelf{index: c, taken: map[int64]bool{}}, nil
}

// creatorKeys maps the registry's creator ids to the keys the seeder signed with.
//
// Matched through the collection slug, which is the one identifier both sides agree on: the seeder
// wrote it into Postgres beside the id the chain issued, and the literal in internal/catalog names
// which key posted it. Nothing here guesses.
func (s *shelf) creatorKeys() (map[uint64]*ecdsaKey, error) {
	out := map[uint64]*ecdsaKey{}
	for _, line := range catalog.CATALOG {
		collection := s.collection(line.Slug)
		if collection == nil {
			continue // Not on this chain. Not an error: the catalog may be seeded in parts.
		}
		key, err := keyFromHex(catalog.CreatorKeys()[line.CreatorKey])
		if err != nil {
			return nil, fmt.Errorf("creator key for %s: %w", line.Slug, err)
		}
		out[uint64(collection.CreatorID)] = key
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no catalog collection on this chain matches the declared lines")
	}
	return out, nil
}

func (s *shelf) collection(slug string) *index.Collection {
	for i := range s.index.Collections {
		if s.index.Collections[i].ID == slug {
			return &s.index.Collections[i]
		}
	}
	return nil
}

// take hands out one unit of a product, in a named variant, and never the same one twice.
//
// `variant` may be empty for a product sold one way. The unit returned is whichever the catalog lists
// first and this scenario has not already used — the scenario cares which *product* it is selling and
// not which of several identical bottles, so choosing is arbitrary and should look it.
func (s *shelf) take(collectionSlug, productSlug, variant string) (uint64, error) {
	collection := s.collection(collectionSlug)
	if collection == nil {
		return 0, fmt.Errorf("no collection %q in the catalog", collectionSlug)
	}
	productID := collectionSlug + "-" + productSlug
	for _, product := range collection.Products {
		if product.ID != productID {
			continue
		}
		for _, v := range product.Variants {
			if variant != "" && v.Name != variant {
				continue
			}
			for _, unit := range v.Units {
				if s.taken[unit.ItemID] {
					continue
				}
				// And whether the chain still has it. A run that resumes after an earlier one — or
				// that is pointed at a chain somebody has already traded on — must not reach for
				// stock that is sold, committed or written off: the sale would revert on state the
				// scenario could have checked, halfway through, on a chain that cannot be rewound.
				if s.inStore != nil && !s.inStore(uint64(unit.ItemID)) {
					continue
				}
				s.taken[unit.ItemID] = true
				return uint64(unit.ItemID), nil
			}
		}
		return 0, fmt.Errorf("every unit of %s%s is already spoken for in this scenario",
			product.Name, variantSuffix(variant))
	}
	return 0, fmt.Errorf("no product %q in %s", productID, collectionSlug)
}

// name is what a product is called, for narration. The chain does not know it and never will.
func (s *shelf) name(itemID uint64) string {
	for _, collection := range s.index.Collections {
		for _, product := range collection.Products {
			for _, variant := range product.Variants {
				for _, unit := range variant.Units {
					if uint64(unit.ItemID) == itemID {
						return fmt.Sprintf("%s %s (%s)", product.Name, variant.Name, collection.Name)
					}
				}
			}
		}
	}
	return fmt.Sprintf("item %d", itemID)
}

func variantSuffix(variant string) string {
	if variant == "" {
		return ""
	}
	return " " + variant
}
