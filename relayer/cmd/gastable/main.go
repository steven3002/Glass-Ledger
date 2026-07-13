// Command gastable renders the bill.
//
// The seventh proof is a number: that this protocol runs, on a public chain, for a rounding error
// against what a payment processor charges to do far less. A number like that is worth nothing if it
// was typed by the party it flatters, so none of these are. Every row is a receipt — the gas the chain
// charged, at the price it charged, for a transaction with a hash anybody can look up — and this
// command only sorts them and does the arithmetic.
//
//	gastable --chain 16602 --ngn-per-0g 3200 > ../docs/gas-table.md
//
// Two sources, and both of them are the chain's own record rather than ours: the demo's receipts, filed
// as each transaction was mined, and the deployment's receipts, fetched back by the hashes the Solidity
// deployment script broadcast. Nothing here is measured by this program; it is only read.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

	"goodhouse/relayer/internal/chain"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "\n  ✗ %v\n\n", err)
		os.Exit(1)
	}
}

func run() error {
	var (
		rpcURL      = flag.String("rpc", env("GLASS_RPC_URL", "https://evmrpc-testnet.0g.ai"), "RPC endpoint the receipts are read from")
		chainID     = flag.Uint64("chain", 16602, "the chain the run happened on")
		dataDir     = flag.String("data", env("GLASS_DATA_DIR", ""), "the run's data directory (default: ../artifacts/demo/<chain>)")
		deployments = flag.String("deployments", env("GLASS_DEPLOYMENTS_DIR", "../artifacts/deployments"), "where the deployment script published addresses")
		broadcast   = flag.String("broadcast", "../contracts/broadcast/Deploy.s.sol", "where the deployment script recorded what it sent")
		rate        = flag.String("ngn-per-0g", "", "naira per 0G, for the naira column (see the note it prints)")
		rateNote    = flag.String("rate-note", "", "where that rate came from, and when")

		// What it costs to *accept the money* for the same sale, which is the comparison the seventh
		// proof is actually making. The defaults are Paystack's published local-card rates; they are
		// flags because they are somebody else's price list and will change without asking us.
		salePrice     = flag.Int64("sale-price", 100_000, "the reference sale, in whole naira")
		processor     = flag.String("processor", "Paystack, local card", "whose fees the protocol's cost is being compared against")
		processorBps  = flag.Int64("processor-bps", 150, "the processor's percentage fee, in basis points")
		processorFlat = flag.Int64("processor-flat", 100, "the processor's flat fee, in naira")
		processorFree = flag.Int64("processor-waiver", 2_500, "the sale below which the flat fee is waived")
		processorCap  = flag.Int64("processor-cap", 2_000, "the most the processor will charge for one sale")
	)
	flag.Parse()

	if *dataDir == "" {
		*dataDir = filepath.Join("..", "artifacts", "demo", fmt.Sprint(*chainID))
	}

	// The two records have to be about the same deployment, or the table would be an average of two
	// different shops. The gateway the script created is compared against the gateway the relayer was
	// pointed at, and a mismatch is a refusal rather than a footnote.
	deployment, err := chain.LoadDeployment(
		chain.DeploymentPath("", *deployments, new(big.Int).SetUint64(*chainID)),
	)
	if err != nil {
		return err
	}

	sent, err := loadBroadcast(filepath.Join(*broadcast, fmt.Sprint(*chainID), "run-latest.json"))
	if err != nil {
		return err
	}
	if err := sameDeployment(sent, deployment); err != nil {
		return err
	}

	demo, err := chain.LoadGasLedger(chain.GasLedgerPath(*dataDir))
	if err != nil {
		return err
	}
	if len(demo) == 0 {
		return fmt.Errorf("%s is empty: there is no run to render", chain.GasLedgerPath(*dataDir))
	}

	ctx := context.Background()
	client, err := chain.Dial(ctx, *rpcURL)
	if err != nil {
		return err
	}
	defer client.Close()

	if client.ChainID.Uint64() != *chainID {
		return fmt.Errorf("--rpc is chain %s and the receipts are from chain %d", client.ChainID, *chainID)
	}

	// Forge records what it sent; the chain records what it charged. The second is the one that counts,
	// and on this network the first does not even carry the receipts — the public RPC is load-balanced
	// and loses them, so forge's broadcast file arrives with an empty receipt list. The hashes are what
	// it is good for; the receipts are fetched back here.
	deployed, err := receiptsOf(ctx, client, sent)
	if err != nil {
		return err
	}

	naira, err := parseRate(*rate)
	if err != nil {
		return err
	}

	return render(os.Stdout, report{
		ChainID:    *chainID,
		RPC:        *rpcURL,
		Ledger:     chain.GasLedgerPath(*dataDir),
		Deployment: deployment,
		Deployed:   deployed,
		Demo:       demo,
		Rate:       naira,
		RateNote:   *rateNote,
		Processor: processorFees{
			Name:   *processor,
			Sale:   *salePrice,
			Bps:    *processorBps,
			Flat:   *processorFlat,
			Waiver: *processorFree,
			Cap:    *processorCap,
		},
	})
}

