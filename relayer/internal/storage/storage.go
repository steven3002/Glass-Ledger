// Package storage publishes the blobs the chain only points at: item vouchers, sweep evidence, and
// the write-off's incident file.
//
// What is on-chain is a hash and a pointer. What the hash commits to lives here, and the split is
// deliberate: a voucher is a few hundred bytes that thirteen items' worth of tags would be foolish to
// store on-chain, but a voucher whose bytes could be swapped afterwards would be no voucher at all.
// So the bytes go to content-addressed storage and the commitment goes on-chain, and anyone can fetch
// the bytes, hash them, and compare — without asking the operator for anything.
//
// Production note: the store is 0G Storage, reached through its SDK against a public indexer. That is
// public infrastructure, not operator infrastructure, which is what keeps the verification path clean:
// a buyer checking a tag talks to a public RPC and a public store, and never to anything Good runs.
// The local backend below exists so the demo can run end-to-end against a development chain with no
// network at all; it is chosen explicitly, and it says so in its pointer.
package storage

import (
	"context"

	"github.com/ethereum/go-ethereum/common"
)

// Store publishes bytes and returns the pointer the chain will carry.
type Store interface {
	// Put publishes a blob and returns its pointer: the 32 bytes an on-chain record holds.
	Put(ctx context.Context, name string, blob []byte) (common.Hash, error)

	// Get fetches a blob back by its pointer. Anyone can do this; the operator holds no privilege
	// here, which is the whole point of the store being public.
	Get(ctx context.Context, pointer common.Hash) ([]byte, error)

	// Backend names where the bytes went, so a demo can never quietly claim to have used 0G Storage
	// when it wrote a file to a laptop.
	Backend() string
}

// Metered is a store that pays for what it publishes, and can say which uploads it paid for.
//
// On 0G an upload is a transaction, so publication has a price and a receipt. Two things depend on
// knowing which uploads were actually submitted: the bill, which must not credit the operator with
// spending it did not do, and the honesty of the narration — bytes already on the network cost nothing
// to republish, and a store that could not tell the difference once had the local demo announcing that
// thirteen vouchers were "already on the network" when it had no network at all.
//
// The local backend does not implement this, and that is the answer to the question rather than a gap
// in it: a store that pays nobody has no submissions to report.
type Metered interface {
	Submissions() []common.Hash
}
