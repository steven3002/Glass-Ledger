package main

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"

	"goodhouse/relayer/internal/feeds"
	"goodhouse/relayer/internal/ops"
)

// scenario trades the catalog through one full cycle of trust: earned, then spent, then exhausted.
//
// The order is the argument. The operator behaves for a while and its capacity grows, because that is
// what proven payment does. Then it stops behaving, and every mechanism that exists to bound the
// damage is made to fire in turn — the challenge, the sweep's silence, the default, the fund, and
// finally the ceiling, which shuts the till on a creator who did nothing wrong because the operator
// owes the fund money it has not repaid. That last one is the point: the punishment is not aimed, and
// cannot be, because the protocol does not know who deserves what. It only knows what is owed.
func scenario(ctx context.Context, o *ops.Ops, s *shelf, defaults bool, fromAct int) error {
	act := func(n int, title string) { o.Say("\n━━━ Act %d — %s\n", n, title) }

	// Whether an act still has to happen. Resuming exists because the back half of this run is many
	// minutes of real waiting against a public chain, and something will occasionally interrupt it —
	// a dropped RPC, a key that runs out of gas mid-act. Everything already sent is already sent.
	todo := func(n int) bool {
		if n >= fromAct {
			return true
		}
		o.Say("\n━━━ Act %d — already done on this chain, skipping\n", n)
		return false
	}

	sold := func(itemID uint64) { o.Say("  · %s", s.name(itemID)) }

	var offBooks, refundDebt uint64

	// ─── Act 1 ────────────────────────────────────────────────────────────────────────────────────
	if todo(1) {
		act(1, "Ordinary trade, on the rail that needs no trust")
		o.Say("  The instant rail splits the payment at the processor, so the operator never holds anyone")
		o.Say("  else's money and consumes no ceiling at all. This is why a shop can open on day one with")
		o.Say("  a capacity of almost nothing — and why it will still be selling at the end of this run,")
		o.Say("  after everything else has been shut.\n")

		for _, pick := range []struct{ line, product, variant string }{
			{"adire-works", "resist-scarf", "one size"},
			{"gra-leather", "card-sleeve", "one size"},
			{"ikoyi-ceramics", "salt-dish", "one size"},
		} {
			item, err := s.take(pick.line, pick.product, pick.variant)
			if err != nil {
				return err
			}
			sold(item)
			if err := o.SellInstant(ctx, item, payment(item)); err != nil {
				return err
			}
		}
	}

	// ─── Act 2 ────────────────────────────────────────────────────────────────────────────────────
	if todo(2) {
		act(2, "The honest cash sale — claimed, unchallenged, settled, and paid for in capacity")
		o.Say("  Cash means the operator holds the money. The debts age from the second of the sale, and")
		o.Say("  the ceiling was consulted before the item left the shelf. Claim it, let the challenge")
		o.Say("  window close with nobody objecting, and the operator's standing with this creator grows")
		o.Say("  by what it proved it paid — which is the only way it ever grows.\n")

		o.Say("  Several times over, because one honest sale is not a licence. Capacity is bought with")
		o.Say("  proof and with nothing else, and watching it accumulate is the only way the last act")
		o.Say("  makes sense: what the operator spends when it finally misbehaves is exactly what it")
		o.Say("  earned by behaving.\n")

		for _, pick := range []struct{ line, product, variant string }{
			{"gra-leather", "river-tote", "one size"},
			{"wuse-tailors", "wuse-trouser", "L"},
			{"ikoyi-ceramics", "lagoon-bowl", "small"},
			{"adire-works", "kampala-shirt", "L"},
			{"gra-leather", "work-apron", "one size"},
			{"harmattan-house", "kano-indigo", "100 ml"},
		} {
			item, err := s.take(pick.line, pick.product, pick.variant)
			if err != nil {
				return err
			}
			sold(item)
			if err := honestCycle(ctx, o, item); err != nil {
				return err
			}
			o.Say("")
		}

		ceiling, err := o.C.Ceiling.Ceiling(&bind.CallOpts{Context: ctx})
		if err != nil {
			return err
		}
		o.Say("  the network's ceiling now stands at %s. Every naira of it above the fund is trust the",
			ops.Money(ceiling))
		o.Say("  operator was given because it proved it had paid people — and it is now free to hold")
		o.Say("  that much of somebody's money at once.")
	}

	// ─── Act 3 ────────────────────────────────────────────────────────────────────────────────────
	if todo(3) {
		act(3, "The claim the creator herself refuses")
		o.Say("  The operator says it paid her. She says it did not, from her own key, and the operator")
		o.Say("  cannot produce the one thing that would settle it. No adjudicator is asked to decide who")
		o.Say("  is telling the truth: the claim dies of an unanswered question, the debts come back at")
		o.Say("  the age they always had, and the lying carries a fee.\n")

		lie, err := s.take("gra-leather", "harbour-satchel", "one size")
		if err != nil {
			return err
		}
		sold(lie)
		if err := o.SellCash(ctx, lie); err != nil {
			return err
		}
		falseClaim, err := claimTheSale(ctx, o, lie)
		if err != nil {
			return err
		}

		// From HER key. A challenge is a creditor saying she was not paid, and it means nothing at all
		// said by anybody else — least of all by the party she is accusing.
		creatorOf, err := creatorOfClaim(ctx, o, falseClaim)
		if err != nil {
			return err
		}
		key, ok := o.CreatorKeys[creatorOf]
		if !ok {
			return fmt.Errorf("no key for creator #%d, who must challenge claim #%d herself", creatorOf, falseClaim)
		}
		if err := o.ChallengeFrom(ctx, falseClaim, key); err != nil {
			return err
		}

		refusal, err := o.RespondExpectingRefusal(ctx, falseClaim, []byte("a receipt for a payment that was never made"))
		if err != nil {
			return err
		}
		o.Say("  the operator tried to answer and was refused: %s", refusal)

		if err := waitFor(ctx, o, o.ResponseDeadline, falseClaim, "the response window"); err != nil {
			return err
		}
		if err := o.VoidChallenged(ctx, falseClaim); err != nil {
			return err
		}
	}

	// ─── Act 4 ────────────────────────────────────────────────────────────────────────────────────
	if todo(4) {
		act(4, "The claim nobody challenged, and nobody covered")
		o.Say("  Nothing here required a victim to be awake. She was not watching, did not challenge, and")
		o.Say("  the claim settled on her silence — provisionally. Then the coverage window closed with no")
		o.Say("  evidence behind it and it died anyway. Silence buys the operator one window and never a")
		o.Say("  verdict.\n")

		asleep, err := s.take("ikoyi-ceramics", "lagoon-bowl", "large")
		if err != nil {
			return err
		}
		sold(asleep)
		if err := o.SellCash(ctx, asleep); err != nil {
			return err
		}
		sleepingClaim, err := claimTheSale(ctx, o, asleep)
		if err != nil {
			return err
		}
		if err := waitFor(ctx, o, o.ChallengeDeadline, sleepingClaim, "the challenge window"); err != nil {
			return err
		}
		if err := o.SettleClaim(ctx, sleepingClaim); err != nil {
			return err
		}
		if err := waitFor(ctx, o, o.CoverageDeadline, sleepingClaim, "the coverage window"); err != nil {
			return err
		}
		if err := o.TouchClaim(ctx, sleepingClaim); err != nil {
			return err
		}
	}

	// ─── Act 5 ────────────────────────────────────────────────────────────────────────────────────
	if todo(5) {
		act(5, "A deposit taken against stock that is not there")
		o.Say("  Every listed item is buyable by anyone at any moment — including the one that quietly")
		o.Say("  went home in somebody's bag. The operator takes the money and owes a hand-over it cannot")
		o.Say("  make; the refund that promise is worth is minted as an ordinary debt, on the ordinary")
		o.Say("  clock, covered by the ordinary machinery. There is no separate refund path to get wrong.\n")

		var err error
		offBooks, err = s.take("ikoyi-ceramics", "morning-cup", "one size")
		if err != nil {
			return err
		}
		sold(offBooks)
		refundDebt, err = o.CommitOption(ctx, offBooks)
		if err != nil {
			return err
		}
	}

	// ─── Act 6 ────────────────────────────────────────────────────────────────────────────────────
	if todo(6) {
		act(6, "The sales nobody ever accounts for")
		o.Say("  No claim, no challenge, no evidence, no lie — the operator simply sells and says nothing.")
		o.Say("  This is the ordinary case and the thesis of the whole design: the debts age on a clock")
		o.Say("  the operator does not hold, and at the end of it a stranger can finish the story.\n")

		o.Say("  It sells until it cannot. Not until this scenario decides it has sold enough — until the")
		o.Say("  contract refuses, which is the only limit on how much of other people's money an operator")
		o.Say("  can be holding at once, and the only one that does not depend on anybody noticing.\n")

		var firstRefusal string
		for _, pick := range []struct{ line, product, variant string }{
			{"wuse-tailors", "agbada-light", "L"},
			{"wuse-tailors", "agbada-light", "XL"},
			{"wuse-tailors", "wrapper-set", "one size"},
			{"ikoyi-ceramics", "table-set", "one size"},
			{"ikoyi-ceramics", "ash-vase", "one size"},
			{"adire-works", "dye-panel", "one size"},
			{"adire-works", "indigo-wrapper", "one size"},
			{"harmattan-house", "night-wind", "100 ml"},
			{"harmattan-house", "cold-morning", "100 ml"},
			{"gra-leather", "harbour-satchel", "one size"},
			{"wuse-tailors", "market-shirt", "L"},
			{"ikoyi-ceramics", "lagoon-bowl", "large"},
			{"adire-works", "resist-scarf", "one size"},
			{"harmattan-house", "dust-amber", "50 ml"},
			{"gra-leather", "belt-plain", "M"},
			{"wuse-tailors", "day-cap", "one size"},
		} {
			// A product this run has already sold out of is skipped, not fatal. The list is what the
			// operator would reach for, in order; running out of one is an ordinary fact about a small
			// shop and not a failure of the scenario.
			item, err := s.take(pick.line, pick.product, pick.variant)
			if err != nil {
				continue
			}
			fits, room, exposure, err := roomFor(ctx, o, item)
			if err != nil {
				return err
			}
			if !fits {
				// Refused, and then the operator reaches for something cheaper — which is what an
				// operator would actually do. Stopping at the first refusal would leave room unused and
				// quietly understate how much of other people's money the ceiling really permits.
				sold(item)
				o.Say("  too big: %s into the operator's hands, and %s of room.",
					ops.Money(exposure), ops.Money(room))
				refusal, err := o.SellCashExpectingRefusal(ctx, item)
				if err != nil {
					return err
				}
				o.Say("  refused: %s", refusal)
				if firstRefusal == "" {
					firstRefusal = refusal
				}
				continue
			}
			sold(item)
			if err := o.SellCash(ctx, item); err != nil {
				return err
			}
		}
		if firstRefusal == "" {
			o.Say("\n  the shelf ran out before the ceiling did — every cash sale offered was permitted.")
		}
	}

	// ─── Acts 7 and 8, if the fund is allowed to be spent ─────────────────────────────────────────
	//
	// Everything above leaves the chain recoverable: debts are aging, the fund is whole, and an
	// operator that simply pays what it owes ends square. Everything below is the part that cannot be
	// walked back — the pool empties, the write-downs land, and growth stays frozen until somebody
	// repays. On a chain whose figures are printed in a document, that is a decision, not a default.
	var uncollected uint64
	if defaults {
		var err error
		if uncollected, err = collectTheDebts(ctx, o, s, offBooks, refundDebt, act, sold); err != nil {
			return err
		}
	} else {
		o.Say("\n━━━ Stopping before the defaults\n")
		o.Say("  The debts from Acts 3, 4, 5 and 6 are aging on the chain's own clock and nothing here")
		o.Say("  will finish them. That is not a gap in the demonstration — it is the state a real shop")
		o.Say("  is in on any ordinary afternoon: money owed, clocks running, and the outcome not yet")
		o.Say("  decided. Anyone may finish it later by sending one transaction per debt, and the fund")
		o.Say("  is untouched and able to pay when they do.")
	}

	// ─── The write-off ────────────────────────────────────────────────────────────────────────────
	act(9, "Shrinkage, written down where everyone can see it")
	o.Say("  A shop loses things. The protocol's answer is not to prevent it — it cannot — but to make")
	o.Say("  the loss a public number the operator's own capacity pays for. This one draws nothing from")
	o.Say("  the fund; it owes the fund a fee, which is the opposite direction.\n")

	burned, err := s.take("adire-works", "stitch-bag", "one size")
	if err != nil {
		return err
	}
	sold(burned)
	if err := o.Burn(ctx, burned, "water damage in the Ikoyi store room"); err != nil {
		return err
	}

	// ─── The state it leaves behind ───────────────────────────────────────────────────────────────
	o.Say("\n━━━ What is left standing\n")
	if defaults {
		o.Say("  debt #%d is past its deadline, uncovered, and collectable by anyone — including anyone", uncollected)
		o.Say("  watching this run. Nothing about that is a demonstration mode; it is simply true until")
		o.Say("  somebody sends the transaction.")
	} else {
		aging, err := agedDebts(ctx, o)
		if err != nil {
			return err
		}
		o.Say("  %d debts are aging and the fund still holds every naira it started with. The acts that", len(aging))
		o.Say("  spend it — the default, the shortfall, the shut till — were deliberately not run here.")
	}
	o.Say("")
	return o.PrintStatus(ctx)
}

