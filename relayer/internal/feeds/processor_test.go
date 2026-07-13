package feeds_test

import (
	"testing"

	"goodhouse/relayer/internal/feeds"
)

// The webhook's signature is worth exactly as much as the secret behind it, and the secret is the
// operator's own.
//
// This test exists to make that unavoidable. It shows the operator forging a "payment notification" for
// a payment that never happened — and the signature checking out perfectly, because of course it does:
// the operator holds the key. Any protocol that accepted this as proof of payment would be a protocol
// in which Good proves its own payments to itself, which is the exact failure the entire settlement
// machinery exists to prevent.
//
// So the payload is a doorbell. What goes on-chain is a *claim*, and a claim is an assertion under
// scrutiny: the recipient can test it, the sweep must eventually back it with evidence from the
// processor's own records, and an assertion that survives neither dies.
func TestTheOperatorCanForgeItsOwnWebhookPerfectly(t *testing.T) {
	const secret = "the operator's own webhook secret"

	// A payment that really happened.
	real := feeds.NewProcessorPayload(secret, 1001, "100000", "NGN")
	if !feeds.Verify(secret, real) {
		t.Fatal("a genuine payload did not verify")
	}

	// And one the operator simply made up, at a desk, for money it never sent — signed with the secret
	// it holds in its own hand.
	forged := feeds.ProcessorPayload{
		Reference: "PSK_A_PAYMENT_THAT_NEVER_HAPPENED",
		Amount:    "100000",
		Currency:  "NGN",
		ItemID:    1001,
	}
	feeds.Sign(secret, &forged)

	if !feeds.Verify(secret, forged) {
		t.Fatal("the operator could not sign its own message, which would be a strange world indeed")
	}

	// The two are indistinguishable, and that is the finding. The conclusion this protocol draws from a
	// valid signature here is exactly one thing: the message came from the integration. It draws no
	// conclusion whatsoever about whether money moved, and the contracts never ask it to — the evidence
	// path is a claim, tested against a verifier, over records the operator does not control.
	if real.Signature == forged.Signature {
		t.Fatal("two different references produced the same signature")
	}
}

func TestAPayloadFromSomebodyElseIsRefused(t *testing.T) {
	real := feeds.NewProcessorPayload("the operator's secret", 1001, "100000", "NGN")

	if feeds.Verify("somebody else's secret", real) {
		t.Fatal("a payload verified under a secret that did not sign it")
	}
}
