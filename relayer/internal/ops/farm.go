package ops

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"

	"goodhouse/relayer/internal/chain"
	"goodhouse/relayer/internal/merkle"
)

// The creator the operator invented, and the imaginary dresses it consigned for her.
//
// Priced high, because the farm's whole purpose is volume: capacity grows at 1% of proven payout value,
// so conjuring a meaningful allowance means moving a meaningful amount of money — through accounts the
// operator owns, in a loop that ends where it started.
//
// The last one is held back. It is what the operator reaches for after it has defaulted on somebody and
// wants to trade its way out, and it is the item that gets refused.
var (
	farmItemIDs = []uint64{2001, 2002, 2003}
	farmPrices  = []int64{25_000_000, 25_000_000, 25_000_000}
)

// farmable is the shelf the farm actually sells: everything but the one held back for the refusal.
func farmable(t Tranche) []Item {
	if len(t.Items) < 2 {
		return t.Items
	}
	return t.Items[:len(t.Items)-1]
}

// seedFarm registers the creator the operator made up, and consigns her goods.
//
// Nothing here is hidden and nothing here is a trick. The registration is a public transaction. The
// tranche is a public root. The vouchers are published to the same store as everybody else's and verify
// against the same registry. Anyone watching the chain can see, in real time, that Good has just
// consigned twenty-five-million-naira dresses from a creator who appeared out of nowhere.
//
// And it does not matter, which is the entire point. The protocol never asks whether she is real,
// because it has no way to find out and neither does anybody else — telling a manufactured counterparty
// from a genuine one is a problem nobody has solved and this protocol does not pretend to. What it does
// instead is make the answer worthless: capacity is bilateral, so whatever Good earns with her, it can
// spend only on her, and she has nothing to sell.
func (o *Ops) seedFarm(ctx context.Context, policy [32]byte, domain common.Hash) (*Tranche, error) {
	operator := chain.Address(o.Keys.Operator)

	// Her signing key is the operator's own. Of course it is: there is nobody else to hold it.
	if _, err := o.Client.Send(ctx, o.Keys.Operator, "register creator (the invented one)", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Registry.Register(auth, operator)
	}); err != nil {
		return nil, err
	}
	creatorID, err := o.C.Registry.CreatorCount(callOpts(ctx))
	if err != nil {
		return nil, err
	}
	o.Say("  creator %s registered as #%s — and she is the operator, signing with the operator's own key",
		short(operator), creatorID)

	items := make([]Item, len(farmItemIDs))
	leaves := make([]merkle.Hash, len(farmItemIDs))
	ids := make([]*big.Int, len(farmItemIDs))
	prices := make([]*big.Int, len(farmItemIDs))

	for i, id := range farmItemIDs {
		ids[i] = new(big.Int).SetUint64(id)
		prices[i] = naira(farmPrices[i])

		digest, _, err := o.voucherBlob(o.Keys.Operator, creatorID, ids[i], policy, domain)
		if err != nil {
			return nil, err
		}
		leaves[i] = digest

		items[i] = Item{ID: id, Price: prices[i].String(), Digest: digest.Hex()}
	}

	tree, err := merkle.New(leaves)
	if err != nil {
		return nil, err
	}
	root := tree.Root()

	// The landlord is the operator too. Every leg of every sale from this shelf lands back in the
	// pocket it left, which is what makes the loop free.
	if _, err := o.Client.Send(ctx, o.Keys.Operator, "post tranche (the invented one)", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Items.PostTranche(
			auth, creatorID, operator, root,
			uint32(len(items)), o.Config.Currency, o.Config.Location,
		)
	}); err != nil {
		return nil, err
	}
	trancheID, err := o.C.Items.TrancheCount(callOpts(ctx))
	if err != nil {
		return nil, err
	}

	// Priced by "her" key, which the price book insists on — and which the operator holds.
	if _, err := o.Client.Send(ctx, o.Keys.Operator, "seed prices (the invented one)", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Prices.Seed(auth, trancheID, ids, prices)
	}); err != nil {
		return nil, err
	}

	// And an account for the money to be paid into. Hers, which is to say the operator's.
	account := crypto.Keccak256Hash([]byte("bank-account/" + operator.Hex()))
	if _, err := o.Client.Send(ctx, o.Keys.Operator, "account: the invented creator", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Debts.SetAccountHash(auth, o.Config.Currency, account)
	}); err != nil {
		return nil, err
	}

	o.Say("  tranche #%s posted for her: %d items at %s each, and the operator is her landlord too",
		trancheID, len(items), money(prices[0]))

	return &Tranche{
		CreatorID: creatorID.Uint64(),
		TrancheID: trancheID.Uint64(),
		Root:      common.Hash(root).Hex(),
		Items:     items,
	}, nil
}

