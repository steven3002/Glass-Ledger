package chain

import (
	"crypto/ecdsa"
	"fmt"
	"os"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// Keys are the accounts the demo runs on, and the separation between them is the demonstration.
//
//   - Operator is the sponsor key. It runs the till and pays for everything, including the buyer's
//     gas: nobody in this protocol needs a funded wallet to be paid, to be refunded, or to buy.
//   - Creator signs vouchers, writes prices, and — this is the point — can challenge a claim from her
//     own key through any RPC on earth. She is never dependent on the operator to say "I was not
//     paid".
//   - Stranger holds no position in any of it. It sends the two permissionless touches: the lapsed
//     claim and the defaulted debt. The wronged party sends nothing, and a stranger does the work.
//   - Buyer is an ordinary customer with a claim code and no wallet of consequence.
//   - Landlord and Community are paid parties. They hold keys for exactly one reason: each of them
//     must register the account they are to be paid into, in their own name. An operator that could
//     write that record would be asserting the very fact it is later supposed to prove.
type Keys struct {
	Operator     *ecdsa.PrivateKey
	Creator      *ecdsa.PrivateKey
	Stranger     *ecdsa.PrivateKey
	Buyer        *ecdsa.PrivateKey
	LandlordKey  *ecdsa.PrivateKey
	CommunityKey *ecdsa.PrivateKey

	Landlord  common.Address
	Community common.Address
}

// Address is the account behind a key.
func Address(key *ecdsa.PrivateKey) common.Address {
	return crypto.PubkeyToAddress(key.PublicKey)
}

// KeysFromEnv loads the demo's accounts.
//
// Nothing is defaulted. A relayer that invents a key when its environment is incomplete is a relayer
// that will one day sign with the wrong one.
func KeysFromEnv() (Keys, error) {
	var keys Keys
	var err error

	if keys.Operator, err = keyFromEnv("GLASS_OPERATOR_KEY"); err != nil {
		return keys, err
	}
	if keys.Creator, err = keyFromEnv("GLASS_CREATOR_KEY"); err != nil {
		return keys, err
	}
	if keys.Stranger, err = keyFromEnv("GLASS_STRANGER_KEY"); err != nil {
		return keys, err
	}
	if keys.Buyer, err = keyFromEnv("GLASS_BUYER_KEY"); err != nil {
		return keys, err
	}
	if keys.LandlordKey, err = keyFromEnv("GLASS_LANDLORD_KEY"); err != nil {
		return keys, err
	}
	if keys.CommunityKey, err = keyFromEnv("GLASS_COMMUNITY_KEY"); err != nil {
		return keys, err
	}

	keys.Landlord = Address(keys.LandlordKey)
	keys.Community = Address(keys.CommunityKey)

	if Address(keys.Stranger) == Address(keys.Operator) {
		return keys, fmt.Errorf(
			"GLASS_STRANGER_KEY is the operator's key: the permissionless touches must be sent by " +
				"somebody with no stake in the outcome, or they demonstrate nothing",
		)
	}

	return keys, nil
}

func keyFromEnv(name string) (*ecdsa.PrivateKey, error) {
	raw := strings.TrimPrefix(os.Getenv(name), "0x")
	if raw == "" {
		return nil, fmt.Errorf("%s is not set", name)
	}

	key, err := crypto.HexToECDSA(raw)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	return key, nil
}

func addressFromEnv(name string) (common.Address, error) {
	raw := os.Getenv(name)
	if !common.IsHexAddress(raw) {
		return common.Address{}, fmt.Errorf("%s is not a valid address", name)
	}
	return common.HexToAddress(raw), nil
}
