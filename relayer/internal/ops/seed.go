package ops

import (
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"

	"goodhouse/relayer/internal/chain"
	"goodhouse/relayer/internal/merkle"
	"goodhouse/relayer/internal/voucher"
)

// maxApproval is the standing allowance the pool collects the operator's fines against.
var maxApproval = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))

// Seed opens the shop: a creator, a consignment, a price book, a funded pool, and the approval that
// makes the operator's own fines collectable.
//
// The last of those is not housekeeping. A fine that has to be volunteered by the party being fined is
// not a fine, so the pool collects what the operator owes by pulling on a standing approval — and an
// operator that declines to grant it does not escape the fine, it merely leaves it sitting on its own
// ceiling, eating the headroom it needs to keep selling. Granting the approval is a condition of
// operating, and the seed is where it happens.
func (o *Ops) Seed(ctx context.Context) error {
	operator := chain.Address(o.Keys.Operator)
	creator := chain.Address(o.Keys.Creator)

	// --- Is the shop already open? ---
	//
	// Seeding twice is not idempotent and cannot be: `register` mints a new creator id every time it is
	// called, and a new creator id changes every voucher, every digest and therefore every leaf. A
	// second seed would post a second consignment of the same dresses under a second creator, and pay
	// to publish thirteen vouchers that already exist. So the run asks the chain first, and it asks it
	// about the thing that matters: whether the tranche on file is the tranche this chain is holding.
	if open, err := o.shopIsOpen(ctx); err != nil {
		return err
	} else if open {
		return o.Publish(ctx)
	}

	// A new shop starts a new bill. The receipts belong to the consignment that paid for them, and a
	// gas table that averaged this deployment's run with the last one's would describe neither.
	if err := o.Client.Gas.Reset(); err != nil {
		return err
	}

	// --- The operator's money, and the pool's right to reach it. ---
	if _, err := o.Client.Send(ctx, o.Keys.Operator, "mint", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.NGN.Mint(auth, operator, o.Config.OperatorFunds)
	}); err != nil {
		return err
	}

	if _, err := o.Client.Send(ctx, o.Keys.Operator, "approve pool", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.NGN.Approve(auth, o.C.Addresses.Pool, maxApproval)
	}); err != nil {
		return err
	}
	o.Say("  operator funded, and the pool may collect its fines")

	// --- The creator. The root of trust for every tag that follows. ---
	if _, err := o.Client.Send(ctx, o.Keys.Operator, "register creator", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Registry.Register(auth, creator)
	}); err != nil {
		return err
	}
	creatorID, err := o.C.Registry.CreatorCount(callOpts(ctx))
	if err != nil {
		return err
	}
	o.Say("  creator %s registered as #%s", short(creator), creatorID)

	// --- The vouchers. Signed off-chain, committed to by one root, published to storage. ---
	//
	// The digest the creator signs *is* the Merkle leaf. That is what makes it impossible for a tag to
	// be genuinely signed and yet absent from the consignment, or present in the consignment and
	// signed by nobody: they are the same thirty-two bytes.
	//
	// Publication comes last, in `Publish` below, and the ordering is deliberate: what the chain
	// commits to is the digest, not the pointer, so the bytes can be published after the tranche that
	// commits to them without weakening anything. Doing it in that order means no failure on the chain
	// can waste an upload, and uploads are the one thing here that is metered.
	domain := voucher.Domain(o.Client.ChainID, o.C.Addresses.Registry)

	// The relayer computes the domain rather than fetching it, so a creator can sign offline. It
	// checks it against the registry all the same: a signing key that agrees with nothing is worse
	// than no signature at all.
	onChainDomain, err := o.C.Registry.DomainSeparator(callOpts(ctx))
	if err != nil {
		return err
	}
	if common.Hash(onChainDomain) != domain {
		return fmt.Errorf(
			"the registry signs under domain %s and this relayer signs under %s — a voucher signed "+
				"here would be refused there", common.Hash(onChainDomain), domain,
		)
	}

	policy, err := o.C.Gateway.SplitPolicy(callOpts(ctx))
	if err != nil {
		return err
	}

	items := make([]Item, len(o.Config.ItemIDs))
	leaves := make([]merkle.Hash, len(o.Config.ItemIDs))

	for i, id := range o.Config.ItemIDs {
		itemID := id.Uint64()

		digest, _, err := o.voucherBlob(creatorID, id, policy, domain)
		if err != nil {
			return err
		}
		leaves[i] = digest

		items[i] = Item{
			ID:     itemID,
			Price:  o.Config.Prices[i].String(),
			Digest: digest.Hex(),
		}
	}

	tree, err := merkle.New(leaves)
	if err != nil {
		return err
	}
	root := tree.Root()

	// --- The consignment. Thirteen items, one storage slot. ---
	if _, err := o.Client.Send(ctx, o.Keys.Operator, "post tranche", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Items.PostTranche(
			auth, creatorID, o.Keys.Landlord, root,
			uint32(len(items)), o.Config.Currency, o.Config.Location,
		)
	}); err != nil {
		return err
	}
	trancheID, err := o.C.Items.TrancheCount(callOpts(ctx))
	if err != nil {
		return err
	}
	o.Say("  tranche #%s posted: root %s over %d items", trancheID, short32(root), len(items))

	// --- The price book. One key writes prices, and it is hers. ---
	if _, err := o.Client.Send(ctx, o.Keys.Creator, "seed prices", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Prices.Seed(auth, trancheID, o.Config.ItemIDs, o.Config.Prices)
	}); err != nil {
		return err
	}
	o.Say("  price book seeded by the creator's own key")

	// --- Where each party is paid. Written by them, and by nobody else. ---
	//
	// An operator that could name the account it claims to have paid would be asserting the very fact
	// it is supposed to be proving.
	for _, party := range []struct {
		name string
		key  *ecdsa.PrivateKey
	}{
		{"creator", o.Keys.Creator},
		{"landlord", o.Keys.LandlordKey},
		{"community", o.Keys.CommunityKey},
		{"buyer", o.Keys.Buyer},
	} {
		account := crypto.Keccak256Hash([]byte("bank-account/" + chain.Address(party.key).Hex()))
		if _, err := o.Client.Send(ctx, party.key, "account: "+party.name, func(auth *bind.TransactOpts) (*types.Transaction, error) {
			return o.C.Debts.SetAccountHash(auth, o.Config.Currency, account)
		}); err != nil {
			return err
		}
	}
	o.Say("  four payout accounts on file, each written by its own owner")

	// --- The pool. It starts at nothing and grows with trade; the demo hands it a past. ---
	if _, err := o.Client.Send(ctx, o.Keys.Operator, "deposit skim", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Pool.DepositSkim(auth, big.NewInt(0), o.Config.PoolSeed)
	}); err != nil {
		return err
	}

	balance, err := o.C.Pool.Balance(callOpts(ctx))
	if err != nil {
		return err
	}
	allowance, err := o.C.Ceiling.Allowance(callOpts(ctx))
	if err != nil {
		return err
	}
	o.Say("  pool %s · allowance %s (the disclosed, unearned day-one threshold)",
		money(balance), money(allowance))

	if err := o.saveConsignment(Consignment{
		CreatorID: creatorID.Uint64(),
		TrancheID: trancheID.Uint64(),
		Root:      common.Hash(root).Hex(),
		Items:     items,
	}); err != nil {
		return err
	}

	// --- And now the bytes themselves. ---
	return o.Publish(ctx)
}

