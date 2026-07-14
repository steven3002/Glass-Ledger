# The bill

What the Glass Ledger costs to run on 0G Galileo (chain 16602), measured from the receipts of one complete
rehearsal — every proof, end to end, on real clocks.

**Nothing in this table is an estimate.** Every row is a transaction the chain mined, at the price
the chain charged. The hashes are in `../artifacts/demo/16602/gas.jsonl` and in the deployment's broadcast record, and this file
is rendered from them by `relayer/cmd/gastable` rather than written by hand: re-render it and the
numbers come back the same, because they were never ours to choose.

The naira column converts at **236.63 ₦/0G**. CoinGecko, 2026-07-14

A testnet token has no price, so that rate is the market's price for the *mainnet* token and the
naira column is therefore a projection: what these transactions would cost on a chain whose gas
behaves as this one's does. The gas is measured; the money is arithmetic on somebody else's
exchange rate, and it moves when they do.

## What the protocol charges to do its job

| Operation | Times | Gas | Cost, once | ₦, once |
|---|---|---|---|---|
| mint | 1 | 68,467 | 0.00027387 0G | ₦0.0648 |
| approve pool | 1 | 46,678 | 0.00018671 0G | ₦0.0442 |
| register creator | 1 | 67,771 | 0.00027108 0G | ₦0.0641 |
| post tranche | 1 | 167,330 | 0.00066932 0G | ₦0.1584 |
| seed prices | 1 | 652,340 | 0.00260936 0G | ₦0.6175 |
| account: creator | 1 | 46,164 | 0.00018466 0G | ₦0.0437 |
| account: landlord | 1 | 46,176 | 0.0001847 0G | ₦0.0437 |
| account: community | 1 | 46,164 | 0.00018466 0G | ₦0.0437 |
| account: buyer | 1 | 46,176 | 0.0001847 0G | ₦0.0437 |
| deposit skim | 8 | 47,802–81,978 | 0.00019121 0G | ₦0.0452 |
| register creator (the invented one) | 1 | 50,671 | 0.00020268 0G | ₦0.0480 |
| post tranche (the invented one) | 1 | 150,230 | 0.00060092 0G | ₦0.1422 |
| seed prices (the invented one) | 1 | 182,294 | 0.00072918 0G | ₦0.1725 |
| account: the invented creator | 1 | 46,176 | 0.0001847 0G | ₦0.0437 |
| publish a blob to 0G Storage | 21 | 279,501–434,561 | 0.00114407 0G | ₦0.2707 |
| sell (instant) | 3 | 739,492–790,792 | 0.00295797 0G | ₦0.6999 |
| redeem certificate | 1 | 41,441 | 0.00016576 0G | ₦0.0392 |
| sell (cash) | 4 | 543,425–577,625 | 0.00230183 0G | ₦0.5447 |
| post claim | 3 | 317,685 | 0.00127074 0G | ₦0.3007 |
| settle claim | 2 | 81,221–90,821 | 0.00036328 0G | ₦0.0860 |
| inject verdict | 5 | 29,663–49,575 | 0.0001983 0G | ₦0.0469 |
| submit evidence | 5 | 70,823–70,835 | 0.00028334 0G | ₦0.0670 |
| attest | 5 | 128,368–225,625 | 0.00078145 0G | ₦0.1849 |
| credit settlement | 3 | 125,212–178,103 | 0.00065111 0G | ₦0.1541 |
| challenge | 1 | 36,154 | 0.00014462 0G | ₦0.0342 |
| void claim | 1 | 234,796 | 0.00093918 0G | ₦0.2222 |
| touch claim | 1 | 162,759 | 0.00065104 0G | ₦0.1541 |
| sell (instant, to itself) | 3 | 646,325–647,109 | 0.00258829 0G | ₦0.6125 |
| commit option | 1 | 488,563 | 0.00195425 0G | ₦0.4624 |
| touch debt | 2 | 138,611–207,811 | 0.00083124 0G | ₦0.1967 |
| expire commitment | 1 | 62,051 | 0.0002482 0G | ₦0.0587 |
| burn | 1 | 375,879 | 0.00150352 0G | ₦0.3558 |
| collect penalty | 3 | 91,714 | 0.00036686 0G | ₦0.0868 |
| collect pool dues | 1 | 71,874 | 0.0002875 0G | ₦0.0680 |
| reimburse | 1 | 93,725 | 0.0003749 0G | ₦0.0887 |

**Look twice at the storage row.** Those 21 uploads carried payloads of **116 to 955 bytes**, and
the gas ran from 279,501 to 434,561. That is *flat* — and not flat in the direction anybody expects,
because the dearest upload of the run was a **116-byte** blob. **The price of publishing is the
submission transaction; the bytes ride along for nothing.** A voucher and a sweep's evidence cost
the same, and what either one leaves on-chain is 32 bytes: a Merkle root.

