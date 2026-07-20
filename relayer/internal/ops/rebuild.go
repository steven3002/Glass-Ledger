package ops

import (
	"context"
	"crypto/ecdsa"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"

	"goodhouse/relayer/internal/merkle"
	"goodhouse/relayer/internal/storage"
	"goodhouse/relayer/internal/voucher"
)

// RebuildConsignment reconstructs the published paperwork from the deployment's own configuration and
// checks it against the chain.
//
// Nothing here is a guess. Each item's leaf is the digest of a voucher whose every field is fixed —
// the creator id the registry issued, the item id, the metadata hash, and the split policy the gateway
// publishes — so the same inputs give the same 32 bytes they gave the day the tranche was posted. The
// pointer is the keccak of the voucher's bytes, and those bytes are equally fixed.
//
// The check is the whole point. A reconstruction that merely looked plausible would be worse than no
// file at all: it would put a shop on screen where every genuine tag is reported as a forgery, because
// each leaf would fail to walk up to a root that was built from different bytes. So the roots are
// compared to the chain's, and a mismatch writes nothing and says which tranche disagreed.
func (o *Ops) RebuildConsignment(ctx context.Context, write bool) error {
	domain := voucher.Domain(o.Client.ChainID, o.C.Addresses.Registry)
	policy, err := o.C.Gateway.SplitPolicy(callOpts(ctx))
	if err != nil {
		return err
	}

	count, err := o.C.Items.TrancheCount(callOpts(ctx))
	if err != nil {
		return err
	}
	o.Say("chain %s · %s tranches posted", o.Client.ChainID, count)

	rebuilt := Consignment{ChainID: o.Client.ChainID.Uint64()}

	// The creator's own consignment, then the invented creator's. Which key signs which is the one
	// thing that cannot be read off the chain — the registry holds an address, and the operator holds
	// the key that matches it for exactly one of these two.
	shelves := []struct {
		trancheID uint64
		signer    *ecdsa.PrivateKey
		items     []uint64
		prices    []*big.Int
		what      string
	}{
		{1, o.Keys.Creator, demoItemIDs(o.Config), o.Config.Prices, "the creator's"},
		{2, o.Keys.Operator, farmItemIDs, farmPriceList(), "the invented creator's"},
	}

	for _, shelf := range shelves {
		if shelf.trancheID > count.Uint64() {
			o.Say("  tranche #%d was never posted on this chain — skipping", shelf.trancheID)
			continue
		}

		record, err := o.C.Items.Tranche(callOpts(ctx), new(big.Int).SetUint64(shelf.trancheID))
		if err != nil {
			return err
		}

		items := make([]Item, len(shelf.items))
		leaves := make([]merkle.Hash, len(shelf.items))
		for i, id := range shelf.items {
			itemID := new(big.Int).SetUint64(id)
			digest, blob, err := o.voucherBlob(shelf.signer, record.CreatorId, itemID, policy, domain)
			if err != nil {
				return err
			}
			leaves[i] = merkle.Hash(digest)
			items[i] = Item{
				ID:      id,
				Price:   shelf.prices[i].String(),
				Digest:  digest.Hex(),
				Pointer: storage.Fingerprint(blob).Hex(),
			}
		}

		tree, err := merkle.New(leaves)
		if err != nil {
			return err
		}
		root := common.Hash(tree.Root())

		// The chain is the authority. If these disagree the reconstruction is wrong, and writing it
		// would condemn every genuine tag in the shop.
		if root != common.Hash(record.Root) {
			return fmt.Errorf(
				"tranche #%d rebuilt to root %s and the chain holds %s. The reconstruction does not "+
					"match what was posted, so nothing has been written — a file that disagrees with the "+
					"root would report every genuine tag in this consignment as a forgery",
				shelf.trancheID, root, common.Hash(record.Root))
		}

		o.Say("  tranche #%d · %s · %d items · root %s… MATCHES the chain",
			shelf.trancheID, shelf.what, len(items), root.Hex()[:14])

		tranche := Tranche{
			CreatorID: record.CreatorId.Uint64(),
			TrancheID: shelf.trancheID,
			Root:      root.Hex(),
			Items:     items,
		}
		if shelf.trancheID == 1 {
			rebuilt.Tranche = tranche
		} else {
			rebuilt.Farm = &tranche
		}
	}

	if !write {
		o.Say("\nverified only. Re-run with -write to restore %s", o.consignmentPath())
		return nil
	}

	// Never over an existing file. Recovery is for a shelf that is gone; a shelf that is present may
	// carry a catalog this command knows nothing about, and silently replacing it with the two demo
	// tranches would delete goods rather than restore them.
	if existing, err := o.Consignment(); err == nil {
		return fmt.Errorf(
			"%s already exists (chain %d, %d catalog consignments). Recovery refuses to overwrite a "+
				"shelf that is there — move it aside first if you really mean to replace it",
			o.consignmentPath(), existing.ChainID, len(existing.Catalog))
	}

	if err := o.saveConsignment(rebuilt); err != nil {
		return err
	}
	o.Say("\nrestored %s", o.consignmentPath())
	return nil
}

// demoItemIDs is the shelf the demo config describes, as plain ids.
func demoItemIDs(config Config) []uint64 {
	out := make([]uint64, len(config.ItemIDs))
	for i, id := range config.ItemIDs {
		out[i] = id.Uint64()
	}
	return out
}

func farmPriceList() []*big.Int {
	out := make([]*big.Int, len(farmPrices))
	for i, amount := range farmPrices {
		out[i] = naira(amount)
	}
	return out
}