// shopIsOpen answers whether this deployment already carries the consignment on file.
//
// The question is settled by the chain, not by the presence of a file: a consignment left behind by a
// previous deployment names a tranche this one has never heard of, and a tranche whose root is not the
// root on file is not this consignment. Either way the answer is no, and the seed proceeds.
func (o *Ops) shopIsOpen(ctx context.Context) (bool, error) {
	consignment, err := o.Consignment()
	if err != nil {
		return false, nil // No file. A shop that was never opened.
	}

	count, err := o.C.Items.TrancheCount(callOpts(ctx))
	if err != nil {
		return false, err
	}
	if count.Uint64() < consignment.TrancheID {
		return false, nil // A different chain, or a fresh deployment of this one.
	}

	tranche, err := o.C.Items.Tranche(callOpts(ctx), new(big.Int).SetUint64(consignment.TrancheID))
	if err != nil {
		return false, err
	}
	if common.Hash(tranche.Root).Hex() != consignment.Root {
		return false, nil
	}

	o.Say("  the shop is already open on this chain — creator #%d, tranche #%d, root %s over %d items",
		consignment.CreatorID, consignment.TrancheID, short32(tranche.Root), tranche.ItemCount)
	o.Say("  (seeding again would consign the same dresses twice, under a creator who is not her)")
	return true, nil
}

