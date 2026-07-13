package ops

import (
	"context"
	"flag"
	"os"

	"goodhouse/relayer/internal/chain"
	"goodhouse/relayer/internal/storage"
)

// Settings is everything a process needs in order to be the operator: a chain to send on, the
// deployment to send at, and the shelf the consignment lives on.
type Settings struct {
	// RPCURL is the chain. Any endpoint will do; nothing here assumes a node it controls.
	RPCURL string

	// Deployment names the addresses file outright, for the rare case of pointing two processes at
	// two deployments of the same chain. Empty means: work it out from the chain, which is the
	// normal case and the one that cannot be got wrong.
	Deployment string

	// Deployments is the directory the deployment script publishes into, one file per chain.
	Deployments string

	// DataDir is the shelf: the consignment file, the blobs, and the run's receipts.
	DataDir string
}

// Flags registers the four settings on a flag set, with their environment fallbacks.
//
// They are registered here, once, rather than declared by each command, because two commands that
// declare the same flag are two commands that can disagree about its default — and one of them will
// be the one nobody notices is wrong.
func Flags(fs *flag.FlagSet) *Settings {
	var s Settings
	fs.StringVar(&s.RPCURL, "rpc", env("GLASS_RPC_URL", "http://127.0.0.1:8545"), "RPC endpoint")
	fs.StringVar(&s.Deployment, "deployment", env("GLASS_DEPLOYMENT", ""), "the deployment the script published")
	fs.StringVar(&s.Deployments, "deployments", env("GLASS_DEPLOYMENTS_DIR", "../artifacts/deployments"), "where the deployment script publishes addresses")
	fs.StringVar(&s.DataDir, "data", env("GLASS_DATA_DIR", "../artifacts/demo"), "where the consignment file and blobs live")
	return &s
}

// Open connects the operator to a deployment: the chain, the contracts, the keys, and the store the
// vouchers were published to. The caller closes the client.
//
// This is the only place the operator is assembled. The demo and the service used to do it separately
// — the same six steps, written out twice — and the two copies drifted the moment one of them was
// corrected: the service went to testnet looking for its addresses in a directory that had moved, found
// nothing, and opened for business with no till. The seven proofs all passed, because the demo drives
// them from the command line and not one of them goes through the counter. The buy button does.
//
// So there is one assembly now, and a fault in it stops everything at once, which is the only kind of
// fault that gets fixed.
func Open(ctx context.Context, s *Settings, say func(format string, args ...any)) (*Ops, error) {
	client, err := chain.Dial(ctx, s.RPCURL)
	if err != nil {
		return nil, err
	}

	// The bill. Every transaction this process sends is written down as the chain's own receipt
	// reports it, beside the consignment it paid for, and `gastable` renders the seventh proof from
	// the file afterwards. The counter's sales are in it too: a dress rung up at the till costs
	// exactly what a dress rung up from the command line costs, and a bill with the buy button
	// missing from it would be a bill that flattered us.
	client.Gas = chain.NewGasLedger(chain.GasLedgerPath(s.DataDir))

	addresses, err := chain.LoadDeployment(
		chain.DeploymentPath(s.Deployment, s.Deployments, client.ChainID),
	)
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

	store, err := storage.FromEnv(s.DataDir)
	if err != nil {
		client.Close()
		return nil, err
	}

	return &Ops{
		Client: client,
		C:      contracts,
		Keys:   keys,
		Store:  store,
		Config: DemoConfig(s.DataDir),
		Say:    say,
	}, nil
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
