package ops

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

	"goodhouse/relayer/internal/chain"
	"goodhouse/relayer/internal/chain/bindings"
	"goodhouse/relayer/internal/merkle"
	"goodhouse/relayer/internal/storage"
	"goodhouse/relayer/internal/voucher"
)

// Ops is the operator, as a program: every action Good can take, and nothing else.
//
// Note what is not here. There is no function that pays a creator without the ledger knowing, no
// function that marks a debt settled, no function that changes what counts as proof. The operator's
// powers are exactly the ones the contracts grant it, and the ones it wishes it had are absent
// because they do not exist — which is the whole argument, expressed as an API.
type Ops struct {
	Client *chain.Client
	C      *chain.Contracts
	Keys   chain.Keys
	Store  storage.Store
	Config Config
	Say    func(format string, args ...any)
}

// Config is the demo's shape: what is on the shelf and what it costs.
//
// The windows and the economics are not here. They are constructor arguments of the deployed
// contracts and the relayer reads them from the chain — a demo that carried its own copy of the
// settlement window would be a demo that could disagree with the protocol it is demonstrating.
type Config struct {
	Currency [32]byte
	Location string

	ItemIDs []*big.Int
	Prices  []*big.Int

	// The pool's opening balance, deposited as the skim of past trade, and the per-sale skim.
	PoolSeed *big.Int
	SkimBps  int64

	// What the operator's funding account holds. It pays skims and, through a standing approval,
	// every fine the protocol levies on it.
	OperatorFunds *big.Int

	// Where the demo's own bookkeeping lives: the consignment file and the blob cache.
	DataDir string
}

// DemoConfig is the shelf the demo sells from: thirteen dresses in Ikoyi, priced ₦100,000 upward.
func DemoConfig(dataDir string) Config {
	var currency [32]byte
	copy(currency[:], "NGN")

	const count = 13
	ids := make([]*big.Int, count)
	prices := make([]*big.Int, count)
	for i := 0; i < count; i++ {
		ids[i] = big.NewInt(int64(1001 + i))
		prices[i] = naira(int64(100_000 + i*10_000))
	}

	return Config{
		Currency:      currency,
		Location:      "Lagos - Ikoyi",
		ItemIDs:       ids,
		Prices:        prices,
		PoolSeed:      naira(400_000),
		SkimBps:       50, // 0.5% of the sale, carved out of the operator's own commission
		OperatorFunds: naira(5_000_000),
		DataDir:       dataDir,
	}
}

// naira converts a whole-naira figure into the token's 18-decimal units.
func naira(amount int64) *big.Int {
	return new(big.Int).Mul(big.NewInt(amount), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))
}

// Consignment is what the seed left behind: the tranche, and every item under it.
//
// The relayer needs the leaves again on every sale, because a sale proves membership. It could
// recompute them from the vouchers in storage, and the web will do exactly that; the relayer keeps
// them to hand because it is the party that signed them.
type Consignment struct {
	CreatorID uint64 `json:"creatorId"`
	TrancheID uint64 `json:"trancheId"`
	Root      string `json:"root"`
	Items     []Item `json:"items"`
}

// Item is one dress: its id, its digest (the leaf), and where its voucher's bytes live.
type Item struct {
	ID      uint64 `json:"id"`
	Price   string `json:"price"`
	Digest  string `json:"digest"`
	Pointer string `json:"pointer"`
}

func (o *Ops) consignmentPath() string {
	return filepath.Join(o.Config.DataDir, "consignment.json")
}

func (o *Ops) saveConsignment(c Consignment) error {
	if err := os.MkdirAll(o.Config.DataDir, 0o755); err != nil {
		return err
	}

	raw, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(o.consignmentPath(), raw, 0o644)
}

// Consignment reads back what the seed posted.
func (o *Ops) Consignment() (Consignment, error) {
	var c Consignment

	raw, err := os.ReadFile(o.consignmentPath())
	if err != nil {
		return c, fmt.Errorf("no consignment on file (has `seed` been run?): %w", err)
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, err
	}
	return c, nil
}

// leaves rebuilds the tranche's Merkle leaves, in item order.
func (c Consignment) leaves() []merkle.Hash {
	out := make([]merkle.Hash, len(c.Items))
	for i, item := range c.Items {
		out[i] = common.HexToHash(item.Digest)
	}
	return out
}

// index is the position of an item id in the consignment — which is its leaf's position.
func (c Consignment) index(itemID uint64) (int, error) {
	for i, item := range c.Items {
		if item.ID == itemID {
			return i, nil
		}
	}
	return 0, fmt.Errorf("item %d is not in this consignment", itemID)
}