// collectTheDebts is the back half: the clocks run out, the fund pays, and the till shuts.
//
// Split out so that skipping it is one branch rather than a scattering of conditionals through the
// narration — and so that what is being skipped is nameable.
func collectTheDebts(
	ctx context.Context,
	o *ops.Ops,
	s *shelf,
	offBooks, refundDebt uint64,
	act func(int, string),
	sold func(uint64),
) (uncollected uint64, err error) {
	act(7, "The clock runs out, and a stranger collects for people who never asked")
	o.Say("  Nobody involved sends these transactions. A key with no position in any of it does, and")
	o.Say("  the fund pays the people the operator did not — until it cannot.\n")

	// The buyer's hand-over deadline first. The operator had until this moment to produce an item it
	// does not have; passing it is what turns the deposit into a refund somebody is owed.
	if err := waitFor(ctx, o, o.FulfilmentDeadline, offBooks, "the hand-over deadline"); err != nil {
		return 0, err
	}
	if err := o.ExpireCommitment(ctx, offBooks); err != nil {
		return 0, err
	}

	overdue, err := agedDebts(ctx, o)
	if err != nil {
		return 0, err
	}
	if len(overdue) == 0 {
		return 0, fmt.Errorf("no debt is collectable — the scenario proved nothing it set out to")
	}
	if err := waitFor(ctx, o, o.DebtDeadline, overdue[0], "the last debt's clock"); err != nil {
		return 0, err
	}
	// Re-read: the wait moved the chain's clock, so debts that were not yet collectable now are.
	if overdue, err = agedDebts(ctx, o); err != nil {
		return 0, err
	}

	// One debt is deliberately left standing. It is past its deadline, it is owed to a real person,
	// and anyone on earth can collect it — which is a far better thing to be able to show a room than
	// to describe.
	//
	// The *smallest* one, and that is not arbitrary. What is about to be demonstrated is a fund that
	// cannot cover what it is asked for, and the margin by which it falls short is thin. Holding back
	// a large debt would take more out of the demand than the fund is short by, and the shortfall
	// would silently not happen — the run would still pass, and would prove less than it claimed.
	if len(overdue) < 2 {
		return 0, fmt.Errorf("only %d debt is collectable; the run needs one to cover and one to leave", len(overdue))
	}
	uncollected, err = smallest(ctx, o, overdue)
	if err != nil {
		return 0, err
	}
	var toCover []uint64
	for _, id := range overdue {
		if id != uncollected {
			toCover = append(toCover, id)
		}
	}

	if err := drain(ctx, o, toCover, refundDebt); err != nil {
		return 0, err
	}

	// ─── Act 8 ────────────────────────────────────────────────────────────────────────────────────
	act(8, "The till shuts on somebody who did nothing wrong")
	o.Say("  The operator owes the fund, and until it pays that back the debt is charged into every")
	o.Say("  relationship it has — not only the ones it failed. So this creator, who has not been")
	o.Say("  wronged and has not wronged anyone, cannot sell for cash. The protocol does not know who")
	o.Say("  deserves what. It knows what is owed, and it refuses in public, by name.\n")

	innocent, err := s.take("harmattan-house", "cold-morning", "50 ml")
	if err != nil {
		return 0, err
	}
	sold(innocent)
	refusal, err := o.SellCashExpectingRefusal(ctx, innocent)
	if err != nil {
		return 0, err
	}
	o.Say("  refused: %s", refusal)

	o.Say("")
	o.Say("  The same item, on the instant rail, sells — because that rail puts none of her money in")
	o.Say("  the operator's hands, so there is nothing for the ceiling to be protecting.")
	if err := o.SellInstant(ctx, innocent, payment(innocent)); err != nil {
		return 0, err
	}

	return uncollected, nil
}

