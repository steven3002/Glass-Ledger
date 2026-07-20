// Command seedcatalog mints the s13 catalog onto a chain and declares it to the indexer.
//
// It ADDS. Nothing here touches a creator, a tranche or an item that already exists — the ids it
// mints continue from wherever the chain has got to, and the original consignment is left exactly as
// the earlier scenario left it. That is deliberate and it is the only reason this is safe to point at
// a chain that already carries a demo somebody is going to present.
//
// What it does, per creator:
//
//	register the key                        → a creator id, which every voucher of hers is checked against
//	per location she sells in:
//	  build a voucher per unit, sign it     → the leaf
//	  merkle the leaves                     → the root
//	  post the tranche                      → one storage slot for the whole consignment
//	  seed the prices, from HER key         → the operator cannot price her goods
//	publish the voucher blobs               → so a stranger can check a tag without asking us
//
// and then writes the grouping — line, product, size, unit — into Postgres. The chain never learns
// any of it: it holds ids, prices and proofs, and the catalog holds what those ids are called.
package main

import (
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/big"
	"os"
	"path/filepath"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/jackc/pgx/v5/pgxpool"

	"goodhouse/relayer/internal/catalog"
	"goodhouse/relayer/internal/chain"
	"goodhouse/relayer/internal/index"
	"goodhouse/relayer/internal/merkle"
	"goodhouse/relayer/internal/ops"
	"goodhouse/relayer/internal/storage"
	"goodhouse/relayer/internal/voucher"
)

// minted is one unit, after the chain has been told about it.
type minted struct {
	itemID    uint64
	trancheID uint64
	digest    common.Hash
	// where the voucher's bytes ended up: the keccak of the blob, which is what a tag carries and
	// what a stranger fetches by. Empty until the blob is actually published.
	pointer common.Hash
	price   *big.Int
	place   int
	// which variant it belongs to, so the declaration can be assembled afterwards
	lineIdx, productIdx, variantIdx int
}

