#!/usr/bin/env bash
#
# The whole demo, end to end, on 0G Galileo testnet.
#
#   ./scripts/testnet.sh
#
# The same seven proofs the local run drives, against a public chain that nobody here controls, with the
# vouchers and the evidence published to 0G Storage and read back through 0G's public indexer.
#
# Two things differ from the local run, and both are the point rather than a concession:
#
#   the clock is real.  A development chain's clock can be pushed forward; a public one cannot. The
#                       demo profile's windows are minutes — settlement 3, challenge 2, response 1,
#                       coverage 5, fulfilment 3 — and on this network they are *waited out*, so a full
#                       rehearsal takes as long as the windows say it does. Budget twenty minutes. The
#                       contracts are handed the same numbers either way; nothing about the code changes.
#
#   the gas is real.    Every transaction here is paid for out of a faucet-funded key, and every upload
#                       to 0G Storage is a submission transaction on top. The run therefore refuses to
#                       start if the operator cannot afford it, rather than dying halfway through Act 4
#                       with an audience watching.
#
# Environment (both files are git-ignored; see README.md):
#   .env.0g        the operator's key, the 0G RPC, the 0G Storage indexer
#   .env.testnet   the five keys that are not the operator's

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
relayer="$(dirname "$here")"
root="$(dirname "$relayer")"

for file in "$root/.env.0g" "$root/.env.testnet"; do
  if [ ! -f "$file" ]; then
    echo "missing $file — see README.md (the faucet process and the demo keys)" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  . "$file"
  set +a
done

# The operator is the key that pays for storage. It runs the till, sponsors the buyer, and publishes
# every voucher and every attestation — one funded account, and the demo says out loud which it is.
export GLASS_OPERATOR_KEY="$GLASS_0G_KEY"
export GLASS_RPC_URL="${GLASS_RPC_URL:-$GLASS_0G_RPC}"
export GLASS_STORAGE=0g
CHAIN_ID=16602

# One shelf per chain: a consignment belongs to the deployment that posted it, and a local run must not
# be able to erase the testnet's paperwork by seeding over the top of it.
export GLASS_DATA_DIR="$root/artifacts/demo/$CHAIN_ID"
OPERATOR="$GLASS_0G_ADDRESS"
RELAYERD_PORT="${GLASS_RELAYERD_PORT:-8790}"
WEB_PORT="${GLASS_WEB_PORT:-3000}"

log() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# --- What this network charges ----------------------------------------------------------------------
#
# 0G has essentially no base fee — seven wei — so the whole price of a transaction is the tip, and the
# node enforces a floor on it: a priority fee under 2 gwei is refused outright ("transaction gas price
# below minimum: gas tip cap 1"). Foundry does not ask the node what to pay. It derives a tip from
# eth_feeHistory, sees rewards of nearly nothing, and offers one wei — which this chain rejects. So the
# tip is stated here, at the 4 gwei the node itself suggests through eth_maxPriorityFeePerGas.
#
# And the fee ceiling has to be stated with it. Foundry derives maxFeePerGas from the base fee alone, so
# on a chain whose base fee is seven wei it offers a ceiling of fifteen — beneath the very tip it was
# just told to pay, which is not a valid transaction in either direction ("max priority fee per gas
# higher than max fee per gas: maxPriorityFeePerGas: 4000000000, maxFeePerGas: 15"). Both numbers, then.
# It costs nothing to name the ceiling generously: what is actually paid is the base fee plus the tip,
# and the base fee here is a rounding error.
#
# The Go relayer needs no such help and is deliberately not given any: abigen's bindings ask the node
# (SuggestGasTipCap → eth_maxPriorityFeePerGas → 4 gwei) rather than guessing, so they price themselves
# correctly on any chain. These constants exist for the two tools that guess.
TIP=4gwei
CEILING=6gwei

# --- Can this run afford itself? -------------------------------------------------------------------
#
# Measured on this network, at the 4 gwei it charges: the deployment is ~16.7M gas, the demo's sixty-odd
# transactions come to ~11M, and an upload to 0G Storage costs about 0.0012 0G apiece — dominated by the
# fixed submission transaction rather than by the payload, so a voucher and an attestation cost the
# same. Sixteen of them (thirteen vouchers, two sweeps, one write-off) is ~0.02 0G, and vouchers already
# published cost nothing at all. Call it 0.13 0G for a full rehearsal from a fresh deployment.