// honestCycle is one sale done properly, all the way through to the capacity it earns.
//
// Sell for cash, claim it, let the challenge window close with nobody objecting, settle on that
// silence — and then, separately, *prove* it. The last two are not the same act and the ceiling does
// not treat them as one: silence buys the operator a settled claim, and only the verifier's verdict
// and the sweep's attestation buy it room to hold more of somebody's money next time.
func honestCycle(ctx context.Context, o *ops.Ops, itemID uint64) error {
	if err := o.SellCash(ctx, itemID); err != nil {
		return err
	}
	claim, err := claimTheSale(ctx, o, itemID)
	if err != nil {
		return err
	}
	if err := waitFor(ctx, o, o.ChallengeDeadline, claim, "the challenge window"); err != nil {
		return err
	}
	if err := o.SettleClaim(ctx, claim); err != nil {
		return err
	}
	if err := o.InjectVerdict(ctx, claim, true); err != nil {
		return err
	}
	if err := o.Sweep(ctx, []uint64{claim}); err != nil {
		return err
	}
	return o.CreditSettlement(ctx, claim)
}

/* ---- The fund, spent down to nothing ---------------------------------------------------------------- */

// drain covers defaults one at a time, largest first, and says what the fund could and could not do.
//
// Largest first is not cosmetic. It is the order that makes the fund's limit visible while there is
// still something left to see: paid in full, paid in full, paid in part — *short* — and then a run of
// people the fund has nothing left for at all. Smallest-first would spend the same money and show a
// cliff at the end that looked like an error.
func drain(ctx context.Context, o *ops.Ops, debtIDs []uint64, refundDebt uint64) error {
	type owed struct {
		id     uint64
		amount *big.Int
	}

	var queue []owed
	for _, id := range debtIDs {
		debt, err := o.C.Debts.Debt(&bind.CallOpts{Context: ctx}, new(big.Int).SetUint64(id))
		if err != nil {
			return err
		}
		queue = append(queue, owed{id: id, amount: debt.Amount})
	}
	for i := range queue {
		for j := i + 1; j < len(queue); j++ {
			if queue[j].amount.Cmp(queue[i].amount) > 0 {
				queue[i], queue[j] = queue[j], queue[i]
			}
		}
	}

	before, err := o.C.Pool.Balance(&bind.CallOpts{Context: ctx})
	if err != nil {
		return err
	}
	total := new(big.Int)
	for _, d := range queue {
		total.Add(total, d.amount)
	}
	o.Say("  the fund holds %s. What is about to be asked of it: %s, across %d debts.",
		ops.Money(before), ops.Money(total), len(queue))
	if total.Cmp(before) > 0 {
		o.Say("  It is %s short before the first transaction is sent — not a bug being demonstrated, but",
			ops.Money(new(big.Int).Sub(total, before)))
		o.Say("  the honest size of a fund measured against the damage one operator can do in an afternoon.")
	}
	o.Say("")

	for _, d := range queue {
		if err := o.TouchDebt(ctx, d.id); err != nil {
			return err
		}
		if d.id == refundDebt {
			o.Say("  → that one was the buyer's refund. The deposit came back from the same fund, by the")
			o.Say("    same machinery, with no separate path and no special case.")
		}
		o.Say("")
	}
	return nil
}