func main() {
	var (
		rpcURL     = flag.String("rpc", envOr("GLASS_RPC_URL", "http://127.0.0.1:8545"), "chain RPC")
		deployment = flag.String("deployment", "", "path to the deployment json (default: artifacts/deployments/<chainid>.json)")
		dataDir    = flag.String("data", envOr("GLASS_DATA_DIR", ""), "where to write the published catalog consignment")
		firstItem  = flag.Uint64("first-item", 3001, "the item id to start from; must not collide with anything minted already")
		dbOnly     = flag.Bool("db-only", false, "skip the chain and re-declare an existing catalog from the written file")
	)
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is not set. It is server-side only — never give it a NEXT_PUBLIC_ name.")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatalf("connect to postgres: %v", err)
	}
	defer pool.Close()
	if err := index.Migrate(ctx, pool); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	client, err := chain.Dial(ctx, *rpcURL)
	if err != nil {
		log.Fatalf("dial %s: %v", *rpcURL, err)
	}
	chainID, err := client.ETH.ChainID(ctx)
	if err != nil {
		log.Fatalf("chain id: %v", err)
	}
	deploy, err := chain.LoadDeployment(chain.DeploymentPath(*deployment, "", chainID))
	if err != nil {
		log.Fatalf("deployment: %v", err)
	}
	contracts, err := chain.Bind(deploy, client.ETH)
	if err != nil {
		log.Fatalf("bind: %v", err)
	}

	operator, err := keyFromEnv("GLASS_OPERATOR_KEY")
	if err != nil {
		log.Fatal(err)
	}
	landlord, err := keyFromEnv("GLASS_LANDLORD_KEY")
	if err != nil {
		log.Fatal(err)
	}

	if *dbOnly {
		log.Fatal("-db-only needs a written catalog to read back; not implemented yet")
	}

	// Refused rather than warned about.
	//
	// Without somewhere to publish, this mints items whose vouchers nobody can fetch and whose ids
	// appear in no consignment — on chain, priced, and invisible to every page that reads the shelf.
	// The run would exit 0 and look like a success.
	if *dataDir == "" {
		log.Fatal("-data (or GLASS_DATA_DIR) is not set. The vouchers would go unpublished and the " +
			"items would be minted into a consignment nothing enumerates: priced on chain, unverifiable " +
			"by a stranger, and blank on the shelf. Point it at this chain's shelf and run again.")
	}
	store, err := storage.FromEnv(*dataDir)
	if err != nil {
		log.Fatalf("storage: %v", err)
	}

	log.Printf("chain %s · minting the s13 catalog from item %d", chainID, *firstItem)
	log.Printf("creators sign with: %s", catalog.Provenance())

	// Where a tag's proof is checked back to, and what the split policy is. Read from the chain
	// rather than assumed: a voucher signed against the wrong domain is a voucher that verifies
	// nowhere, and it fails at the till rather than here.
	domain := voucher.Domain(client.ChainID, deploy.Registry)
	policy, err := contracts.Gateway.SplitPolicy(&bind.CallOpts{Context: ctx})
	if err != nil {
		log.Fatalf("split policy: %v", err)
	}

	// What is already on this chain, from the consignment written on the way.
	//
	// A mint of this size against a public chain takes many minutes — most of it spent waiting for
	// storage nodes to sync, not for blocks — so it will sometimes be interrupted. Re-running from
	// scratch would be the worst possible response to that: the creators would be registered a second
	// time under new ids, splitting each of them in half, and every tranche would be posted again
	// under ids the first run already used. So the run resumes. It is the only safe way to have a
	// long, expensive, partially-completed operation against a chain that cannot be rewound.
	resume, err := alreadyMinted(*dataDir, chainID.Uint64())
	if err != nil {
		log.Fatalf("read what is already minted: %v", err)
	}
	if len(resume.tranches) > 0 {
		log.Printf("resuming: %d catalog consignments and %d units are already on this chain",
			len(resume.tranches), resume.units)
	}

	// Item ids are always assigned from the same start, in the same order, whether this is a first run
	// or a resumption. They are a pure function of the catalog literal and `-first-item`, so replaying
	// the numbering reproduces exactly what the interrupted run produced — and a tranche whose ids are
	// already on file is then simply skipped. Continuing from a high-water mark instead would give the
	// remaining goods different ids from the ones the first run would have given them, which is fine
	// until you try to resume twice.
	var all []minted
	tranches := resume.tranches
	nextItem := *firstItem
	creatorIDs := map[int]*big.Int{}

	for li, ln := range catalog.CATALOG {
		creatorKey, err := crypto.HexToECDSA(trim0x(catalog.CreatorKeys()[ln.CreatorKey]))
		if err != nil {
			log.Fatalf("creator key %d: %v", ln.CreatorKey, err)
		}

		// One registration per key, however many lines she carries. A creator with two collections is
		// one creator; registering twice would mint a second id and split her identity in half.
		creatorID, seen := creatorIDs[ln.CreatorKey]
		if !seen {
			// Was she registered by an earlier, interrupted run? The registry holds an address per id
			// and no reverse index, so this asks it id by id — a handful of reads against a registry
			// with five entries, and the alternative is registering her twice.
			if existing := findCreator(ctx, contracts, crypto.PubkeyToAddress(creatorKey.PublicKey)); existing != nil {
				creatorIDs[ln.CreatorKey] = existing
				creatorIDByLine[li] = existing.Int64()
				log.Printf("  creator #%s — %s, already registered on this chain", existing, ln.CreatorName)
				creatorID, seen = existing, true
			}
		}
		if !seen {
			if _, err := client.Send(ctx, operator, "register creator", func(auth *bind.TransactOpts) (*types.Transaction, error) {
				return contracts.Registry.Register(auth, crypto.PubkeyToAddress(creatorKey.PublicKey))
			}); err != nil {
				log.Fatalf("register creator for %s: %v", ln.Slug, err)
			}
			creatorID, err = contracts.Registry.CreatorCount(&bind.CallOpts{Context: ctx})
			if err != nil {
				log.Fatalf("creator count: %v", err)
			}
			creatorID = new(big.Int).Set(creatorID)
			creatorIDs[ln.CreatorKey] = creatorID

			// Her payout account, written by her own key and by nobody else's.
			//
			// Only a hash of it reaches the chain — what the ledger needs is the ability to check that
			// a claimed payment went to the account she named, not the account itself. And she writes
			// it herself because an operator that could name the account it says it paid would be
			// asserting the very fact it is supposed to be proving.
			//
			// Without this a sale of her goods reverts `NoAccountOnFile` at the till: her consignment
			// is posted, her prices are seeded, her tags verify, and not one item can be sold.
			account := crypto.Keccak256Hash([]byte("bank-account/" + crypto.PubkeyToAddress(creatorKey.PublicKey).Hex()))
			if _, err := client.Send(ctx, creatorKey, "account: "+ln.CreatorName, func(auth *bind.TransactOpts) (*types.Transaction, error) {
				return contracts.Debts.SetAccountHash(auth, currencyTag(), account)
			}); err != nil {
				log.Fatalf("payout account for %s: %v", ln.CreatorName, err)
			}

			log.Printf("  creator #%s registered — %s, payout account on file from her own key",
				creatorID, ln.CreatorName)
		}
		creatorIDByLine[li] = creatorID.Int64()

		// Group this line's units by the place they stand in. A consignment is per location, so a line
		// sold in three towns is three consignments — the chain has no notion of "the same line,
		// elsewhere", and inventing one would mean inventing a fact.
		byPlace := map[int][]minted{}
		for pi, p := range ln.Products {
			for vi, v := range p.Variants {
				for _, st := range v.Stock {
					for n := 0; n < st.Units; n++ {
						byPlace[st.Place] = append(byPlace[st.Place], minted{
							itemID: nextItem, price: catalog.Naira(st.Naira), place: st.Place,
							lineIdx: li, productIdx: pi, variantIdx: vi,
						})
						nextItem++
					}
				}
			}
		}

		for _, place := range sortedKeys(byPlace) {
			units := byPlace[place]

			// Already posted by an earlier run. Its ids, its root and its vouchers are on file and on
			// chain; doing it again would post a second consignment of the same goods.
			if resume.has(units[0].itemID) {
				log.Printf("    already on chain · %-22s %2d units · %s",
					catalog.LOCATIONS[place], len(units), ln.Name)
				for i := range units {
					units[i].trancheID = resume.trancheOf(units[i].itemID)
				}
				all = append(all, units...)
				continue
			}

			leaves := make([]merkle.Hash, len(units))
			blobs := make([][]byte, len(units))
			for i := range units {
				digest, blob, err := voucherFor(creatorKey, creatorID, units[i].itemID, policy, domain,
					ln, units[i], catalog.LOCATIONS[place])
				if err != nil {
					log.Fatalf("voucher for item %d: %v", units[i].itemID, err)
				}
				leaves[i] = merkle.Hash(digest)
				blobs[i] = blob
				units[i].digest = digest
			}

			tree, err := merkle.New(leaves)
			if err != nil {
				log.Fatalf("merkle for %s @ %s: %v", ln.Slug, catalog.LOCATIONS[place], err)
			}
			root := common.Hash(tree.Root())

			if _, err := client.Send(ctx, operator, "post tranche", func(auth *bind.TransactOpts) (*types.Transaction, error) {
				return contracts.Items.PostTranche(auth, creatorID, crypto.PubkeyToAddress(landlord.PublicKey),
					root, uint32(len(units)), currencyTag(), catalog.LOCATIONS[place])
			}); err != nil {
				log.Fatalf("post tranche for %s @ %s: %v", ln.Slug, catalog.LOCATIONS[place], err)
			}
			trancheID, err := contracts.Items.TrancheCount(&bind.CallOpts{Context: ctx})
			if err != nil {
				log.Fatalf("tranche count: %v", err)
			}
			trancheID = new(big.Int).Set(trancheID)

			ids := make([]*big.Int, len(units))
			prices := make([]*big.Int, len(units))
			for i := range units {
				units[i].trancheID = trancheID.Uint64()
				ids[i] = new(big.Int).SetUint64(units[i].itemID)
				prices[i] = units[i].price
			}

			// Prices are written by HER key. The operator posts the consignment but cannot price what
			// is in it — which is the whole reason a creator's key exists in this system.
			if _, err := client.Send(ctx, creatorKey, "seed prices", func(auth *bind.TransactOpts) (*types.Transaction, error) {
				return contracts.Prices.Seed(auth, trancheID, ids, prices)
			}); err != nil {
				log.Fatalf("seed prices for %s @ %s: %v", ln.Slug, catalog.LOCATIONS[place], err)
			}

			// Publish the bytes, and keep the pointer each one came back as.
			//
			// Through the same store the demo publishes to — local files on a development chain, 0G
			// Storage on a real one — because a tag from this catalog and a tag from the original
			// consignment are checked by the identical code path in the browser. A second, bespoke
			// way of putting blobs on disk would be a second way for them to be wrong.
			consigned := make([]ops.Item, len(units))
			for i := range units {
				pointer, err := store.Put(ctx, fmt.Sprintf("voucher-%d", units[i].itemID), blobs[i])
				if err != nil {
					log.Fatalf("publish voucher for item %d: %v", units[i].itemID, err)
				}
				units[i].pointer = pointer
				consigned[i] = ops.Item{
					ID:      units[i].itemID,
					Price:   units[i].price.String(),
					Digest:  units[i].digest.Hex(),
					Pointer: pointer.Hex(),
				}
			}
			tranches = append(tranches, ops.Tranche{
				CreatorID: creatorID.Uint64(),
				TrancheID: trancheID.Uint64(),
				Root:      root.Hex(),
				Items:     consigned,
			})

			// Recorded after every tranche, not once at the end.
			//
			// On a public chain a run can stop halfway — a timeout, an RPC that drops, a storage
			// upload that will not land. Whatever is already minted is minted for good, and if the
			// file is only written at the end then everything posted before the failure is an item on
			// chain that no consignment names: priced, provable, and invisible to every page. Writing
			// as we go costs one small file write per tranche and makes a partial run a partial shop
			// rather than a broken one.
			if err := recordCatalog(*dataDir, chainID.Uint64(), tranches); err != nil {
				log.Fatalf("record the catalog's consignments: %v", err)
			}

			log.Printf("    tranche #%s · %-22s %2d units · %s",
				trancheID, catalog.LOCATIONS[place], len(units), ln.Name)
			all = append(all, units...)
		}
	}

	// The paperwork is already on disk, written tranche by tranche above. The database comes second on
	// purpose: if Postgres is unreachable the shop still opens — the shelf, the prices and the proofs
	// all come from that file and the chain, and the only thing missing is what the goods are
	// *called*. The reverse, a catalog naming items no consignment lists, is a shop that cannot show
	// what it is describing.
	declared, err := index.Merge(ctx, pool, chainID.Int64(), declare(all))
	if err != nil {
		log.Fatalf("read the existing catalog to preserve it: %v", err)
	}
	counts, err := index.Write(ctx, pool, chainID.Int64(), declared)
	if err != nil {
		log.Fatalf("declare to postgres: %v", err)
	}

	log.Printf("minted %d units across %d consignments", len(all), countTranches(all))
	log.Printf("catalog now: %d collections, %d products, %d variants, %d units",
		counts.Collections, counts.Products, counts.Variants, counts.Units)
}

