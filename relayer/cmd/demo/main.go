// Command demo drives the protocol.
//
// Every act of the demo is a subcommand here, and the whole thing end to end is `run`. There is no
// hidden state and no privileged path: the demo does exactly what an operator can do, from the
// operator's key — and the two transactions that punish the operator are sent from a stranger's.
//
//	demo seed                        open the shop
//	demo publish                     re-publish any voucher whose bytes never reached the store
//	demo resolve                     fetch every voucher back from the store, as a buyer would
//	demo status                      read the till
//	demo sell --item 1001            instant rail: the processor split the payment at source
//	demo cash-sale --item 1002       the operator takes the money into its own hands
//	demo buy --item 1003             a sponsored purchase, and a certificate redeemed with a code
//	demo commit --item 1004          the standing buy option: a stranger buys what may not exist
//	demo post-claim --debts 1,2,3    the operator asserts that it paid
//	demo challenge --claim 1         the creator says, in her own name, that it did not
//	demo inject-verdict --claim 1    what a real zkTLS verifier would have concluded
//	demo sweep --claims 1,2          the periodic attestation
//	demo credit --claim 1            collect the capacity a proven payout earned
//	demo touch-claim --claim 2       a stranger collects a lapsed claim
//	demo touch-debt --debt 4         a stranger collects a defaulted debt
//	demo burn --item 1005            a write-off, paid as if sold
//	demo farm                        the operator buys trust from itself, and it buys nothing
//	demo run                         all seven proofs, in order
package main

import (
	"context"
	"flag"
	"fmt"
	"math/big"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"

	"github.com/ethereum/go-ethereum/common"

	"goodhouse/relayer/internal/feeds"
	"goodhouse/relayer/internal/ops"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "\n  ✗ %v\n\n", err)
		os.Exit(1)
	}
}

