package ops

import (
	"context"
	"math/big"
)

// Status is the public ledger's headline numbers — every one of them a public read, available to
// anybody with an RPC endpoint and no relationship with the operator at all.
type Status struct {
	PoolBalance   *big.Int
	Allowance     *big.Int
	Ceiling       *big.Int
	Used          *big.Int
	Headroom      *big.Int
	Outstanding   *big.Int
	Reimbursement *big.Int
	Penalties     *big.Int
	Frozen        bool
	Debts         uint64
	Claims        uint64
}

// Status reads the till.
//
// Nothing here is the relayer's opinion. These are the same numbers the web's ledger view reads, from
// the same contracts, over the same public RPC — and if this process is dead, they are still readable.
// That is the difference between a dashboard and a ledger.
func (o *Ops) Status(ctx context.Context) (Status, error) {
	var s Status
	var err error

	opts := callOpts(ctx)

	if s.PoolBalance, err = o.C.Pool.Balance(opts); err != nil {
		return s, err
	}
	if s.Allowance, err = o.C.Ceiling.Allowance(opts); err != nil {
		return s, err
	}
	if s.Ceiling, err = o.C.Ceiling.Ceiling(opts); err != nil {
		return s, err
	}
	if s.Used, err = o.C.Ceiling.Used(opts); err != nil {
		return s, err
	}
	if s.Headroom, err = o.C.Ceiling.Headroom(opts); err != nil {
		return s, err
	}
	if s.Outstanding, err = o.C.Debts.Outstanding(opts); err != nil {
		return s, err
	}
	if s.Reimbursement, err = o.C.Pool.ReimbursementOutstanding(opts); err != nil {
		return s, err
	}
	if s.Penalties, err = o.C.Pool.PenaltiesOutstanding(opts); err != nil {
		return s, err
	}
	if s.Frozen, err = o.C.Ceiling.Frozen(opts); err != nil {
		return s, err
	}

	debts, err := o.C.Debts.DebtCount(opts)
	if err != nil {
		return s, err
	}
	s.Debts = debts.Uint64()

	claims, err := o.C.Debts.ClaimCount(opts)
	if err != nil {
		return s, err
	}
	s.Claims = claims.Uint64()

	return s, nil
}

// PrintStatus narrates the till.
func (o *Ops) PrintStatus(ctx context.Context) error {
	s, err := o.Status(ctx)
	if err != nil {
		return err
	}

	o.Say("  pool %s + allowance %s = ceiling %s", money(s.PoolBalance), money(s.Allowance), money(s.Ceiling))
	o.Say("  used %s (custody %s · owed to the pool %s · unpaid fines %s) → headroom %s",
		money(s.Used), money(s.Outstanding), money(s.Reimbursement), money(s.Penalties), money(s.Headroom))
	if s.Frozen {
		o.Say("  growth is FROZEN: the operator owes the pool, and heals only by paying it")
	}
	o.Say("  %d debts · %d claims", s.Debts, s.Claims)

	return nil
}

// DebtsOfSale lists the debt ids a sale minted, newest sale last. The relayer keeps no ledger of its
// own: it asks the ledger.
func (o *Ops) DebtsOfSale(ctx context.Context, itemID uint64) ([]uint64, error) {
	count, err := o.C.Debts.DebtCount(callOpts(ctx))
	if err != nil {
		return nil, err
	}

	var out []uint64
	for id := uint64(1); id <= count.Uint64(); id++ {
		debt, err := o.C.Debts.Debt(callOpts(ctx), new(big.Int).SetUint64(id))
		if err != nil {
			return nil, err
		}
		if debt.SaleRef.Uint64() == itemID {
			out = append(out, id)
		}
	}

	return out, nil
}

// Claimable filters a sale's debts down to the ones a claim can name: everything but the operator's
// own leg, which is retained at mint and can never be claimed, because there is no payment of yourself
// to prove.
func (o *Ops) Claimable(ctx context.Context, debtIDs []uint64) ([]uint64, error) {
	var out []uint64

	for _, id := range debtIDs {
		debt, err := o.C.Debts.Debt(callOpts(ctx), new(big.Int).SetUint64(id))
		if err != nil {
			return nil, err
		}
		// DebtState.AGING — the only state a claim may attach to.
		if debt.State == 1 {
			out = append(out, id)
		}
	}

	return out, nil
}
