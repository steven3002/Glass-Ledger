#!/usr/bin/env bash
#
# s13's world, from nothing, on a local chain.
#
#   ./scripts/seed-catalog.sh
#
# Fresh anvil → deploy → the original seven-proof demo → declare the legacy consignment → mint the
# s13 catalog. Runs end to end so the dataset is reproducible rather than an artefact of whatever
# order somebody happened to run things in.
#
# anvil's accounts are deterministic, publicly known and worth nothing. Nothing real is signed here.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
relayer="$(dirname "$here")"
root="$(dirname "$relayer")"

RPC="${GLASS_RPC_URL:-http://127.0.0.1:8545}"
PORT="${RPC##*:}"

export GLASS_OPERATOR_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export GLASS_CREATOR_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
export GLASS_LANDLORD_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
export GLASS_COMMUNITY_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
export GLASS_BUYER_KEY=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
export GLASS_STRANGER_KEY=0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba
export GLASS_RPC_URL="$RPC"
# One shelf per chain, like the testnet's — and for the same reason, from the other direction.
#
# This used to be `artifacts/demo` flat, next to the testnet's `artifacts/demo/16602`. Resetting a
# local run with `rm -rf artifacts/demo` therefore deleted the *testnet's* published paperwork, which
# is untracked, unrecoverable from git, and impossible to re-seed: re-running the seed against 16602
# registers a second creator and posts the same dresses again under a new tranche. The chain and 0G
# Storage were unharmed both times it happened, and `cmd/rebuildconsignment` reconstructs the file
# from the deployment and checks it against the on-chain roots — but nothing should depend on that.
export GLASS_DATA_DIR="$root/artifacts/demo/31337"

[ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL is not set (it lives in the repo root .env, gitignored)"; exit 1; }

log() { printf '\n\033[1m%s\033[0m\n' "$*"; }

log "==> the catalog tables, dropped and rebuilt"
# Everything here is derived from the chain plus a literal in catalog.go, so dropping is cheap and a
# migration tool would be protecting data that can be regenerated in seconds.
psql_exec() { go run "$relayer/cmd/indexerd" -seed -rpc "$RPC" \
  -consignment "$GLASS_DATA_DIR/consignment.json" \
  -deployment "$root/artifacts/deployments/31337.json"; }

log "==> deploy"
( cd "$root/contracts"
  OPERATOR_RECIPIENT=0xa0Ee7A142d267C1f36714E4a8F75612F20a79720 \
    forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC" \
      --private-key "$GLASS_OPERATOR_KEY" --broadcast --silent )

log "==> multicall3"
# Every read the web makes is aggregated through Multicall3 at its canonical address. 0G has it; a
# fresh anvil does not (1.7.1), and without it the whole ledger reads back as `0x`. The runtime code
# is copied from a chain that has it rather than kept as a literal here — a 7.6kB blob pasted into a
# shell script is a blob nobody will ever check.
MULTICALL=0xcA11bde05977b3631167028862bE2a173976CA11
if [ "$(cast code "$MULTICALL" --rpc-url "$RPC")" = "0x" ]; then
  code="$(cast code "$MULTICALL" --rpc-url "${GLASS_MULTICALL_SOURCE_RPC:-https://evmrpc-testnet.0g.ai}")"
  cast rpc anvil_setCode "$MULTICALL" "$code" --rpc-url "$RPC" >/dev/null
  echo "  provisioned multicall3 from a chain that has it"
fi

log "==> bindings"
"$here/gen-bindings.sh" >/dev/null

log "==> the original demo: seven proofs"
( cd "$relayer" && go run ./cmd/demo run >/dev/null )

log "==> declare the original consignment to the indexer"
( cd "$relayer" && psql_exec )

log "==> mint the s13 catalog"
( cd "$relayer" && go run ./cmd/seedcatalog -first-item 3001 \
    -deployment "$root/artifacts/deployments/31337.json" )

log "==> trade it, badly"
# The unhappy paths are the point of the dataset, so they are part of the seed rather than an
# optional extra somebody remembers to run. A shelf with nothing but stock on it demonstrates
# nothing: every surface that exists to show a failure would render empty and look finished.
#
# Nothing is re-declared afterwards. The catalog is a *grouping* — which units make up which product
# — and selling one does not move it to another product or rename it. What changes is the chain's
# view of those ids, which every page reads live.
( cd "$relayer" && go run ./cmd/sellcatalog -defaults="${GLASS_DEFAULTS:-true}" \
    -deployment "$root/artifacts/deployments/31337.json" )
