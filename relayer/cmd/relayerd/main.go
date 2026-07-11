// Command relayerd is the operator's long-running service. It will host the
// mock payment-processor webhook and bank-alert feeds, a status endpoint, and
// a clean-shutdown kill switch.
//
// Public verification never depends on this process: buyer- and auditor-facing
// verification reads chain state over public RPC only, so stopping relayerd
// must not change any verification result.
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "relayerd: scaffold only — service wiring not yet implemented")
	os.Exit(1)
}
