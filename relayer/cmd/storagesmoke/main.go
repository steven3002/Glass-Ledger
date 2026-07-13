// Command storagesmoke publishes one blob to 0G Storage and reads it back through the public indexer.
//
// The demo's default store writes content-addressed files to disk, which is enough to run every proof
// on a development chain and is honest about being nothing more than that. The real store is 0G
// Storage, and an upload there costs gas on the 0G chain — so the backend cannot be exercised by a
// test suite, only by a funded key on a live network. This command is that exercise, kept small and
// separate on purpose: it needs no deployment, no consignment and no contracts, so the storage layer
// can be proven (or found wanting) long before anything else is ready.
//
//	GLASS_0G_RPC=…  GLASS_0G_INDEXER=…  GLASS_0G_KEY=…  go run ./cmd/storagesmoke
//
// It prints the pointer 0G assigned the bytes, whether the bytes came back identical, and what the
// upload cost in native token — the number the cost table needs and the only way to get it is to pay
// it once.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"

	"goodhouse/relayer/internal/storage"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "\n  ✗ %v\n\n", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	rpcURL := env("GLASS_0G_RPC", "")
	indexerURL := env("GLASS_0G_INDEXER", "")
	key := strings.TrimPrefix(env("GLASS_0G_KEY", ""), "0x")

	if rpcURL == "" || indexerURL == "" || key == "" {
		return fmt.Errorf(
			"set GLASS_0G_RPC, GLASS_0G_INDEXER and GLASS_0G_KEY — the endpoints are network facts and " +
				"the key has to be one that holds gas, so none of the three is defaulted here",
		)
	}

	private, err := crypto.HexToECDSA(key)
	if err != nil {
		return fmt.Errorf("GLASS_0G_KEY: %w", err)
	}
	account := crypto.PubkeyToAddress(private.PublicKey)

	eth, err := ethclient.DialContext(ctx, rpcURL)
	if err != nil {
		return fmt.Errorf("rpc: %w", err)
	}
	defer eth.Close()

	chainID, err := eth.ChainID(ctx)
	if err != nil {
		return fmt.Errorf("rpc: %w", err)
	}

	before, err := eth.BalanceAt(ctx, account, nil)
	if err != nil {
		return fmt.Errorf("balance: %w", err)
	}

	fmt.Printf("\n  chain %s · account %s · balance %s\n", chainID, account, token(before))

	// An upload is a transaction. Without gas there is nothing to measure and nothing to prove, and a
	// run that failed for want of a faucet claim should say so in one sentence rather than in an SDK
	// stack trace.
	if before.Sign() == 0 {
		return fmt.Errorf(
			"%s holds no native token, so it cannot pay for an upload. Fund it (the testnet faucet "+
				"allows 0.1 0G per wallet per day) and run this again", account,
		)
	}

	store, err := storage.NewZeroG(rpcURL, indexerURL, key, os.TempDir())
	if err != nil {
		return err
	}
	fmt.Printf("  store %s\n\n", store.Backend())

	// A voucher-shaped blob, so what is measured is what the protocol actually publishes.
	blob, err := json.MarshalIndent(map[string]any{
		"note":      "0G Storage smoke test — one blob, published and read back.",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}, "", "  ")
	if err != nil {
		return err
	}

	started := time.Now()
	pointer, err := store.Put(ctx, "smoke", blob)
	if err != nil {
		return fmt.Errorf("upload: %w", err)
	}
	uploaded := time.Since(started)

	after, err := eth.BalanceAt(ctx, account, nil)
	if err != nil {
		return fmt.Errorf("balance: %w", err)
	}
	cost := new(big.Int).Sub(before, after)

	fmt.Printf("  ↑ %d bytes → %s (%s)\n", len(blob), pointer, uploaded.Round(time.Millisecond))
	fmt.Printf("    cost %s\n\n", token(cost))

	started = time.Now()
	got, err := store.Get(ctx, pointer)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	downloaded := time.Since(started)

	// The pointer is 0G's own Merkle root over the file, not our hash of it, so the bytes are what
	// prove the round trip: publish these, get these back, or the store is not a store.
	if !bytes.Equal(blob, got) {
		return fmt.Errorf(
			"the bytes came back different: published %d, read %d — a store that does not return what "+
				"it was given cannot hold a voucher", len(blob), len(got),
		)
	}

	fmt.Printf("  ↓ %d bytes back, identical (%s)\n", len(got), downloaded.Round(time.Millisecond))
	fmt.Printf("    keccak of the bytes %s — what an on-chain evidence hash commits to\n", storage.Fingerprint(got))
	fmt.Printf("    0G's root           %s — where the on-chain pointer sends a reader\n\n", pointer)
	fmt.Printf("  ✓ 0G Storage: published, addressed, and read back through the public indexer.\n\n")

	return nil
}

// token renders a native-token amount at the chain's 18 decimals.
func token(wei *big.Int) string {
	whole := new(big.Int)
	frac := new(big.Int)
	whole.QuoRem(wei, big.NewInt(1e18), frac)
	return fmt.Sprintf("%s.%018s 0G", whole, frac.String())
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
