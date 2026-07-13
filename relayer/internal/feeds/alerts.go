package feeds

import (
	"sync"
	"time"
)

// Alert is a credit landing in somebody's bank account — the message a recipient's phone shows when
// money actually arrives.
//
// This feed is the *recipient's* side of settlement, and it is deliberately the only side that gets to
// say a payment happened from the payee's point of view. In production nothing like this service
// exists: the recipient's own banking app pushes the alert to her own phone, her app matches it against
// the claims the operator posted, and the match happens on her device where the operator can never see
// it. Here it is simulated so the ledger view can show the auto-match beat — and it is simulated
// honestly, which means an alert exists here only when a payment really was made in the story.
//
// The asymmetry that matters: a claim with no matching alert is what a recipient challenges. An alert
// with no claim is nothing at all — the operator paying somebody it never admitted owing is not a
// problem the protocol has.
type Alert struct {
	Recipient string `json:"recipient"`
	Reference string `json:"reference"`
	Amount    string `json:"amount"`
	Currency  string `json:"currency"`
	At        int64  `json:"at"`
}

// AlertFeed is the simulated bank-alert stream, per recipient.
type AlertFeed struct {
	mu     sync.RWMutex
	alerts map[string][]Alert
}

func NewAlertFeed() *AlertFeed {
	return &AlertFeed{alerts: make(map[string][]Alert)}
}

// Credit records that money reached a recipient. The demo calls this only when the operator really
// paid — which is why the stalled payout produces no alert, and why the recipient's app has nothing to
// match the operator's claim against.
func (f *AlertFeed) Credit(recipient, reference, amount, currency string) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.alerts[recipient] = append(f.alerts[recipient], Alert{
		Recipient: recipient,
		Reference: reference,
		Amount:    amount,
		Currency:  currency,
		At:        time.Now().Unix(),
	})
}

// For returns a recipient's alerts.
func (f *AlertFeed) For(recipient string) []Alert {
	f.mu.RLock()
	defer f.mu.RUnlock()

	out := make([]Alert, len(f.alerts[recipient]))
	copy(out, f.alerts[recipient])
	return out
}
