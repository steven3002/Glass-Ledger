package ops

import (
	"context"
	"math/big"
)

// The clocks. Every one of them is read from the chain, never from a constant in this program: a demo
// that carried its own copy of the settlement window could disagree with the protocol it is
// demonstrating, and would eventually do so at the worst possible moment.

// DebtDeadline is when a debt goes into default if nobody has paid it. It is written once, at mint,
// and never moves again — which is what makes re-aging need no mechanism at all: a claim that dies
// hands back a debt at the age it always had.
func (o *Ops) DebtDeadline(ctx context.Context, debtID uint64) (uint64, error) {
	debt, err := o.C.Debts.Debt(callOpts(ctx), new(big.Int).SetUint64(debtID))
	if err != nil {
		return 0, err
	}
	return debt.Deadline, nil
}

// ChallengeDeadline is the moment silence ratifies a claim.
func (o *Ops) ChallengeDeadline(ctx context.Context, claimID uint64) (uint64, error) {
	claim, err := o.C.Debts.Claim(callOpts(ctx), new(big.Int).SetUint64(claimID))
	if err != nil {
		return 0, err
	}
	return claim.ChallengeDeadline, nil
}

// ResponseDeadline is the operator's own clock: how long it has to answer a challenge with proof.
func (o *Ops) ResponseDeadline(ctx context.Context, claimID uint64) (uint64, error) {
	claim, err := o.C.Debts.Claim(callOpts(ctx), new(big.Int).SetUint64(claimID))
	if err != nil {
		return 0, err
	}
	return claim.ResponseDeadline, nil
}

// CoverageDeadline is the moment a claim needs evidence behind it or it is void — the backstop that
// protects the recipient who never looked.
func (o *Ops) CoverageDeadline(ctx context.Context, claimID uint64) (uint64, error) {
	deadline, err := o.C.Sweep.CoverageDeadline(callOpts(ctx), new(big.Int).SetUint64(claimID))
	if err != nil {
		return 0, err
	}
	return deadline, nil
}

// FulfilmentDeadline is when an unfulfilled order becomes a refund the pool will pay.
func (o *Ops) FulfilmentDeadline(ctx context.Context, itemID uint64) (uint64, error) {
	item, err := o.C.Items.ItemOf(callOpts(ctx), new(big.Int).SetUint64(itemID))
	if err != nil {
		return 0, err
	}
	return item.CommittedUntil, nil
}

// Wait moves to the far side of a deadline.
func (o *Ops) Wait(ctx context.Context, deadline uint64, what string) error {
	if err := o.Client.WaitUntil(ctx, deadline); err != nil {
		return err
	}
	o.Say("  … %s", what)
	return nil
}

// Naira converts whole naira into the token's 18-decimal units.
func Naira(whole *big.Int) *big.Int {
	return new(big.Int).Mul(whole, new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))
}
