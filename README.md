# Glass Ledger

A retail protocol in which the ledger, not the operator, is what people trust.

An item is consigned by its creator, sold in one atomic transaction that owes every party their share the
moment the tag is scanned, and paid for on a clock that runs whether anybody is watching or not. If the
operator does not pay, a stranger with nothing at stake can collect the default on the wronged party's
behalf, and the operator's right to hold other people's money shrinks by arithmetic that anyone can
check. **Nobody has to file anything.**

It is deployed and running on **0G Galileo** (chain 16602). Every claim below has been executed against
that public chain — the addresses are in [Where it lives](#where-it-lives), what it cost is in
[`docs/gas-table.md`](docs/gas-table.md), and the demo itself is in
[`docs/RUNBOOK.md`](docs/RUNBOOK.md).

```bash
relayer/scripts/e2e.sh          # everything, on a local chain. No network, no keys, no gas. ~40 seconds
relayer/scripts/testnet.sh      # everything, on 0G Galileo. Real gas, real clocks. ~21 minutes
```

## What it is made of

| | |
|---|---|
| `contracts/` | Solidity (Foundry). **The protocol.** Every rule the system has is in here, and nowhere else. |
| `relayer/` | Go. Everything the *operator* runs — and nothing anyone else depends on. |
| `web/` | Next.js. The public ledger, the buyer's scanner, the creator's wall. Public state only. |

Ten contracts. `CreatorRegistry` is the root of trust for a tag; `ItemLedger` is the state machine that
makes a tag single-use; `PriceBook` holds prices the creator writes and the operator cannot; `DebtLedger`
is the clock — mint, age, claim, challenge, settle, void, default — and `SweepRegistry` is the ratchet
that proves settlement in batches against `IProofVerifier` (a stub here; the real zkTLS verifier is M1's
job and swaps in at the same seam). `Pool` and `Allowance` are the cage: the operator's right to take
money into its own hands is a number that grows only with proven settlement and is written down, hard,
by every default. `SaleGateway` is the fusion — the one transaction in which authenticity, inventory,
the split, the ceiling and the certificate are inseparable.

**Capacity is bilateral, and that is the load-bearing sentence in the treasury.** The allowance is not a
score the operator holds; it is a number it has *with a creator* — earned on that creator's proven
payouts, spendable only on that creator's goods. It has to work that way, because an operator can invent
a creator: consign her imaginary dresses, sell them to itself, pay accounts it controls, and prove every
one of those payments, all of it true, all of it public, and none of it catchable — telling a
manufactured counterparty from a real one is a problem nobody has solved. So the protocol does not try.
It makes the answer worthless instead: whatever Good earns by trading with itself, it can spend only on
itself. **The farm succeeds completely and buys an empty room** (`test_theFarmThatBuysNothing`).

The same reasoning is why the only global number the protocol publishes is a **record of failure** —
defaults, claims voided, money owed, fines unpaid — in absolute counts and amounts, with no rate
anywhere in it. A rate has a denominator, and a denominator is exactly what a farmer manufactures. You
cannot farm a clean record; you can only fail to have failed (`test_theRecordCannotBeFarmed`).

**The dependency that matters is the one that does not exist.** `web/lib/verify` cannot import anything
that talks to the relayer, and the boundary is held down by a lint rule, an executable test, and the
end-to-end script. Stopping the operator's process does not change what a buyer's scan says, because
verification never went through the operator in the first place.

## Where it lives

Deployed on **0G Galileo, chain 16602**, by `contracts/script/Deploy.s.sol` — the single definition of
this protocol's shape. **The relayer never deploys.** Addresses are published to
`artifacts/deployments/16602.json`, which the relayer and the web read; neither carries a hard-coded
address.

Rehearsed end to end on this deployment on **2026-07-14**: all seven proofs, both kill-switch halves, the
farm act, in **27 minutes** for **0.136 0G**. The deployed bytecode was compared against the local build
with each contract's constructor-baked immutables masked out — it is **byte-for-byte identical**. This is
the shop; you can walk into it.

| | | |
|---|---|---|
| `SaleGateway` | [`0x3099EAfA5F535AD4823c1D771B1f605C7781fe50`](https://chainscan-galileo.0g.ai/address/0x3099EAfA5F535AD4823c1D771B1f605C7781fe50) | the atomic sale: authenticity, inventory, split, ceiling and certificate, inseparable |
| `DebtLedger` | [`0xCdc5aa114919517280991f062D30e9Ad8Eda22ab`](https://chainscan-galileo.0g.ai/address/0xCdc5aa114919517280991f062D30e9Ad8Eda22ab) | the clock: mint, age, claim, challenge, settle, void, default |
| `SweepRegistry` | [`0x6282603937297fFa4C903e9676Fb6453D25AAf03`](https://chainscan-galileo.0g.ai/address/0x6282603937297fFa4C903e9676Fb6453D25AAf03) | the ratchet: one attestation, many claims proven |
| `Pool` | [`0x948A11158777E932789d35a0467cb01991F2b444`](https://chainscan-galileo.0g.ai/address/0x948A11158777E932789d35a0467cb01991F2b444) | who pays the wronged party when the operator does not |
| `Allowance` | [`0xAb95fE008bfE693CD5ad09Bd076c50ea2AB59726`](https://chainscan-galileo.0g.ai/address/0xAb95fE008bfE693CD5ad09Bd076c50ea2AB59726) | the ceiling: the right to hold **one creator's** money, as a number, earned with her and spendable only on her goods |
| `CreatorRegistry` | [`0x5cCf6476b7c22b490df9DdF4f76bb2cF10CaD256`](https://chainscan-galileo.0g.ai/address/0x5cCf6476b7c22b490df9DdF4f76bb2cF10CaD256) | the root of trust for a tag |
| `ItemLedger` | [`0xd1A43B3Ba1307B48cf987CdE9394318b4BF35284`](https://chainscan-galileo.0g.ai/address/0xd1A43B3Ba1307B48cf987CdE9394318b4BF35284) | the state machine that makes a tag single-use |
| `PriceBook` | [`0x6e81af69b841646b3d31E5aE210B499313dcCf8d`](https://chainscan-galileo.0g.ai/address/0x6e81af69b841646b3d31E5aE210B499313dcCf8d) | prices the creator writes and the operator cannot |
| `StubProofVerifier` | [`0x673a972968F7E262553d6Bfcde17BE57c1720d34`](https://chainscan-galileo.0g.ai/address/0x673a972968F7E262553d6Bfcde17BE57c1720d34) | **the stub.** The real zkTLS verifier swaps in at this seam — see below |
| `MockNGN` | [`0x6b9540f34295Cc25a77151F5803bfAF6c06a2516`](https://chainscan-galileo.0g.ai/address/0x6b9540f34295Cc25a77151F5803bfAF6c06a2516) | the pool's asset. Production: cNGN (primary), USDC (secondary) |

The operator is `0xd3BDc969bc9c5E944a346686d57eb042fD9d8290`; its treasury account is
`0xaA0D18438C4d2deae4095fB505E462Ad51f3813F`, deliberately not the hot key that runs the till.

**About that stub.** `IProofVerifier` is the real interface, and `StubProofVerifier` answers it with
verdicts the operator injects — which is exactly as damning as it sounds, and exactly why the seam is
built the way it is. **There is no `setVerifier` anywhere in this system.** The sweep reads its verifier
off the ledger, immutably, so swapping the stub for a genuine zkTLS verifier is a *fresh deployment* and
not a configuration change: the operator cannot quietly redefine what counts as proof. Nothing else moves
when the real one lands (M1's integration target).

## Running it

### Locally, against a development chain

Nothing but the toolchain is required — no network, no keys, no gas:

```bash
relayer/scripts/e2e.sh
```

It starts anvil, deploys the protocol with the Solidity script, drives all seven proofs from the
relayer's CLI, then kills the operator and verifies four tags with it dead — from the CLI *and* from the
browser's own verification module.

### On 0G Galileo

```bash
relayer/scripts/testnet.sh
```

The same seven proofs against a public chain nobody here controls, with the vouchers and the sweep and
write-off evidence published to **0G Storage** and read back through 0G's public indexer.

Two things differ from the local run, and both are the point rather than a concession.

**The clock is real.** A development chain's clock can be pushed forward; a public one cannot, and
`evm_increaseTime` does not exist on 0G — nor should it. The demo profile's windows (settlement 3 min,
challenge 2, response 1, coverage 5, fulfilment 3) are therefore *waited out*. **Budget 25–30 minutes**
(measured: 21.4, 22.9, and 27.1 once the farm act was added). Fourteen of those minutes are the windows
and are fixed; the rest is the deployment and the uploads to 0G Storage, and the uploads are the part
that varies. The contracts are handed the same numbers on both networks and cannot tell which one they
are on — and they demonstrably cannot: the final ledger state of the testnet run is **identical, to the
kobo, to the local run's.**

**The counter is real too, and the buy button is on the critical path.** Prove it before you show it —
it drives a real purchase through the real page, in a real browser, against whatever chain you point it
at, and it fails loudly if the operator's till is shut:

```bash
cd web && GLASS_BUY_ITEM=1011 node scripts/buy-once.mjs      # needs relayerd up, and the web served
```

> **Build the web against the chain you are demonstrating.** `GLASS_DATA_DIR` names the shelf, and the
> consignment on it belongs to the deployment that posted it. Point the page at one chain with another
> chain's paperwork and it does not break — it **condemns every genuine tag in the shop as forged**, from
> a verifier that is working perfectly and reading the wrong shelf. The scripts export it for you, and
> the sync refuses a mismatch rather than serving it; if you are standing up the page by hand, export it.

**The attack is real, and it runs on stage.** Act 4 is the operator inventing a creator and buying a
reputation from her — every transaction succeeding, every proof valid — and Act 5 is that reputation
turning out to be worth nothing. It is one command on its own if you want to rehearse the beat:

```bash
cd relayer && go run ./cmd/demo farm
```

**The gas is real.** A rehearsal from a fresh deployment cost the operator **0.136203 0G**, measured
(2026-07-14): the deployment, its own 89 transactions and 21 uploads to 0G Storage, and the gas it hands
to the five other parties so they can send theirs. Every row behind that number is in
[`docs/gas-table.md`](docs/gas-table.md), which is rendered from the run's own receipts rather than
written by hand. The script refuses to start below 0.15 rather than run out of gas halfway through Act 4
with an audience watching.

And one figure worth knowing before somebody asks: **the entire self-dealing farm — inventing a creator,
consigning her, three ₦25,000,000 sales to itself, proving every one, collecting the capacity — cost
₦3.55 in gas and conjured ₦425,000 of capacity.** That is why the defence is structural. If it rested on
the attack being expensive, it would not be a defence at all.

**Re-render the bill on the day.** The gas is measured and permanent; the naira column is somebody else's
exchange rate and will be stale. One command, and it prints the rate and the date it used:

```bash
cd relayer && go run ./cmd/gastable --chain 16602 \
  --ngn-per-0g <today's rate> --rate-note "CoinGecko, <today>" > ../docs/gas-table.md
```

### Two things that will bite you, and did

**Serve the demo from `http://localhost`. Never HTTPS.** 0G's storage nodes are plain-`http://` IP
addresses, and the browser fetches vouchers from them **directly** — the SDK asks the indexer *where* a
file is and then goes to the nodes themselves. CORS is wide open, so this works perfectly over
`http://localhost`, and **an HTTPS-served page would have every storage read blocked as mixed content.**

That is a transport limit of today's testnet and *not* a trust or availability hole, which is worth
saying plainly because it is the first thing a careful reader will worry about: the store is
**content-addressed**. The pointer *is* the hash of the bytes, and the chain holds it — so the bytes may
arrive from 0G, from a mirror, from a cache, or from the tag itself, and a substituted byte simply fails
to hash. **The chain is the authority; everything else is a courier.**

**0G's fee market is unusual, and Foundry guesses it wrong — twice.** The base fee is **7 wei**, so the
tip is effectively the entire price, and the node enforces a **~2 gwei minimum priority fee**. Foundry
does not ask the node what to pay: it derives a tip from `eth_feeHistory`, sees nearly nothing, and
offers 1 wei — which is refused (`gas tip cap 1, minimum needed 2000000000`). Pin the tip and it fails
the *other* way, because Foundry computes `maxFeePerGas` from the base fee alone and offers 15 wei,
beneath the tip it was just told to pay. **Both numbers must be stated:**

```bash
forge script … --priority-gas-price 4gwei --with-gas-price 6gwei     # and `cast` wants --gas-price
```

**The Go relayer needs none of this**, and is deliberately given none: abigen's bindings *ask the node*
(`SuggestGasTipCap` → 4 gwei) instead of guessing, which is why they priced themselves correctly on the
first try, on a chain they had never seen. These flags exist for the two tools that guess.

## Toolchain

| | |
|---|---|
| Foundry | forge 1.7.1 · solc **0.8.36** · `evm_version = "cancun"` (0G's requirement) |
| Go | **1.26.5** (the 0G Storage client needs ≥1.23) · go-ethereum **v1.15.11** (the version that client pins) |
| Node | 20.20.2 · Next.js 16.2.10 · viem 2.55.0 |

OpenZeppelin (v5.6.1) and forge-std are vendored under `contracts/lib` as plain clones, so a fresh
checkout builds with no submodule and no network step.

```bash
cd contracts && forge build && forge test          # 222 tests
cd relayer   && go build ./... && go test ./...
cd web       && npm install && npm run build
```

The Go contract bindings and the web's ABIs are **generated** from `contracts/out`, never committed:

```bash
relayer/scripts/gen-bindings.sh     # needs: go install github.com/ethereum/go-ethereum/cmd/abigen@v1.15.11
cd web && npm run sync              # also runs automatically before dev/build/lint
```

## Environment

Two git-ignored files at the repository root. Nothing is defaulted: a relayer that invents a key when its
environment is incomplete is a relayer that will one day sign with the wrong one.

**`.env.0g`** — the operator, and where 0G lives:

```bash
GLASS_STORAGE=0g                                              # `0g`, or unset for the local file store
GLASS_0G_RPC=https://evmrpc-testnet.0g.ai                     # 0G Galileo, chain id 16602
GLASS_0G_INDEXER=https://indexer-storage-testnet-turbo.0g.ai  # 0G Storage's public indexer
GLASS_0G_KEY=0x…                                              # the operator: runs the till, pays for uploads
GLASS_0G_ADDRESS=0x…
```

**`.env.testnet`** — the five accounts that are *not* the operator's, each holding only enough gas to
send its own transactions:

```bash
GLASS_CREATOR_KEY=0x…              # signs vouchers, writes her own prices, challenges a claim in her own name
GLASS_LANDLORD_KEY=0x…             # registers the account he is to be paid into
GLASS_COMMUNITY_KEY=0x…            # the same, for the referral share
GLASS_BUYER_KEY=0x…                # registers where she is to be refunded. Her purchase is sponsored.
GLASS_STRANGER_KEY=0x…             # sends the permissionless touches. Holds no position in any of it.
GLASS_OPERATOR_RECIPIENT=0x…       # the operator's treasury account, kept apart from its hot key
```

**The separation is not hygiene, it is the demonstration.** The landlord and the community owner hold
keys for exactly one reason — each must register their own payout account — because an operator that
could write that record would be asserting the very fact it is later supposed to prove. The buyer holds
one for the same reason and no other: she registers *where she is to be refunded*, and everything else
she does is sponsored. And the stranger's key is the whole argument in miniature: **collecting somebody
else's default costs a passer-by a fraction of a naira and requires the permission of nobody.**

`scripts/testnet.sh` funds the five from the operator, skips any that already hold enough, and re-reads
the *balance* rather than trusting a receipt — because the public RPC is load-balanced and will
occasionally deny knowing a transaction it has already mined.

### Getting the gas

The operator's key is funded from the faucet, and only a human can claim it:

1. **https://faucet.0g.ai** — 0.1 0G per wallet per day, browser flow with a captcha.
2. The Google Cloud 0G faucet — https://cloud.google.com/application/web3/faucet/0g/galileo.

Paste in the address from `GLASS_0G_ADDRESS`. Then check it landed, and confirm the store works:

```bash
cast balance $GLASS_0G_ADDRESS --rpc-url $GLASS_0G_RPC --ether
cd relayer && go run ./cmd/storagesmoke       # upload → download → byte-comparison, and the real cost
```

An upload to 0G Storage is a submission transaction on the 0G chain, so publishing costs gas — about
**0.0012 0G per blob**, dominated by the transaction rather than the payload (a voucher and an
attestation cost the same). **Bytes already on the network are never paid for twice:** the uploader
computes the file's Merkle root locally, asks the storage nodes whether they already hold it, and submits
only if they do not. A failed rehearsal is therefore cheap to retry, and publication resumes where it
stopped.

### Storage backends

`GLASS_STORAGE=0g` publishes to 0G Storage, and the on-chain pointer is the file's **Merkle root** — not
the submission's transaction hash, which is a different 32 bytes that resolves to nothing. Unset, the
relayer writes content-addressed files under `artifacts/demo/blobs` and the pointer is the keccak of the
bytes, which is what makes the local demo runnable on a laptop with no network at all. The backend is
chosen in one place, it is printed every time it is used, and the web must be pointed at the same one
(`NEXT_PUBLIC_STORAGE`) — a consignment published to one store cannot be read out of the other.

The web reads its chain and its store from the environment too:

```bash
NEXT_PUBLIC_CHAIN_ID=16602
NEXT_PUBLIC_RPC_URL=https://evmrpc-testnet.0g.ai
NEXT_PUBLIC_STORAGE=0g
NEXT_PUBLIC_0G_INDEXER=https://indexer-storage-testnet-turbo.0g.ai
```

There is no operator endpoint in that list, and there never may be one.

## The question everybody asks

> *"Isn't Good just marking its own homework? It is the one telling the chain that it paid."*

There is a test named after the answer: **`TestTheOperatorCanForgeItsOwnWebhookPerfectly`**
(`relayer/internal/feeds/processor_test.go`). We signed a payment notification for a payment that never
happened, using the operator's own secret, and watched it verify perfectly — because of course it does.
The operator holds the key.

**That is precisely why a signed webhook is never evidence in this protocol.** It is a doorbell. What
goes on-chain is a *claim*: an assertion the operator is on the hook for, which dies if a recipient
challenges it and the operator cannot prove it, or if no sweep ever covers it, or if a deadline simply
passes. Every one of those is somebody else's key — or nobody's at all.

The same instinct runs through the tests that matter. `web/scripts/verify-offline.mjs` does not merely
check that verification works with the operator dead; it wiretaps the process and **fails on any host it
cannot account for**. It was blind once — the 0G TS SDK speaks axios, not `fetch`, so an earlier version
watched the wrong thing and would have reported a clean bill of health it had no way to know was true.
**A test that cannot see the thing it certifies is worse than no test**, because it manufactures
confidence.
