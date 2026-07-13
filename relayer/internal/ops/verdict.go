package ops

import (
	"context"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/core/types"
)

// InjectVerdict tells the stub verifier what a real zkTLS verifier would have concluded about a claim.
//
// Read the statement it is verdicting on: it comes **from the ledger**, never from here. The relayer
// cannot compose the statement it is about to have judged, and that is not a stylistic choice — it is
// the property the whole settlement design rests on. The ledger assembles the statement out of what it
// captured when the claim was posted (the payment reference, the recipients' account hashes as they
// stood at that moment, the amounts, the currency), so an operator holding a genuine receipt for some
// *other* payment cannot aim it at this claim. It would be proving a statement nobody asked about.
//
// Production note: this whole function disappears. A real verifier takes a zkTLS transcript and checks
// two things — that it is cryptographically valid, and that it says what this statement says. Garbage
// fails the first test; real-but-irrelevant evidence fails the second. There is no third party to ask
// and no verdict to inject, which is why there is no `setVerifier` anywhere in this protocol: a
// mutable verifier pointer under the operator's key would let the operator decide what counts as
// proof, and it would decide "everything does".
func (o *Ops) InjectVerdict(ctx context.Context, claimID uint64, valid bool) error {
	statement, err := o.C.Debts.StatementOf(callOpts(ctx), new(big.Int).SetUint64(claimID))
	if err != nil {
		return err
	}

	if _, err := o.Client.Send(ctx, o.Keys.Operator, "inject verdict", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Proofs.SetVerdict(auth, statement, valid)
	}); err != nil {
		return err
	}

	if valid {
		o.Say("  the payment for claim #%d is in the processor's records — the stub will say so", claimID)
	} else {
		o.Say("  no such payment exists — the stub will say so about claim #%d", claimID)
	}

	return nil
}