FLOOR=150000000000000000 # 0.15 0G — one full rehearsal, with room for a flake

balance="$(cast balance "$OPERATOR" --rpc-url "$GLASS_0G_RPC")"
if [ "$(echo "$balance < $FLOOR" | bc)" -eq 1 ]; then
  cat >&2 <<EOF

  The operator ($OPERATOR) holds $(cast to-unit "$balance" ether) 0G.

  A full rehearsal — deployment, sixty-odd transactions and sixteen uploads — costs about 0.13 0G at
  this network's 4 gwei, so this refuses to start below 0.15 rather than run out of gas in front of an
  audience. Top it up at https://faucet.0g.ai (0.1 0G per wallet per day) and run this again.

EOF
  exit 1
fi

log "==> 0G Galileo testnet (chain $CHAIN_ID)"
echo "  operator     $OPERATOR — $(cast to-unit "$balance" ether) 0G"
echo "  rpc          $GLASS_0G_RPC"
echo "  storage      $GLASS_0G_INDEXER"

# --- Everybody else's gas ---------------------------------------------------------------------------
#
# Five accounts that are not the operator's, each holding just enough to send its own transactions. The
# creator needs the most: she seeds thirteen prices, registers her payout account, and challenges a
# claim in her own name. The stranger needs enough for the two permissionless touches — which is the
# whole argument in one line of gas: collecting a default costs a passer-by a few thousandths of a token
# and requires the permission of nobody.
#
# Funding is skipped for any account that already holds enough, so re-running this is free.
#
# And it is retried, because the public RPC is load-balanced and will occasionally answer a receipt
# query for a transaction it has not seen yet ("server returned a null response when a non-null response
# was expected") — a transaction that is, at that moment, perfectly fine and about to be mined. The
# balance is therefore re-read before every attempt: the question this function asks is not "did my
# transaction succeed" but "does this account have its gas", and only the second one matters.
fund() {
  local name="$1" address="$2" want="$3"
  local have

  for attempt in 1 2 3; do
    have="$(cast balance "$address" --rpc-url "$GLASS_0G_RPC")"
    if [ "$(echo "$have >= $want" | bc)" -eq 1 ]; then
      if [ "$attempt" -eq 1 ]; then
        echo "  $name  $address — $(cast to-unit "$have" ether) 0G (already funded)"
      else
        echo "  $name  $address — funded to $(cast to-unit "$have" ether) 0G (the RPC lost the receipt, not the money)"
      fi
      return
    fi

    if cast send "$address" \
      --value "$(echo "$want - $have" | bc)" \
      --private-key "$GLASS_OPERATOR_KEY" \
      --rpc-url "$GLASS_0G_RPC" \
      --priority-gas-price "$TIP" \
      --gas-price "$CEILING" \
      --confirmations 1 >/dev/null 2>&1; then
      echo "  $name  $address — funded to $(cast to-unit "$want" ether) 0G"
      return
    fi

    sleep 5
  done

  echo "  ✗ $name  $address could not be funded after three attempts" >&2
  exit 1
}

log "==> the five keys that are not the operator's"
fund "creator  " "$(cast wallet address "$GLASS_CREATOR_KEY")" 6000000000000000
fund "landlord " "$(cast wallet address "$GLASS_LANDLORD_KEY")" 1500000000000000
fund "community" "$(cast wallet address "$GLASS_COMMUNITY_KEY")" 1500000000000000
fund "buyer    " "$(cast wallet address "$GLASS_BUYER_KEY")" 1500000000000000
fund "stranger " "$(cast wallet address "$GLASS_STRANGER_KEY")" 8000000000000000

# --- The deployment ---------------------------------------------------------------------------------
#
# The Solidity script, as everywhere else: there is one definition of this protocol's shape and the
# relayer is not it. A fresh deployment every time, because the demo consumes the items it sells and a
# second rehearsal needs a shelf that has not been sold off — and because an immutable protocol has no
# other way to change its mind.
log "==> deploy (the Solidity script — the one definition of the protocol's shape)"
mkdir -p "$root/artifacts/deployments" "$GLASS_DATA_DIR"
(
  cd "$root/contracts"
  OPERATOR_RECIPIENT="$GLASS_OPERATOR_RECIPIENT" \
    forge script script/Deploy.s.sol:Deploy \
      --rpc-url "$GLASS_0G_RPC" \
      --private-key "$GLASS_OPERATOR_KEY" \
      --priority-gas-price "$TIP" \
      --with-gas-price "$CEILING" \
      --broadcast \
      --slow \
      --silent
)
echo "  addresses written to artifacts/deployments/$CHAIN_ID.json"