/* ---- Small helpers ---------------------------------------------------------------------------------- */

// roomFor answers whether a cash sale of this item would fit under the ceiling, and by how much it
// would miss.
//
// Asked before the transaction rather than discovered by sending one, so the scenario can narrate the
// last sale that fits and the first that does not. The arithmetic is the contract's own: what a cash
// sale puts in the operator's hands is every share of the price that is somebody else's — its own
// commission is retained at mint and was never anyone's money to hold.
//
// Both gates, because a sale needs both. The bilateral one asks what this creator is exposed to; the
// network one stops a single pool from being pledged to every relationship at once, and it is very
// often the one that bites first.
func roomFor(ctx context.Context, o *ops.Ops, itemID uint64) (fits bool, room, exposure *big.Int, err error) {
	call := &bind.CallOpts{Context: ctx}

	price, err := o.C.Prices.EffectivePrice(call, new(big.Int).SetUint64(itemID))
	if err != nil {
		return false, nil, nil, err
	}
	creator, _, err := creatorOfItem(ctx, o, itemID)
	if err != nil {
		return false, nil, nil, err
	}

	var others int64
	for _, bpsOf := range []func(*bind.CallOpts) (uint16, error){
		o.C.Gateway.CreatorBps, o.C.Gateway.LandlordBps, o.C.Gateway.CommunityBps,
	} {
		share, err := bpsOf(call)
		if err != nil {
			return false, nil, nil, err
		}
		others += int64(share)
	}
	exposure = new(big.Int).Div(new(big.Int).Mul(price, big.NewInt(others)), big.NewInt(10_000))

	bilateral, err := o.C.Ceiling.HeadroomOf(call, new(big.Int).SetUint64(creator))
	if err != nil {
		return false, nil, nil, err
	}
	network, err := o.C.Ceiling.Headroom(call)
	if err != nil {
		return false, nil, nil, err
	}
	room = bilateral
	if network.Cmp(room) < 0 {
		room = network
	}

	return exposure.Cmp(room) <= 0, room, exposure, nil
}

