// Package feeds hosts the demo's mock money-side inputs: a payment-processor
// webhook (instant rails) and a simulated bank-alert feed (custody rails).
//
// Payloads emitted here are demo triggers only. They stand in for processor
// notifications, which in production are HMAC-signed with the operator's own
// secret and therefore can never serve as settlement evidence — the evidence
// path is on-chain claims tested against the proof verifier.
package feeds
