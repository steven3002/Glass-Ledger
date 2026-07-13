package chain

import (
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"

	"goodhouse/relayer/internal/chain/bindings"
)

// Refusal is the protocol declining to do something, by name.
//
// The contracts revert with custom errors and never with strings, because an error's name is part of
// the public interface: `AlreadySold`, `OverCeiling`, `NotDefaulted` are sentences a counter clerk or
// a ledger view can show a person. This type is where those sentences are recovered from the raw
// four bytes the chain returns.
type Refusal struct {
	Name string
	Args []any
}

func (r *Refusal) Error() string {
	if len(r.Args) == 0 {
		return r.Name
	}

	parts := make([]string, len(r.Args))
	for i, arg := range r.Args {
		parts[i] = fmt.Sprint(arg)
	}
	return fmt.Sprintf("%s(%s)", r.Name, strings.Join(parts, ", "))
}

// Reverts decodes revert data against the errors the contracts actually declare.
type Reverts struct {
	bySelector map[[4]byte]abi.Error
}

// NewReverts loads every custom error in the deployment. The list is built from the contracts' own
// ABIs, so an error added to a contract is decodable here the moment the bindings are regenerated —
// there is no second copy of the error list to fall out of date.
func NewReverts() *Reverts {
	r := &Reverts{bySelector: make(map[[4]byte]abi.Error)}

	for _, meta := range []string{
		bindings.CreatorRegistryMetaData.ABI,
		bindings.ItemLedgerMetaData.ABI,
		bindings.PriceBookMetaData.ABI,
		bindings.DebtLedgerMetaData.ABI,
		bindings.SweepRegistryMetaData.ABI,
		bindings.StubProofVerifierMetaData.ABI,
		bindings.SaleGatewayMetaData.ABI,
		bindings.AllowanceMetaData.ABI,
		bindings.PoolMetaData.ABI,
		bindings.MockNGNMetaData.ABI,
	} {
		parsed, err := abi.JSON(strings.NewReader(meta))
		if err != nil {
			continue
		}
		for _, declared := range parsed.Errors {
			var selector [4]byte
			copy(selector[:], declared.ID.Bytes()[:4])
			r.bySelector[selector] = declared
		}
	}

	return r
}

// Wrap turns an RPC error carrying revert data into a named Refusal, and leaves anything else alone.
func (r *Reverts) Wrap(err error) error {
	data, ok := revertData(err)
	if !ok {
		return err
	}

	refusal := r.Decode(data)
	if refusal == nil {
		return err
	}
	return refusal
}

// Decode reads the four-byte selector and unpacks the error's arguments.
func (r *Reverts) Decode(data []byte) *Refusal {
	if len(data) < 4 {
		return nil
	}

	var selector [4]byte
	copy(selector[:], data[:4])

	declared, known := r.bySelector[selector]
	if !known {
		return nil
	}

	args, err := declared.Inputs.Unpack(data[4:])
	if err != nil {
		return &Refusal{Name: declared.Name}
	}
	return &Refusal{Name: declared.Name, Args: args}
}

// revertData digs the returned bytes out of whatever shape the node put them in.
func revertData(err error) ([]byte, bool) {
	type dataError interface{ ErrorData() any }

	var carrier dataError
	for err != nil {
		if candidate, ok := err.(dataError); ok {
			carrier = candidate
			break
		}
		unwrapped, ok := err.(interface{ Unwrap() error })
		if !ok {
			return nil, false
		}
		err = unwrapped.Unwrap()
	}
	if carrier == nil {
		return nil, false
	}

	encoded, ok := carrier.ErrorData().(string)
	if !ok {
		return nil, false
	}

	raw, decodeErr := hex.DecodeString(strings.TrimPrefix(encoded, "0x"))
	if decodeErr != nil {
		return nil, false
	}
	return raw, true
}