/* ---- turning what was minted into what the catalog says -------------------------------------------- */

// declare assembles the declaration from the units actually minted.
//
// Built from `all` rather than from catalog.CATALOG directly, so the ids in the database are the ids the chain
// really issued. A declaration written from the wishlist would be right until the first time a send
// failed halfway.
func declare(all []minted) index.Declared {
	var declared index.Declared

	for li, ln := range catalog.CATALOG {
		collection := index.DeclaredCollection{
			ID: ln.Slug, Name: ln.Name, CreatorName: ln.CreatorName,
			Category: ln.Category, Blurb: ln.Blurb,
		}
		for pi, p := range ln.Products {
			dp := index.DeclaredProduct{ID: ln.Slug + "-" + p.Slug, Name: p.Name, Blurb: p.Blurb}
			for vi, v := range p.Variants {
				dv := index.DeclaredVariant{ID: dp.ID + "-" + v.Slug, Name: v.Name}
				for _, u := range all {
					if u.lineIdx == li && u.productIdx == pi && u.variantIdx == vi {
						dv.Units = append(dv.Units, index.DeclaredUnit{
							ItemID: int64(u.itemID), TrancheID: int64(u.trancheID),
						})
					}
				}
				if len(dv.Units) > 0 {
					dp.Variants = append(dp.Variants, dv)
				}
			}
			if len(dp.Variants) > 0 {
				collection.Products = append(collection.Products, dp)
			}
		}
		// The creator id the chain issued, carried through so the frontend can link the line to her.
		for _, u := range all {
			if u.lineIdx == li {
				collection.CreatorID = creatorIDFor(li)
				break
			}
		}
		if len(collection.Products) > 0 {
			declared.Collections = append(declared.Collections, collection)
		}
	}
	return declared
}