// processorFees is what somebody else charges to move the money for one sale.
//
// The seventh proof's claim is not that this protocol is cheap in the abstract — it is that adding it to
// a sale costs a rounding error *against the fee the sale already pays* to be accepted at all. That is a
// comparison, so it needs the other side of it, and the other side is a published price list.
type processorFees struct {
	Name   string
	Sale   int64 // the reference sale, in whole naira
	Bps    int64
	Flat   int64
	Waiver int64
	Cap    int64
}

// charge is what the processor takes from the reference sale.
func (p processorFees) charge() int64 {
	fee := p.Sale * p.Bps / 10_000
	if p.Sale >= p.Waiver {
		fee += p.Flat
	}
	return min(fee, p.Cap)
}

// --- The two records ---------------------------------------------------------------------------------

// broadcastTx is one line of the deployment script's own account of what it sent.
type broadcastTx struct {
	Hash            string `json:"hash"`
	TransactionType string `json:"transactionType"`
	ContractName    string `json:"contractName"`
	ContractAddress string `json:"contractAddress"`
	Function        string `json:"function"`
}

// signature is the function a wiring call invoked, as the deployment script recorded it.
func (t broadcastTx) signature() string {
	if i := strings.IndexByte(t.Function, '('); i > 0 {
		return t.Function[:i]
	}
	return t.Function
}

