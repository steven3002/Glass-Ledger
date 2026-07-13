package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"path/filepath"

	"github.com/ethereum/go-ethereum/common"

	"goodhouse/relayer/internal/chain"
	"goodhouse/relayer/internal/feeds"
	"goodhouse/relayer/internal/ops"
	"goodhouse/relayer/internal/storage"
)

// The till: the one part of the operator the buyer's page actually needs.
//
// A sale is the single thing in this protocol that only Good can do — the gateway will not consume an
// item for anybody else, and the buyer has no wallet, no gas and no account. So the checkout page
// sends its purchase here, and the operator sponsors the transaction. That is the whole of the web's
// dependency on this process, and it is deliberately the *write* path only.
//
// Everything the page does before that — reading the tag, fetching the voucher, checking the creator's
// signature, walking the Merkle proof, reading the item's state, dry-running the ceiling — happens
// against a public RPC and a public store, in the browser, with no code path that can reach this
// service. Kill this process and the shop cannot sell; verification carries on exactly as before, and
// so does every clock, every default and every permissionless touch. That is the difference between a
// counter and a ledger, and it is why the kill switch is worth pulling in front of people.
//
// Production note: an open till endpoint is a door into the operator's own money, and this one is
// wide open because a demo has no terminals to enrol. A real deployment authenticates the point-of-sale
// device and rate-limits per terminal; nothing about that changes what the contracts check, which is
// the only reason it can be left out here.
type till struct {
	ops *ops.Ops
}

// openTill wires the operator's side of the counter: keys, the deployed contracts, and the store the
// vouchers were published to.
//
// It is allowed to fail. The feeds, the status endpoint and the kill switch do not need a chain, and a
// relayerd that refused to start without one could not be used to demonstrate the one thing it is for.
// When there is no till, the checkout endpoints say so in a sentence.
func openTill(ctx context.Context, rpcURL, deployment, deployments, dataDir string) (*till, error) {
	client, err := chain.Dial(ctx, rpcURL)
	if err != nil {
		return nil, err
	}

	// Where the deployment script published its addresses. It is a directory in its own right and is
	// not derived from the data directory: the shelf is per-chain (a consignment belongs to the
	// deployment that posted it) and the deployments directory is not, so walking up from one to reach
	// the other finds the wrong place the moment the shelf moves — which is precisely what it did, and
	// this process spent a whole testnet rehearsal with its till shut because of it.
	path := deployment
	if path == "" {
		path = filepath.Join(deployments, client.ChainID.String()+".json")
	}
	addresses, err := chain.LoadDeployment(path)
	if err != nil {
		client.Close()
		return nil, err
	}

	contracts, err := chain.Bind(addresses, client.ETH)
	if err != nil {
		client.Close()
		return nil, err
	}

	keys, err := chain.KeysFromEnv()
	if err != nil {
		client.Close()
		return nil, err
	}

	store, err := storage.FromEnv(dataDir)
	if err != nil {
		client.Close()
		return nil, err
	}

	return &till{ops: &ops.Ops{
		Client: client,
		C:      contracts,
		Keys:   keys,
		Store:  store,
		Config: ops.DemoConfig(dataDir),
		Say:    func(format string, args ...any) { log.Printf(format, args...) },
	}}, nil
}

type buyRequest struct {
	ItemID uint64 `json:"itemId"`
}

type buyResponse struct {
	ItemID uint64 `json:"itemId"`

	// ClaimCode is the receipt. It is a bearer secret: whoever holds it can redeem the certificate,
	// which is a real weakness and is the reason production binds the certificate to a passkey account
	// at the point of sale instead of printing a code at all.
	ClaimCode string `json:"claimCode"`
}

// buy rings up a sale on the instant rail and hands back the code on the receipt.
//
// The payment is mocked, as everything about the buyer's money is in this MVP: the processor's webhook
// is a trigger, never evidence, and the claim posted in the same transaction is the assertion that
// actually gets tested. See feeds.ProcessorPayload.
func (t *till) buy(w http.ResponseWriter, r *http.Request) {
	var request buyRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.ItemID == 0 {
		refuse(w, http.StatusBadRequest, "which item?")
		return
	}

	payment := feeds.NewProcessorPayload(
		env("GLASS_WEBHOOK_SECRET", "demo-webhook-secret"), request.ItemID, "", "NGN",
	)

	if err := t.ops.SellInstant(r.Context(), request.ItemID, payment); err != nil {
		// The refusal is the product. The chain decodes its own errors by name (see
		// chain/reverts.go), so a counter that will not sell says which rule stopped it —
		// AlreadySold, OverCeiling, UnknownCreatorSignature — and the page prints that sentence.
		refuse(w, http.StatusConflict, err.Error())
		return
	}

	code := t.ops.ReceiptCode(request.ItemID)
	writeJSON(w, buyResponse{
		ItemID:    request.ItemID,
		ClaimCode: common.Hash(code).Hex(),
	})
}

type redeemRequest struct {
	ItemID uint64 `json:"itemId"`
	Code   string `json:"code"`

	// Where the certificate should be bound. A buyer with a wallet names it; a buyer without one —
	// which is the ordinary case, and the case this demo is about — names nothing, and the account
	// the demo gave her is used.
	//
	// Production note: the certificate is bound to a passkey account created at the point of sale, so
	// nothing bearer-shaped ever travels and nobody has to be handed an address to hold.
	Owner string `json:"owner"`
}

// redeem binds the certificate to whoever presents the code, and sponsors the gas for it.
//
// The operator cannot do this without the code — the commitment was written into the sale — and it
// cannot refuse to do it either, because the same code works from any RPC with any gas payer. What is
// sponsored here is a convenience, not a permission.
func (t *till) redeem(w http.ResponseWriter, r *http.Request) {
	var request redeemRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.ItemID == 0 {
		refuse(w, http.StatusBadRequest, "which item?")
		return
	}

	owner := chain.Address(t.ops.Keys.Buyer)
	if request.Owner != "" {
		if !common.IsHexAddress(request.Owner) {
			refuse(w, http.StatusBadRequest, "that is not an address to bind a certificate to")
			return
		}
		owner = common.HexToAddress(request.Owner)
	}

	if err := t.ops.Redeem(r.Context(), request.ItemID, common.HexToHash(request.Code), owner); err != nil {
		refuse(w, http.StatusConflict, err.Error())
		return
	}

	writeJSON(w, map[string]any{"itemId": request.ItemID, "owner": owner.Hex(), "redeemed": true})
}

// closed is what the checkout answers when this process was started without a chain to sell on.
func closed(w http.ResponseWriter, _ *http.Request) {
	refuse(w, http.StatusServiceUnavailable, fmt.Sprint(
		"the till is not open: this operator was started without a deployment, a key, or an RPC to "+
			"reach the chain on. Verification is unaffected — it never came through here.",
	))
}

func refuse(w http.ResponseWriter, status int, reason string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": reason})
}
