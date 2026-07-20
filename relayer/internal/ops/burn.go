package ops

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/core/types"

	"goodhouse/relayer/internal/chain/bindings"
	"goodhouse/relayer/internal/merkle"
	"goodhouse/relayer/internal/storage"
)

// Burn writes an item off, and pays everyone as if it had sold.
//
// The write-off is the laundering door in every retail system: sell for cash off the books, then
// declare the item destroyed. The protocol's answer is not paperwork — it is pricing. The creator is
// paid her 80% and the landlord his 5%, exactly as a sale would have paid them; the referral share of a
// sale that never happened goes to the pool, because there is no referrer and it must not be a windfall
// for the party that destroyed the goods; and then there is a fee. What is left for the launderer is
// the commission it would have earned by ringing the sale up honestly, minus that fee — strictly less,
// at every price. There is no evidence to fake, because the price is the price.
//
// The payouts are minted as ordinary debts on the ordinary clock. Declaring the loss is not the same as
// bearing it: an operator that never pays them watches them default like any others.
func (o *Ops) Burn(ctx context.Context, itemID uint64, reason string) error {
	// Which consignment this item is in, and whose key signs for it. Resolved the same way a sale
	// resolves it — a write-off proves membership exactly as a sale does, and an item can be written
	// off from any of the shop's consignments, not only the first one.
	consignment, signer, err := o.blockOf(itemID)
	if err != nil {
		return err
	}
	index, err := consignment.index(itemID)
	if err != nil {
		return err
	}

	item, signature, err := o.signedVoucher(ctx, signer, consignment.CreatorID, itemID)
	if err != nil {
		return err
	}

	tree, err := merkle.New(consignment.leaves())
	if err != nil {
		return err
	}
	path, err := tree.Proof(index)
	if err != nil {
		return err
	}

	// The incident file: photographs, the insurer's report, whatever the loss actually was. It goes to
	// storage and its hash goes on-chain, so it cannot be swapped afterwards for a better story.
	blob, err := json.MarshalIndent(incident{ItemID: itemID, Reason: reason}, "", "  ")
	if err != nil {
		return err
	}
	pointer, err := o.publish(ctx, fmt.Sprintf("write-off-%d", itemID), blob)
	if err != nil {
		return err
	}

	writeOff := bindings.SaleGatewayWriteOff{
		Voucher:        item,
		Signature:      signature,
		TrancheId:      new(big.Int).SetUint64(consignment.TrancheID),
		Proof:          path,
		EvidenceHash:   storage.Fingerprint(blob),
		StoragePointer: pointer,
	}

	price, err := o.C.Prices.EffectivePrice(callOpts(ctx), new(big.Int).SetUint64(itemID))
	if err != nil {
		return err
	}

	if _, err := o.Client.Send(ctx, o.Keys.Operator, "burn", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return o.C.Gateway.Burn(auth, writeOff)
	}); err != nil {
		return err
	}

	// The arithmetic, which the contract emits precisely so that it can be displayed rather than
	// narrated. Recomputed here from the same published parameters the contract used.
	operatorBps, err := o.C.Gateway.OperatorBps(callOpts(ctx))
	if err != nil {
		return err
	}
	burnBps, err := o.C.Gateway.BurnPenaltyBps(callOpts(ctx))
	if err != nil {
		return err
	}

	honest := bps(price, int64(operatorBps))
	fee := bps(price, int64(burnBps))
	paidAsSold := new(big.Int).Sub(price, honest)
	laundered := new(big.Int).Sub(honest, fee)

	o.Say("  item %d written off: %q", itemID, reason)
	o.Say("  → paid as if sold: %s (every share of the price that is not the operator's own)", money(paidAsSold))
	o.Say("  → write-off fee:   %s, owed to the pool", money(fee))
	o.Say("  → an honest sale would have earned the operator %s", money(honest))
	o.Say("  → laundering it earns %s. Strictly less, and it is less at every price.", money(laundered))

	return nil
}

type incident struct {
	ItemID uint64 `json:"itemId"`
	Reason string `json:"reason"`
}
