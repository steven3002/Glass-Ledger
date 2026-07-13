package ops

import (
	"context"
	"fmt"

	"github.com/ethereum/go-ethereum/common"

	"goodhouse/relayer/internal/storage"
)

// ResolvePointers fetches every voucher back out of the store, by the pointer the tag carries, and
// checks that what comes back is the voucher the consignment committed to.
//
// This is the operator running the buyer's own check against itself. A pointer is a promise that
// certain bytes are retrievable by anyone; the promise is worth nothing until somebody retrieves them,
// and the demo cannot afford to discover in front of an audience that a voucher was published to a
// store that no longer serves it. So the check is the buyer's: fetch by pointer, from the public
// indexer, and compare against the digest the chain's tranche root commits to.
//
// It reads and never writes, so it costs nothing — there is no reason not to run it before every
// rehearsal.
func (o *Ops) ResolvePointers(ctx context.Context) error {
	consignment, err := o.Consignment()
	if err != nil {
		return err
	}

	o.Say("  resolving %d voucher pointers through %s", len(consignment.Items), o.Store.Backend())

	for _, item := range consignment.Items {
		if item.Pointer == "" {
			return fmt.Errorf("item %d has no pointer: its voucher was never published (run `publish`)", item.ID)
		}

		blob, err := o.Store.Get(ctx, common.HexToHash(item.Pointer))
		if err != nil {
			return fmt.Errorf("item %d: nothing resolves at %s: %w", item.ID, item.Pointer, err)
		}

		published, err := parsePublishedVoucher(blob)
		if err != nil {
			return fmt.Errorf("item %d: %w", item.ID, err)
		}

		// The digest is the whole point. It is what the creator signed and what the tranche root
		// commits to, so a voucher whose digest is not the leaf on file is a voucher for some other
		// item — however well-formed, however genuinely signed, and whatever the pointer said.
		if published.Digest.Hex() != item.Digest {
			return fmt.Errorf(
				"item %d: the bytes at %s carry digest %s, and the consignment's leaf is %s",
				item.ID, item.Pointer, published.Digest, item.Digest,
			)
		}
		if published.ItemID != fmt.Sprint(item.ID) {
			return fmt.Errorf("item %d: the bytes at %s are the voucher for item %s",
				item.ID, item.Pointer, published.ItemID)
		}
	}

	o.Say("  every pointer resolves, and every voucher is the leaf the chain committed to")
	return nil
}

// ResolveEvidence fetches an evidence blob back by its pointer and checks it against the fingerprint
// the chain holds beside it.
//
// The chain carries two different facts about a sweep's evidence and they answer two different
// questions: the hash says *these bytes*, and the pointer says *over there*. Checking one without the
// other proves half of what is needed — bytes that hash correctly but cannot be fetched are evidence
// nobody can read, and bytes that can be fetched but hash to something else are not the evidence that
// was attested to.
func (o *Ops) ResolveEvidence(ctx context.Context, pointer, fingerprint common.Hash) error {
	blob, err := o.Store.Get(ctx, pointer)
	if err != nil {
		return fmt.Errorf("nothing resolves at %s: %w", pointer, err)
	}

	if got := storage.Fingerprint(blob); got != fingerprint {
		return fmt.Errorf("the bytes at %s hash to %s, and the chain attested to %s",
			pointer, got, fingerprint)
	}

	o.Say("  the evidence at %s… resolves, and it is the evidence the chain attested to (%d bytes)",
		pointer.Hex()[:10], len(blob))
	return nil
}
