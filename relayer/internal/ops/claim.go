package ops

import (
	"context"
	"crypto/ecdsa"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/core/types"

	"goodhouse/relayer/internal/feeds"
)

// PostClaim is the operator asserting that it paid these debts, naming the payment.
//
// Single or batched, it is one assertion with one fate: if it cannot be sustained, every debt under it
// re-ages and every recipient under it is a wronged party. Batch composition is therefore the
// operator's own blast radius, chosen by the operator — an honest one has nothing to fear from putting
// a thousand real payments in one claim, and a dishonest one has everything to fear from putting one
// lie in with them.
func (o *Ops) PostClaim(ctx context.Context, debtIDs []uint64, payment feeds.ProcessorPayload) (uint64, error) {
	ids := make([]*big.Int, len(debtIDs))
	for i, id := range debtIDs {
		ids[i] = new(big.Int).SetUint64(id)
	}

	if _, err := o.Client.Send(ctx, o.Keys.Operator, "post claim", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Debts.PostClaim(auth, ids, payment.RefHash())
	}); err != nil {
		return 0, err
	}

	count, err := o.C.Debts.ClaimCount(callOpts(ctx))
	if err != nil {
		return 0, err
	}
	claimID := count.Uint64()

	claim, err := o.C.Debts.Claim(callOpts(ctx), count)
	if err != nil {
		return 0, err
	}
	o.Say("  claim #%d posted over %d debts (%s) — challengeable until the clock at %d",
		claimID, len(debtIDs), money(claim.TotalAmount), claim.ChallengeDeadline)

	return claimID, nil
}

// Challenge is a recipient saying, in her own name, that she was not paid.
//
// Sent from her key and from no other. There is no allow-list, no operator approval and no privileged
// relay: the transaction is valid from any node on earth, which is the whole reason the relayer being
// dead cannot silence her. The relayer *can* carry a signed challenge for a recipient who holds no gas
// (`challengeFor`), and that is a convenience — never a gate.
func (o *Ops) Challenge(ctx context.Context, claimID uint64) error {
	return o.ChallengeFrom(ctx, claimID, o.Keys.Creator)
}

// ChallengeFrom is the same, from a named key.
//
// Whose key it is, is the whole substance of the act. A challenge is a creditor saying *I was not
// paid*, and it means nothing said by anybody else — so a scenario covering several creators has to
// send each challenge from the creator it belongs to, rather than from whichever key happens to be
// to hand. The contract enforces this; sending the wrong one produces a revert, not a wrong result.
func (o *Ops) ChallengeFrom(ctx context.Context, claimID uint64, key *ecdsa.PrivateKey) error {
	if _, err := o.Client.Send(ctx, key, "challenge", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Debts.Challenge(auth, new(big.Int).SetUint64(claimID))
	}); err != nil {
		return err
	}

	claim, err := o.C.Debts.Claim(callOpts(ctx), new(big.Int).SetUint64(claimID))
	if err != nil {
		return err
	}
	o.Say("  the creator challenged claim #%d from her own key — the operator has until %d to prove it",
		claimID, claim.ResponseDeadline)

	return nil
}

// Respond is the operator answering a challenge with evidence.
//
// The statement being proved is built by the *ledger*, out of what it captured when the claim was
// posted. The operator supplies the proof and nothing else — it cannot describe the payment it is
// proving, so a real receipt for a different payment answers a question nobody asked.
func (o *Ops) Respond(ctx context.Context, claimID uint64, proof []byte) error {
	_, err := o.Client.Send(ctx, o.Keys.Operator, "respond", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Debts.Respond(auth, new(big.Int).SetUint64(claimID), proof)
	})
	return err
}

// RespondExpectingRefusal is the operator trying to answer with a proof it does not have.
func (o *Ops) RespondExpectingRefusal(ctx context.Context, claimID uint64, proof []byte) (string, error) {
	return o.Client.MustRevert(ctx, o.Keys.Operator, "respond", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Debts.Respond(auth, new(big.Int).SetUint64(claimID), proof)
	})
}

// SettleClaim records that a claim's challenge window closed with nobody having tested it.
//
// Permissionless, and sent here from the stranger's key to make the point: silence ratifies a claim,
// and recording that fact is arithmetic anyone can execute. The recipient did nothing, and did not
// have to.
func (o *Ops) SettleClaim(ctx context.Context, claimID uint64) error {
	if _, err := o.Client.Send(ctx, o.Keys.Stranger, "settle claim", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Debts.SettleClaim(auth, new(big.Int).SetUint64(claimID))
	}); err != nil {
		return err
	}

	o.Say("  claim #%d settled on silence — provisionally. It still owes the sweep its evidence", claimID)
	return nil
}

// VoidChallenged kills a challenged claim the operator never answered.
//
// Sent from the stranger's key. The wronged recipient has already done the only thing the protocol
// ever asks of her, which is to say she was not paid; everything after that is arithmetic a stranger
// can execute.
func (o *Ops) VoidChallenged(ctx context.Context, claimID uint64) error {
	if _, err := o.Client.Send(ctx, o.Keys.Stranger, "void claim", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Debts.VoidChallenged(auth, new(big.Int).SetUint64(claimID))
	}); err != nil {
		return err
	}

	rate, err := o.C.Debts.PenaltyRateBps(callOpts(ctx))
	if err != nil {
		return err
	}
	fine, err := o.C.Pool.PenaltiesOutstanding(callOpts(ctx))
	if err != nil {
		return err
	}
	o.Say("  claim #%d is void. The debts come back at the age they always had, and the lying fee is "+
		"%s — unpaid, and already eating the operator's own ceiling (next void: %s%%)",
		claimID, money(fine), new(big.Int).Div(rate, big.NewInt(100)))

	return nil
}
