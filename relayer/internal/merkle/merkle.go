// Package merkle builds tranche roots and membership proofs the way the item ledger verifies them.
//
// A tranche is a Merkle root over the digests the creator signed, and a sale proves the tag it is
// consuming is one of the leaves under that root. The ledger checks the walk, not the construction,
// so any builder whose proofs verify is a valid builder — but there is exactly one construction in
// this repository, and this is it. The contract-side builder used in the test suites walks the tree
// identically; the round-trip test in this package proves the two agree by asking the deployed
// ledger to verify a proof this code produced.
package merkle

import (
	"bytes"
	"errors"

	"golang.org/x/crypto/sha3"
)

// ErrEmpty is returned when a tree is asked for over no leaves. A consignment of nothing is not a
// consignment.
var ErrEmpty = errors.New("merkle: no leaves")

// Hash is a 32-byte node.
type Hash = [32]byte

// Tree is a binary tree over ordered leaves, hashed commutatively at every pair.
type Tree struct {
	nodes  []Hash
	leaves int
}

// New builds the tree over `leaves`, in order. Leaf i is item i of the consignment.
func New(leaves []Hash) (*Tree, error) {
	n := len(leaves)
	if n == 0 {
		return nil, ErrEmpty
	}

	// The leaves occupy the tail of the array in reverse, so that a node's children are always at
	// 2i+1 and 2i+2 and the root lands at 0.
	nodes := make([]Hash, 2*n-1)
	for i, leaf := range leaves {
		nodes[2*n-2-i] = leaf
	}
	for i := n - 1; i > 0; i-- {
		node := i - 1
		nodes[node] = commutative(nodes[2*node+1], nodes[2*node+2])
	}

	return &Tree{nodes: nodes, leaves: n}, nil
}

// Root is the consignment object: the whole of a tranche's on-chain footprint.
func (t *Tree) Root() Hash { return t.nodes[0] }

// Proof is the membership path for the leaf at `index`.
func (t *Tree) Proof(index int) ([]Hash, error) {
	if index < 0 || index >= t.leaves {
		return nil, errors.New("merkle: leaf index out of range")
	}

	node := 2*t.leaves - 2 - index

	depth := 0
	for walk := node; walk > 0; walk = (walk - 1) / 2 {
		depth++
	}

	path := make([]Hash, depth)
	for i := 0; i < depth; i++ {
		sibling := node - 1
		if node%2 == 1 {
			sibling = node + 1
		}
		path[i] = t.nodes[sibling]
		node = (node - 1) / 2
	}

	return path, nil
}

// Verify walks a proof exactly as the ledger does, which is what makes it worth having here: the
// relayer never posts a root it has not first proved a path against.
func Verify(leaf Hash, proof []Hash, root Hash) bool {
	computed := leaf
	for _, sibling := range proof {
		computed = commutative(computed, sibling)
	}
	return computed == root
}

// commutative hashes an unordered pair, so a proof carries no left/right bookkeeping.
func commutative(a, b Hash) Hash {
	if bytes.Compare(a[:], b[:]) > 0 {
		a, b = b, a
	}

	hasher := sha3.NewLegacyKeccak256()
	hasher.Write(a[:])
	hasher.Write(b[:])

	var out Hash
	copy(out[:], hasher.Sum(nil))
	return out
}
