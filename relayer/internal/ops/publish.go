package ops

import (
	"context"

	"github.com/ethereum/go-ethereum/common"

	"goodhouse/relayer/internal/chain"
	"goodhouse/relayer/internal/storage"
)

// publish sends a blob to the store and records what publishing it cost.
//
// On 0G the store is a chain. The bytes are submitted in a transaction that the storage client sends on
// the operator's behalf — which means an upload has a price and a receipt exactly like any other
// transaction, and it does *not* pass through the relayer's own Send. It would therefore be missing from
// the bill unless it were fetched back deliberately, and a gas table that quietly omitted the one
// operation the seventh proof is about would be worse than no gas table at all.
//
// A receipt that cannot be read does not fail the caller. The bytes are published and the money is gone
// either way, and losing the *record* of a payment is not a reason to throw away the work the payment
// bought — in the middle of a twenty-minute rehearsal, on an RPC known to mislay a receipt it is about
// to have. It says so out loud instead, because a bill with a hole in it must not look complete.
func (o *Ops) publish(ctx context.Context, name string, blob []byte) (common.Hash, error) {
	paidBefore := o.storeSubmissions()

	pointer, err := o.Store.Put(ctx, name, blob)
	if err != nil {
		return common.Hash{}, err
	}

	for _, submission := range o.storeSubmissions()[len(paidBefore):] {
		if err := o.Client.RecordStorage(ctx, chain.StorageOp, len(blob), submission); err != nil {
			o.Say("  (%s is published — but what it cost could not be read back: %v)", name, err)
		}
	}

	return pointer, nil
}

// storeSubmissions asks the store which uploads it has actually paid for.
//
// A store that pays for nothing answers with nothing, and that is the honest answer rather than a
// missing one: the local backend writes files to a laptop, so a count of zero from it means "free", not
// "these were already published". Reading it as the latter once had the local demo cheerfully announcing
// that thirteen vouchers were already on a network it has never heard of.
func (o *Ops) storeSubmissions() []common.Hash {
	if metered, ok := o.Store.(storage.Metered); ok {
		return metered.Submissions()
	}
	return nil
}

// metered says whether the store is the kind that pays at all.
func (o *Ops) metered() bool {
	_, ok := o.Store.(storage.Metered)
	return ok
}