var creatorIDByLine = map[int]int64{}

func creatorIDFor(line int) int64 { return creatorIDByLine[line] }

/* ---- the voucher, and publishing it ---------------------------------------------------------------- */

type publishedVoucher struct {
	CreatorID      string            `json:"creatorId"`
	ItemID         string            `json:"itemId"`
	MetadataHash   common.Hash       `json:"metadataHash"`
	SplitPolicyRef [32]byte          `json:"splitPolicyRef"`
	Digest         common.Hash       `json:"digest"`
	Signature      string            `json:"signature"`
	Metadata       map[string]string `json:"metadata"`
}

// voucherFor rebuilds one unit's voucher: the digest the creator signs, which is the leaf the tranche
// commits to, and the bytes a stranger fetches to check it without asking anybody.
//
// The metadata block here is still unsigned in substance — `metadataHash` is a placeholder, exactly as
// it is in the original seed. s12 closes that; until it does, a holder trusts the publisher for the
// words and the chain for everything else, and the UI says so.
func voucherFor(
	signer *ecdsa.PrivateKey, creatorID *big.Int, itemID uint64,
	policy [32]byte, domain common.Hash, ln catalog.Line, u minted, place string,
) (common.Hash, []byte, error) {
	id := new(big.Int).SetUint64(itemID)
	v := voucher.Voucher{
		CreatorID:      creatorID,
		ItemID:         id,
		MetadataHash:   voucher.MetadataHash(itemID),
		SplitPolicyRef: policy,
	}

	signature, err := v.Sign(signer, domain)
	if err != nil {
		return common.Hash{}, nil, err
	}
	digest := v.Digest(domain)

	p := ln.Products[u.productIdx]
	blob, err := json.MarshalIndent(publishedVoucher{
		CreatorID: creatorID.String(), ItemID: id.String(),
		MetadataHash: v.MetadataHash, SplitPolicyRef: v.SplitPolicyRef,
		Digest: digest, Signature: "0x" + common.Bytes2Hex(signature),
		Metadata: map[string]string{
			"name":       p.Name,
			"variant":    p.Variants[u.variantIdx].Name,
			"collection": ln.Name,
			"location":   place,
		},
	}, "", "  ")
	if err != nil {
		return common.Hash{}, nil, err
	}
	return digest, blob, nil
}

