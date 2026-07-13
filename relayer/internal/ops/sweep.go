package ops

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/core/types"

	"goodhouse/relayer/internal/storage"
)

// Sweep posts the period's attestation: one proof over the operator's transfer log, covering every
// claim it can reach.
//
// This is the ratchet, and it is the half of the design that protects people who are not watching. A
// challenge catches a false claim only if somebody is awake to catch it; the sweep runs whether anyone
// is awake or not. A claim it cannot cover keeps its clock and dies at its deadline — so silence can
// delay the reckoning by one coverage window and can never replace the evidence.
//
// Two transactions, in this order: the evidence blob goes to storage and its hash goes on-chain, and
// then the attestation names the claims it covers. A batch never fails because one claim in it cannot
// be covered — it says so, out loud, with a deadline attached. An attestation that reverted would make
// the operator's own failures unrecordable, and "the sweep reverted" is not evidence of anything.
func (o *Ops) Sweep(ctx context.Context, claimIDs []uint64) error {
	blob, err := json.MarshalIndent(attestation{
		Period:   time.Now().UTC().Format(time.RFC3339),
		Note:     "processor transfer log for the period",
		ClaimIDs: claimIDs,
	}, "", "  ")
	if err != nil {
		return err
	}

	pointer, err := o.publish(ctx, fmt.Sprintf("attestation-%d", time.Now().Unix()), blob)
	if err != nil {
		return err
	}

	if _, err := o.Client.Send(ctx, o.Keys.Operator, "submit evidence", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Proofs.SubmitEvidence(auth, blob, pointer)
	}); err != nil {
		return err
	}

	ids := make([]*big.Int, len(claimIDs))
	for i, id := range claimIDs {
		ids[i] = new(big.Int).SetUint64(id)
	}

	if _, err := o.Client.Send(ctx, o.Keys.Operator, "attest", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Sweep.Attest(auth, ids, blob, pointer)
	}); err != nil {
		return err
	}

	// What the sweep actually covered, read back from the chain rather than assumed. A claim the
	// evidence did not reach is still sitting there, still owed evidence, still on its clock.
	for _, id := range claimIDs {
		claim, err := o.C.Debts.Claim(callOpts(ctx), new(big.Int).SetUint64(id))
		if err != nil {
			return err
		}
		o.Say("  claim #%d → %s", id, claimState(claim.State))
	}
	o.Say("  evidence %s published to %s", storage.Fingerprint(blob).Hex()[:10]+"…", o.Store.Backend())

	// And now the reader's half of it, done the reader's way: take the pointer *from the chain* — not
	// from the variable a few lines up, which only proves this program remembers what it just did — and
	// fetch the bytes back out of the public store. What an attestation is worth is exactly what a
	// stranger can retrieve and check against it, so the check is a stranger's: resolve the pointer,
	// hash what comes back, and compare it to the fingerprint the sweep put on-chain beside it.
	sweepID, err := o.C.Sweep.AttestationCount(callOpts(ctx))
	if err != nil {
		return err
	}
	attestation, err := o.C.Sweep.Attestation(callOpts(ctx), sweepID)
	if err != nil {
		return err
	}

	return o.ResolveEvidence(ctx, attestation.StoragePointer, attestation.EvidenceHash)
}

// attestation is the blob's shape. In production it is the processor's transfer log for the period and
// the zkTLS transcript over it; here it is a record of what was claimed, hashed on-chain so it cannot
// be swapped afterwards for a better story.
type attestation struct {
	Period   string   `json:"period"`
	Note     string   `json:"note"`
	ClaimIDs []uint64 `json:"claimIds"`
}

func claimState(state uint8) string {
	switch state {
	case 1:
		return "pending"
	case 2:
		return "challenged"
	case 3:
		return "settled (on silence — still owes the sweep its evidence)"
	case 4:
		return "PROVEN (evidence on-chain; beyond challenge, and it earns capacity)"
	case 5:
		return "VOID"
	default:
		return "unknown"
	}
}
