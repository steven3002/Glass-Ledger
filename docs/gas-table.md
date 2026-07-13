# The bill

What the Glass Ledger costs to run on 0G Galileo (chain 16602), measured from the receipts of one complete
rehearsal — every proof, end to end, on real clocks.

**Nothing in this table is an estimate.** Every row is a transaction the chain mined, at the price
the chain charged. The hashes are in `../artifacts/demo/16602/gas.jsonl` and in the deployment's broadcast record, and this file
is rendered from them by `relayer/cmd/gastable` rather than written by hand: re-render it and the
numbers come back the same, because they were never ours to choose.

The naira column converts at **247.37 ₦/0G**. CoinGecko, 13 July 2026 (`zero-gravity`: $0.1793 / ₦247.37).

A testnet token has no price, so that rate is the market's price for the *mainnet* token and the
naira column is therefore a projection: what these transactions would cost on a chain whose gas
behaves as this one's does. The gas is measured; the money is arithmetic on somebody else's
exchange rate, and it moves when they do.

## What the protocol charges to do its job

| Operation | Times | Gas | Cost, once | ₦, once |
|---|---|---|---|---|
| mint | 1 | 68,467 | 0.00027387 0G | ₦0.0677 |
| approve pool | 1 | 46,678 | 0.00018671 0G | ₦0.0462 |
| register creator | 1 | 67,771 | 0.00027108 0G | ₦0.0671 |
| post tranche | 1 | 167,318 | 0.00066927 0G | ₦0.1656 |
| seed prices | 1 | 652,340 | 0.00260936 0G | ₦0.6455 |
| account: creator | 1 | 46,164 | 0.00018466 0G | ₦0.0457 |
| account: landlord | 1 | 46,176 | 0.0001847 0G | ₦0.0457 |
| account: community | 1 | 46,164 | 0.00018466 0G | ₦0.0457 |
| account: buyer | 1 | 46,176 | 0.0001847 0G | ₦0.0457 |
| deposit skim | 8 | 47,801–81,977 | 0.0001912 0G | ₦0.0473 |
| publish a blob to 0G Storage | 15 | 289,235–300,969 | 0.00117029 0G | ₦0.2895 |
| sell (instant) | 3 | 708,784–760,120 | 0.00283528 0G | ₦0.7014 |
| redeem certificate | 1 | 41,441 | 0.00016576 0G | ₦0.0410 |
| sell (cash) | 4 | 501,667–518,767 | 0.00207507 0G | ₦0.5133 |
| post claim | 3 | 312,107 | 0.00124843 0G | ₦0.3088 |
| settle claim | 2 | 72,062–76,862 | 0.00030745 0G | ₦0.0761 |
| inject verdict | 2 | 29,663–49,575 | 0.0001983 0G | ₦0.0491 |
| submit evidence | 2 | 70,823–70,835 | 0.00028334 0G | ₦0.0701 |
| attest | 2 | 128,346–218,010 | 0.00087204 0G | ₦0.2157 |
| credit settlement | 1 | 122,530 | 0.00049012 0G | ₦0.1212 |
| challenge | 1 | 36,132 | 0.00014453 0G | ₦0.0358 |
| void claim | 1 | 227,203 | 0.00090881 0G | ₦0.2248 |
| touch claim | 1 | 148,778 | 0.00059511 0G | ₦0.1472 |
| commit option | 1 | 448,583 | 0.00179433 0G | ₦0.4439 |
| touch debt | 2 | 112,929–145,129 | 0.00058052 0G | ₦0.1436 |
| expire commitment | 1 | 62,051 | 0.0002482 0G | ₦0.0614 |
| burn | 1 | 346,774 | 0.0013871 0G | ₦0.3431 |
| collect penalty | 3 | 91,714 | 0.00036686 0G | ₦0.0907 |
| collect pool dues | 1 | 71,843 | 0.00028737 0G | ₦0.0711 |
| reimburse | 1 | 93,791 | 0.00037516 0G | ₦0.0928 |

**Look twice at the storage row.** Those 15 uploads carried payloads of **116 to 955 bytes**, and
the gas ran from 289,235 to 300,969. That is *flat* — and not flat in the direction anybody expects,
because the dearest upload of the run was a **116-byte** blob. **The price of publishing is the
submission transaction; the bytes ride along for nothing.** A voucher and a sweep's evidence cost
the same, and what either one leaves on-chain is 32 bytes: a Merkle root.

The storage fee proper — what a submission carries to the storage contract as value, as against
what it burns as gas — is the rounding error inside the rounding error: **0.00000012 0G of fee against 0.00117016 0G
of gas**, or one part in 9,518.

These are the uploads that **cost** something, and that is not the same as the ones the run
published. A blob already on 0G is never paid for twice: the file's Merkle root is a pure
function of its bytes, computable locally with no gas, and the uploader submits a transaction
only when the storage nodes do not already hold that root. Republishing an identical blob is
therefore free, on any machine, with no local cache involved in the decision — which is why a
failed rehearsal is cheap to retry, and why publication resumes where it stopped rather than
starting again.

## What it cost to put the protocol there

Once, per deployment. An immutable protocol has no other way to change its mind, so this is also
what an upgrade costs.

