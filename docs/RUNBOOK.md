# The demo, in one page

Seven proofs, in the order the story tells them. One command runs all of it; the acts below are what to
say while it does, and what to point at when it does.

```bash
relayer/scripts/testnet.sh          # 0G Galileo, real gas, real clocks — about 21 minutes
relayer/scripts/e2e.sh              # the same seven proofs on a local chain — about 40 seconds
```

Open the ledger at **http://localhost:3000** and leave it on the screen throughout.

> **Serve the page from `http://localhost`, never `https://`.** 0G's storage nodes are plain-`http://`
> IP addresses and the browser fetches the vouchers from them *directly*, so an HTTPS page would have
> every storage read blocked as mixed content. This is a transport limit of today's testnet and not a
> trust one — the store is content-addressed, so a substituted byte simply fails to hash. The chain is
> the authority; everything else is a courier.

---

## Why it takes twenty-odd minutes, and why that is the right answer

Because the windows are real. Settlement is 3 minutes, the challenge window 2, the operator's response 1,
sweep coverage 5, fulfilment 3 — and on a public chain they are **waited out**, because a public chain
has no `evm_increaseTime` and should not have one. The local run finishes in forty seconds by pushing a
development chain's clock forward; the testnet run cannot, and does not pretend to.

**Budget 20–25 minutes** — two measured runs took 21.4 and 22.9. About fourteen of those minutes are the
windows, and that part is fixed; the deployment and the sixteen uploads to 0G Storage are the rest, and
the uploads are the part that wanders. Do not promise a number to the minute; promise the windows.

The contracts are handed the same numbers on both networks and cannot tell the difference. **Nothing
about a deadline is decided by the relayer: a debt is in default because its deadline passed, and it
would be in default if this program had never been written.** The relayer only turns up afterwards, so
that somebody can collect it.

If the room is short on time, run the local script and say that sentence. If the room is sceptical, run
the testnet script and let the clock be boring in public — the boredom *is* the proof.

---

## Act 0 — The shop opens

```bash
demo seed            # what the script runs for you
```

> creator `0x7099…79C8` registered as #1 · tranche #1 posted: root `0xfbd8c8ea…` over 13 items ·
> price book seeded **by the creator's own key** · four payout accounts on file, **each written by its
> own owner** · pool ₦400,000 · allowance ₦450,000 · **13 vouchers published to 0G Storage**

Thirteen dresses in Ikoyi. The line to land: the operator did **not** write the prices and did **not**
write anybody's payout account. It cannot. An operator that could name the account it later claims to
have paid would be asserting the very fact it is supposed to prove.

> **Expect a wall of yellow here, and do not flinch at it.** Publishing thirteen vouchers to 0G Storage
> takes two or three minutes, and each upload prints `level=warning msg="Log entry is unavailable yet"`
> a few times while a storage node catches up with the block carrying that upload's own transaction.
> Nodes trail the chain head by a handful of blocks; the client waits and succeeds. It is the inside of
> a retry loop, not a fault — and it is left visible on purpose, because a condition that is real should
> not be hidden just because it is ugly.

## Act 1 — P1: the atomic sale

> item 1001 sold on the instant rail for ₦100,000 — **4 debts minted**, and the claim asserting the rail
> already paid them posted **in the same transaction**
> buyer `0x15d3…6A65` redeemed the certificate for item 1002 with the code on her receipt — item state:
> **OWNED**. *She sent no transaction, holds no gas, and owns the certificate anyway.*

One transaction: the tag is checked, the shelf is checked, the ceiling is checked, the item is consumed,
the split is owed, and the certificate exists. **There is no ordering in which the operator takes the
money and skips a step, because the steps are one step.**

## Act 2 — P2: the counter defends itself

> the same tag, a second time → **`AlreadySold(1001)`**
> a tag the creator never signed → **`UnknownCreatorSignature`**

Named by the contract, decoded from the public chain's own revert data. A clone is not a special case —
the state machine *is* the nullifier. And note what these cost: **nothing.** A refused sale never becomes
a transaction at all.

## Act 3 — P4: the settlement clock

