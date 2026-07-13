package ops

import (
	"context"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"

	"goodhouse/relayer/internal/chain"
)

// TouchDebt executes a default: the pool pays the recipient, and the allowance takes the write-down.
//
// **Sent from the stranger's key, and that is the entire demonstration.** The debt was already in
// default — it went into default by arithmetic, the moment its deadline passed with nobody having paid
// it. This transaction decides nothing; it collects a fact. Anyone may send it, and in the demo
// somebody with no stake in any of it does, because the person who was wronged must never have to.
//
// The event the pool emits carries `by` — the account that collected the lapse. That field is how the
// ledger view shows, without narration, that the creator sent nothing and a stranger did the work.
func (o *Ops) TouchDebt(ctx context.Context, debtID uint64) error {
	id := new(big.Int).SetUint64(debtID)

	debt, err := o.C.Debts.Debt(callOpts(ctx), id)
	if err != nil {
		return err
	}
	balanceBefore, err := o.C.NGN.BalanceOf(callOpts(ctx), debt.Recipient)
	if err != nil {
		return err
	}

	if _, err := o.Client.Send(ctx, o.Keys.Stranger, "touch debt", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Pool.Touch(auth, id)
	}); err != nil {
		return err
	}

	balanceAfter, err := o.C.NGN.BalanceOf(callOpts(ctx), debt.Recipient)
	if err != nil {
		return err
	}
	allowance, err := o.C.Ceiling.Allowance(callOpts(ctx))
	if err != nil {
		return err
	}
	owed, err := o.C.Pool.ReimbursementOutstanding(callOpts(ctx))
	if err != nil {
		return err
	}

	o.Say("  stranger %s touched debt #%d", short(chain.Address(o.Keys.Stranger)), debtID)
	o.Say("  → %s paid %s from the pool, in full, having sent no transaction of her own",
		short(debt.Recipient), money(new(big.Int).Sub(balanceAfter, balanceBefore)))
	o.Say("  → allowance written down to %s; the operator now owes the pool %s, and its growth is frozen",
		money(allowance), money(owed))

	return nil
}

// TouchClaim collects a claim whose coverage deadline passed with no evidence behind it.
//
// The second permissionless touch, and the second time the same principle does the work: the claim did
// not die because a stranger sent this transaction — it died when the deadline passed with nothing to
// show, and the transaction only records it.
func (o *Ops) TouchClaim(ctx context.Context, claimID uint64) error {
	id := new(big.Int).SetUint64(claimID)

	if _, err := o.Client.Send(ctx, o.Keys.Stranger, "touch claim", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Sweep.Touch(auth, id)
	}); err != nil {
		return err
	}

	debtIDs, err := o.C.Debts.ClaimDebts(callOpts(ctx), id)
	if err != nil {
		return err
	}

	o.Say("  stranger %s touched claim #%d: no evidence ever appeared, so it is void",
		short(chain.Address(o.Keys.Stranger)), claimID)

	for _, debtID := range debtIDs {
		debt, err := o.C.Debts.Debt(callOpts(ctx), debtID)
		if err != nil {
			return err
		}
		defaultable, err := o.C.Debts.IsDefaultable(callOpts(ctx), debtID)
		if err != nil {
			return err
		}
		o.Say("  → debt #%s is back, aging from the moment it always aged from (%d), in default: %v",
			debtID, debt.MintedAt, defaultable)
	}

	return nil
}

// ExpireCommitment releases an order the operator failed to fulfil in time.
//
// Permissionless too, and for the same reason: a buyer's way out cannot run through the party that let
// them down.
func (o *Ops) ExpireCommitment(ctx context.Context, itemID uint64) error {
	if _, err := o.Client.Send(ctx, o.Keys.Stranger, "expire commitment", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Gateway.ExpireCommitment(auth, new(big.Int).SetUint64(itemID))
	}); err != nil {
		return err
	}

	o.Say("  item %d's reservation lapsed. It is back on the shelf, and the buyer's refund is an "+
		"ordinary aged debt that the ordinary default path covers", itemID)
	return nil
}

// CollectPenalty pushes a wronged recipient the fine a voided claim owed them.
//
// Pulled from the operator's funding account against the standing approval, and pushed by anyone who
// cares to send the transaction — the recipient is owed the money whether or not she is watching, and
// making her ask for it would be one more thing the protocol demands of the party it exists to protect.
func (o *Ops) CollectPenalty(ctx context.Context, recipient common.Address) error {
	due, err := o.C.Pool.PenaltyDue(callOpts(ctx), recipient)
	if err != nil {
		return err
	}
	if due.Sign() == 0 {
		return nil
	}

	if _, err := o.Client.Send(ctx, o.Keys.Stranger, "collect penalty", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Pool.CollectPenalty(auth, recipient)
	}); err != nil {
		return err
	}

	o.Say("  %s of the lying fee paid to %s, out of the operator's own pocket",
		money(due), short(recipient))
	return nil
}

// CollectPoolDues collects the pool's half of every void penalty and every write-off's dues.
func (o *Ops) CollectPoolDues(ctx context.Context) error {
	due, err := o.C.Pool.PoolDuesOwed(callOpts(ctx))
	if err != nil {
		return err
	}
	if due.Sign() == 0 {
		return nil
	}

	if _, err := o.Client.Send(ctx, o.Keys.Stranger, "collect pool dues", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Pool.CollectPoolDues(auth)
	}); err != nil {
		return err
	}

	// Named, not lumped. This sum is not all fines, and calling it "fines" invites an audience to add up
	// the penalties, get a smaller number, and conclude the books do not close — which is exactly what
	// happened when somebody who had never seen this system was handed the transcript and asked to check
	// it. What lands here is the pool's half of every void penalty, plus a write-off's fee, plus the
	// share of a written-off item that had no one to attribute it to. A ledger that cannot be reconciled
	// on the screen it is displayed on is not "arithmetic anybody can check".
	o.Say("  %s collected into the pool — the pool's half of the void penalties, plus each write-off's fee", money(due))
	o.Say("  and the share of a written-off item that no referral was ever presented for")
	return nil
}

// Reimburse pays the pool back for a default it covered.
//
// Paying late does not erase the default: the recipient was made whole by the fund, so the operator's
// obligation changed creditor rather than disappearing, and the write-down stands. This is the only
// way the operator un-chokes its own capacity — the duty and the incentive are one mechanism.
func (o *Ops) Reimburse(ctx context.Context, amount *big.Int) error {
	if _, err := o.Client.Send(ctx, o.Keys.Operator, "reimburse", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Pool.Reimburse(auth, amount)
	}); err != nil {
		return err
	}

	owed, err := o.C.Pool.ReimbursementOutstanding(callOpts(ctx))
	if err != nil {
		return err
	}
	frozen, err := o.C.Ceiling.Frozen(callOpts(ctx))
	if err != nil {
		return err
	}

	o.Say("  %s reimbursed. Still owed: %s. Growth frozen: %v (healing is prospective — the volume "+
		"settled while the pool was short earns nothing, ever)", money(amount), money(owed), frozen)
	return nil
}