The storage fee proper — what a submission carries to the storage contract as value, as against
what it burns as gas — is the rounding error inside the rounding error: **0.00000012 0G of fee against 0.00114394 0G
of gas**, or one part in 9,305.

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
| deploy CreatorRegistry | 699,587 | 0.00279835 0G | ₦0.6622 |
| deploy ItemLedger | 1,305,690 | 0.00522276 0G | ₦1.24 |
| deploy PriceBook | 823,392 | 0.00329357 0G | ₦0.7794 |
| deploy StubProofVerifier | 378,571 | 0.00151428 0G | ₦0.3583 |
| deploy DebtLedger | 3,594,732 | 0.01437893 0G | ₦3.40 |
| deploy SweepRegistry | 881,144 | 0.00352458 0G | ₦0.8340 |
| deploy MockNGN | 563,836 | 0.00225534 0G | ₦0.5337 |
| deploy Allowance | 1,573,129 | 0.00629252 0G | ₦1.49 |
| deploy Pool | 1,264,380 | 0.00505752 0G | ₦1.20 |
| deploy SaleGateway | 2,703,108 | 0.01081243 0G | ₦2.56 |
| wire ItemLedger.setSaleGateway | 50,022 | 0.00020009 0G | ₦0.0473 |
| wire DebtLedger.setSaleGateway | 50,100 | 0.0002004 0G | ₦0.0474 |
| wire DebtLedger.setPool | 52,998 | 0.00021199 0G | ₦0.0502 |
| wire DebtLedger.setSweepRegistry | 52,996 | 0.00021198 0G | ₦0.0502 |
| wire Allowance.setPool | 52,959 | 0.00021184 0G | ₦0.0501 |
| wire Pool.setSaleGateway | 50,041 | 0.00020016 0G | ₦0.0474 |
| **the whole protocol, deployed** | **14,096,685** | **0.05638674 0G** | **₦13.34** |

## Who paid for it

| Account | | Transactions | Spent |
|---|---|---|---|
| `0xd3BDc969bc9c5E944a346686d57eb042fD9d8290` | the the invented creator | 72 | 0.0711352 0G |
| `0xA6df2D4369D9e0912a7BB4B869D199A9893c843E` | the creator | 3 | 0.00293863 0G |
| `0xC1f5d62509F5861fC9B7392894E36B58C1b94315` | the landlord | 1 | 0.0001847 0G |
| `0xE297849CcB1f58a065673169F911d85e65646cF3` | the community | 1 | 0.00018466 0G |
| `0xaD0d56846Fbc2297840D7B4e46A0E8f17e148c86` | the buyer | 1 | 0.0001847 0G |
| `0x9D2d6849DFe240f905fab378FDE45EAd76738A27` | a stranger | 11 | 0.00530034 0G |

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

**A whole rehearsal costs 0.13631498 0G.** Standing the protocol up from nothing (0.05638674 0G) and then running it
through its own worst day — every sale, every claim, every lie, every default, every write-off, and
every byte published to 0G Storage (0.07992824 0G).

*(That is what the protocol charged. The rehearsal also hands the five other parties enough gas to
send their own transactions, which `cast` does outside this ledger and a re-run skips — see the
README for the measured end-to-end figure.)*

**And it costs 0.00083124 0G to collect somebody else's default.** One transaction, sent by an account with
no position in any of this, which pays a creator who is not watching out of a pool she does not
control. It cannot be stopped and it needs nobody's permission — and at ₦0.1967 to send, it does not
need a motive either. That is the whole of the enforcement mechanism: not a regulator, not a
complaints desk. A number small enough that somebody will do it out of spite.

The stranger's 11 transactions in this run — both defaults, the lapsed claim, and the fines and
pool dues it collected on everyone else's behalf in the last act — came to **0.00530034 0G** in total.

## Against what it costs to accept the money

The claim is not that this is cheap in the abstract. It is that putting a sale on the Glass
Ledger costs a rounding error **against the fee that sale already pays to be accepted at all**.

On a ₦100,000 dress — the cheapest thing on this shelf:

| | |
|---|---|
| the card fee, to move the money (Paystack, local card) | **₦1,600** |
| the packed sale, to make the money *owed* — tag checked, shelf checked, ceiling checked, item | |
| consumed, four debts minted, certificate committed, claim code issued, all in one transaction | **₦0.6999** |

**The ledger costs 2286 times less than the card fee it rides beside**. The protocol does not replace the processor and does not want to: the card fee buys the
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

