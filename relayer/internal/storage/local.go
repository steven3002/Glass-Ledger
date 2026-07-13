package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// Local is a content-addressed store on disk.
//
// It exists so the whole demo — every act, every proof — can be run end-to-end against a development
// chain on a machine with no network. It is honest about what it is: the pointer it returns is the
// keccak hash of the bytes themselves, so the commitment property that matters still holds (the blob
// cannot be swapped for another after the fact, because a different blob has a different pointer),
// and nothing else is claimed. It is not 0G Storage and does not pretend to be; `Backend()` says so,
// and the demo prints it.
type Local struct {
	dir string
}

// NewLocal roots a store at `dir`, creating it if it does not exist.
func NewLocal(dir string) (*Local, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("storage: %w", err)
	}
	return &Local{dir: dir}, nil
}

func (l *Local) Backend() string { return "local (content-addressed files)" }

func (l *Local) Put(_ context.Context, name string, blob []byte) (common.Hash, error) {
	pointer := crypto.Keccak256Hash(blob)

	// Written under the pointer, so a reader who has only the on-chain 32 bytes can find it — and
	// hard-linked under a readable name, because a human debugging a demo should not have to grep
	// hashes.
	path := filepath.Join(l.dir, pointer.Hex()+".blob")
	if err := os.WriteFile(path, blob, 0o644); err != nil {
		return common.Hash{}, fmt.Errorf("storage: %w", err)
	}
	if name != "" {
		labelled := filepath.Join(l.dir, name+".json")
		if err := os.WriteFile(labelled, blob, 0o644); err != nil {
			return common.Hash{}, fmt.Errorf("storage: %w", err)
		}
	}

	return pointer, nil
}

func (l *Local) Get(_ context.Context, pointer common.Hash) ([]byte, error) {
	blob, err := os.ReadFile(filepath.Join(l.dir, pointer.Hex()+".blob"))
	if err != nil {
		return nil, fmt.Errorf("storage: %w", err)
	}

	// The pointer is the hash. Check it, because a store that hands back the wrong bytes without
	// complaint is worse than one that hands back nothing.
	if got := crypto.Keccak256Hash(blob); got != pointer {
		return nil, fmt.Errorf("storage: blob at %s hashes to %s", pointer, got)
	}

	return blob, nil
}