// creatorOfItem answers whose consignment an item sits in, from the published paperwork.
func creatorOfItem(ctx context.Context, o *ops.Ops, itemID uint64) (creator, tranche uint64, err error) {
	item, err := o.C.Items.ItemOf(&bind.CallOpts{Context: ctx}, new(big.Int).SetUint64(itemID))
	if err != nil {
		return 0, 0, err
	}
	// The chain's slot is lazy: it names the tranche only once something has touched the item, and
	// nothing has touched an item that is still for sale. So the record is read from the consignment
	// the tranche was posted under.
	if item.TrancheId.Sign() != 0 {
		record, err := o.C.Items.Tranche(&bind.CallOpts{Context: ctx}, item.TrancheId)
		if err != nil {
			return 0, 0, err
		}
		return record.CreatorId.Uint64(), item.TrancheId.Uint64(), nil
	}
	return o.CreatorOfConsigned(itemID)
}

// smallest picks the least valuable of a set of debts.
func smallest(ctx context.Context, o *ops.Ops, debtIDs []uint64) (uint64, error) {
	var pick uint64
	var least *big.Int
	for _, id := range debtIDs {
		debt, err := o.C.Debts.Debt(&bind.CallOpts{Context: ctx}, new(big.Int).SetUint64(id))
		if err != nil {
			return 0, err
		}
		if least == nil || debt.Amount.Cmp(least) < 0 {
			least, pick = debt.Amount, id
		}
	}
	return pick, nil
}

