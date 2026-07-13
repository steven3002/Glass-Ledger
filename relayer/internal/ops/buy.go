package ops

import (
	"context"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"

	"goodhouse/relayer/internal/chain"
	"goodhouse/relayer/internal/feeds"
)

// Buy is an ordinary customer buying an ordinary dress.
//
// She has no wallet, no gas and no interest in any of this. The operator sponsors the transaction, the
// rail splits the payment at source, and she walks out with a receipt carrying a claim code. Then the
// certificate is redeemed to her address — also sponsored, because needing the operator's cooperation
// to receive what she has already paid for would be the same dependency this protocol exists to remove.
//
// Redemption is permissionless: whoever holds the code holds the certificate. That is a real weakness
// of a bearer secret and it is documented where the code is hashed; production binds the certificate to
// a passkey account at the point of sale, so nothing bearer-shaped ever travels.
func (o *Ops) Buy(ctx context.Context, itemID uint64, payment feeds.ProcessorPayload) error {
	if err := o.SellInstant(ctx, itemID, payment); err != nil {
		return err
	}
	return o.Redeem(ctx, itemID, o.ReceiptCode(itemID), chain.Address(o.Keys.Buyer))
}

// ReceiptCode is the secret the till prints on the buyer's receipt.
//
// The sale committed to its hash; this is the preimage, and it is the only thing the buyer walks out
// with. See the note where the code is derived for what a real one looks like and why this one is
// reproducible.
func (o *Ops) ReceiptCode(itemID uint64) [32]byte { return claimCode(itemID) }

// Redeem turns a claim code into a certificate, in the name of whoever presents it.
//
// The transaction is sponsored, because a buyer who needed gas to receive what she has already paid
// for would be a buyer dependent on the operator's cooperation — the exact dependency this protocol
// exists to remove. What the operator cannot do is redeem *for* her without the code: the commitment
// was written at the sale, and the gateway checks the preimage.
func (o *Ops) Redeem(ctx context.Context, itemID uint64, code [32]byte, owner common.Address) error {
	if _, err := o.Client.Send(ctx, o.Keys.Operator, "redeem certificate", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Gateway.RedeemCertificate(auth, new(big.Int).SetUint64(itemID), code, owner)
	}); err != nil {
		return err
	}

	state, err := o.C.Items.StateOf(callOpts(ctx), new(big.Int).SetUint64(itemID))
	if err != nil {
		return err
	}

	o.Say("  buyer %s redeemed the certificate for item %d with the code on her receipt — item state: %s",
		short(owner), itemID, itemState(state))
	o.Say("  she sent no transaction, holds no gas, and owns the certificate anyway")

	return nil
}

// CommitOption takes a stranger's money for an item the operator may not actually have.
//
// This is the standing buy option, and it is the trap that catches off-books inventory. Every listed
// item is buyable by anyone at any moment — including the item that quietly went home in somebody's
// bag. The full price is the exposure, because the operator is holding a stranger's money against a
// promise, and the refund that promise is worth is minted here as an ordinary debt: it ages, it
// defaults, and it is covered by exactly the machinery that covers an unpaid creator. There is no
// separate refund path to get wrong.
func (o *Ops) CommitOption(ctx context.Context, itemID uint64) (uint64, error) {
	input, err := o.saleInput(ctx, itemID, true)
	if err != nil {
		return 0, err
	}

	buyer := chain.Address(o.Keys.Buyer)

	if _, err := o.Client.Send(ctx, o.Keys.Operator, "commit option", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Gateway.CommitOption(auth, input, buyer)
	}); err != nil {
		return 0, err
	}

	commitment, err := o.C.Gateway.CommitmentOf(callOpts(ctx), new(big.Int).SetUint64(itemID))
	if err != nil {
		return 0, err
	}
	item, err := o.C.Items.ItemOf(callOpts(ctx), new(big.Int).SetUint64(itemID))
	if err != nil {
		return 0, err
	}

	o.Say("  a stranger bought item %d for %s. The operator has until %d to hand it over — and it "+
		"does not have it.", itemID, money(commitment.Price), item.CommittedUntil)
	o.Say("  → refund debt #%s minted: the buyer's way out, on the ordinary clock",
		commitment.RefundDebtId)

	return commitment.RefundDebtId.Uint64(), nil
}

func itemState(state uint8) string {
	switch state {
	case 0:
		return "absent (never touched — availability is proven by the tranche, not by a storage write)"
	case 1:
		return "listed"
	case 2:
		return "committed"
	case 3:
		return "sold"
	case 4:
		return "OWNED"
	case 5:
		return "BURNED"
	default:
		return "unknown"
	}
}
