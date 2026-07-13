package chain

import (
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
)

// Client is the operator's connection to the chain.
type Client struct {
	ETH     *ethclient.Client
	RPC     *rpc.Client
	ChainID *big.Int

	// DevTime lets the demo move a development chain's clock forward instead of waiting for it.
	//
	// The windows are minutes here and days in production, and they run through *identical code*: the
	// contracts take them as constructor arguments and know nothing about which profile they were
	// given. What differs on a development chain is only that its clock does not run on its own, so a
	// three-minute settlement window would otherwise take three minutes of an audience's life. On a
	// real network this is false and the demo waits, because there the clock runs without help.
	DevTime bool

	// Gas is the bill, if anybody is keeping one. Every transaction below passes through Send, so this
	// is the one place a run's true cost can be recorded without a caller having to remember to.
	Gas *GasLedger

	reverts *Reverts
}

// TxFn submits one transaction through a generated binding.
type TxFn func(*bind.TransactOpts) (*types.Transaction, error)

// Dial connects to any RPC endpoint — anvil or a public node. Nothing in this client is specific to
// a network: the demo profile and the production profile differ in their parameters, never in code.
func Dial(ctx context.Context, rpcURL string) (*Client, error) {
	client, err := rpc.DialContext(ctx, rpcURL)
	if err != nil {
		return nil, fmt.Errorf("dial %s: %w", rpcURL, err)
	}

	eth := ethclient.NewClient(client)
	chainID, err := eth.ChainID(ctx)
	if err != nil {
		eth.Close()
		return nil, fmt.Errorf("chain id: %w", err)
	}

	return &Client{ETH: eth, RPC: client, ChainID: chainID, reverts: NewReverts()}, nil
}

func (c *Client) Close() { c.ETH.Close() }

// Auth builds the signing options for one key.
func (c *Client) Auth(key *ecdsa.PrivateKey) (*bind.TransactOpts, error) {
	return bind.NewKeyedTransactorWithChainID(key, c.ChainID)
}

// Send submits a transaction and waits for it to be mined, returning a decoded custom error if the
// chain refuses it.
//
// A refusal is not a failure of the relayer: half the demo consists of transactions the protocol is
// supposed to reject, and the audience needs to see *which* rule rejected them. So the revert data is
// decoded against the contracts' own ABIs and surfaced by name — `OverCeiling(exposure, headroom)`,
// not "execution reverted".
func (c *Client) Send(ctx context.Context, key *ecdsa.PrivateKey, label string, call TxFn) (*types.Receipt, error) {
	auth, err := c.Auth(key)
	if err != nil {
		return nil, err
	}
	auth.Context = ctx

	tx, err := call(auth)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", label, c.reverts.Wrap(err))
	}

	receipt, err := bind.WaitMined(ctx, c.ETH, tx)
	if err != nil {
		return nil, fmt.Errorf("%s: waiting for %s: %w", label, tx.Hash(), err)
	}
	if receipt.Status != types.ReceiptStatusSuccessful {
		return nil, fmt.Errorf("%s: reverted on-chain (tx %s)", label, tx.Hash())
	}

	// The label the caller passed to name this transaction in an error message is the same label the
	// gas table files it under. There is no second list of operation names to fall out of step with the
	// code, and no operation that can be sent without appearing on the bill.
	if err := c.record(label, Address(key), receipt); err != nil {
		return nil, fmt.Errorf("%s: recording what it cost: %w", label, err)
	}

	return receipt, nil
}

// MustRevert runs a call that the protocol is expected to refuse, and returns the rule that refused
// it. A call that *succeeds* here is the failure: it means a guard the demo is asserting is gone.
func (c *Client) MustRevert(ctx context.Context, key *ecdsa.PrivateKey, label string, call TxFn) (string, error) {
	_, err := c.Send(ctx, key, label, call)
	if err == nil {
		return "", fmt.Errorf("%s: expected the protocol to refuse this, and it did not", label)
	}

	var refusal *Refusal
	if !errors.As(err, &refusal) {
		return "", fmt.Errorf("%s: refused, but not by a named rule: %w", label, err)
	}

	return refusal.Error(), nil
}

// Now reads the chain's clock. Every deadline in this protocol is wall-clock, so the demo waits
// against the chain's time and never against the host's.
func (c *Client) Now(ctx context.Context) (uint64, error) {
	header, err := c.ETH.HeaderByNumber(ctx, nil)
	if err != nil {
		return 0, err
	}
	return header.Time, nil
}

// WaitUntil blocks until the chain's clock is past `deadline` — the moment at which a window has run
// out and the arithmetic the protocol runs on becomes true.
//
// Nothing here decides anything. A debt is not in default because the relayer waited; it is in default
// because its deadline passed, and it would be in default if this program had never been written. All
// this does is arrive after the fact so that somebody can go and collect it.
func (c *Client) WaitUntil(ctx context.Context, deadline uint64) error {
	for {
		now, err := c.Now(ctx)
		if err != nil {
			return err
		}
		if now > deadline {
			return nil
		}

		if c.DevTime {
			if err := c.advanceTime(ctx, deadline-now+1); err != nil {
				return err
			}
			continue
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

// advanceTime moves a development chain's clock forward and mines a block to make it so.
func (c *Client) advanceTime(ctx context.Context, seconds uint64) error {
	var ignored json.RawMessage
	if err := c.RPC.CallContext(ctx, &ignored, "evm_increaseTime", seconds); err != nil {
		return fmt.Errorf("advancing the clock: %w (is this a development chain?)", err)
	}
	return c.RPC.CallContext(ctx, &ignored, "evm_mine")
}
