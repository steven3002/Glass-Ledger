// Package voucher builds, hashes and signs the creator's item vouchers.
//
// A voucher is an item's whole identity: who made it, which item it is, what it says about itself,
// and under which published split it may be sold. It carries no price — prices move on an epoch
// cadence and a voucher is signed once and never again, so a price inside one would either freeze
// the price or force a re-signing of every item on every change.
//
// The digest computed here is load-bearing twice over: it is what the creator signs, and it is the
// Merkle leaf her tranche commits to. Those being the same 32 bytes is what makes it impossible for
// a tag to be genuinely signed but absent from the consignment, or present in the consignment but
// signed by nobody. The encoding therefore has to agree with the registry's to the byte, and the
// round-trip test in this package proves it does by asking the deployed registry for the same digest.
package voucher

import (
	"crypto/ecdsa"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// Voucher is the creator-signed record the registry verifies.
type Voucher struct {
	CreatorID      *big.Int
	ItemID         *big.Int
	MetadataHash   [32]byte
	SplitPolicyRef [32]byte
}

// MetadataHash is what an item's voucher commits to about the item itself.
//
// It lives here, alone, because it is a *committed* value: it goes into the leaf, the leaf goes into
// the root, and the root is on chain. Two places computing it two ways do not produce an error — they
// produce a genuine tag that fails its own Merkle proof and is reported to the reader as a forgery,
// by a verifier working perfectly. That happened: the seeder hashed the id's raw bytes while the
// relayer hashed "glass-ledger/item/<id>", and every catalog item was consequently unsellable.
//
// It commits to the id and nothing else. The published blob beside it carries the name, the size, the
// line and the town — none of which are covered by this hash, and none of which the chain can check.
// That is the existing boundary, not an oversight of this function: what a tag proves is *who signed
// for which item under which split*, and what it is called is the catalog's word.
func MetadataHash(itemID uint64) [32]byte {
	return crypto.Keccak256Hash([]byte(fmt.Sprintf("glass-ledger/item/%d", itemID)))
}

var (
	// keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
	domainTypeHash = crypto.Keccak256Hash(
		[]byte("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
	)
	// keccak256("ItemVoucher(uint256 creatorId,uint256 itemId,bytes32 metadataHash,bytes32 splitPolicyRef)")
	voucherTypeHash = crypto.Keccak256Hash(
		[]byte("ItemVoucher(uint256 creatorId,uint256 itemId,bytes32 metadataHash,bytes32 splitPolicyRef)"),
	)

	// The registry's EIP-712 domain. Both are hashed, never used raw.
	domainName    = crypto.Keccak256Hash([]byte("Glass Ledger"))
	domainVersion = crypto.Keccak256Hash([]byte("1"))
)

// Domain is the separator the registry signs vouchers under.
//
// It binds the chain and the registry's own address, which is what stops a signature from travelling
// between deployments or between chains. The relayer computes it rather than fetching it so that a
// creator can sign offline; the seed op checks it against the deployed registry all the same, because
// a signing key that agrees with nothing is worse than no signature at all.
func Domain(chainID *big.Int, registry common.Address) common.Hash {
	return crypto.Keccak256Hash(
		domainTypeHash.Bytes(),
		domainName.Bytes(),
		domainVersion.Bytes(),
		common.BigToHash(chainID).Bytes(),
		common.LeftPadBytes(registry.Bytes(), 32),
	)
}

// StructHash is the EIP-712 hash of the voucher's contents.
func (v Voucher) StructHash() common.Hash {
	return crypto.Keccak256Hash(
		voucherTypeHash.Bytes(),
		common.BigToHash(v.CreatorID).Bytes(),
		common.BigToHash(v.ItemID).Bytes(),
		v.MetadataHash[:],
		v.SplitPolicyRef[:],
	)
}

// Digest is what the creator signs — and the leaf her tranche commits to.
func (v Voucher) Digest(domain common.Hash) common.Hash {
	return crypto.Keccak256Hash(
		[]byte{0x19, 0x01},
		domain.Bytes(),
		v.StructHash().Bytes(),
	)
}

// Sign produces the 65-byte signature the registry checks.
//
// Ethereum's recovery id is 0 or 1 and the signature format the registry expects carries 27 or 28,
// so the last byte is shifted. Nothing else about the bytes changes.
func (v Voucher) Sign(key *ecdsa.PrivateKey, domain common.Hash) ([]byte, error) {
	signature, err := crypto.Sign(v.Digest(domain).Bytes(), key)
	if err != nil {
		return nil, err
	}
	signature[64] += 27
	return signature, nil
}