func run() error {
	settings := ops.Flags(flag.CommandLine)

	var (
		devTime   = flag.Bool("dev-time", true, "advance a development chain's clock instead of waiting for it")
		item      = flag.Uint64("item", 0, "item id")
		debt      = flag.Uint64("debt", 0, "debt id")
		claim     = flag.Uint64("claim", 0, "claim id")
		debtList  = flag.String("debts", "", "comma-separated debt ids")
		claimList = flag.String("claims", "", "comma-separated claim ids")
		valid     = flag.Bool("valid", true, "inject-verdict: whether the payment is in the processor's records")
		amount    = flag.String("amount", "", "reimburse: how much, in whole naira")
		recipient = flag.String("to", "", "collect-penalty: the wronged party")
		reason    = flag.String("reason", "water damage", "burn: what happened to the item")
	)
	flag.Parse()

	command := flag.Arg(0)
	if command == "" {
		flag.Usage()
		return fmt.Errorf("no command given")
	}

	// Go stops parsing flags at the first argument that is not one, so `demo run --dev-time=false` puts
	// the flag *after* the command and quietly leaves it at its default — which, for that flag, means a
	// demo pointed at a public chain would try to shove its clock forward and fail in a way that reads
	// like a network fault. A flag that was typed and ignored is worse than a flag that was refused.
	if extra := flag.Args()[1:]; len(extra) > 0 {
		return fmt.Errorf(
			"flags come before the command: try `demo %s %s` (these were ignored: %s)",
			strings.Join(extra, " "), command, strings.Join(extra, " "),
		)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	o, err := ops.Open(ctx, settings, func(format string, args ...any) {
		fmt.Printf(format+"\n", args...)
	})
	if err != nil {
		return err
	}
	defer o.Client.Close()

	// A development chain's clock can be pushed forward; a public one cannot, and asking it to fails in
	// a way that reads like a network fault. This is the one thing the demo needs that the operator's
	// service must never have.
	o.Client.DevTime = *devTime

	switch command {
	case "seed":
		return o.Seed(ctx)

	case "publish":
		// The seed's own last step, on its own. An upload costs a transaction, so a run that failed
		// after publishing nine vouchers resumes at the tenth: an item that already carries a pointer
		// is not paid for a second time.
		return o.Publish(ctx)

	case "resolve":
		// The buyer's read, run by the operator against itself: every voucher fetched back out of the
		// public store by the pointer its tag carries, and checked against the leaf the chain's tranche
		// root commits to. It reads and never writes, so it costs nothing and there is no reason not to
		// run it before a rehearsal — a pointer that resolves to nothing is a tag that cannot be checked.
		return o.ResolvePointers(ctx)

	case "status":
		return o.PrintStatus(ctx)

	case "sell":
		return o.SellInstant(ctx, *item, payment(*item))

	case "cash-sale":
		return o.SellCash(ctx, *item)

	case "buy":
		return o.Buy(ctx, *item, payment(*item))

	case "commit":
		_, err := o.CommitOption(ctx, *item)
		return err

	case "expire":
		return o.ExpireCommitment(ctx, *item)

	case "post-claim":
		ids, err := parseIDs(*debtList)
		if err != nil {
			return err
		}
		_, err = o.PostClaim(ctx, ids, payment(*item))
		return err

	case "challenge":
		return o.Challenge(ctx, *claim)

	case "settle":
		return o.SettleClaim(ctx, *claim)

	case "void":
		return o.VoidChallenged(ctx, *claim)

	case "inject-verdict":
		return o.InjectVerdict(ctx, *claim, *valid)

	case "sweep":
		ids, err := parseIDs(*claimList)
		if err != nil {
			return err
		}
		return o.Sweep(ctx, ids)

	case "credit":
		return o.CreditSettlement(ctx, *claim)

	case "touch-claim":
		return o.TouchClaim(ctx, *claim)

	case "touch-debt":
		return o.TouchDebt(ctx, *debt)

	case "collect-dues":
		return o.CollectPoolDues(ctx)

	case "collect-penalty":
		if !common.IsHexAddress(*recipient) {
			return fmt.Errorf("--to must be an address")
		}
		return o.CollectPenalty(ctx, common.HexToAddress(*recipient))

	case "reimburse":
		whole, ok := new(big.Int).SetString(*amount, 10)
		if !ok {
			return fmt.Errorf("--amount must be a whole number of naira")
		}
		return o.Reimburse(ctx, ops.Naira(whole))

	case "burn":
		return o.Burn(ctx, *item, *reason)

	case "farm":
		// The operator buys trust from itself, in the open, and it works. Then it tries to spend it on
		// somebody real, and it does not.
		_, err := o.Farm(ctx)
		return err

	case "kill-check":
		// The kill-switch beat, from the chain's side. Every number this prints is a public read over a
		// public RPC. Stop the operator's service and run it again: it answers exactly the same, because
		// verification never went through the operator in the first place. That is the difference
		// between a ledger and a dashboard.
		return o.PrintStatus(ctx)

	case "run":
		return scenario(ctx, o)

	default:
		return fmt.Errorf("unknown command %q", command)
	}
}

// payment mints the processor notification a sale is triggered by. See feeds.ProcessorPayload for why
// it can never be evidence of anything.
func payment(itemID uint64) feeds.ProcessorPayload {
	return feeds.NewProcessorPayload(
		env("GLASS_WEBHOOK_SECRET", "demo-webhook-secret"), itemID, "", "NGN",
	)
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func parseIDs(list string) ([]uint64, error) {
	if strings.TrimSpace(list) == "" {
		return nil, fmt.Errorf("no ids given")
	}

	parts := strings.Split(list, ",")
	out := make([]uint64, 0, len(parts))
	for _, part := range parts {
		id, err := strconv.ParseUint(strings.TrimSpace(part), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("%q is not an id", part)
		}
		out = append(out, id)
	}

	return out, nil
}