// Farm runs the attack — in the open, on a public chain, with every step succeeding.
//
// The operator sells the invented creator's imaginary dresses to itself on the instant rail. The rail
// posts the claim in the same transaction, as it does for every instant sale. The operator then attests
// to those payments with a proof that is **valid**, because the payments are real: money genuinely moved
// from one of its accounts to another. The protocol is not deceived at any point. It is told the truth
// throughout, and the truth is that Good paid Good.
//
// Two things are worth watching while it runs.
//
// The capacity really is conjured. Fifty million naira of self-dealt volume, ₦42.5m of it payable to
// somebody other than the operator, earns the 1% the rules promise: **₦425,000 of new allowance, out of
// thin air.** The protocol credits it, and it is right to.
//
// And it buys nothing. Not one kobo of it is spendable on the real creator's dresses, because it was
// never earned with her. Her ceiling does not move. Her till stays exactly as shut as it was.
//
// It does not even cost the 57 kobo per naira the analysis assumed, because a farmer has no reason to
// pay the skim: the deposit is voluntary in this build — the contract cannot see a payment it never
// receives — and money in the pool only ever pays the operator's own victims. So the cheapest version of
// this attack costs gas and nothing else. It still buys an empty room.
func (o *Ops) Farm(ctx context.Context) (*big.Int, error) {
	consignment, err := o.Consignment()
	if err != nil {
		return nil, err
	}
	if consignment.Farm == nil {
		return nil, fmt.Errorf("this consignment has no invented creator on it — re-seed to demonstrate the farm")
	}

	real := new(big.Int).SetUint64(consignment.CreatorID)
	fake := new(big.Int).SetUint64(consignment.Farm.CreatorID)

	before, err := o.capacity(ctx, real)
	if err != nil {
		return nil, err
	}
	farmBefore, err := o.C.Ceiling.AllowanceOf(callOpts(ctx), fake)
	if err != nil {
		return nil, err
	}

	for _, item := range farmable(*consignment.Farm) {
		if err := o.farmOnce(ctx, *consignment.Farm, item.ID); err != nil {
			return nil, err
		}
	}

	farmAfter, err := o.C.Ceiling.AllowanceOf(callOpts(ctx), fake)
	if err != nil {
		return nil, err
	}
	after, err := o.capacity(ctx, real)
	if err != nil {
		return nil, err
	}

	conjured := new(big.Int).Sub(farmAfter, farmBefore)

	o.Say("")
	o.Say("  creator #%s (invented): allowance %s → %s — the operator conjured %s of capacity out of a "+
		"counterparty it made up, and the protocol was right to credit it",
		fake, money(farmBefore), money(farmAfter), money(conjured))
	o.Say("  creator #%s (real):     allowance %s → %s. Not one kobo. She was not part of this.",
		real, money(before.Allowance), money(after.Allowance))

	return conjured, nil
}

