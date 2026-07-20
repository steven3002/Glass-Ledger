// Command rebuildconsignment reconstructs a chain's consignment file without sending a transaction.
//
// The consignment is the shop's published paperwork — the tranche roots, the leaf each item hashes to,
// and the pointer its voucher's bytes live at. It is *derived*, not authored: every field follows from
// the deployment's own configuration, the creator's key, and the split policy the gateway publishes.
// So a lost file is recoverable exactly, and this proves the recovery is exact rather than asserting
// it: the roots it computes are compared against the roots the chain is already holding, and it
// refuses to write anything if they differ by a bit.
//
// Why this exists: the local scenarios write to `artifacts/demo/` while the testnet writes to
// `artifacts/demo/<chainid>/`, so a `rm -rf artifacts/demo` between local runs takes the testnet's
// shelf with it. The chain is untouched by that and 0G Storage still holds the bytes; only the local
// index of them is gone. Losing it is not a disaster, but discovering it during a demo would be, and
// the demo cannot be re-seeded to fix it — re-running the seed would register a *second* creator and
// post the same dresses again under a new tranche.
//
// It sends nothing. It reads the chain, computes, checks, and writes one file.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"goodhouse/relayer/internal/ops"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "\nrebuildconsignment: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	settings := ops.Flags(flag.CommandLine)
	write := flag.Bool("write", false, "write the file (default: verify only, and say what it would write)")
	flag.Parse()

	ctx := context.Background()
	o, err := ops.Open(ctx, settings, func(format string, args ...any) {
		fmt.Printf(format+"\n", args...)
	})
	if err != nil {
		return err
	}
	defer o.Client.Close()

	return o.RebuildConsignment(ctx, *write)
}