log "==> bindings"
"$here/gen-bindings.sh" >/dev/null

# --- The demo ---------------------------------------------------------------------------------------
#
# --dev-time=false: there is no evm_increaseTime on a public chain, and there should not be. Every
# deadline in this protocol is a wall-clock deadline, and here the wall clock is the one everybody else
# is using. The demo waits.
log "==> the demo: seven proofs, on real clocks (about twenty minutes)"
(
  cd "$relayer"
  go run ./cmd/demo --dev-time=false run
)

# --- The kill switch --------------------------------------------------------------------------------
relayerd_pid=""
web_pid=""
cleanup() {
  # The whole process group, not the pid we happen to hold. `npx` spawns `next`, which spawns the
  # server that actually holds the port, so killing the pid this script started leaves the listener
  # alive — and the next run of either script then finds port 3000 occupied by a corpse serving the
  # last deployment's paperwork, which it will hand out while answering every health check perfectly.
  [ -n "$web_pid" ] && kill -- -"$web_pid" 2>/dev/null || true
  [ -n "$relayerd_pid" ] && kill "$relayerd_pid" 2>/dev/null || true
}
trap cleanup EXIT

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
go run ./cmd/demo --dev-time=false kill-check

# The other half of the same beat, and the half an audience actually watches: the buyer's page, reading
# the vouchers out of 0G Storage through the public indexer while the operator's process is a corpse.
if [ -d "$root/web/node_modules" ]; then
  log "==> the browser's half of the kill switch: the browse cases, with the operator still dead"
  # Nothing may already be listening here. `next start` snapshots the public directory when it boots
  # and never looks at it again, so a server left running from an earlier deployment serves that
  # deployment's paperwork and 404s this one's — and it would answer a readiness probe cheerfully while
  # doing it. A test that quietly talks to the wrong server is worse than a test that fails.
  if curl -sf --max-time 2 "http://127.0.0.1:$WEB_PORT/" >/dev/null 2>&1; then
    echo "  ✗ something is already serving on port $WEB_PORT. Stop it: this rehearsal must be read by a" >&2
    echo "    page built from *this* deployment, and a stale one would 404 it while looking healthy." >&2
    exit 1
  fi

  (
    cd "$root/web"
    export NEXT_PUBLIC_CHAIN_ID="$CHAIN_ID"
    export NEXT_PUBLIC_RPC_URL="$GLASS_0G_RPC"
    export NEXT_PUBLIC_STORAGE=0g
    export NEXT_PUBLIC_0G_INDEXER="$GLASS_0G_INDEXER"

    npm run build --silent >/dev/null

    # setsid, so the server leads its own process group and the cleanup above can take the whole family
    # with it rather than orphaning the listener.
    setsid npx next start -p "$WEB_PORT" >/dev/null 2>&1 &
    echo $! > /tmp/glass-web.pid

    # The readiness probe asks for the file this rehearsal is *about*. Waiting on any old static asset
    # proves the process is listening and nothing else.
    for _ in $(seq 1 60); do
      curl -sf "http://127.0.0.1:$WEB_PORT/deployments/$CHAIN_ID.json" >/dev/null 2>&1 && break
      sleep 0.5
    done
    curl -sf "http://127.0.0.1:$WEB_PORT/deployments/$CHAIN_ID.json" >/dev/null

    WEB_ORIGIN="http://127.0.0.1:$WEB_PORT" node scripts/verify-offline.mjs
  )
  web_pid="$(cat /tmp/glass-web.pid)"
else
  log "!! web/node_modules is missing — the browser half of the kill switch did NOT run."
  echo "   Install it (cd web && npm install) and run this again; a pass mark that quietly skips is not a pass mark."
fi

spent="$(echo "$balance - $(cast balance "$OPERATOR" --rpc-url "$GLASS_0G_RPC")" | bc)"
log "✓ seven proofs on a public chain, vouchers and evidence in 0G Storage, and the tags still verify with the operator dead."
echo "  this rehearsal cost the operator $(cast to-unit "$spent" ether) 0G."