// FarmExpectingRefusal tries to farm when the operator's own books are not square, and reports the rule
// that stops it.
//
// This is the second lock, and it was found by walking into it. Growth is frozen while the operator owes
// the pool — every relationship at once, the invented one included — so an operator that has already
// defaulted on somebody cannot trade with itself to earn its way back out. **It cannot farm its way out
// of a hole it is standing in.** The only route back is the one the protocol has always insisted on:
// pay the pool what it covered on your behalf.
//
// Which means a farmer has to do this *before* it goes wrong. That is why the demo farms in Act 4, while
// the books are still clean — it is not a convenience of the script, it is the only order in which the
// attack can be run at all.
func (o *Ops) FarmExpectingRefusal(ctx context.Context) (string, error) {
	consignment, err := o.Consignment()
	if err != nil {
		return "", err
	}
	if consignment.Farm == nil || len(consignment.Farm.Items) < 2 {
		return "", fmt.Errorf("this consignment has no invented creator on it — re-seed to demonstrate the farm")
	}

	// The one dress held back for exactly this. Everything up to the collection works perfectly: the
	// sale goes through, the claim posts, the sweep proves it. The money moved, and the chain says so.
	held := consignment.Farm.Items[len(consignment.Farm.Items)-1]

	input, err := o.saleInputFrom(ctx, *consignment.Farm, o.Keys.Operator, held.ID, false)
	if err != nil {
		return "", err
	}
	if _, err := o.Client.Send(ctx, o.Keys.Operator, "sell (instant, to itself)", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Gateway.SellInstant(auth, input, payFor(held.ID))
	}); err != nil {
		return "", err
	}

	claimID, err := o.C.Debts.ClaimCount(callOpts(ctx))
	if err != nil {
		return "", err
	}
	if err := o.InjectVerdict(ctx, claimID.Uint64(), true); err != nil {
		return "", err
	}
	if err := o.Sweep(ctx, []uint64{claimID.Uint64()}); err != nil {
		return "", err
	}

	// And then the collection, which is the only step that fails.
	return o.CreditSettlementExpectingRefusal(ctx, claimID.Uint64())
}

// farmOnce is one turn of the loop: sell to yourself, attest to the payment you really made, collect.
func (o *Ops) farmOnce(ctx context.Context, farm Tranche, itemID uint64) error {
	// No community voucher: there was no referral, because there was no buyer.
	input, err := o.saleInputFrom(ctx, farm, o.Keys.Operator, itemID, false)
	if err != nil {
		return err
	}

	if _, err := o.Client.Send(ctx, o.Keys.Operator, "sell (instant, to itself)", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Gateway.SellInstant(auth, input, payFor(itemID))
	}); err != nil {
		return err
	}

	claimID, err := o.C.Debts.ClaimCount(callOpts(ctx))
	if err != nil {
		return err
	}

	// The verdict a real zkTLS verifier would reach. It is **true**, and that is not a cheat: the
	// operator did pay those accounts, and a prover looking at the bank's records would say so.
	if err := o.InjectVerdict(ctx, claimID.Uint64(), true); err != nil {
		return err
	}
	if err := o.Sweep(ctx, []uint64{claimID.Uint64()}); err != nil {
		return err
	}
	if err := o.CreditSettlement(ctx, claimID.Uint64()); err != nil {
		return err
	}

	price, err := o.C.Prices.EffectivePrice(callOpts(ctx), new(big.Int).SetUint64(itemID))
	if err != nil {
		return err
	}
	o.Say("    item %d sold to the operator for %s, paid to the operator, and proven by the operator",
		itemID, money(price))

	return nil
}

// capacity is what the ceiling says about one relationship, right now.
type capacityOf struct {
	Allowance *big.Int
	Headroom  *big.Int
}

func (o *Ops) capacity(ctx context.Context, creatorID *big.Int) (capacityOf, error) {
	var c capacityOf
	var err error

	if c.Allowance, err = o.C.Ceiling.AllowanceOf(callOpts(ctx), creatorID); err != nil {
		return c, err
	}
	if c.Headroom, err = o.C.Ceiling.HeadroomOf(callOpts(ctx), creatorID); err != nil {
		return c, err
	}

	return c, nil
}
