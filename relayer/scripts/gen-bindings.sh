#!/usr/bin/env bash
#
# Regenerates the Go contract bindings from the Foundry build artifacts.
#
# The bindings are generated, never edited, and never committed: they are a projection of the
# contracts, and a hand-touched projection is a lie waiting to happen. Run this after any change
# under contracts/src, and run it on a fresh checkout before building the relayer.
#
#   ./scripts/gen-bindings.sh
#
# Requires abigen at the pinned go-ethereum version (see the toolchain notes in the README):
#   go install github.com/ethereum/go-ethereum/cmd/abigen@v1.15.11

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
relayer="$(dirname "$here")"
contracts="$(dirname "$relayer")/contracts"
out="$relayer/internal/chain/bindings"

# `go install` puts abigen here, and a login shell may not have it on PATH.
export PATH="$PATH:$(go env GOPATH)/bin"

if ! command -v abigen >/dev/null; then
  echo "abigen is not installed. It must be the pinned go-ethereum version:" >&2
  echo "  go install github.com/ethereum/go-ethereum/cmd/abigen@v1.15.11" >&2
  exit 1
fi

# Every contract the operator has to talk to. The stub verifier is on this list because the demo's
# operator injects verdicts into it; the real verifier it stands in for takes no such call.
contracts_list=(
  CreatorRegistry
  ItemLedger
  PriceBook
  DebtLedger
  SweepRegistry
  StubProofVerifier
  SaleGateway
  Allowance
  Pool
  MockNGN
)

echo "==> forge build"
(cd "$contracts" && forge build >/dev/null)

rm -rf "$out"
mkdir -p "$out"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for name in "${contracts_list[@]}"; do
  artifact="$contracts/out/$name.sol/$name.json"
  [ -f "$artifact" ] || { echo "missing artifact: $artifact" >&2; exit 1; }

  jq -c '.abi' "$artifact" > "$tmp/$name.abi"
  jq -r '.bytecode.object' "$artifact" | sed 's/^0x//' > "$tmp/$name.bin"

  abigen \
    --abi "$tmp/$name.abi" \
    --bin "$tmp/$name.bin" \
    --pkg bindings \
    --type "$name" \
    --out "$out/$name.go"

  echo "    $name"
done

# A struct that appears in two ABIs (an item voucher in the registry and in the gateway; a proof
# statement in the ledger and in the verifier) is generated into both files, and Go will not have the
# same type declared twice in one package. Keep the first declaration and drop the rest: one struct,
# one Go type, so a voucher built for the registry is the same value the gateway is handed.
python3 - "$out" "${contracts_list[@]}" <<'PY'
import re, sys, pathlib

out = pathlib.Path(sys.argv[1])
seen = set()
block = re.compile(
    r"^// (\w+) is an auto generated low-level Go binding around an user-defined struct\.\n"
    r"type \1 struct \{[^}]*\}\n\n",
    re.M,
)

for name in sys.argv[2:]:
    path = out / f"{name}.go"
    src = path.read_text()

    def keep(match: re.Match) -> str:
        struct = match.group(1)
        if struct in seen:
            return ""
        seen.add(struct)
        return match.group(0)

    path.write_text(block.sub(keep, src))
PY

echo "==> bindings written to internal/chain/bindings"
