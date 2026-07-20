package ops

import (
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"

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

	// The catalog creators' signing keys, by the creator id the registry issued them.
	//
	// Empty for the original demo, which knows exactly two creators and holds both their keys in
	// `Keys`. A scenario that sells the s13 catalog fills this in, and a verb asked to act on one of
	// those items without it fails loudly rather than signing with the operator's key — which would
	// forge the creator's signature and still be accepted by the gateway, since a gateway that could
	// tell would be a gateway that had solved identity.
	CreatorKeys map[uint64]*ecdsa.PrivateKey
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
	// Which chain posted it. A tranche id, a root and thirteen leaves only mean anything against the
	// deployment that recorded them, and the same file copied to a page pointed at another chain
	// produces a shop where every genuine tag reads *forged* — the vouchers it names were published to
	// a store the other chain never wrote to. That is a failure which looks exactly like the protocol
	// working, and it is the reason the chain is stamped here rather than inferred from a directory
	// name.
	ChainID uint64 `json:"chainId"`

	// The real creator's thirteen dresses. Promoted into this object rather than nested, so the file
	// the web reads is the file it always was.
	Tranche

	// And the consignment of the creator the operator made up.
	//
	// She has no dresses, no bank account and no existence. Her signing key is the operator's own,
	// because she *is* the operator — which is not a shortcut in the demo, it is the attack, exactly
	// as an operator would run it. The protocol registers her without complaint, because there is no
	// question it could ask that would catch her: nobody has ever been able to tell a fake counterparty
	// from a real one.
	//
	// It does not have to. Whatever the operator earns by trading with her, it can spend only on her —
	// and she has nothing to sell.
	Farm *Tranche `json:"farm,omitempty"`

	// The rest of the shop: every consignment the s13 catalog posted, one per line per town.
	//
	// A list rather than two more named fields, because this part grows — a creator opening a second
	// line or selling into a fourth town is one more entry here and no change anywhere else. What it
	// is NOT is a different kind of thing: these are the same tranches, posted the same way, proved
	// the same way. They live apart from `Tranche` only because that one is promoted to the top level
	// and there can be exactly one of it.
	//
	// Anything reading the shelf has to read this too. An item minted into a tranche that nothing
	// enumerates is an item on chain that the ledger cannot see: it has a price, a state and an owner,
	// and the page renders a blank where they should be — which reads as "not for sale" rather than
	// as "we did not look".
	Catalog []Tranche `json:"catalog,omitempty"`
}

