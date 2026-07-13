package ops

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
)

func callOpts(ctx context.Context) *bind.CallOpts {
	return &bind.CallOpts{Context: ctx}
}

// short renders an address the way a person reads one.
func short(a common.Address) string {
	hex := a.Hex()
	return hex[:6] + "…" + hex[len(hex)-4:]
}

func short32(h [32]byte) string {
	hex := common.Hash(h).Hex()
	return hex[:10] + "…"
}

// Money renders an 18-decimal token amount as naira, for a caller outside this package that has read a
// figure off the chain and has to print it in the same hand as everything else.
func Money(amount *big.Int) string {
	return money(amount)
}

// money renders an 18-decimal token amount as naira, because the audience counts in naira and the
// contract counts in wei, and only one of those two is the point.
func money(amount *big.Int) string {
	if amount == nil {
		return "₦0"
	}

	unit := new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)
	whole, remainder := new(big.Int).QuoRem(amount, unit, new(big.Int))

	text := groupThousands(whole.String())
	if remainder.Sign() == 0 {
		return "₦" + text
	}

	// Sub-naira dust exists (a penalty splits an odd kobo) and is never rounded away in the ledger,
	// so it is not rounded away here either.
	fraction := new(big.Int).Mul(remainder, big.NewInt(100))
	fraction.Div(fraction, unit)
	return fmt.Sprintf("₦%s.%02d", text, fraction.Int64())
}

func groupThousands(digits string) string {
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

// bps applies a basis-point rate to an amount.
func bps(amount *big.Int, rate int64) *big.Int {
	out := new(big.Int).Mul(amount, big.NewInt(rate))
	return out.Div(out, big.NewInt(10_000))
}
