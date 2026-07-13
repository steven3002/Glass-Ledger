package feeds

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
)

// ProcessorPayload is what a payment processor tells the operator when money moves.
//
// **It is a trigger. It is not evidence, and it can never become evidence.**
//
// Read the signature below and the reason is plain: the payload is HMAC-signed with a secret the
// operator itself holds. Good could sit down and manufacture one of these in a text editor. Any design
// that treated it as proof of payment would be a design in which the operator proves its own payments
// to itself — which is the exact failure the entire settlement machinery exists to prevent.
//
// So the payload does one thing: it tells the relayer that a sale can be rung up, and it carries the
// payment reference that the sale's *claim* will name. The claim is an assertion under scrutiny — the
// recipient can test it, the sweep must eventually back it, and an assertion that survives neither
// dies. The proof, when it is demanded, comes from the processor's own records through zkTLS, not from
// this message.
type ProcessorPayload struct {
	Reference string `json:"reference"`
	Amount    string `json:"amount"`
	Currency  string `json:"currency"`
	ItemID    uint64 `json:"itemId"`
	Timestamp int64  `json:"timestamp"`

	// Signature is HMAC-SHA256 over the reference, with the operator's own webhook secret. It proves
	// the message came from the processor's integration — and proves *nothing whatsoever* about
	// whether any money reached anybody.
	Signature string `json:"signature"`
}

// RefHash is the payment reference as the chain carries it: hashed, because the reference is the
// processor's business and the chain only needs to be able to tell one payment from another.
func (p ProcessorPayload) RefHash() [32]byte {
	return crypto.Keccak256Hash([]byte(p.Reference))
}

// NewProcessorPayload mints a mock notification for a sale.
func NewProcessorPayload(secret string, itemID uint64, amount, currency string) ProcessorPayload {
	payload := ProcessorPayload{
		Reference: fmt.Sprintf("PSK_%d_%d", itemID, time.Now().UnixNano()),
		Amount:    amount,
		Currency:  currency,
		ItemID:    itemID,
		Timestamp: time.Now().Unix(),
	}
	Sign(secret, &payload)
	return payload
}

// Sign puts the operator's own HMAC on a payload.
//
// It is exported for one reason, and it is not convenience: it makes the failure mode visible. Anyone
// holding the secret can sign anything, including a notification for a payment that was never made —
// which is why this protocol treats the result as a trigger and never as evidence, and why there is a
// test that forges one.
func Sign(secret string, payload *ProcessorPayload) {
	payload.Signature = sign(secret, payload.Reference)
}

// Verify checks the HMAC.
//
// The relayer checks it because a webhook endpoint that accepted anything would be an open door into
// the operator's own till — the operator has every reason to want its triggers authentic. It is worth
// being exact about what a passing check buys: it says the message came from the integration. It says
// nothing about the money, and the protocol never asks it to.
func Verify(secret string, payload ProcessorPayload) bool {
	expected := sign(secret, payload.Reference)
	return hmac.Equal([]byte(expected), []byte(payload.Signature))
}

func sign(secret, reference string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(reference))
	return hex.EncodeToString(mac.Sum(nil))
}
