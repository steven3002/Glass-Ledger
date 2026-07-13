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

	// What the operator's standing is with each creator it deals with. There is no single number here
	// any more, and there is not supposed to be: capacity is a property of a relationship, so a shop
	// can have a wide-open till with one creator and a shut one with another, at the same instant.
	Capacity []Relationship

	// And the one thing the protocol says about the operator as a whole. It is not a score.
	Record Failure
}

// Relationship is the operator's standing with one creator.
type Relationship struct {
	CreatorID   uint64
	Allowance   *big.Int
	Outstanding *big.Int
	Headroom    *big.Int
}

// Failure is the operator's record: what it has broken, and what it owes.
//
// Note what is not in it. There is no rating, no average and above all no *rate* — a rate has a
// denominator, and the denominator is exactly what an operator with a Sybil budget manufactures. Sell
// to yourself ten thousand times and any ratio you like improves. So this is a rap sheet in absolute
// counts and amounts, every field monotone in misbehaviour: **you cannot farm a clean record, you can
// only fail to have failed.**
type Failure struct {
	Defaults        uint64
	DefaultValue    *big.Int
	ClaimsVoided    uint64
	OwedToPool      *big.Int
	PenaltiesUnpaid *big.Int
	GrowthFrozen    bool
	PoolBalance     *big.Int
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
	if s.Allowance, err = o.C.Ceiling.TotalAllowance(opts); err != nil {
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

	// One row per creator the registry knows about. The ceiling answers for a creator it has never
	// heard of too — she stands at her genesis threshold — but a table of relationships that do not
	// exist would be a table of noise.
	creators, err := o.C.Registry.CreatorCount(opts)
	if err != nil {
		return s, err
	}
	for id := uint64(1); id <= creators.Uint64(); id++ {
		creatorID := new(big.Int).SetUint64(id)
		row := Relationship{CreatorID: id}

		if row.Allowance, err = o.C.Ceiling.AllowanceOf(opts, creatorID); err != nil {
			return s, err
		}
		if row.Outstanding, err = o.C.Debts.OutstandingOf(opts, creatorID); err != nil {
			return s, err
		}
		if row.Headroom, err = o.C.Ceiling.HeadroomOf(opts, creatorID); err != nil {
			return s, err
		}

		s.Capacity = append(s.Capacity, row)
	}

	record, err := o.C.Ceiling.Record(opts)
	if err != nil {
		return s, err
	}
	s.Record = Failure{
		Defaults:        record.Defaults.Uint64(),
		DefaultValue:    record.DefaultValue,
		ClaimsVoided:    record.ClaimsVoided.Uint64(),
		OwedToPool:      record.OwedToPool,
		PenaltiesUnpaid: record.PenaltiesUnpaid,
		GrowthFrozen:    record.GrowthFrozen,
		PoolBalance:     record.PoolBalance,
	}

	return s, nil
}

// PrintStatus narrates the till.
func (o *Ops) PrintStatus(ctx context.Context) error {
	s, err := o.Status(ctx)
	if err != nil {
		return err
	}

	o.Say("  pool %s + earned record %s = the network's ceiling %s",
		money(s.PoolBalance), money(s.Allowance), money(s.Ceiling))
	o.Say("  used %s (custody %s · owed to the pool %s · unpaid fines %s) → headroom %s",
		money(s.Used), money(s.Outstanding), money(s.Reimbursement), money(s.Penalties), money(s.Headroom))

	// And the number that actually decides whether a dress can be sold: the one for *her*.
	for _, row := range s.Capacity {
		o.Say("  creator #%d: allowance %s · holding %s of hers · headroom %s",
			row.CreatorID, money(row.Allowance), money(row.Outstanding), money(row.Headroom))
	}

	if s.Frozen {
		o.Say("  growth is FROZEN: the operator owes the pool, and heals only by paying it")
	}
	o.Say("  %d debts · %d claims", s.Debts, s.Claims)

	o.Say("  Good's record: %d defaults (%s) · %d claims voided · %s owed to the pool · %s in unpaid fines",
		s.Record.Defaults, money(s.Record.DefaultValue), s.Record.ClaimsVoided,
		money(s.Record.OwedToPool), money(s.Record.PenaltiesUnpaid))
	o.Say("  (that is not a score. It is what Good has broken and what Good owes — and no amount of " +
		"trading with itself can improve it.)")

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