// saleInput assembles everything a sale needs to prove it may consume an item: the creator's
// signature, the membership proof, the certificate's commitment, and — only if a referral is being
// claimed — the attribution voucher.
//
// The community leg mints against a presented voucher and against nothing else. Half of a referral is
// not a referral, and an operator that could mint the leg without one could mint it to itself.
func (o *Ops) saleInput(ctx context.Context, itemID uint64, withCommunity bool) (bindings.SaleGatewaySaleInput, error) {
	var input bindings.SaleGatewaySaleInput

	consignment, err := o.Consignment()
	if err != nil {
		return input, err
	}
	index, err := consignment.index(itemID)
	if err != nil {
		return input, err
	}

	item, signature, err := o.signedVoucher(ctx, consignment.CreatorID, itemID)
	if err != nil {
		return input, err
	}

	tree, err := merkle.New(consignment.leaves())
	if err != nil {
		return input, err
	}
	path, err := tree.Proof(index)
	if err != nil {
		return input, err
	}

	input = bindings.SaleGatewaySaleInput{
		Voucher:               item,
		Signature:             signature,
		TrancheId:             new(big.Int).SetUint64(consignment.TrancheID),
		Proof:                 path,
		ClaimCodeHash:         claimCodeCommitment(itemID, claimCode(itemID)),
		CertificateCommitment: certificateCommitment(itemID),
	}

	if withCommunity {
		input.CommunityRecipient = o.Keys.Community
		input.CommunityVoucherHash = communityVoucherHash(itemID)
	}

	return input, nil
}

// signedVoucher rebuilds an item's voucher and re-signs it with the creator's key.
//
// The signature is not stored and read back: it is produced from the key each time, because the thing
// being demonstrated is that the creator's key — and only the creator's key — can make a tag genuine.
func (o *Ops) signedVoucher(ctx context.Context, creatorID, itemID uint64) (bindings.CreatorRegistryItemVoucher, []byte, error) {
	policy, err := o.C.Gateway.SplitPolicy(callOpts(ctx))
	if err != nil {
		return bindings.CreatorRegistryItemVoucher{}, nil, err
	}

	item := voucher.Voucher{
		CreatorID:      new(big.Int).SetUint64(creatorID),
		ItemID:         new(big.Int).SetUint64(itemID),
		MetadataHash:   metadataHash(itemID),
		SplitPolicyRef: policy,
	}

	domain := voucher.Domain(o.Client.ChainID, o.C.Addresses.Registry)
	signature, err := item.Sign(o.Keys.Creator, domain)
	if err != nil {
		return bindings.CreatorRegistryItemVoucher{}, nil, err
	}

	return bindings.CreatorRegistryItemVoucher{
		CreatorId:      item.CreatorID,
		ItemId:         item.ItemID,
		MetadataHash:   item.MetadataHash,
		SplitPolicyRef: item.SplitPolicyRef,
	}, signature, nil
}

// forgedSignature signs an item's voucher with a key the registry has never heard of.
//
// This is what a counterfeiter actually has: a convincing dress, a convincing tag, and no way to make
// the one signature that would matter.
func (o *Ops) forgedSignature(ctx context.Context, creatorID, itemID uint64) ([]byte, error) {
	policy, err := o.C.Gateway.SplitPolicy(callOpts(ctx))
	if err != nil {
		return nil, err
	}

	item := voucher.Voucher{
		CreatorID:      new(big.Int).SetUint64(creatorID),
		ItemID:         new(big.Int).SetUint64(itemID),
		MetadataHash:   metadataHash(itemID),
		SplitPolicyRef: policy,
	}

	return item.Sign(o.Keys.Stranger, voucher.Domain(o.Client.ChainID, o.C.Addresses.Registry))
}

// --- The commitments the contracts expect, computed the way the contracts compute them. ---

// claimCodeCommitment is `keccak256(abi.encode(itemId, code))`, binding a code to its item so a code
// learned from one sale cannot redeem another.
func claimCodeCommitment(itemID uint64, code [32]byte) [32]byte {
	return crypto.Keccak256Hash(
		common.BigToHash(new(big.Int).SetUint64(itemID)).Bytes(),
		code[:],
	)
}

// claimCode is the secret printed on the buyer's receipt.
//
// Production note: this is derived so the demo can reproduce it. A real claim code is random, printed
// once, and known only to the buyer holding the paper — and even then it is a bearer secret, which is
// why production binds the certificate to a passkey account at the point of sale instead.
func claimCode(itemID uint64) [32]byte {
	return crypto.Keccak256Hash([]byte(fmt.Sprintf("glass-ledger/claim-code/%d", itemID)))
}

func certificateCommitment(itemID uint64) [32]byte {
	return crypto.Keccak256Hash([]byte(fmt.Sprintf("glass-ledger/certificate/%d", itemID)))
}

func communityVoucherHash(itemID uint64) [32]byte {
	return crypto.Keccak256Hash([]byte(fmt.Sprintf("glass-ledger/attribution/%d", itemID)))
}

func metadataHash(itemID uint64) [32]byte {
	return crypto.Keccak256Hash([]byte(fmt.Sprintf("glass-ledger/item/%d", itemID)))
}