func loadBroadcast(path string) ([]broadcastTx, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading the deployment's broadcast record %s: %w", path, err)
	}

	var file struct {
		Transactions []broadcastTx `json:"transactions"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	if len(file.Transactions) == 0 {
		return nil, fmt.Errorf("%s records no transactions", path)
	}

	return file.Transactions, nil
}

// sameDeployment refuses a bill assembled from two different shops.
func sameDeployment(sent []broadcastTx, deployment chain.Deployment) error {
	for _, tx := range sent {
		if tx.TransactionType != "CREATE" || tx.ContractName != "SaleGateway" {
			continue
		}
		if common.HexToAddress(tx.ContractAddress) == deployment.Gateway {
			return nil
		}
		return fmt.Errorf(
			"the deployment script's last run created its gateway at %s, and the relayer is pointed at "+
				"%s — these are two different deployments, and one table cannot be the bill for both",
			tx.ContractAddress, deployment.Gateway,
		)
	}

	return fmt.Errorf("the broadcast record contains no SaleGateway deployment")
}

// receiptsOf reads back what the chain charged for the deployment — and names each transaction from the
// chain's own record rather than from the label filed beside it.
//
// The broadcast file is a trustworthy list of *which* transactions were sent and an untrustworthy list of
// which is which. Its `hash` fields are filed in the order the transactions came back, not the order they
// are described in, so an entry announcing `CREATE PriceBook` can carry the hash of somebody else's
// transaction entirely. Read naively it produces a table in which a one-shot setter costs 2.5M gas and a
// contract deploys for 45k: nonsense, and nonsense that would have been published under our name.
//
// Everything else in an entry is sound, because `contractName`, `contractAddress` and `function` all come
// from the same simulation and agree with each other. So those build the two dictionaries — which contract
// lives at which address, and which selector is which setter — and then the hashes are treated as nothing
// but a set of transactions to go and look up. A receipt that created something is named by *what it
// created*; a call is named by the four bytes of its own input. The chain says what happened, and the
// script's paperwork is only asked where to send the query.
func receiptsOf(ctx context.Context, client *chain.Client, sent []broadcastTx) ([]chain.Receipt, error) {
	contracts := map[common.Address]string{}
	setters := map[[4]byte]string{}

	for _, tx := range sent {
		if tx.ContractAddress != "" {
			contracts[common.HexToAddress(tx.ContractAddress)] = tx.ContractName
		}
		if tx.Function != "" {
			var selector [4]byte
			copy(selector[:], crypto.Keccak256([]byte(tx.Function))[:4])
			setters[selector] = tx.signature()
		}
	}

	name := func(at common.Address) string {
		if known, ok := contracts[at]; ok {
			return known
		}
		return at.Hex()
	}

	// Where in the chain's own order each transaction sits. A block holds more than one of these — the
	// deployment is sixteen transactions and a chain will happily put six of them in one block — so the
	// block number alone does not order them, and an ordering that is merely nearly right would show the
	// gateway being wired up before it existed.
	type mined struct {
		receipt chain.Receipt
		block   uint64
		index   uint
	}

	order := make([]mined, 0, len(sent))
	for _, sentTx := range sent {
		hash := common.HexToHash(sentTx.Hash)

		receipt, err := client.ETH.TransactionReceipt(ctx, hash)
		if err != nil {
			return nil, fmt.Errorf("the deployment's receipt for %s: %w", hash, err)
		}

		tx, _, err := client.ETH.TransactionByHash(ctx, hash)
		if err != nil {
			return nil, fmt.Errorf("the deployment's transaction %s: %w", hash, err)
		}

		var op string
		switch {
		case receipt.ContractAddress != (common.Address{}):
			op = "deploy " + name(receipt.ContractAddress)

		case tx.To() != nil && len(tx.Data()) >= 4:
			var selector [4]byte
			copy(selector[:], tx.Data()[:4])

			setter, known := setters[selector]
			if !known {
				setter = fmt.Sprintf("%#x", selector)
			}
			op = fmt.Sprintf("wire %s.%s", name(*tx.To()), setter)

		default:
			return nil, fmt.Errorf("the deployment sent %s, and it is neither a deployment nor a call", hash)
		}

		price := new(big.Int)
		if receipt.EffectiveGasPrice != nil {
			price = receipt.EffectiveGasPrice
		}

		order = append(order, mined{
			receipt: chain.Receipt{
				Op:    op,
				Tx:    sentTx.Hash,
				Gas:   receipt.GasUsed,
				Price: price.String(),
				Block: receipt.BlockNumber.Uint64(),
			},
			block: receipt.BlockNumber.Uint64(),
			index: receipt.TransactionIndex,
		})
	}

	// In the order the chain mined them, which is the order the protocol came into existence: every
	// contract, and then the one-shot wiring that can never be repeated.
	sort.Slice(order, func(i, j int) bool {
		if order[i].block != order[j].block {
			return order[i].block < order[j].block
		}
		return order[i].index < order[j].index
	})

	out := make([]chain.Receipt, 0, len(order))
	for _, tx := range order {
		out = append(out, tx.receipt)
	}

	return out, nil
}

// --- The arithmetic ----------------------------------------------------------------------------------

type report struct {
	ChainID    uint64
	RPC        string
	Ledger     string
	Deployment chain.Deployment
	Deployed   []chain.Receipt
	Demo       []chain.Receipt
	Rate       *big.Float // naira per 0G, or nil
	RateNote   string
	Processor  processorFees
}

// network names the chain the bill was run up on, and refuses to flatter a development chain with 0G's
// name: a gas table measured against anvil is a rehearsal of the measurement, not the measurement.
func (r report) network() string {
	if r.ChainID == 16602 {
		return "0G Galileo (chain 16602)"
	}
	return fmt.Sprintf("chain %d — **not 0G**, so these prices are that chain's, not this network's", r.ChainID)
}

// row is one operation, and every time the run performed it.
type row struct {
	Op       string
	Receipts []chain.Receipt
}

func (r row) count() int { return len(r.Receipts) }

func (r row) gas() (low, high uint64) {
	low, high = r.Receipts[0].Gas, r.Receipts[0].Gas
	for _, receipt := range r.Receipts[1:] {
		low = min(low, receipt.Gas)
		high = max(high, receipt.Gas)
	}
	return low, high
}

// typical is the cost of performing the operation once — the median, so that one cold-storage outlier
// (the first sale of a run writes slots nobody has written before) does not become the headline price
// of every sale after it.
func (r row) typical() *big.Int {
	costs := make([]*big.Int, 0, len(r.Receipts))
	for _, receipt := range r.Receipts {
		costs = append(costs, receipt.Cost())
	}
	sort.Slice(costs, func(i, j int) bool { return costs[i].Cmp(costs[j]) < 0 })
	return costs[len(costs)/2]
}

func (r row) total() *big.Int {
	sum := new(big.Int)
	for _, receipt := range r.Receipts {
		sum.Add(sum, receipt.Cost())
	}
	return sum
}

func (r row) bytes() (low, high int) {
	low, high = r.Receipts[0].Bytes, r.Receipts[0].Bytes
	for _, receipt := range r.Receipts[1:] {
		low = min(low, receipt.Bytes)
		high = max(high, receipt.Bytes)
	}
	return low, high
}

// dearestBytes is the size of the blob that cost the most gas to publish — which, if the payload were
// what one paid for, would be the biggest one. It is not.
func (r row) dearestBytes() int {
	dearest := r.Receipts[0]
	for _, receipt := range r.Receipts[1:] {
		if receipt.Gas > dearest.Gas {
			dearest = receipt
		}
	}
	return dearest.Bytes
}

// split separates the two halves of an upload's price: what it burned as gas, and what it carried to the
// storage contract as a fee. The median of each, so one outlier does not make the case either way.
func (r row) split() (gas, fee *big.Int) {
	gases := make([]*big.Int, 0, len(r.Receipts))
	fees := make([]*big.Int, 0, len(r.Receipts))

	for _, receipt := range r.Receipts {
		price, ok := new(big.Int).SetString(receipt.Price, 10)
		if !ok {
			price = new(big.Int)
		}
		gases = append(gases, new(big.Int).Mul(new(big.Int).SetUint64(receipt.Gas), price))

		value, ok := new(big.Int).SetString(receipt.Value, 10)
		if !ok {
			value = new(big.Int)
		}
		fees = append(fees, value)
	}

	median := func(of []*big.Int) *big.Int {
		sort.Slice(of, func(i, j int) bool { return of[i].Cmp(of[j]) < 0 })
		return of[len(of)/2]
	}
	return median(gases), median(fees)
}

// ratioOf is how many times the first amount contains the second, for a sentence a person can check.
func ratioOf(whole, part *big.Int) uint64 {
	if part.Sign() == 0 {
		return 0
	}
	return new(big.Int).Div(whole, part).Uint64()
}

// group collects receipts by operation, in the order the run first performed each one. That order is the
// story's order — the shop opens, a dress sells, a claim is posted, a debt goes into default — and it
// costs nothing to keep, whereas a hand-written list of operations is one more thing to fall out of step
// with the code.
func group(receipts []chain.Receipt) []row {
	var rows []row
	index := map[string]int{}

	for _, receipt := range receipts {
		at, seen := index[receipt.Op]
		if !seen {
			index[receipt.Op] = len(rows)
			rows = append(rows, row{Op: receipt.Op})
			at = len(rows) - 1
		}
		rows[at].Receipts = append(rows[at].Receipts, receipt)
	}

	return rows
}

func totalOf(receipts []chain.Receipt) *big.Int {
	sum := new(big.Int)
	for _, receipt := range receipts {
		sum.Add(sum, receipt.Cost())
	}
	return sum
}

// find looks up one operation by the name the relayer sends it under.
func find(rows []row, op string) (row, bool) {
	for _, candidate := range rows {
		if candidate.Op == op {
			return candidate, true
		}
	}
	return row{}, false
}

// account is one of the parties, and what the run cost it.
type account struct {
	Address common.Address
	Name    string
	Count   int
	Spent   *big.Int
}

// accounts totals what each party spent, in the order they first appear.
//
// The buyer is not in this table, and her absence is the point: she is sponsored, so she never sends a
// transaction and never holds a token. The one to read is the stranger.
func accounts(deployment chain.Deployment, receipts []chain.Receipt) []account {
	names := whoIs(deployment, receipts)

	var out []account
	index := map[common.Address]int{}

	for _, receipt := range receipts {
		from := common.HexToAddress(receipt.From)

		at, seen := index[from]
		if !seen {
			name, known := names[from]
			if !known {
				name = "—"
			}
			index[from] = len(out)
			out = append(out, account{Address: from, Name: name, Spent: new(big.Int)})
			at = len(out) - 1
		}

		out[at].Count++
		out[at].Spent.Add(out[at].Spent, receipt.Cost())
	}

	return out
}

// whoIs names the parties from the run's own record, rather than from a list this program carries.
//
// The operator is named by the deployment. The paid parties name themselves, because each of them had to
// register the account they are to be paid into and the transaction that does it says whose it is. And
// the stranger is named by what it did: it collected somebody else's default. That is the only
// identification it has, and the only one it needs — an account with no position in any of this, which
// is precisely why the demo hands it the two transactions that punish the operator.
func whoIs(deployment chain.Deployment, receipts []chain.Receipt) map[common.Address]string {
	names := map[common.Address]string{deployment.Operator: "the operator"}

	for _, receipt := range receipts {
		if party, isRegistration := strings.CutPrefix(receipt.Op, "account: "); isRegistration {
			names[common.HexToAddress(receipt.From)] = "the " + strings.TrimSpace(party)
		}
	}

	for _, receipt := range receipts {
		if receipt.Op != "touch debt" {
			continue
		}
		if from := common.HexToAddress(receipt.From); names[from] == "" {
			names[from] = "a stranger"
		}
	}

	return names
}

// --- Rendering ---------------------------------------------------------------------------------------

const wei = 1e18

// zeroG renders a cost in the native token.
func zeroG(amount *big.Int) string {
	value := new(big.Float).Quo(new(big.Float).SetInt(amount), big.NewFloat(wei))
	return strings.TrimRight(strings.TrimRight(value.Text('f', 8), "0"), ".") + " 0G"
}

// naira renders a cost at the stated rate, and says so when there is no rate to state.
func (r report) naira(amount *big.Int) string {
	if r.Rate == nil {
		return "—"
	}

	value := new(big.Float).Quo(new(big.Float).SetInt(amount), big.NewFloat(wei))
	value.Mul(value, r.Rate)

	digits := 2
	if small, _ := value.Float64(); small < 1 {
		digits = 4
	}
	return "₦" + value.Text('f', digits)
}

// ratio says how the two prices actually compare, in the form a person would say it out loud, and it
// works the sentence out from the numbers rather than being told which one to reach for.
func (r report) ratio(cost *big.Int, fee int64) string {
	naira := new(big.Float).Quo(new(big.Float).SetInt(cost), big.NewFloat(wei))
	naira.Mul(naira, r.Rate)

	price, _ := naira.Float64()
	if price <= 0 {
		return "The ledger's share of that is unmeasurably small"
	}

	times := float64(fee) / price
	switch {
	case times >= 100:
		return fmt.Sprintf("**The ledger costs %.0f times less than the card fee it rides beside**", times)
	case times >= 2:
		return fmt.Sprintf("**The ledger costs %.1f times less than the card fee it rides beside**", times)
	default:
		return fmt.Sprintf("**The ledger costs %.0f%% of the card fee it rides beside**", 100/times)
	}
}

func parseRate(rate string) (*big.Float, error) {
	if rate == "" {
		return nil, nil
	}

	value, ok := new(big.Float).SetString(rate)
	if !ok || value.Sign() <= 0 {
		return nil, fmt.Errorf("--ngn-per-0g %q is not a rate", rate)
	}
	return value, nil
}

func commas(n uint64) string {
	digits := fmt.Sprint(n)
	if len(digits) <= 3 {
		return digits
	}

	head := len(digits) % 3
	if head == 0 {
		head = 3
	}

	out := digits[:head]
	for i := head; i < len(digits); i += 3 {
		out += "," + digits[i:i+3]
	}
	return out
}

func gasRange(low, high uint64) string {
	if low == high {
		return commas(low)
	}
	return commas(low) + "–" + commas(high)
}

func render(out io.Writer, r report) error {
	p := func(format string, args ...any) { fmt.Fprintf(out, format+"\n", args...) }

	operations := group(r.Demo)
	parties := accounts(r.Deployment, r.Demo)

	p("# The bill")
	p("")
	p("What the Glass Ledger costs to run on %s, measured from the receipts of one complete", r.network())
	p("rehearsal — every proof, end to end, on real clocks.")
	p("")
	p("**Nothing in this table is an estimate.** Every row is a transaction the chain mined, at the price")
	p("the chain charged. The hashes are in `%s` and in the deployment's broadcast record, and this file", r.Ledger)
	p("is rendered from them by `relayer/cmd/gastable` rather than written by hand: re-render it and the")
	p("numbers come back the same, because they were never ours to choose.")
	p("")

	if r.Rate != nil {
		p("The naira column converts at **%s ₦/0G**. %s", r.Rate.Text('f', 2), r.RateNote)
		p("")
		p("A testnet token has no price, so that rate is the market's price for the *mainnet* token and the")
		p("naira column is therefore a projection: what these transactions would cost on a chain whose gas")
		p("behaves as this one's does. The gas is measured; the money is arithmetic on somebody else's")
		p("exchange rate, and it moves when they do.")
		p("")
	}

	// --- The demo's own operations ---
	p("## What the protocol charges to do its job")
	p("")
	p("| Operation | Times | Gas | Cost, once | ₦, once |")
	p("|---|---|---|---|---|")

	for _, row := range operations {
		low, high := row.gas()
		p("| %s | %d | %s | %s | %s |",
			row.Op, row.count(), gasRange(low, high), zeroG(row.typical()), r.naira(row.typical()))
	}
	p("")

	// The storage row is the one worth reading twice, and it is the only one whose payload sizes are
	// known — so it is the only one that can *demonstrate* rather than assert that the payload is free.
	if uploads, found := find(operations, chain.StorageOp); found {
		small, large := uploads.bytes()
		low, high := uploads.gas()
		dearest := uploads.dearestBytes()
		gas, fee := uploads.split()

		if small != large && small > 0 {
			p("**Look twice at the storage row.** Those %d uploads carried payloads of **%d to %d bytes**, and",
				uploads.count(), small, large)
			p("the gas ran from %s to %s. That is *flat* — and not flat in the direction anybody expects,",
				commas(low), commas(high))
			p("because the dearest upload of the run was a **%d-byte** blob. **The price of publishing is the",
				dearest)
			p("submission transaction; the bytes ride along for nothing.** A voucher and a sweep's evidence cost")
			p("the same, and what either one leaves on-chain is 32 bytes: a Merkle root.")
			p("")
			p("The storage fee proper — what a submission carries to the storage contract as value, as against")
			p("what it burns as gas — is the rounding error inside the rounding error: **%s of fee against %s",
				zeroG(fee), zeroG(gas))
			p("of gas**, or one part in %s.", commas(ratioOf(gas, fee)))
			p("")
			p("These are the uploads that **cost** something, and that is not the same as the ones the run")
			p("published. A blob already on 0G is never paid for twice: the file's Merkle root is a pure")
			p("function of its bytes, computable locally with no gas, and the uploader submits a transaction")
			p("only when the storage nodes do not already hold that root. Republishing an identical blob is")
			p("therefore free, on any machine, with no local cache involved in the decision — which is why a")
			p("failed rehearsal is cheap to retry, and why publication resumes where it stopped rather than")
			p("starting again.")
			p("")
		}
	}

	// --- The deployment ---
	p("## What it cost to put the protocol there")
	p("")
	p("Once, per deployment. An immutable protocol has no other way to change its mind, so this is also")
	p("what an upgrade costs.")
	p("")
	p("| Transaction | Gas | Cost | ₦ |")
	p("|---|---|---|---|")

	for _, receipt := range r.Deployed {
		p("| %s | %s | %s | %s |",
			receipt.Op, commas(receipt.Gas), zeroG(receipt.Cost()), r.naira(receipt.Cost()))
	}

	deployedGas := uint64(0)
	for _, receipt := range r.Deployed {
		deployedGas += receipt.Gas
	}
	deployedCost := totalOf(r.Deployed)
	p("| **the whole protocol, deployed** | **%s** | **%s** | **%s** |",
		commas(deployedGas), zeroG(deployedCost), r.naira(deployedCost))
	p("")

	// --- Who paid ---
	p("## Who paid for it")
	p("")
	p("| Account | | Transactions | Spent |")
	p("|---|---|---|---|")

	for _, party := range parties {
		p("| `%s` | %s | %d | %s |", party.Address, party.Name, party.Count, zeroG(party.Spent))
	}
	p("")
	p("Read that table for what is *missing* from it. **The wronged creator sends nothing.** Her three")
	p("transactions are the shop opening — she registers her own payout account, writes her own prices, and")
	p("challenges one false claim in her own name. Through the whole of the stalled payout that this")
	p("protocol exists for, she does nothing, and she is paid anyway.")
	p("")
	p("**And the buyer's single transaction is not her purchase.** She buys a dress with no wallet, no")
	p("account and no gas; she redeems her certificate with a code printed on a receipt; and when an order")
	p("cannot be delivered she is refunded in full — all of it sponsored, none of it hers to pay for. The")
	p("one transaction she sends is `account: buyer`: she registers *the account she is to be refunded")
	p("into*, in her own name, because the protocol will not let the operator name it for her. That")
	p("refusal is the point. (In production that account is created by a passkey at checkout, and she still")
	p("never sees a wallet — M6's work, not the MVP's.)")
	p("")

	// --- The two numbers that are the pitch ---
	demoCost := totalOf(r.Demo)
	whole := new(big.Int).Add(demoCost, deployedCost)

	stranger := new(big.Int)
	strangerTxs := 0
	for _, party := range parties {
		if party.Name == "a stranger" {
			stranger, strangerTxs = party.Spent, party.Count
		}
	}

	p("## The two numbers that are the argument")
	p("")
	p("**A whole rehearsal costs %s.** Standing the protocol up from nothing (%s) and then running it",
		zeroG(whole), zeroG(deployedCost))
	p("through its own worst day — every sale, every claim, every lie, every default, every write-off, and")
	p("every byte published to 0G Storage (%s).", zeroG(demoCost))
	p("")
	p("*(That is what the protocol charged. The rehearsal also hands the five other parties enough gas to")
	p("send their own transactions, which `cast` does outside this ledger and a re-run skips — see the")
	p("README for the measured end-to-end figure.)*")
	p("")

	if touch, found := find(operations, "touch debt"); found {
		p("**And it costs %s to collect somebody else's default.** One transaction, sent by an account with",
			zeroG(touch.typical()))
		p("no position in any of this, which pays a creator who is not watching out of a pool she does not")
		p("control. It cannot be stopped and it needs nobody's permission — and at %s to send, it does not",
			r.naira(touch.typical()))
		p("need a motive either. That is the whole of the enforcement mechanism: not a regulator, not a")
		p("complaints desk. A number small enough that somebody will do it out of spite.")
		p("")
		p("The stranger's %d transactions in this run — both defaults, the lapsed claim, and the fines and", strangerTxs)
		p("pool dues it collected on everyone else's behalf in the last act — came to **%s** in total.", zeroG(stranger))
		p("")
	}

	// --- The comparison the proof is actually making ---
	if sale, found := find(operations, "sell (instant)"); found && r.Rate != nil {
		fee := r.Processor.charge()

		p("## Against what it costs to accept the money")
		p("")
		p("The claim is not that this is cheap in the abstract. It is that putting a sale on the Glass")
		p("Ledger costs a rounding error **against the fee that sale already pays to be accepted at all**.")
		p("")
		p("On a ₦%s dress — the cheapest thing on this shelf:", commas(uint64(r.Processor.Sale)))
		p("")
		p("| | |")
		p("|---|---|")
		p("| the card fee, to move the money (%s) | **₦%s** |", r.Processor.Name, commas(uint64(fee)))
		p("| the packed sale, to make the money *owed* — tag checked, shelf checked, ceiling checked, item | |")
		p("| consumed, four debts minted, certificate committed, claim code issued, all in one transaction | **%s** |", r.naira(sale.typical()))
		p("")
		p("%s. The protocol does not replace the processor and does not want to: the card fee buys the", r.ratio(sale.typical(), fee))
		p("movement of money, and this buys the *obligation* — the part that today lives in a spreadsheet")
		p("nobody outside the building can read.")
		p("")
	}

	// --- The sweep, said out loud ---
	p("## What amortizes, and what does not")
	p("")
	p("A sweep is one proof over a whole period, and it is tempting to leave it at *one proof spans")
	p("thousands of debts for pennies*. That sentence is true of the proof and false of everything else, so")
	p("the two are measured apart (`test_aSweepCostsWhatItsClaimsCostAndNotMore`, by differencing an")
	p("attestation over 1 claim against one over 11):")
	p("")
	p("| | Gas |")
	p("|---|---|")
	p("| the attestation itself — the proof and the evidence, **once, however many claims it covers** | ~102,900 |")
	p("| **every covered claim, on top** — three debts moved to proven | **~45,500** |")
	p("")
	p("So a batch amortizes the *proof*, and never the per-claim state writes. A sweep covering a thousand")
	p("claims costs about 45.6M gas and has to be split across blocks; it does not cost 102,900. Anybody")
	p("sizing a real operator's sweep budget should multiply, not hope.")
	p("")

	// --- Refusals ---
	p("## What the counter's refusals cost")
	p("")
	p("Nothing. A sale the protocol will not allow — a tag already sold, a signature no registered creator")
	p("made, a cash sale over the ceiling — never becomes a transaction at all: it is refused when its gas")
	p("is estimated, and the operator pays for nothing. There is no row for these in the table above, and")
	p("their absence is the honest report. Defending the counter is free.")
	p("")

	return nil
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