Three cash sales, three fates, and the recipient does nothing in any of them.

- **The honest one.** Claim posted → challenge window closes → *settled* → the sweep covers it → **PROVEN**
  → the operator's allowance grows **+₦1,050**. *Capacity is bought with proof, not with silence.*
- **The lie.** The operator claims a payment it never made. The creator challenges **from her own key,
  through a public RPC** — not through us. The operator answers with evidence it does not have →
  **`ProofRejected(4)`** → void → a ₦1,137.50 fine → and the debt comes back **at the age it always had**.
  Stalling costs more than doing nothing, and it can be tried exactly once.
- **The sleeper.** Nobody challenges. The claim settles on silence — and then **dies anyway** at the
  coverage deadline, because no sweep could ever cover a payment that never happened. *She was protected
  by arithmetic, not by vigilance.*

## Act 4 — The operator buys itself a reputation, and the two sales it will not pay

Before anything goes wrong, the operator does something entirely legal, entirely public and entirely
successful: **it invents a creator.** It consigns her imaginary dresses, sells them to itself, pays
accounts it controls, and attests to those payments with a proof that is **valid** — because the money
really moved.

> creator `0xd3BD…8290` registered as **#2** — and she is the operator, signing with the operator's own key
> tranche #2 posted for her: 3 items at ₦25,000,000 each, and the operator is her landlord too
> item 2001 sold to the operator for ₦25,000,000, paid to the operator, and proven by the operator
> item 2002 — the same
>
> creator **#2 (invented)**: allowance ₦450,000 → **₦875,000** — the operator conjured **₦425,000** of
> capacity out of a counterparty it made up, and the protocol was right to credit it
> creator **#1 (real)**: allowance ₦451,050 → **₦451,050.** Not one kobo. She was not part of this.

**Say this part slowly, because the room will assume you are showing them a bug.** Nothing here was
forged. The dresses were consigned, the sales went through, the money moved, and the proof was *valid* —
the operator really did pay those accounts, and they were its own. The protocol was told the truth at
every step. The only lie in the entire loop is a **person**, and telling a manufactured counterparty from
a real one is a problem nobody has ever solved. This protocol does not try. It makes the answer
worthless instead, and Act 5 is where you show them.

Then the two sales that go wrong: a cash sale the operator will never pay and never even lie about (P5),
and the dress that quietly went home in somebody's bag, which a stranger now buys (P3).

> **and THIS is why the shop cannot sell off the books.** Not because the cash is watched — it is not.
> Because the *item* is: its twin is still listed, still buyable by anyone in the world, and the operator
> can no longer deliver it. Selling quietly does not erase the obligation. It opens a short position that
> a stranger can call — **and one just did.**

That sentence is not optional. A cold reader who was shown this demo without it concluded, unprompted,
that Good *could* sell off the books. See question 5 below.

## Act 5 — P5: the stalled payout (**the thesis**), and what the reputation was worth

The operator sells a dress for cash and simply never pays. It does not lie, does not stall, does not
file anything. Nothing happens procedurally. The debt ages, in public, in red.

Then the deadline passes and **a stranger** — an account with no position in any of this — touches it:

> `0x7099…79C8` **paid ₦120,000 from the pool, in full, having sent no transaction of her own**
> the operator's capacity with creator #1 written down to **₦0**; it owes the pool ₦120,000, and its
> growth is frozen — **with everybody, not only with her**

And the beat the whole protocol exists for — the very next cash sale, at the counter:

> the next cash sale → **`OverCeiling(1, 157500000000000000000000, 0)`**
> **the till is shut. Not by a policy, not by a person — by arithmetic that anybody can check.**

The refusal names the creator, because the till can be open for one and shut for another in the same
instant. Then sell the *same item* on the instant rail and watch it go through: the ceiling constrains
**custody**, and custody only. Commerce does not stop; the right to hold other people's money does.

**And now cash in Act 4.** The operator is holding a reputation it manufactured. This is the moment it
would spend it:

> creator **#1**: allowance ₦0 · headroom **₦0**
> creator **#2**: allowance ₦875,000 · headroom **₦1,036,062.50**
>
> the cash sale of the REAL creator's dress, one more time → **`OverCeiling(1, 166250000000000000000000, 0)`**

**The operator is standing on over a million naira of headroom and cannot spend one kobo of it**, because
it is headroom *with a creator who does not exist*. Under a single pooled allowance those two lines would
be one line, and the ₦425,000 would be sitting in the same pot as hers, ready to be spent on her dresses.
That was the hole. Here they are two lines, and hers is zero.

> A reputation you build by trading with yourself is a reputation you can only spend on yourself.

Then it tries to farm again, from here, and hits a **second, different lock**:

> → **`GrowthFrozen(9, 120000000000000000000000)`**

It cannot even do that. Growth is frozen the moment the operator owes the pool — with every creator at
once, the invented one included. **It cannot farm its way out of a hole it is standing in.** There is
exactly one road back, and it is the one the ledger has been pointing at since the default: pay the pool
what it covered for you. *(This is also why the farm happens in Act 4 rather than here: a farmer has to
stock up before it goes wrong. That is forced by the protocol, not chosen by the script.)*

## Act 6 — P3 and P6

- **P3, the standing buy option.** The dress that "went home in somebody's bag" is still listed, so a
  stranger buys its digital twin. The operator cannot deliver what it does not have. The fulfilment
  window expires and the buyer is **refunded ₦160,000 from the pool, having sent nothing.** *Nobody
  accused anyone. The ledger did it.*
- **P6, the write-off.** "Water damage." The burn pays everyone as if the item had sold: ₦148,750 out,
  plus a ₦1,700 fee to the pool. On screen, the arithmetic, side by side:

  > an honest sale would have earned the operator **₦21,250** · laundering it earns **₦19,550**.
  > Strictly less — and it is less at every price.

## Act 7 — The road back, and the bill

Fines collected, the pool reimbursed, and **the write-down still standing.** There is no payment that
retroactively un-defaults a debt. Capacity heals only the way it was built: through settled volume,
proven, and only forward from the day the pool was squared.

Then the bill — `docs/gas-table.md`, rendered from the receipts of the run that just happened.

---

## The kill switch (do this last, and do it live)

The script stops the operator's process and then verifies four tags with it dead — from the CLI, and
from the browser's own verification module.

```
  operator: up
  operator: down
  ✓ P2.1  genuine, unsold        ✓ P2.2  forged tag — no registered creator signed this
  ✓ P2.3  cloned tag of a sold item     ✓ P2.4  the off-books contradiction
  ✓ every browse case verified with the operator dead, and not one call went near it.
```

It prints every host verification touched: the chain's public RPC, the page's own origin, 0G's public
indexer, and the storage nodes that indexer vouches for. **Nothing of Good's.** An unaccountable host is
a test failure, not a footnote.

---

## The six questions you will be asked

These are not hypothetical. Two people who had never seen this project were handed nothing but the demo's
transcript and asked what they made of it; between them they asked the first five, unprompted, and four
of those five are fair. The sixth is the sharpest thing anybody can ask about this design, and **Act 4
answers it before it is asked** — but have the words ready in case somebody gets there first.

**1. "The oracle is a stub. Isn't that the whole system?"** — *Yes, and it is the one thing we did not
build.* The MVP ships the real **interface** with a stub behind it, deliberately (a real zkTLS prover is
its own workstream and would have held the demo hostage). But note the shape of the seam, because it is
not a shortcut: the sweep assembles the statement it verifies **from on-chain captured state**
(`statementOf`) — the operator supplies the proof and never the statement, so it cannot choose what is
being proved. And **there is no `setVerifier` anywhere in this system.** Swapping the stub for the real
verifier is a fresh deployment, not a config change: the operator cannot quietly redefine what counts as
proof. That is the integration target, and nothing else moves when it lands.

