package chain

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"

	"goodhouse/relayer/internal/chain/bindings"
)

// Deployment is where the protocol lives, as written by the deployment script.
//
// The relayer never deploys. One definition of the deployment exists — the Solidity script — and it
// is the one the contract test suite exercises, wiring order and one-shot setters included. A second
// deployment path in Go would be a second definition of the protocol's shape, and the two would drift
// on the first day somebody changed a constructor.
type Deployment struct {
	ChainID           uint64         `json:"chainId"`
	Operator          common.Address `json:"operator"`
	OperatorRecipient common.Address `json:"operatorRecipient"`

	Registry common.Address `json:"registry"`
	Items    common.Address `json:"items"`
	Prices   common.Address `json:"prices"`
	Proofs   common.Address `json:"proofs"`
	Debts    common.Address `json:"debts"`
	Sweep    common.Address `json:"sweep"`
	NGN      common.Address `json:"ngn"`
	Ceiling  common.Address `json:"ceiling"`
	Pool     common.Address `json:"pool"`
	Gateway  common.Address `json:"gateway"`
}

// LoadDeployment reads the addresses the deployment script published.
func LoadDeployment(path string) (Deployment, error) {
	var d Deployment

	raw, err := os.ReadFile(path)
	if err != nil {
		return d, fmt.Errorf("reading deployment %s: %w", path, err)
	}
	if err := json.Unmarshal(raw, &d); err != nil {
		return d, fmt.Errorf("parsing deployment %s: %w", path, err)
	}
	if d.Gateway == (common.Address{}) {
		return d, fmt.Errorf("deployment %s: no gateway address", path)
	}

	return d, nil
}

// Contracts is every contract the operator has to talk to, bound and ready.
type Contracts struct {
	Registry *bindings.CreatorRegistry
	Items    *bindings.ItemLedger
	Prices   *bindings.PriceBook
	Proofs   *bindings.StubProofVerifier
	Debts    *bindings.DebtLedger
	Sweep    *bindings.SweepRegistry
	NGN      *bindings.MockNGN
	Ceiling  *bindings.Allowance
	Pool     *bindings.Pool
	Gateway  *bindings.SaleGateway

	Addresses Deployment
}

// Bind attaches the generated bindings to a deployment.
func Bind(d Deployment, backend bind.ContractBackend) (*Contracts, error) {
	registry, err := bindings.NewCreatorRegistry(d.Registry, backend)
	if err != nil {
		return nil, err
	}
	items, err := bindings.NewItemLedger(d.Items, backend)
	if err != nil {
		return nil, err
	}
	prices, err := bindings.NewPriceBook(d.Prices, backend)
	if err != nil {
		return nil, err
	}
	proofs, err := bindings.NewStubProofVerifier(d.Proofs, backend)
	if err != nil {
		return nil, err
	}
	debts, err := bindings.NewDebtLedger(d.Debts, backend)
	if err != nil {
		return nil, err
	}
	sweep, err := bindings.NewSweepRegistry(d.Sweep, backend)
	if err != nil {
		return nil, err
	}
	ngn, err := bindings.NewMockNGN(d.NGN, backend)
	if err != nil {
		return nil, err
	}
	ceiling, err := bindings.NewAllowance(d.Ceiling, backend)
	if err != nil {
		return nil, err
	}
	pool, err := bindings.NewPool(d.Pool, backend)
	if err != nil {
		return nil, err
	}
	gateway, err := bindings.NewSaleGateway(d.Gateway, backend)
	if err != nil {
		return nil, err
	}

	return &Contracts{
		Registry:  registry,
		Items:     items,
		Prices:    prices,
		Proofs:    proofs,
		Debts:     debts,
		Sweep:     sweep,
		NGN:       ngn,
		Ceiling:   ceiling,
		Pool:      pool,
		Gateway:   gateway,
		Addresses: d,
	}, nil
}