/* ---- Resuming an interrupted mint ------------------------------------------------------------------ */

// minted so far, read back from the consignment this command writes as it goes.
type priorRun struct {
	tranches      []ops.Tranche
	trancheByItem map[uint64]uint64
	units         int
}

func (p priorRun) has(itemID uint64) bool { _, ok := p.trancheByItem[itemID]; return ok }

func (p priorRun) trancheOf(itemID uint64) uint64 { return p.trancheByItem[itemID] }

// alreadyMinted reads the catalog consignments an earlier run recorded for this chain.
//
// The file is the record of what exists, and it is written after each tranche precisely so that this
// can be trusted. A consignment belonging to another chain is not a prior run of this one — it is a
// different shop — and is refused rather than resumed from.
func alreadyMinted(dataDir string, chainID uint64) (priorRun, error) {
	out := priorRun{trancheByItem: map[uint64]uint64{}}

	raw, err := os.ReadFile(filepath.Join(dataDir, "consignment.json"))
	if os.IsNotExist(err) {
		return out, nil
	}
	if err != nil {
		return out, err
	}

	var c ops.Consignment
	if err := json.Unmarshal(raw, &c); err != nil {
		return out, err
	}
	if c.ChainID != 0 && c.ChainID != chainID {
		return out, fmt.Errorf(
			"the consignment on file was posted on chain %d and this run is against chain %d",
			c.ChainID, chainID)
	}

	out.tranches = c.Catalog
	for _, tranche := range c.Catalog {
		for _, item := range tranche.Items {
			out.trancheByItem[item.ID] = tranche.TrancheID
			out.units++
		}
	}
	return out, nil
}

