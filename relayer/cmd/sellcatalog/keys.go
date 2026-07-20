package main

import (
	"crypto/ecdsa"
	"strings"

	"github.com/ethereum/go-ethereum/crypto"
)

// ecdsaKey is the signing key type, aliased so the shelf's signature reads without dragging the
// crypto import into a file that is otherwise about names and item ids.
type ecdsaKey = ecdsa.PrivateKey

func keyFromHex(hex string) (*ecdsaKey, error) {
	return crypto.HexToECDSA(strings.TrimPrefix(hex, "0x"))
}
