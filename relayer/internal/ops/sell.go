package ops

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"

	"goodhouse/relayer/internal/feeds"
)

// SellInstant rings up a sale on a rail that split the payment as it happened.
//
// The processor's notification is what *triggers* this transaction, and it is never what proves it.
// The payload is HMAC-signed with a secret the operator itself holds, so it could be manufactured by
// the operator at will — which is precisely why the protocol treats it as a doorbell and not as
// evidence. What goes on-chain is a *claim*: the operator's assertion that this payment reference paid
// these parties, posted in the same transaction that owes them the money, and testable by every one of
// them from that second onward.
func (o *Ops) SellInstant(ctx context.Context, itemID uint64, payment feeds.ProcessorPayload) error {
	input, err := o.saleInput(ctx, itemID, true)
	if err != nil {
		return err
	}

	if _, err := o.Client.Send(ctx, o.Keys.Operator, "sell (instant)", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Gateway.SellInstant(auth, input, payment.RefHash())
	}); err != nil {
		return err
	}

	price, err := o.C.Prices.EffectivePrice(callOpts(ctx), new(big.Int).SetUint64(itemID))
	if err != nil {
		return err
	}
	minted, err := o.DebtsOfSale(ctx, itemID)
	if err != nil {
		return err
	}
	o.Say("  item %d sold on the instant rail for %s — %d debts minted, and the claim asserting the "+
		"rail already paid them posted in the same transaction",
		itemID, money(price), len(minted))

	return o.depositSkim(ctx, itemID, price)
}

// SellCash rings up a sale for money the operator takes into its own hands.
//
// No claim is attached, because none exists: nobody has been paid. The debts age from this second, and
// the ceiling was consulted before the item left the shelf — which is the only moment at which anyone
// can ask whether the operator should be allowed to hold this much of other people's money.
func (o *Ops) SellCash(ctx context.Context, itemID uint64) error {
	input, err := o.saleInput(ctx, itemID, true)
	if err != nil {
		return err
	}

	if _, err := o.Client.Send(ctx, o.Keys.Operator, "sell (cash)", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Gateway.SellCash(auth, input)
	}); err != nil {
		return err
	}

	price, err := o.C.Prices.EffectivePrice(callOpts(ctx), new(big.Int).SetUint64(itemID))
	if err != nil {
		return err
	}
	outstanding, err := o.C.Debts.Outstanding(callOpts(ctx))
	if err != nil {
		return err
	}
	o.Say("  item %d sold for cash at %s — the operator now holds %s of other people's money",
		itemID, money(price), money(outstanding))

	return o.depositSkim(ctx, itemID, price)
}

// SellCashExpectingRefusal rings up a sale the ceiling is expected to refuse, and reports the rule
// that refused it. This is the beat the whole protocol exists for: the till says no, in public, with
// a reason a person can read.
func (o *Ops) SellCashExpectingRefusal(ctx context.Context, itemID uint64) (string, error) {
	input, err := o.saleInput(ctx, itemID, true)
	if err != nil {
		return "", err
	}

	return o.Client.MustRevert(ctx, o.Keys.Operator, "sell (cash)", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Gateway.SellCash(auth, input)
	})
}

// SellInstantExpectingRefusal is the checkout defending itself: a tag that has already been consumed,
// presented a second time.
//
// The state machine *is* the nullifier. There is no separate spent-set to keep in step with anything:
// a sold item is sold, and a clone of its tag is a tag for an item that is sold. The clone cannot be
// rung up at all — which is what makes a forgery radioactive rather than merely risky, because the one
// place it must work is the one place it certainly will not.
func (o *Ops) SellInstantExpectingRefusal(ctx context.Context, itemID uint64) (string, error) {
	input, err := o.saleInput(ctx, itemID, true)
	if err != nil {
		return "", err
	}

	return o.Client.MustRevert(ctx, o.Keys.Operator, "sell (instant)", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Gateway.SellInstant(auth, input, payFor(itemID))
	})
}

// SellForgedExpectingRefusal presents a tag nobody's creator ever signed.
//
// The signature is made with a key the registry has never heard of. Every downstream check — the
// tranche, the split policy, the price — is beside the point, because the first question the gateway
// asks is whose name is on this, and the answer is nobody's. A forged tag cannot be sold through the
// system at all; it can only be sold *outside* it, where the buyer gets no certificate, no claim code
// and no recourse, and where a scan of the tag exposes it in a second.
func (o *Ops) SellForgedExpectingRefusal(ctx context.Context, itemID uint64) (string, error) {
	input, err := o.saleInput(ctx, itemID, true)
	if err != nil {
		return "", err
	}

	// Signed by a forger: someone who has the item, the tag, and no right to either.
	consignment, err := o.Consignment()
	if err != nil {
		return "", err
	}
	forged, err := o.forgedSignature(ctx, consignment.CreatorID, itemID)
	if err != nil {
		return "", err
	}
	input.Signature = forged

	return o.Client.MustRevert(ctx, o.Keys.Operator, "sell (forged tag)", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Gateway.SellCash(auth, input)
	})
}

func payFor(itemID uint64) [32]byte {
	return crypto.Keccak256Hash([]byte(fmt.Sprintf("processor-ref/%d", itemID)))
}

// depositSkim pays the fifth leg into the pool.
//
// Production note: the rail routes this at source, exactly like the other four legs, and it is carved
// out of the operator's own commission — Good funds the fund that insures Good's failures, and the
// creator's, landlord's and community's shares are untouched. Here the operator deposits it after the
// sale, because in this build the buyer's money is fiat and never touches the chain.
func (o *Ops) depositSkim(ctx context.Context, itemID uint64, price *big.Int) error {
	skim := bps(price, o.Config.SkimBps)
	if skim.Sign() == 0 {
		return nil
	}

	if _, err := o.Client.Send(ctx, o.Keys.Operator, "deposit skim", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Pool.DepositSkim(auth, new(big.Int).SetUint64(itemID), skim)
	}); err != nil {
		return err
	}

	o.Say("  skim of %s into the pool (0.%d%% of the sale, out of the operator's own share)",
		money(skim), o.Config.SkimBps/10)
	return nil
}