**2. "What happens when the loss is bigger than the pool?"** — The pool **pays what it has**, says so on
the chain (`PoolShortfall`), and **the write-down still lands on the whole defaulted amount**
(`test_aPoolTooSmallPaysWhatItHasAndSaysSo`). The pool is a buffer, not an insurance policy, and the
recipient is left short — that is the honest answer and it should be given plainly. What the operator
cannot do is profit from it: the loss it caused is written off its own capacity in full.

**3. "Who is the stranger, and what pays them to turn up?"** — Nothing, and **nothing needs to.** Two
things make keeper apathy harmless. First, the wronged party can send that transaction *herself*, for
about **₦0.14** — the stranger is in the demo to prove she does not *have* to, not because she cannot.
Second, and this is the part people miss: **an unpaid debt eats the operator's ceiling from the moment it
is minted**, aging and untouched, whether anybody collects it or not. The touch is what gets the *creator
her money*; it is not what punishes the operator. The operator is already in the cage.

**4. "What actually moved? What currency is any of this in?"** — On-chain, the pool holds a test
stablecoin (`MockNGN`) and really transfers it; production is cNGN or USDC on the same rails. The **fiat**
leg — operator's bank to creator's bank — is *not* on this chain and never will be. That leg is exactly
what the zkTLS proof attests to, and it is the reason the settlement machinery exists at all. Say this
before you are asked; a payments demo that never names its asset invites the question in a worse form.

**5. "So Good just can't sell off the books?"** — Watch how you answer, because this is the one a cold
reader got **wrong**, and rejected outright: *"the system polices the ledger, not the shop — off-books
cash is invisible."* And that is true! The cash **is** invisible. The answer is that the *item* is not:
its twin stays listed, buyable by anyone on earth, and the shop can no longer deliver it. Selling quietly
does not erase the obligation — it opens a short position a stranger can call, which is precisely what
Act 6 shows. Say that sentence out loud at the moment the stranger buys item 1007, or the room will draw
the opposite conclusion and be sure it is right.

**6. "Good earns its own reputation. So it can just fake the counterparty and print it."** — **Yes. It
can, it does, and you watched it work in Act 4.** Do not argue with this question; concede it completely,
because conceding it is the answer. Good invented a creator, sold her imaginary dresses to itself, paid
its own accounts, proved every payment — and every step was *true*, which is why no detector could ever
have caught it. Telling a manufactured counterparty from a real one is a problem nobody has solved, and
this protocol does not pretend to.

It makes the answer worthless instead. **Capacity is bilateral**: earned with a creator, spendable only
on that creator's goods. So the farm succeeds completely and buys an empty room — ₦425,000 of real,
credited, honestly-earned capacity, usable only on the dresses of a woman who does not exist. Point at
the two lines on the ledger: creator #1 at zero, creator #2 at ₦875,000, and the till still refusing.
*A reputation you build by trading with yourself is a reputation you can only spend on yourself.*

And if they push — *"then it just farms after it defaults, to dig itself out"* — no: **growth is frozen
the moment it owes the pool**, with every creator at once, the invented one included. It cannot farm its
way out of a hole it is standing in. There is one road back and it is paying the pool. Both locks are on
screen in Act 5; the tests are `test_theFarmThatBuysNothing` and `test_theRecordCannotBeFarmed`.

**One thing to be honest about if it comes up:** the same reasoning is why the protocol publishes **no
score** — the only global number is a record of *failure*, in absolute counts and amounts, with no rate
anywhere in it. A rate has a denominator, and a denominator is exactly what a farmer manufactures.

## And the question behind all of them

> *"Isn't Good just marking its own homework? It's the one telling the chain it paid."*

No — and there is a test named after the reason: **`TestTheOperatorCanForgeItsOwnWebhookPerfectly`**
(`relayer/internal/feeds/processor_test.go`). We signed a payment notification for a payment that never
happened, with the operator's own secret, and watched it verify perfectly. Of course it did: the operator
holds the key.

**That is why a signed webhook is never evidence in this protocol.** It is a doorbell. What goes on-chain
is a *claim* — an assertion the operator is on the hook for — and a claim is killed by a challenge it
cannot answer, or by a sweep that never covers it, or by a deadline that simply passes. Every one of
those is somebody else's key, or nobody's at all.