// Publish puts every voucher's bytes in the store and records where they landed.
//
// It is separate from the seeding, and it is resumable, for one reason: publishing costs money. On 0G
// Storage each blob is a submission transaction, and the price is dominated by the transaction rather
// than by the payload — so a voucher and a sweep's evidence cost about the same, and thirteen vouchers
// cost thirteen times one. An upload already made is therefore never made twice: an item that carries a
// pointer is skipped, and the file is written after each success, so a run interrupted at the ninth
// voucher resumes at the ninth rather than at the first.
//
// The bytes are rebuilt here rather than carried over from the seed, and the digest they hash to is
// checked against the one the tranche committed to. If those two ever disagreed — a different split
// policy, a different registry, a different creator — the voucher about to be published would be for an
// item this consignment does not contain, and publishing it would be worse than publishing nothing.
func (o *Ops) Publish(ctx context.Context) error {
	consignment, err := o.Consignment()
	if err != nil {
		return err
	}

	domain := voucher.Domain(o.Client.ChainID, o.C.Addresses.Registry)
	policy, err := o.C.Gateway.SplitPolicy(callOpts(ctx))
	if err != nil {
		return err
	}
	creatorID := new(big.Int).SetUint64(consignment.CreatorID)

	// What the store itself says it did, as against what this loop asked it to do. The two differ
	// whenever bytes turn out to be published already, and the difference is money: on 0G an upload is
	// a submission transaction, and the transaction is nearly the whole price.
	paidBefore := len(o.storeSubmissions())

	published, skipped := 0, 0
	for i, item := range consignment.Items {
		if item.Pointer != "" {
			skipped++
			continue
		}

		digest, blob, err := o.voucherBlob(creatorID, new(big.Int).SetUint64(item.ID), policy, domain)
		if err != nil {
			return err
		}
		if digest.Hex() != item.Digest {
			return fmt.Errorf(
				"item %d hashes to %s here and to %s in the consignment the chain committed to — "+
					"the voucher this would publish is not the one the tranche contains",
				item.ID, digest.Hex(), item.Digest,
			)
		}

		pointer, err := o.publish(ctx, fmt.Sprintf("voucher-%d", item.ID), blob)
		if err != nil {
			return fmt.Errorf("publishing item %d (%d of %d already published): %w",
				item.ID, published, len(consignment.Items), err)
		}

		// Written down before the next upload is attempted. An upload whose pointer was lost is an
		// upload that has to be paid for again.
		consignment.Items[i].Pointer = pointer.Hex()
		if err := o.saveConsignment(consignment); err != nil {
			return err
		}
		published++
	}

	paid := len(o.storeSubmissions()) - paidBefore

	switch {
	case published == 0 && skipped > 0:
		o.Say("  %d vouchers already published to %s — nothing to pay for twice", skipped, o.Store.Backend())
	case o.metered() && published > paid:
		o.Say("  %d vouchers published to %s — %d of them were already on the network and cost nothing",
			published, o.Store.Backend(), published-paid)
	default:
		o.Say("  %d vouchers published to %s", published, o.Store.Backend())
	}

	return nil
}

// voucherBlob rebuilds one item's voucher: the digest the creator signs — which is the leaf the tranche
// commits to — and the bytes a reader fetches to check it for themselves.
//
// The signature is produced from the key every time rather than stored and read back, because the thing
// being demonstrated is that the creator's key, and only the creator's key, can make a tag genuine.
func (o *Ops) voucherBlob(creatorID, itemID *big.Int, policy [32]byte, domain common.Hash) (common.Hash, []byte, error) {
	id := itemID.Uint64()

	item := voucher.Voucher{
		CreatorID:      creatorID,
		ItemID:         itemID,
		MetadataHash:   metadataHash(id),
		SplitPolicyRef: policy,
	}

	signature, err := item.Sign(o.Keys.Creator, domain)
	if err != nil {
		return common.Hash{}, nil, err
	}
	digest := item.Digest(domain)

	// What a stranger needs to check a tag, and nothing they need to be given by us: the buyer's
	// scanner fetches these bytes, hashes them, checks the signature against the registry, and walks
	// the leaf up to the root the chain holds — without asking the operator for anything.
	blob, err := json.MarshalIndent(publishedVoucher{
		CreatorID:      creatorID.String(),
		ItemID:         itemID.String(),
		MetadataHash:   item.MetadataHash,
		SplitPolicyRef: item.SplitPolicyRef,
		Digest:         digest,
		Signature:      "0x" + common.Bytes2Hex(signature),
		Metadata: map[string]string{
			"name":     fmt.Sprintf("Dress %d", id-1000),
			"location": o.Config.Location,
		},
	}, "", "  ")
	if err != nil {
		return common.Hash{}, nil, err
	}

	return digest, blob, nil
}

// publishedVoucher is the shape of the bytes that live in storage: everything a stranger needs to
// check a tag, and nothing they need to be given by us.
type publishedVoucher struct {
	CreatorID      string            `json:"creatorId"`
	ItemID         string            `json:"itemId"`
	MetadataHash   [32]byte          `json:"metadataHash"`
	SplitPolicyRef [32]byte          `json:"splitPolicyRef"`
	Digest         common.Hash       `json:"digest"`
	Signature      string            `json:"signature"`
	Metadata       map[string]string `json:"metadata"`
}

// parsePublishedVoucher reads back what a store handed over. A blob that will not parse is not a
// voucher, whatever the pointer that led to it promised.
func parsePublishedVoucher(blob []byte) (publishedVoucher, error) {
	var out publishedVoucher
	if err := json.Unmarshal(blob, &out); err != nil {
		return out, fmt.Errorf("the bytes published there are not a voucher: %w", err)
	}
	return out, nil
}