// agedDebts is every debt still aging, oldest first — the ones a clock can finish.
func agedDebts(ctx context.Context, o *ops.Ops) ([]uint64, error) {
	count, err := o.C.Debts.DebtCount(&bind.CallOpts{Context: ctx})
	if err != nil {
		return nil, err
	}
	var out []uint64
	for id := uint64(1); id <= count.Uint64(); id++ {
		debt, err := o.C.Debts.Debt(&bind.CallOpts{Context: ctx}, new(big.Int).SetUint64(id))
		if err != nil {
			return nil, err
		}
		// DebtState.AGING, and only debts this scenario's catalog creators are owed: the demo's own
		// unfinished business is on the same chain and is not this run's to collect.
		if debt.State == 1 && debt.CreatorId.Uint64() >= 3 {
			out = append(out, id)
		}
	}
	return out, nil
}

// creatorOfClaim answers whose money a claim is about, so the challenge comes from the right key.
//
// Read off the chain rather than remembered from the sale. The creator was fixed on every debt at
// mint, out of a tranche her own key signed, so the ledger is the authority on it — and a scenario
// that challenged from the key it *expected* to be right would pass silently on the day it was not.
func creatorOfClaim(ctx context.Context, o *ops.Ops, claimID uint64) (uint64, error) {
	ids, err := o.C.Debts.ClaimDebts(&bind.CallOpts{Context: ctx}, new(big.Int).SetUint64(claimID))
	if err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, fmt.Errorf("claim #%d names no debts", claimID)
	}
	creator, err := o.C.Debts.CreatorOf(&bind.CallOpts{Context: ctx}, ids[0])
	if err != nil {
		return 0, err
	}
	return creator.Uint64(), nil
}

// waitFor pushes past a deadline the contracts set, whatever it happens to be.
func waitFor(
	ctx context.Context,
	o *ops.Ops,
	deadlineOf func(context.Context, uint64) (uint64, error),
	id uint64,
	what string,
) error {
	deadline, err := deadlineOf(ctx, id)
	if err != nil {
		return err
	}
	return o.Wait(ctx, deadline, what)
}

// claimTheSale posts the operator's assertion that it paid a sale's recipients.
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

// payment is the processor's notification: a doorbell, never evidence.
func payment(itemID uint64) feeds.ProcessorPayload {
	return feeds.ProcessorPayload{Reference: fmt.Sprintf("catalog-sale-%d", itemID)}
}
