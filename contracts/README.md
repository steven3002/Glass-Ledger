# Contracts

Solidity contracts for the Glass Ledger protocol, built with [Foundry](https://getfoundry.sh/).

## Toolchain

- Solidity `0.8.36` (pinned in `foundry.toml`)
- EVM target `cancun` — required by 0G Chain, and exercised: the sale gateway's reentrancy guard
  uses transient storage, so a green build is evidence the target is right rather than an assumption
- Dependencies vendored under `lib/`: `forge-std` v1.16.2, `openzeppelin-contracts` v5.6.1

## Build

```shell
forge build            # development profile (optimizer runs: 200)
FOUNDRY_PROFILE=production forge build   # deployment profile (optimizer runs: 10000)
```

## Test

```shell
forge test
forge snapshot         # refresh .gas-snapshot
```

Demo and production deployments run identical bytecode paths: window and economic
parameters are constructor arguments, never compile-time switches.

## Modules

| Path | What lives there |
|---|---|
| `identity/CreatorRegistry` | The root of trust. A creator's key, the EIP-712 domain her vouchers are signed under, and the digest that is both her signature's subject and the tranche's Merkle leaf. |
| `items/ItemLedger` | Consignments and the life of an item. A tranche is a Merkle root; item storage is lazy, so posting thirteen items costs one root. Consumption is terminal — the state machine is the nullifier. |
| `items/PriceBook` | What an item costs, in the currency of the place it is sold. One key writes prices; a posted change takes effect at the next epoch boundary. |
| `sale/SaleGateway` | The only path that consumes an item, and the reason the ledger can be trusted: one call checks the tag, the shelf and the ceiling, consumes the item, mints what is owed and issues the certificate. |
| `debt/DebtLedger` | What the operator owes, to whom, since when. Debts age from the second the item leaves the shelf; time moves them toward default and never toward paid. |
| `interfaces/`, `oracle/IProofVerifier` | The three seams the rest of the protocol is built against: the debt ledger, the ceiling, and the evidence verifier. |
| `libs/` | Shared codes (`Types`), deadline and epoch arithmetic (`WindowMath`), claim-code commitments (`ClaimCodes`). |

## Who may do what

| Actor | May |
|---|---|
| operator | Register creators, post consignments, sell, take and fulfil orders. Wires the deployment once, permanently. |
| creator (her registered key) | Sign vouchers off-chain; seed and reprice her items. Nobody else writes a price. |
| sale gateway | The only account that may consume or reserve an item, and the only one that mints debts. |
| anyone | Release an order the operator failed to fulfil in time, and redeem a certificate with its claim code. A buyer's way out never runs through the party that let them down. |

Tranche proofs are a binary Merkle tree over the ordered voucher digests, hashing each pair
commutatively — the convention OpenZeppelin's `MerkleProof` verifies. Any off-chain builder whose
proofs verify under that walk is a valid builder.