// findCreator asks the registry which id, if any, holds this address.
func findCreator(ctx context.Context, contracts *chain.Contracts, address common.Address) *big.Int {
	count, err := contracts.Registry.CreatorCount(&bind.CallOpts{Context: ctx})
	if err != nil {
		return nil
	}
	for id := uint64(1); id <= count.Uint64(); id++ {
		key, err := contracts.Registry.KeyOf(&bind.CallOpts{Context: ctx}, new(big.Int).SetUint64(id))
		if err != nil {
			return nil
		}
		if key == address {
			return new(big.Int).SetUint64(id)
		}
	}
	return nil
}

// recordCatalog writes the tranches this run posted into the consignment the web reads.
//
// Read-modify-write, on purpose. The file already holds the original creator's thirteen dresses and
// the invented creator's three, and neither of them is this command's to touch: the demo that gets
// presented is in there. Everything under `catalog` is replaced wholesale, because a re-run mints new
// ids and merging the old ones in would leave the shelf listing items from a chain state that no
// longer exists.
//
// The chain id is checked rather than trusted. A consignment on file from another network is not a
// file to append to — its tranche ids belong to a different chain, and the two sets of items would be
// indistinguishable in the shelf while only one of them resolves.
func recordCatalog(dataDir string, chainID uint64, tranches []ops.Tranche) error {
	path := filepath.Join(dataDir, "consignment.json")

	var c ops.Consignment
	raw, err := os.ReadFile(path)
	switch {
	case err == nil:
		if err := json.Unmarshal(raw, &c); err != nil {
			return fmt.Errorf("%s is not readable as a consignment: %w", path, err)
		}
		if c.ChainID != 0 && c.ChainID != chainID {
			return fmt.Errorf(
				"the consignment at %s was posted on chain %d and this catalog was minted on chain %d. "+
					"Appending would put two chains' tranches in one file, and the shelf would list items "+
					"whose vouchers were never published to the store it reads",
				path, c.ChainID, chainID)
		}
	case os.IsNotExist(err):
		// No demo on this chain — the catalog is the whole shop. Legitimate, and the file is ours to
		// create.
	default:
		return err
	}

	c.ChainID = chainID
	c.Catalog = tranches

	out, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, out, 0o644)
}

/* ---- small helpers --------------------------------------------------------------------------------- */

// currencyTag is "NGN", right-padded to 32 bytes — the only currency this deployment's pool can honour.
func currencyTag() [32]byte {
	var tag [32]byte
	copy(tag[:], "NGN")
	return tag
}

func sortedKeys(m map[int][]minted) []int {
	keys := make([]int, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	for i := 0; i < len(keys); i++ {
		for j := i + 1; j < len(keys); j++ {
			if keys[j] < keys[i] {
				keys[i], keys[j] = keys[j], keys[i]
			}
		}
	}
	return keys
}

func countTranches(all []minted) int {
	seen := map[uint64]bool{}
	for _, u := range all {
		seen[u.trancheID] = true
	}
	return len(seen)
}

func keyFromEnv(name string) (*ecdsa.PrivateKey, error) {
	raw := trim0x(os.Getenv(name))
	if raw == "" {
		return nil, fmt.Errorf("%s is not set", name)
	}
	return crypto.HexToECDSA(raw)
}

func trim0x(s string) string {
	if len(s) > 2 && (s[:2] == "0x" || s[:2] == "0X") {
		return s[2:]
	}
	return s
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
