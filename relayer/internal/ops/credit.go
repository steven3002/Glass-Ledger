package ops

import (
	"context"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/core/types"
)

// CreditSettlement collects the capacity a proven payout earned.
//
// This is the operation an operator forgets at its peril, and the demo runs it on purpose so that the
// sentence can be said out loud: **capacity is collected, not granted.** The allowance does not
// quietly accumulate in the background to be handed over later. Each proven claim's growth has to be
// claimed, and whatever has not been claimed when a default lands is gone — not only the volume proven
// during the freeze, but any earlier growth still uncollected when the freeze began.
//
// Two further rules are visible from here. Growth is credited on a claim that is **proven** and never
// on one that merely settled, because a claim that closed unchallenged can still die at its coverage
// deadline — so capacity awarded at settlement would be capacity awarded for a payment that may never
// have happened. And an operator that never attests never grows: the sweep is what turns a settled
// claim into a proven one, so the ratchet that protects the sleeping recipient is the same machine
// that pays the operator its capacity.
func (o *Ops) CreditSettlement(ctx context.Context, claimID uint64) error {
	before, err := o.C.Ceiling.Allowance(callOpts(ctx))
	if err != nil {
		return err
	}

	if _, err := o.Client.Send(ctx, o.Keys.Operator, "credit settlement", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Ceiling.CreditSettlement(auth, new(big.Int).SetUint64(claimID))
	}); err != nil {
		return err
	}

	after, err := o.C.Ceiling.Allowance(callOpts(ctx))
	if err != nil {
		return err
	}

	o.Say("  claim #%d's proven value credited: allowance %s → %s (+%s)",
		claimID, money(before), money(after), money(new(big.Int).Sub(after, before)))

	return nil
}

// CreditSettlementExpectingRefusal tries to collect growth the protocol will not grant, and reports
// the rule that refused it — a claim that only settled, a claim already credited, a claim whose value
// the freeze forfeited.
func (o *Ops) CreditSettlementExpectingRefusal(ctx context.Context, claimID uint64) (string, error) {
	return o.Client.MustRevert(ctx, o.Keys.Operator, "credit settlement", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Ceiling.CreditSettlement(auth, new(big.Int).SetUint64(claimID))
	})
}
