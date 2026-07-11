// Command demo is the scenario runner: it drives the end-to-end demo acts
// (seeding, sales, claims, sweeps, defaults, burns) against any RPC endpoint,
// local or testnet, with pauses and narration hooks for live presentation.
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "demo: scaffold only — scenario runner not yet implemented")
	os.Exit(1)
}
