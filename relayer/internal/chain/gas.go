package chain

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

// StorageOp is the name a 0G Storage upload is filed under.
//
// It is a constant rather than a string typed in two places because two programs have to agree on it: the
// one that writes the bill, and the one that reads it back and has something to say about that particular
// row. A renderer that missed the storage rows because a word had been changed under it would quietly
// drop the one operation the seventh proof is about.
const StorageOp = "publish a blob to 0G Storage"

// Receipt is what one transaction cost, filed under the name of the operation that sent it.
//
// The seventh proof is a number, and a number nobody can reproduce is a slogan. So every transaction
// this relayer sends leaves one of these behind, taken from the chain's own receipt — the gas the chain
// charged and the price it charged it at, never an estimate and never a quote. The gas table is then
// rendered from the file rather than typed by hand, which means it cannot drift from what the network
// actually did, and anybody who doubts a row can look the transaction up by its hash.
type Receipt struct {
	Op    string `json:"op"`
	From  string `json:"from"`
	Tx    string `json:"tx"`
	Gas   uint64 `json:"gas"`
	Price string `json:"gasPrice"` // wei per unit of gas: what the receipt says was paid, not what was bid

	// Value is what the transaction carried, and it is set only where the transfer is part of the price
	// of the operation rather than the point of it: a 0G Storage submission pays the storage contract a
	// fee on top of its gas, and an upload's true cost is the two together.
	Value string `json:"value,omitempty"`

	// Bytes is the size of a published blob. It is here to be looked at rather than used: the claim that
	// an upload's price is the transaction and not the payload is only worth making if the payload sizes
	// sit in the table beside the gas.
	Bytes int `json:"bytes,omitempty"`

	Block uint64 `json:"block"`
}

// Cost is gas × price, plus whatever the transaction had to carry in order to do its job.
func (r Receipt) Cost() *big.Int {
	price, ok := new(big.Int).SetString(r.Price, 10)
	if !ok {
		price = new(big.Int)
	}

	cost := new(big.Int).Mul(new(big.Int).SetUint64(r.Gas), price)

	if r.Value != "" {
		if value, ok := new(big.Int).SetString(r.Value, 10); ok {
			cost.Add(cost, value)
		}
	}
	return cost
}

// GasLedger is the record of what a run cost: one JSON object per line, appended as each transaction is
// mined.
//
// It is appended rather than written at the end because a rehearsal on a public chain takes twenty
// minutes and can fail in the nineteenth. A run that dies in the last act has still spent everything it
// spent, and the receipts are the most expensive thing in the building — they are not going to be held
// in memory until a process that may not survive gets around to saving them.
type GasLedger struct {
	mu   sync.Mutex
	path string
}

// NewGasLedger opens the ledger for a chain's data directory. A nil ledger records nothing and is a
// legitimate state: the relayer's service has no business writing the demo's bill.
func NewGasLedger(path string) *GasLedger { return &GasLedger{path: path} }

// GasLedgerPath is where a chain's receipts live: beside the consignment they paid for.
func GasLedgerPath(dataDir string) string { return filepath.Join(dataDir, "gas.jsonl") }

// Record appends one receipt.
func (l *GasLedger) Record(r Receipt) error {
	if l == nil {
		return nil
	}

	line, err := json.Marshal(r)
	if err != nil {
		return err
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(l.path), 0o755); err != nil {
		return err
	}

	file, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}

	if _, err := file.Write(append(line, '\n')); err != nil {
		file.Close()
		return err
	}
	return file.Close()
}

// Reset starts a fresh ledger, and the seed calls it when it opens a fresh shop.
//
// The receipts belong to the consignment that paid for them. A second deployment on the same chain is a
// different shop, with different contracts and a different shelf, and mixing its bill with the last
// one's would produce a gas table that averages two runs and describes neither.
func (l *GasLedger) Reset() error {
	if l == nil {
		return nil
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(l.path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(l.path, nil, 0o644)
}

// LoadGasLedger reads a run's receipts back.
func LoadGasLedger(path string) ([]Receipt, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading the gas ledger %s (has the demo been run?): %w", path, err)
	}

	var out []Receipt

	decoder := json.NewDecoder(bytes.NewReader(raw))
	for decoder.More() {
		var receipt Receipt
		if err := decoder.Decode(&receipt); err != nil {
			return nil, fmt.Errorf("parsing %s: %w", path, err)
		}
		out = append(out, receipt)
	}

	return out, nil
}

// record files a mined transaction under the name of the operation that sent it.
func (c *Client) record(op string, from common.Address, receipt *types.Receipt) error {
	return c.Gas.Record(Receipt{
		Op:    op,
		From:  from.Hex(),
		Tx:    receipt.TxHash.Hex(),
		Gas:   receipt.GasUsed,
		Price: effectivePrice(receipt).String(),
		Block: receipt.BlockNumber.Uint64(),
	})
}

// RecordStorage files a 0G Storage submission — a transaction this relayer did not send itself.
//
// An upload goes out through the storage client rather than through Send, so its receipt is fetched
// back by hash. Two numbers make its price: the gas, like any transaction, and the fee the submission
// carries to the storage contract as value. Reporting only the gas would understate what publishing a
// voucher costs, and the entire purpose of this ledger is that nobody has to take the number on trust.
func (c *Client) RecordStorage(ctx context.Context, op string, size int, hash common.Hash) error {
	if c.Gas == nil {
		return nil
	}

	// Asked more than once, because this endpoint is load-balanced and will occasionally deny knowing a
	// transaction it has already mined. The storage client waited for this very receipt before it
	// returned, so the transaction is certainly there; a node that says otherwise is behind, not right.
	var receipt *types.Receipt
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		if receipt, err = c.ETH.TransactionReceipt(ctx, hash); err == nil {
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	if err != nil {
		return fmt.Errorf("the storage submission %s was sent but its receipt could not be read: %w", hash, err)
	}

	tx, _, err := c.ETH.TransactionByHash(ctx, hash)
	if err != nil {
		return fmt.Errorf("reading the storage submission %s: %w", hash, err)
	}

	// The sender is recovered from the signature rather than assumed to be the operator: this is the one
	// transaction in the run that the relayer did not sign itself, and a bill is worth nothing if it does
	// not say whose account the money left.
	from, err := types.Sender(types.LatestSignerForChainID(c.ChainID), tx)
	if err != nil {
		return fmt.Errorf("reading the sender of the storage submission %s: %w", hash, err)
	}

	return c.Gas.Record(Receipt{
		Op:    op,
		From:  from.Hex(),
		Tx:    hash.Hex(),
		Gas:   receipt.GasUsed,
		Price: effectivePrice(receipt).String(),
		Value: tx.Value().String(),
		Bytes: size,
		Block: receipt.BlockNumber.Uint64(),
	})
}

// effectivePrice is what the chain actually charged per unit of gas.
func effectivePrice(receipt *types.Receipt) *big.Int {
	if receipt.EffectiveGasPrice == nil {
		return new(big.Int)
	}
	return receipt.EffectiveGasPrice
}