| Transaction | Gas | Cost | ₦ |
|---|---|---|---|
| deploy CreatorRegistry | 699,587 | 0.00279835 0G | ₦0.6922 |
| deploy ItemLedger | 1,305,690 | 0.00522276 0G | ₦1.29 |
| deploy PriceBook | 823,392 | 0.00329357 0G | ₦0.8147 |
| deploy StubProofVerifier | 378,571 | 0.00151428 0G | ₦0.3746 |
| deploy DebtLedger | 3,359,311 | 0.01343724 0G | ₦3.32 |
| deploy SweepRegistry | 881,144 | 0.00352458 0G | ₦0.8719 |
| deploy MockNGN | 563,836 | 0.00225534 0G | ₦0.5579 |
| deploy Allowance | 1,091,581 | 0.00436632 0G | ₦1.08 |
| deploy Pool | 1,233,804 | 0.00493522 0G | ₦1.22 |
| deploy SaleGateway | 2,689,160 | 0.01075664 0G | ₦2.66 |
| wire ItemLedger.setSaleGateway | 50,022 | 0.00020009 0G | ₦0.0495 |
| wire DebtLedger.setSaleGateway | 50,100 | 0.0002004 0G | ₦0.0496 |
| wire DebtLedger.setPool | 53,100 | 0.0002124 0G | ₦0.0525 |
| wire DebtLedger.setSweepRegistry | 52,996 | 0.00021198 0G | ₦0.0524 |
| wire Allowance.setPool | 50,091 | 0.00020036 0G | ₦0.0496 |
| wire Pool.setSaleGateway | 50,065 | 0.00020026 0G | ₦0.0495 |
| **the whole protocol, deployed** | **13,332,450** | **0.0533298 0G** | **₦13.19** |

## Who paid for it

| Account | | Transactions | Spent |
|---|---|---|---|
| `0xd3BDc969bc9c5E944a346686d57eb042fD9d8290` | the operator | 48 | 0.04782078 0G |
| `0xA6df2D4369D9e0912a7BB4B869D199A9893c843E` | the creator | 3 | 0.00293854 0G |
| `0xC1f5d62509F5861fC9B7392894E36B58C1b94315` | the landlord | 1 | 0.0001847 0G |
| `0xE297849CcB1f58a065673169F911d85e65646cF3` | the community | 1 | 0.00018466 0G |
| `0xaD0d56846Fbc2297840D7B4e46A0E8f17e148c86` | the buyer | 1 | 0.0001847 0G |
| `0x9D2d6849DFe240f905fab378FDE45EAd76738A27` | a stranger | 11 | 0.004768 0G |

Read that table for what is *missing* from it. **The wronged creator sends nothing.** Her three
transactions are the shop opening — she registers her own payout account, writes her own prices, and
challenges one false claim in her own name. Through the whole of the stalled payout that this
protocol exists for, she does nothing, and she is paid anyway.

**And the buyer's single transaction is not her purchase.** She buys a dress with no wallet, no
account and no gas; she redeems her certificate with a code printed on a receipt; and when an order
cannot be delivered she is refunded in full — all of it sponsored, none of it hers to pay for. The
one transaction she sends is `account: buyer`: she registers *the account she is to be refunded
into*, in her own name, because the protocol will not let the operator name it for her. That
refusal is the point. (In production that account is created by a passkey at checkout, and she still
never sees a wallet — M6's work, not the MVP's.)

## The two numbers that are the argument

**A whole rehearsal costs 0.10941118 0G.** Standing the protocol up from nothing (0.0533298 0G) and then running it
through its own worst day — every sale, every claim, every lie, every default, every write-off, and
every byte published to 0G Storage (0.05608138 0G).

*(That is what the protocol charged. The rehearsal also hands the five other parties enough gas to
send their own transactions, which `cast` does outside this ledger and a re-run skips — see the
README for the measured end-to-end figure.)*

**And it costs 0.00058052 0G to collect somebody else's default.** One transaction, sent by an account with
no position in any of this, which pays a creator who is not watching out of a pool she does not
control. It cannot be stopped and it needs nobody's permission — and at ₦0.1436 to send, it does not
need a motive either. That is the whole of the enforcement mechanism: not a regulator, not a
complaints desk. A number small enough that somebody will do it out of spite.

The stranger's 11 transactions in this run — both defaults, the lapsed claim, and the fines and
pool dues it collected on everyone else's behalf in the last act — came to **0.004768 0G** in total.

## Against what it costs to accept the money

The claim is not that this is cheap in the abstract. It is that putting a sale on the Glass
Ledger costs a rounding error **against the fee that sale already pays to be accepted at all**.

On a ₦100,000 dress — the cheapest thing on this shelf:

| | |
|---|---|
| the card fee, to move the money (Paystack, local card) | **₦1,600** |
| the packed sale, to make the money *owed* — tag checked, shelf checked, ceiling checked, item | |
| consumed, four debts minted, certificate committed, claim code issued, all in one transaction | **₦0.7014** |

**The ledger costs 2281 times less than the card fee it rides beside**. The protocol does not replace the processor and does not want to: the card fee buys the
movement of money, and this buys the *obligation* — the part that today lives in a spreadsheet
nobody outside the building can read.

## What amortizes, and what does not

A sweep is one proof over a whole period, and it is tempting to leave it at *one proof spans
thousands of debts for pennies*. That sentence is true of the proof and false of everything else, so
the two are measured apart (`test_aSweepCostsWhatItsClaimsCostAndNotMore`, by differencing an
attestation over 1 claim against one over 11):

| | Gas |
|---|---|
| the attestation itself — the proof and the evidence, **once, however many claims it covers** | ~102,900 |
| **every covered claim, on top** — three debts moved to proven | **~45,500** |

So a batch amortizes the *proof*, and never the per-claim state writes. A sweep covering a thousand
claims costs about 45.6M gas and has to be split across blocks; it does not cost 102,900. Anybody
sizing a real operator's sweep budget should multiply, not hope.

## What the counter's refusals cost

Nothing. A sale the protocol will not allow — a tag already sold, a signature no registered creator
made, a cash sale over the ceiling — never becomes a transaction at all: it is refused when its gas
is estimated, and the operator pays for nothing. There is no row for these in the table above, and
their absence is the honest report. Defending the counter is free.