// Tranche is one creator's consignment: who she is, what she posted, and every item under it.
type Tranche struct {
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
func (t Tranche) leaves() []merkle.Hash {
	out := make([]merkle.Hash, len(t.Items))
	for i, item := range t.Items {
		out[i] = common.HexToHash(item.Digest)
	}
	return out
}

// index is the position of an item id in the tranche — which is its leaf's position.
func (t Tranche) index(itemID uint64) (int, error) {
	for i, item := range t.Items {
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
	tranche, signer, err := o.blockOf(itemID)
	if err != nil {
		return bindings.SaleGatewaySaleInput{}, err
	}
	return o.saleInputFrom(ctx, tranche, signer, itemID, withCommunity)
}

// blockOf finds the consignment an item belongs to, and the key that signs for it.
//
// Every verb that touches an item goes through here, so a sale, a commitment and a write-off all
// agree about which tranche an item is in. Guessing wrong is not a missing record: the proof is
// walked against the wrong tree, the gateway rejects a genuine item, and the operator's own shop
// refuses to sell its own stock.
//
// The signer is decided by which consignment it is, never by lookup on the item:
//
//	the creator's own tranche   → her key. She signed these, and only she could have.
//	the invented creator's      → the operator's, because she IS the operator. That is the attack,
//	                              not a shortcut, and it is the reason the farm exists at all.
//	a catalog consignment       → the key registered for that creator id, supplied by the caller.
func (o *Ops) blockOf(itemID uint64) (Tranche, *ecdsa.PrivateKey, error) {
	consignment, err := o.Consignment()
	if err != nil {
		return Tranche{}, nil, err
	}

	if _, err := consignment.Tranche.index(itemID); err == nil {
		return consignment.Tranche, o.Keys.Creator, nil
	}
	if consignment.Farm != nil {
		if _, err := consignment.Farm.index(itemID); err == nil {
			return *consignment.Farm, o.Keys.Operator, nil
		}
	}
	for _, tranche := range consignment.Catalog {
		if _, err := tranche.index(itemID); err != nil {
			continue
		}
		key, ok := o.CreatorKeys[tranche.CreatorID]
		if !ok {
			return Tranche{}, nil, fmt.Errorf(
				"item %d is in consignment #%d, posted by creator #%d, and no signing key for her was "+
					"supplied. Her vouchers are checked against her own key — the operator cannot sign "+
					"for her, which is the point of her having one",
				itemID, tranche.TrancheID, tranche.CreatorID)
		}
		return tranche, key, nil
	}

	return Tranche{}, nil, fmt.Errorf("item %d is in no consignment on file", itemID)
}

// AdoptCreatorKeys teaches this operator which key signs for which registered creator.
//
// Given a list of private keys, it asks the registry which id — if any — each one holds, and files it
// under that id. Keys the registry has never seen are ignored: a deployment may carry keys for
// creators who have not been registered on this particular chain, and that is not an error.
//
// It takes keys rather than reading the catalog itself so that `internal/ops` stays what it is — the
// protocol, and nothing about which goods a particular demo happens to sell.
func (o *Ops) AdoptCreatorKeys(ctx context.Context, hexKeys []string) error {
	count, err := o.C.Registry.CreatorCount(callOpts(ctx))
	if err != nil {
		return err
	}

	registered := map[common.Address]uint64{}
	for id := uint64(1); id <= count.Uint64(); id++ {
		key, err := o.C.Registry.KeyOf(callOpts(ctx), new(big.Int).SetUint64(id))
		if err != nil {
			return err
		}
		registered[key] = id
	}

	if o.CreatorKeys == nil {
		o.CreatorKeys = map[uint64]*ecdsa.PrivateKey{}
	}
	for _, hexKey := range hexKeys {
		key, err := crypto.HexToECDSA(strings.TrimPrefix(strings.TrimSpace(hexKey), "0x"))
		if err != nil {
			return fmt.Errorf("creator key: %w", err)
		}
		if id, ok := registered[crypto.PubkeyToAddress(key.PublicKey)]; ok {
			o.CreatorKeys[id] = key
		}
	}
	return nil
}

// CreatorOfConsigned answers which creator and which tranche an item was consigned under, from the
// published paperwork rather than from the chain's item slot.
//
// The slot is lazy — it names a tranche only after something has touched the item — so for anything
// still standing on the shelf the chain's answer is zero and the paperwork's is the true one.
func (o *Ops) CreatorOfConsigned(itemID uint64) (creator, tranche uint64, err error) {
	block, _, err := o.blockOf(itemID)
	if err != nil {
		return 0, 0, err
	}
	return block.CreatorID, block.TrancheID, nil
}

// saleInputFrom is the same, for a named tranche signed by a named key.
//
// The key is a parameter because whose it is, is the whole question this protocol has stopped asking.
// The real creator signs her own vouchers with her own key. The creator the operator invented is signed
// for by the operator, because there is nobody else to do it — and the gateway cannot tell, will not
// try, and does not need to.
func (o *Ops) saleInputFrom(
	ctx context.Context,
	tranche Tranche,
	signer *ecdsa.PrivateKey,
	itemID uint64,
	withCommunity bool,
) (bindings.SaleGatewaySaleInput, error) {
	var input bindings.SaleGatewaySaleInput

	index, err := tranche.index(itemID)
	if err != nil {
		return input, err
	}

	item, signature, err := o.signedVoucher(ctx, signer, tranche.CreatorID, itemID)
	if err != nil {
		return input, err
	}

	tree, err := merkle.New(tranche.leaves())
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
		TrancheId:             new(big.Int).SetUint64(tranche.TrancheID),
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
func (o *Ops) signedVoucher(ctx context.Context, signer *ecdsa.PrivateKey, creatorID, itemID uint64) (bindings.CreatorRegistryItemVoucher, []byte, error) {
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
	signature, err := item.Sign(signer, domain)
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

func metadataHash(itemID uint64) [32]byte { return voucher.MetadataHash(itemID) }
