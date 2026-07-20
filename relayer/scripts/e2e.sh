#!/usr/bin/env bash
#
# The whole demo, end to end, on a local development chain.
#
#   ./scripts/e2e.sh
#
# It starts anvil, deploys the protocol with the Solidity deployment script, and then drives all seven
# proofs from the relayer's own CLI — the same commands an operator would run, from the operator's own
# key, with the two permissionless touches sent from a stranger's.
#
# The keys below are anvil's published test accounts. They are deterministic, publicly known, and worth
# nothing: they exist in every Foundry installation on earth. Nothing real is ever signed with them, and
# the relayer refuses to start if the stranger's key turns out to be the operator's — because the point
# of the stranger is that it has no stake in any of this.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
relayer="$(dirname "$here")"
root="$(dirname "$relayer")"

RPC="${GLASS_RPC_URL:-http://127.0.0.1:8545}"
PORT="${RPC##*:}"

# anvil's deterministic accounts: 0 the operator, 1 the creator, 2 the landlord, 3 the community
# owner, 4 the buyer, and 5 a stranger who wants nothing from anybody.
export GLASS_OPERATOR_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export GLASS_CREATOR_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
export GLASS_LANDLORD_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
export GLASS_COMMUNITY_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
export GLASS_BUYER_KEY=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
export GLASS_STRANGER_KEY=0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba

export GLASS_RPC_URL="$RPC"
# One shelf per chain — see seed-catalog.sh. A flat path here can be erased by, and can erase, the
# testnet's own paperwork under artifacts/demo/<chainid>.
export GLASS_DATA_DIR="$root/artifacts/demo/31337"

log() { printf '\n\033[1m%s\033[0m\n' "$*"; }

RELAYERD_PORT="${GLASS_RELAYERD_PORT:-8790}"

WEB_PORT="${GLASS_WEB_PORT:-3000}"

anvil_pid=""
relayerd_pid=""
web_pid=""
cleanup() {
  # The whole process group, not the pid we happen to hold: the web server is three processes deep
  # behind npx, and killing the wrapper leaves the listener alive and holding the port.
  [ -n "$web_pid" ] && kill -- -"$web_pid" 2>/dev/null || true
  [ -n "$relayerd_pid" ] && kill "$relayerd_pid" 2>/dev/null || true
  [ -n "$anvil_pid" ] && kill "$anvil_pid" 2>/dev/null || true
}
trap cleanup EXIT

log "==> anvil"
anvil --port "$PORT" --silent &
anvil_pid=$!

for _ in $(seq 1 50); do
  cast block-number --rpc-url "$RPC" >/dev/null 2>&1 && break
  sleep 0.2
done
cast block-number --rpc-url "$RPC" >/dev/null

log "==> deploy (the Solidity script — the one definition of the protocol's shape)"
mkdir -p "$root/artifacts/deployments" "$GLASS_DATA_DIR"
(
  cd "$root/contracts"
  # The operator's ledger recipient is a treasury account, kept distinct from the hot key that runs
  # sales: a key that rings up transactions all day is not a place to keep money.
  OPERATOR_RECIPIENT=0xa0Ee7A142d267C1f36714E4a8F75612F20a79720 \
    forge script script/Deploy.s.sol:Deploy \
      --rpc-url "$RPC" \
      --private-key "$GLASS_OPERATOR_KEY" \
      --broadcast \
      --silent
)

log "==> bindings"
"$here/gen-bindings.sh" >/dev/null

log "==> the demo: seven proofs"
(
  cd "$relayer"
  go run ./cmd/demo run
)

log "==> the kill switch: the operator goes offline, and verification does not notice"
cd "$relayer"

go build -o /tmp/glass-relayerd ./cmd/relayerd
/tmp/glass-relayerd --addr "127.0.0.1:$RELAYERD_PORT" &
relayerd_pid=$!

for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:$RELAYERD_PORT/status" >/dev/null 2>&1 && break
  sleep 0.2
done

curl -sf "http://127.0.0.1:$RELAYERD_PORT/status" >/dev/null && echo "  operator: up"
curl -sf -X POST "http://127.0.0.1:$RELAYERD_PORT/kill" >/dev/null
wait "$relayerd_pid" 2>/dev/null || true
relayerd_pid=""

if curl -sf --max-time 2 "http://127.0.0.1:$RELAYERD_PORT/status" >/dev/null 2>&1; then
  echo "  ✗ the operator is still serving"
  exit 1
fi
echo "  operator: down"

echo
echo "  and now, with the operator dead, the same ledger, read straight off the chain:"
go run ./cmd/demo kill-check

# The other half of the same beat, and the half an audience actually watches: the buyer's page.
#
# The operator is dead at this point in the script and stays dead. What runs below is the browser's own
# verification module — the real one, not a re-implementation — against the chain and against the web's
# own published vouchers, with every network call it makes written down and checked. If the page could
# only verify while Good was alive, this is where it would be caught.
if [ -d "$root/web/node_modules" ]; then
  log "==> the browser's half of the kill switch: the four browse cases, with the operator still dead"

  # Nothing may already be listening here, and a readiness probe cannot be the thing that establishes
  # it. `next start` snapshots the public directory when it boots and never looks at it again, so a
  # server left running from an earlier run serves that run's paperwork forever — and it will answer a
  # probe for this deployment perfectly cheerfully, because it has a file by that name too. It then
  # 404s every voucher this run published, and the browse cases fail with "no paperwork behind it": a
  # test that quietly talked to the wrong server and reported the wrong answer. Refuse to start instead.
  if curl -sf --max-time 2 "http://127.0.0.1:$WEB_PORT/" >/dev/null 2>&1; then
    echo "  ✗ something is already serving on port $WEB_PORT. Stop it: this run must be read by a page" >&2
    echo "    built from *this* deployment, and a stale one will 404 its vouchers while looking healthy." >&2
    exit 1
  fi

  (
    cd "$root/web"
    npm run build --silent >/dev/null

    # setsid, so that the server is the leader of its own process group and `kill -- -PID` takes the
    # whole family with it. `npx` spawns `next`, which spawns the server that actually holds the port —
    # so killing the pid we started leaves the listener behind, and the next run of either script finds
    # port 3000 occupied by a corpse serving last week's shop.
    setsid npx next start -p "$WEB_PORT" >/dev/null 2>&1 &
    echo $! > /tmp/glass-web.pid
  )
  web_pid="$(cat /tmp/glass-web.pid)"

  for _ in $(seq 1 60); do
    curl -sf "http://127.0.0.1:$WEB_PORT/deployments/31337.json" >/dev/null 2>&1 && break
    sleep 0.5
  done
  curl -sf "http://127.0.0.1:$WEB_PORT/deployments/31337.json" >/dev/null

  (
    cd "$root/web"
    WEB_ORIGIN="http://127.0.0.1:$WEB_PORT" node scripts/verify-offline.mjs
  )
else
  log "!! web/node_modules is missing — the browser half of the kill switch did NOT run."
  echo "   Install it (cd web && npm install) and run this again; a pass mark that quietly skips is not a pass mark."
fi

log "✓ every proof exercised locally, against the deployed contracts, from the relayer's CLI — and the tags still verify with the operator dead."
