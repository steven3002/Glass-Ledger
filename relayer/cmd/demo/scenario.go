package main

import (
	"context"
	"fmt"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"

	"goodhouse/relayer/internal/chain"
	"goodhouse/relayer/internal/ops"
)

// The shelf, by item id. Thirteen dresses; the demo consumes eight of them.
const (
	itemInstant  = 1001 // P1: the atomic sale
	itemBuyer    = 1002 // P1: a sponsored purchase and a claim code
	itemHonest   = 1003 // P4: the honest cash sale — claimed, settled, proven, credited
	itemLie      = 1004 // P4: the false claim — challenged, unanswered, void
	itemAsleep   = 1005 // P4: the sleeping recipient — never challenged, never covered, void anyway
	itemStalled  = 1006 // P5: never claimed at all. The thesis.
	itemOffBooks = 1007 // P3: the item that went home in somebody's bag
	itemBurned   = 1008 // P6: the write-off
	itemAfter    = 1009 // P5: the sale that is refused, and the one that is not
)

// scenario runs the whole demo: the seven proofs, in the order the story tells them.
//
// Nothing here is staged. Every transaction is one an operator could send, from the operator's own key,
// and the two that punish the operator are sent from a stranger's — a key with no position in any of
// it, which is exactly the point. The clocks are the deployed contracts' own; the arithmetic is the
// deployed contracts' own; and where the protocol refuses something, the refusal is printed by name,
// because a rule that cannot be read is a rule nobody can rely on.
func scenario(ctx context.Context, o *ops.Ops) error {
	act := func(number int, title string) {
		o.Say("\n━━━ Act %d — %s\n", number, title)
	}

	// ─── Act 0 ────────────────────────────────────────────────────────────────────────────────────
	act(0, "The shop opens")
	if err := o.Seed(ctx); err != nil {
		return err
	}

	// ─── Act 1 ────────────────────────────────────────────────────────────────────────────────────
	act(1, "P1 — the atomic sale: the item IS the ledger")
	o.Say("  One transaction: the tag is checked, the shelf is checked, the ceiling is checked, the")
	o.Say("  item is consumed, the split is owed, and the certificate exists. There is no ordering in")
	o.Say("  which the operator takes the money and skips a step, because the steps are one step.\n")

	if err := o.SellInstant(ctx, itemInstant, payment(itemInstant)); err != nil {
		return err
	}
	o.Say("")
	if err := o.Buy(ctx, itemBuyer, payment(itemBuyer)); err != nil {
		return err
	}

	// ─── Act 2 ────────────────────────────────────────────────────────────────────────────────────
	act(2, "P2 — the checkout defends itself")

	refusal, err := o.SellInstantExpectingRefusal(ctx, itemInstant)
	if err != nil {
		return err
	}
	o.Say("  the same tag, a second time → %s", refusal)
	o.Say("  (the state machine IS the nullifier: a clone is a tag for an item that is already sold)\n")

	refusal, err = o.SellForgedExpectingRefusal(ctx, itemHonest)
	if err != nil {
		return err
	}
	o.Say("  a tag the creator never signed → %s", refusal)
	o.Say("  (a forgery cannot be rung up at all. It can only be sold outside the system — with no")
	o.Say("   certificate, no claim code, no recourse, and a scan that exposes it in a second.)")

	// ─── Act 3 ────────────────────────────────────────────────────────────────────────────────────
	act(3, "P4 — the settlement clock: claim → challenge → proof")

	o.Say("  ── the honest path: nobody has to do anything ──\n")
	if err := o.SellCash(ctx, itemHonest); err != nil {
		return err
	}

	honestClaim, err := claimTheSale(ctx, o, itemHonest)
	if err != nil {
		return err
	}

	deadline, err := o.ChallengeDeadline(ctx, honestClaim)
	if err != nil {
		return err
	}
	if err := o.Wait(ctx, deadline, "the challenge window closes. The creator was paid; her phone matched the credit; she did nothing."); err != nil {
		return err
	}
	if err := o.SettleClaim(ctx, honestClaim); err != nil {
		return err
	}
	if err := o.InjectVerdict(ctx, honestClaim, true); err != nil {
		return err
	}
	if err := o.Sweep(ctx, []uint64{honestClaim}); err != nil {
		return err
	}
	if err := o.CreditSettlement(ctx, honestClaim); err != nil {
		return err
	}
	o.Say("  capacity is bought with proof, not with silence. An operator that never attests never grows.")

	o.Say("\n  ── the lie: a claim the operator cannot support ──\n")
	if err := o.SellCash(ctx, itemLie); err != nil {
		return err
	}

	falseClaim, err := claimTheSale(ctx, o, itemLie)
	if err != nil {
		return err
	}
	if err := o.Challenge(ctx, falseClaim); err != nil {
		return err
	}

	// The operator has no proof, because there was no payment. Watch it try.
	if err := o.InjectVerdict(ctx, falseClaim, false); err != nil {
		return err
	}
	refusal, err = o.RespondExpectingRefusal(ctx, falseClaim, []byte("a receipt for a payment that was never made"))
	if err != nil {
		return err
	}
	o.Say("  the operator answers with evidence it does not have → %s", refusal)

	responseDeadline, err := o.ResponseDeadline(ctx, falseClaim)
	if err != nil {
		return err
	}
	if err := o.Wait(ctx, responseDeadline, "the operator's own clock runs out."); err != nil {
		return err
	}
	if err := o.VoidChallenged(ctx, falseClaim); err != nil {
		return err
	}
	o.Say("  the debt is back, at the age it always had — and it is already past its deadline. Stalling")
	o.Say("  costs more than doing nothing, and it can be tried exactly once.")

	o.Say("\n  ── the sleeping recipient: never challenged, and it dies anyway ──\n")
	if err := o.SellCash(ctx, itemAsleep); err != nil {
		return err
	}

	sleepingClaim, err := claimTheSale(ctx, o, itemAsleep)
	if err != nil {
		return err
	}

	deadline, err = o.ChallengeDeadline(ctx, sleepingClaim)
	if err != nil {
		return err
	}
	if err := o.Wait(ctx, deadline, "the challenge window closes. Nobody looked. The claim settles."); err != nil {
		return err
	}
	if err := o.SettleClaim(ctx, sleepingClaim); err != nil {
		return err
	}

	// No verdict is injected: there is no payment, so no sweep can ever cover it.
	if err := o.Sweep(ctx, []uint64{sleepingClaim}); err != nil {
		return err
	}
	o.Say("  the sweep cannot cover what never happened. The claim keeps its clock.")

	coverage, err := o.CoverageDeadline(ctx, sleepingClaim)
	if err != nil {
		return err
	}
	if err := o.Wait(ctx, coverage, "the coverage deadline passes."); err != nil {
		return err
	}
	if err := o.TouchClaim(ctx, sleepingClaim); err != nil {
		return err
	}
	o.Say("  she was protected by arithmetic, not by vigilance. Silence delayed the reckoning by one")
	o.Say("  coverage window; it could never replace the evidence.")

	// ─── Act 4 ────────────────────────────────────────────────────────────────────────────────────
	act(4, "The two sales that will not be paid")

	o.Say("  A cash sale the operator will simply never pay, and never even lie about (P5)…\n")
	if err := o.SellCash(ctx, itemStalled); err != nil {
		return err
	}

	o.Say("\n  …and the item that quietly went home in somebody's bag, which a stranger now buys (P3).\n")
	refundDebt, err := o.CommitOption(ctx, itemOffBooks)
	if err != nil {
		return err
	}

	// Said out loud, because it is the one conclusion an audience does not reach on its own. A cold
	// reader given this demo's transcript got every other proof unprompted and flatly rejected this one —
	// "the system polices the ledger, not the shop; off-books cash is invisible" — which is true of the
	// cash and beside the point. What cannot be made invisible is the *item*: the dress left the building,
	// and its twin is still on the shelf, still listed, still buyable by anybody on earth. Taking a thing
	// off the books does not remove the obligation; it opens a short position against a shop that can no
	// longer deliver, and any stranger may call it. That is why the write-off exists at all — and why the
	// write-off, which is the honest way out, still pays everyone as if the item had sold.
	o.Say("\n  and THIS is why the shop cannot sell off the books. Not because the cash is watched — it is")
	o.Say("  not. Because the *item* is: its twin is still listed, still buyable by anyone in the world,")
	o.Say("  and the operator can no longer deliver it. Selling quietly does not erase the obligation. It")
	o.Say("  opens a short position that a stranger can call — and one just did.")

	o.Say("\n  The operator does nothing about either. Nothing is filed. Nobody accuses anyone.")
	if err := o.PrintStatus(ctx); err != nil {
		return err
	}

	// ─── Act 5 ────────────────────────────────────────────────────────────────────────────────────
	act(5, "P5 — the stalled payout: punished by state alone")

	stalledDebts, err := o.DebtsOfSale(ctx, itemStalled)
	if err != nil {
		return err
	}
	creatorDebt := stalledDebts[0]

	debtDeadline, err := o.DebtDeadline(ctx, creatorDebt)
	if err != nil {
		return err
	}
	if err := o.Wait(ctx, debtDeadline, "the settlement deadline passes. The creator has still sent nothing."); err != nil {
		return err
	}

	o.Say("")
	if err := o.TouchDebt(ctx, creatorDebt); err != nil {
		return err
	}

	o.Say("\n  And now the beat this whole protocol exists for:\n")
	refusal, err = o.SellCashExpectingRefusal(ctx, itemAfter)
	if err != nil {
		return err
	}
	o.Say("  the next cash sale, at the counter → %s", refusal)
	o.Say("  the till is shut. Not by a policy, not by a person — by arithmetic that anybody can check.\n")

	if err := o.SellInstant(ctx, itemAfter, payment(itemAfter)); err != nil {
		return err
	}
	o.Say("  …while the same item, on the rail that never puts money in the operator's hands, still")
	o.Say("  sells. The ceiling constrains custody, and custody only. Commerce does not stop.")

	// ─── Act 6 ────────────────────────────────────────────────────────────────────────────────────
	act(6, "P3 — the standing buy option, and P6 — the write-off")

	fulfilment, err := o.FulfilmentDeadline(ctx, itemOffBooks)
	if err != nil {
		return err
	}
	if err := o.Wait(ctx, fulfilment, "the fulfilment window closes. The operator cannot deliver what it does not have."); err != nil {
		return err
	}

	if err := o.ExpireCommitment(ctx, itemOffBooks); err != nil {
		return err
	}
	if err := o.TouchDebt(ctx, refundDebt); err != nil {
		return err
	}
	o.Say("  the buyer is whole. She filed nothing, accused nobody, and sent no transaction.")
	o.Say("  Nobody accused anyone. The ledger did it.\n")

	if err := o.Burn(ctx, itemBurned, "water damage"); err != nil {
		return err
	}
	o.Say("\n  note what just happened: the write-off went through at a ceiling of zero. A punishment a")
	o.Say("  full ceiling could block would be a punishment the operator escapes by filling its own")
	o.Say("  ceiling — so the write-off takes no authorization, and the debts it mints tighten the")
	o.Say("  ceiling on the next sale instead.")

	// ─── Act 7 ────────────────────────────────────────────────────────────────────────────────────
	act(7, "The road back")

	o.Say("  Nothing was seized, because nothing was ever deposited. What was revoked is the right to")
	o.Say("  hold other people's money — and it comes back only one way.\n")

	if err := o.CollectPenalty(ctx, chain.Address(o.Keys.Creator)); err != nil {
		return err
	}
	if err := o.CollectPenalty(ctx, o.Keys.Landlord); err != nil {
		return err
	}
	if err := o.CollectPenalty(ctx, o.Keys.Community); err != nil {
		return err
	}
	if err := o.CollectPoolDues(ctx); err != nil {
		return err
	}

	owed, err := o.C.Pool.ReimbursementOutstanding(&bind.CallOpts{Context: ctx})
	if err != nil {
		return err
	}
	if owed.Sign() > 0 {
		if err := o.Reimburse(ctx, owed); err != nil {
			return err
		}
	}

	o.Say("")
	if err := o.PrintStatus(ctx); err != nil {
		return err
	}

	o.Say("\n  The write-down stands. It always stands: there is no payment that retroactively")
	o.Say("  un-defaults a debt. Capacity heals only the way it was built — through settled volume,")
	o.Say("  proven, and only forward from the day the pool was squared.")

	// The old closing line said "not one transaction from anybody who was wronged", and it was false. The
	// creator sent one: she challenged the claim that lied about paying her. A cold reader caught it
	// inside a minute, and was right to — a demo that overstates its own result by one transaction has
	// invited the audience to wonder what else it rounded off. The true claim is stronger anyway, because
	// it is the sleeping recipient who proves the point: she sent nothing, watched nothing, and was made
	// whole on the same arithmetic. Vigilance is faster here. It was never load-bearing.
	o.Say("\n━━━ Seven proofs. No filings, no complaints, and no authority anywhere in the picture.")
	o.Say("    One wronged party sent one transaction in all of this — a challenge the creator chose to")
	o.Say("    send, which bought her two minutes. The recipient who did nothing at all was made whole by")
	o.Say("    the same arithmetic, on the same day. Watching is faster. It was never what protected her.\n")
	return nil
}

// claimTheSale posts the operator's assertion that it paid a sale's recipients.
//
// The operator's own leg is not in it. It is retained at mint — payer and payee are the same party, so
// there was never anything to transfer, and there is no payment of yourself to prove.
func claimTheSale(ctx context.Context, o *ops.Ops, itemID uint64) (uint64, error) {
	debts, err := o.DebtsOfSale(ctx, itemID)
	if err != nil {
		return 0, err
	}

	claimable, err := o.Claimable(ctx, debts)
	if err != nil {
		return 0, err
	}
	if len(claimable) == 0 {
		return 0, fmt.Errorf("item %d has no claimable debts", itemID)
	}

	return o.PostClaim(ctx, claimable, payment(itemID))
}
