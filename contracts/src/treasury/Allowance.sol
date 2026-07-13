// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {DebtLedger} from "../debt/DebtLedger.sol";
import {IDebtLedger} from "../interfaces/IDebtLedger.sol";
import {IPoolReserves} from "../interfaces/IPoolReserves.sol";
import {ISaleAuthorizer} from "../interfaces/ISaleAuthorizer.sol";
import {Types} from "../libs/Types.sol";

/// @title Allowance
/// @notice The operator's earned capacity, and the ceiling that capacity buys.
///
///         Nothing is staked here. The allowance is not money and cannot be seized — it is the
///         measure of how much of other people's money the network will let the operator hold at
///         once, and it is built out of payments the operator has actually proven it made. A default
///         takes five times the defaulted amount off it in one block. That asymmetry is the whole
///         deterrent: capacity is slow to earn and instant to lose.
///
/// @dev **Capacity is bilateral, and that is what closes the last hole in this protocol.**
///
///      An operator can invent a creator. It can consign that creator's imaginary dresses, sell them
///      to itself, pay the proceeds into accounts it controls, and prove every one of those payments
///      — because the payments are real. Every step is honest; only the counterparty is not. Under a
///      single pooled allowance that loop *manufactures* capacity, at roughly 57 kobo of skim per
///      naira conjured, and the operator can then spend the capacity taking custody of a **real**
///      creator's money. Nobody has ever solved the problem of telling a fake counterparty from a
///      real one, and this protocol does not try.
///
///      It makes the question irrelevant instead. Capacity is earned *with* a creator and spendable
///      only *on that creator's goods*. The farm still works perfectly — the fake creator's allowance
///      grows exactly as the arithmetic says it should — and it buys an empty room: the only goods it
///      can be spent on are goods that do not exist. **A reputation built by trading with yourself is
///      a reputation you can only spend on yourself.** The attack succeeds completely and achieves
///      nothing, which is a stronger guarantee than any detector, because a detector can be fooled and
///      an empty room cannot.
///
///      The ceiling is a **gate on new sales, not an invariant**. Exposure can rise with nobody's
///      authorization — a voided instant claim puts its debts back into custody (the rail's own
///      claim died, so the money it swore had been split never was), a coverage lapse does the same
///      through the sweep, and a default converts a debt into a reimbursement that occupies the same
///      headroom. So the inequality may be transiently false, and the correct response is not to
///      revert something that already happened: it is that the *next* custody sale does not happen.
///      That is what `authorize` enforces, and it is the only thing it enforces.
///
///      Growth is credited on **proven** claims only, never on merely settled ones. A claim that
///      settled because nobody challenged it can still die at its coverage deadline — silence is not
///      evidence, and a lie that outlives the challenge window must not be worth capacity in the
///      meantime. Waiting for the proof makes the rule structural: a `PROVEN` claim is terminal, so
///      growth that has been credited can never need to be taken back, and no reversal path has to
///      exist to be got right. Capacity is earned by evidence, which is the same rule the rest of
///      this protocol runs on.
contract Allowance is ISaleAuthorizer {
    uint256 internal constant BPS = 10_000;

    address public immutable operator;
    DebtLedger public immutable debts;

    /// @notice The disclosed, unearned threshold a *new relationship* opens with.
    /// @dev Without it, custody rails would open at a ceiling of exactly zero and stay there
    ///      forever: no sales, so no settled volume, so no growth, so no sales. It is deliberately
    ///      modest, it is public, and it is the last number in this protocol taken on faith. Every
    ///      naira of capacity after it is earned.
    ///
    ///      It is granted per relationship because that is who bears it: the exposure a new creator
    ///      accepts on day one is *hers*, and it is hers to accept. It is emphatically **not** granted
    ///      per relationship in the network gate below — see `totalAllowance`, which is the difference
    ///      between a grant and a thing you can print.
    uint256 public immutable genesisAllowance;

    /// @notice What a proven currency of settled value adds to the allowance — of the creator whose
    ///         goods earned it, and of nobody else.
    uint16 public immutable growthBps;

    /// @notice What a default takes off it, as a multiple of the defaulted amount.
    uint8 public immutable writeDownMultiple;

    /// @notice The pool. Set once, at deployment, and permanent.
    IPoolReserves public pool;

    /// @notice The capacity the operator has with one creator: what it may hold of *her* money.
    /// @dev Lazily opened. A creator who has never been dealt with holds her genesis threshold and no
    ///      storage slot; the slot appears the first time the number moves. `allowanceOf` is the read
    ///      that knows the difference, and every write goes through `_open` first.
    mapping(uint256 creatorId => uint256) private _allowance;
    mapping(uint256 creatorId => bool) private _opened;

    /// @notice The capacity the operator has with the network as a whole.
    ///
    /// @dev **This is one genesis grant, plus everything earned, minus everything written down — and
    ///      it is not the sum of the bilateral allowances.** The difference is deliberate and it is
    ///      the second half of the same idea.
    ///
    ///      Summing a per-creator grant over creators would make the network's unearned exposure a
    ///      function of how many creators exist, and the operator can make creators out of nothing. A
    ///      total taken over counterparties is farmable *because a farmer manufactures counterparties*
    ///      — that is the whole lesson of this session, and it applies to the network's own faith in
    ///      Good exactly as it applies to a reputation score. So the network extends its unearned
    ///      faith **once**: registering a creator opens a relationship, and it does not print capacity.
    ///
    ///      What the operator earns *is* counted here, from any relationship — including a farmed one.
    ///      That is harmless, and it is worth being precise about why: both gates must pass, so a
    ///      network gate the farm has loosened simply stops being the binding one, and the bilateral
    ///      gate underneath it is the one that cannot be farmed. An inflated network gate is a lost
    ///      belt, never an open door.
    ///
    ///      In a single-creator deployment this is exactly `allowanceOf(thatCreator)`, which is why
    ///      every number in the worked examples is unchanged by any of this.
    uint256 public totalAllowance;

    /// @notice The moment the last freeze lifted. Growth is creditable only for value settled after
    ///         it — healing is prospective, and the volume the freeze forfeited is never recovered.
    uint64 public healingSince;

    /// @notice Claims whose growth has been collected. A claim earns its growth once.
    mapping(uint256 claimId => bool) public credited;

    event PoolSet(address indexed pool);
    event AllowanceGrew(
        uint256 indexed claimId,
        uint256 indexed creatorId,
        uint256 settledValue,
        uint256 growth,
        uint256 allowance
    );
    event AllowanceWrittenDown(
        uint256 indexed debtId,
        uint256 indexed creatorId,
        uint256 defaulted,
        uint256 assessed,
        uint256 applied,
        uint256 allowance
    );
    event FreezeLifted(uint64 healingSince);

    error NotOperator();
    error NotPool();
    error ZeroAddress();
    error PoolAlreadySet();
    error PoolNotSet();
    error InvalidGrowth();
    error InvalidMultiple();
    error ClaimNotProven(uint256 claimId, Types.ClaimState state);
    error AlreadyCredited(uint256 claimId);
    error GrowthFrozen(uint256 claimId, uint256 reimbursementOutstanding);
    error GrowthForfeited(uint256 claimId, uint64 settledAt, uint64 healingSince);
    error NothingToCredit(uint256 claimId);

    /// @notice Everything the protocol says about the operator, in public, as one reading.
    ///
    /// @dev **This is a record of failure, and it is deliberately not a score.**
    ///
    ///      There is no rating here, no average, and above all no *rate* — because a rate has a
    ///      denominator, and a denominator is precisely what an operator with a Sybil budget can
    ///      manufacture. "Two defaults in ten thousand sales" is a number anybody can buy: sell to
    ///      yourself nine thousand times and watch your failure rate fall. Every field below is an
    ///      **absolute count or amount, monotone in the operator's misbehaviour**, so the only way to
    ///      improve this reading is to not have failed. You cannot farm a clean record. You can only
    ///      fail to have failed.
    ///
    ///      It is also the reason there is no `successCount` here, however tempting: the moment a good
    ///      number sits next to a bad one, somebody computes the ratio, and the ratio is farmable even
    ///      if neither number is. What is not published cannot be gamed.
    struct FailureRecord {
        /// @notice Debts the operator let default. Never decreases.
        uint256 defaults;
        /// @notice What those defaults were worth, in full, at the moment each landed.
        uint256 defaultValue;
        /// @notice Claims the operator posted and could not sustain — a payment asserted and then
        ///         disproven, or never proven. Never decreases.
        uint256 claimsVoided;
        /// @notice What the operator owes the pool for defaults the pool covered on its behalf.
        uint256 owedToPool;
        /// @notice Fines the operator has been charged and has not paid.
        uint256 penaltiesUnpaid;
        /// @notice Whether the operator's capacity is currently barred from growing, because it owes
        ///         the pool. True is bad; it is not an achievement to be false.
        bool growthFrozen;
        /// @notice What the fund can actually pay a victim right now.
        uint256 poolBalance;
    }

    modifier onlyPool() {
        if (msg.sender != address(pool)) revert NotPool();
        _;
    }

    constructor(
        address operator_,
        DebtLedger debts_,
        uint256 genesisAllowance_,
        uint16 growthBps_,
        uint8 writeDownMultiple_
    ) {
        if (operator_ == address(0) || address(debts_) == address(0)) {
            revert ZeroAddress();
        }
        if (growthBps_ == 0 || growthBps_ > BPS) revert InvalidGrowth();
        if (writeDownMultiple_ == 0) revert InvalidMultiple();

        operator = operator_;
        debts = debts_;
        genesisAllowance = genesisAllowance_;
        growthBps = growthBps_;
        writeDownMultiple = writeDownMultiple_;

        // One grant, to the network, once. See `totalAllowance`.
        totalAllowance = genesisAllowance_;
    }

    /// @notice Wires the pool. Deployment-time only, and permanent.
    function setPool(address pool_) external {
        if (msg.sender != operator) revert NotOperator();
        if (pool_ == address(0)) revert ZeroAddress();
        if (address(pool) != address(0)) revert PoolAlreadySet();
        pool = IPoolReserves(pool_);
        emit PoolSet(pool_);
    }

    /// @inheritdoc ISaleAuthorizer
    /// @dev Ungated on purpose. It writes nothing and it decides nothing that a caller could
    ///      corrupt — it reads public numbers and either reverts or does not. Leaving it open means
    ///      the counter, the ledger view and anyone else can ask the ceiling the same question the
    ///      till asks it, and get the same answer, without sending a transaction.
    ///
    ///      Two gates, and a sale needs both. The bilateral one is the rule; the network one is the
    ///      arithmetic that stops one pool from being pledged to every relationship at once.
    function authorize(uint256 creatorId, uint256 exposure, Types.Rail rail) external view {
        // The instant rail never places third-party money in the operator's hands: the processor
        // split the payment at source. A sale that consumes no custody consumes no ceiling — which
        // is why commerce works on day one, at a genesis allowance of almost nothing.
        if (rail == Types.Rail.INSTANT) return;

        uint256 room = headroomOf(creatorId);
        if (exposure > room) revert OverCeiling(creatorId, exposure, room);

        uint256 networkRoom = headroom();
        if (exposure > networkRoom) revert OverNetworkCeiling(exposure, networkRoom);
    }

    /// @notice Collects the growth a proven claim earned. Anyone may send it; only the operator
    ///         benefits from it.
    /// @dev What counts, exactly: value that was *paid to somebody else* and *proven to have been*.
    ///
    ///      - Not the operator's own leg. It is `RETAINED` at mint and can never be claimed, so it
    ///        can never be proven, so it can never appear here. Paying yourself proves nothing.
    ///      - Not a buyer's refund obligation. A refund is not sale value, and a fulfilled order
    ///        (`DISCHARGED`) is performance rather than payment — neither is a payment the operator
    ///        made to a third party out of money it was holding.
    ///      - Not a settled claim, until it is a proven one. See the contract note.
    ///
    ///      And now: not anybody else's capacity. The growth lands on the creator whose goods the
    ///      payment was for, resolved from the sale each debt was minted against — which was fixed at
    ///      mint, by the gateway, from a tranche the creator signed. The operator supplies the proof
    ///      and never the attribution.
    ///
    ///      A claim may span sales from several creators, so the credit is applied per debt, to the
    ///      creator that debt belongs to. Growth is linear in the amount, so splitting it that way
    ///      credits exactly what a single sum would have, up to the wei that integer division drops —
    ///      and it drops it against the operator, which is the correct direction for a rounding error
    ///      in a capacity grant.
    ///
    ///      Two rules about the freeze, and they are the same rule twice: growth is refused while a
    ///      reimbursement is outstanding, and refused afterwards for anything that settled before
    ///      the pool was squared. Capacity is collected, not granted — and a freeze forfeits
    ///      everything not already collected.
    function creditSettlement(uint256 claimId) external returns (uint256 growth) {
        if (credited[claimId]) revert AlreadyCredited(claimId);

        DebtLedger.Claim memory posted = debts.claim(claimId);
        if (posted.state != Types.ClaimState.PROVEN) revert ClaimNotProven(claimId, posted.state);

        uint256 owedToPool = _reserves().reimbursementOutstanding();
        if (owedToPool != 0) revert GrowthFrozen(claimId, owedToPool);

        // When the value settled: the moment the claim's challenge window closed. Fixed when the
        // claim was posted, so the operator cannot move it — and moving it by posting the claim
        // later only ages the debt closer to default.
        if (posted.challengeDeadline < healingSince) {
            revert GrowthForfeited(claimId, posted.challengeDeadline, healingSince);
        }

        credited[claimId] = true;

        uint256[] memory debtIds = debts.claimDebts(claimId);

        for (uint256 i = 0; i < debtIds.length; ++i) {
            IDebtLedger.Debt memory owed = debts.debt(debtIds[i]);
            if (owed.state != Types.DebtState.PROVEN) continue;
            if (owed.role == Types.Role.OPERATOR || owed.role == Types.Role.BUYER) continue;

            uint256 earned = owed.amount * growthBps / BPS;
            if (earned == 0) continue;

            uint256 creatorId = owed.creatorId;
            _open(creatorId);
            _allowance[creatorId] += earned;
            totalAllowance += earned;
            growth += earned;

            emit AllowanceGrew(claimId, creatorId, owed.amount, earned, _allowance[creatorId]);
        }

        if (growth == 0) revert NothingToCredit(claimId);
    }

    /// @notice Takes the write-down a default costs. Callable only by the pool.
    /// @dev Assessed on the defaulted amount, not on what the pool managed to pay: the punishment is
    ///      for the default, and an empty pool is not a mitigation. It stops at zero because there is
    ///      nothing behind zero — an operator with no allowance has no custody capacity at all, which
    ///      is the strongest thing this number can say.
    ///
    ///      It lands on the creator whose goods the defaulted debt came from, and on nobody else. A
    ///      creator the operator has never wronged does not have her ceiling cut because it wronged
    ///      somebody else — her relationship is hers, and it is intact. What *does* reach her is the
    ///      reimbursement the operator now owes the pool, which is charged into every relationship's
    ///      gate at once (see `usedBy`): the operator's refusal to square its books throttles every
    ///      counter it has, which is exactly the intent.
    function writeDown(uint256 debtId, uint256 defaulted)
        external
        onlyPool
        returns (uint256 applied)
    {
        uint256 creatorId = debts.creatorOf(debtId);
        _open(creatorId);

        uint256 assessed = defaulted * writeDownMultiple;
        uint256 current = _allowance[creatorId];

        applied = assessed > current ? current : assessed;
        _allowance[creatorId] = current - applied;

        // The network's number falls with it, and never below zero. In a single-creator deployment
        // the two are the same number and hit the floor together.
        totalAllowance = applied > totalAllowance ? 0 : totalAllowance - applied;

        emit AllowanceWrittenDown(
            debtId, creatorId, defaulted, assessed, applied, _allowance[creatorId]
        );
    }

    /// @notice The pool has been made whole: growth may resume, from here forward. Pool only.
    function liftFreeze() external onlyPool {
        healingSince = uint64(block.timestamp);
        emit FreezeLifted(healingSince);
    }

    // --- Reads ---

    /// @notice The capacity the operator has earned with one creator, including her genesis threshold.
    function allowanceOf(uint256 creatorId) public view returns (uint256) {
        return _opened[creatorId] ? _allowance[creatorId] : genesisAllowance;
    }

    /// @notice What the network will let the operator hold of *this creator's* money: the pool that
    ///         would compensate her, plus the record it has built with her.
    /// @dev The two halves are different kinds of guarantee. The pool is the compensation bound — it
    ///      is what actually pays a victim. The allowance is the deterrence bound — it is the future
    ///      income the operator forfeits by misbehaving. They are added because the ceiling's job is
    ///      to keep the uncompensated tail small, and both numbers shrink it.
    function ceilingOf(uint256 creatorId) public view returns (uint256) {
        return _reserves().balance() + allowanceOf(creatorId);
    }

    /// @notice Everything counted against that creator's ceiling: her money the operator is holding,
    ///         plus everything the operator owes the system and has not settled.
    /// @dev The obligations are global on purpose, and charged into every relationship at once. The
    ///      chain cannot reach the operator's bank account, so a punishment it cannot collect has to
    ///      cost something anyway — and what it costs is capacity, everywhere, until the books are
    ///      square. **No obligation in this protocol can be escaped by refusing to pay it**: refusing
    ///      throttles the operator's own till, in public, in front of every creator it deals with.
    ///
    ///      A defaulted debt is counted exactly once — it leaves the ledger's exposure at the instant
    ///      it becomes a reimbursement here.
    function usedBy(uint256 creatorId) public view returns (uint256) {
        IPoolReserves reserves = _reserves();
        return debts.outstandingOf(creatorId) + reserves.reimbursementOutstanding()
            + reserves.penaltiesOutstanding();
    }

    /// @notice What is left, for this creator. Zero when exposure has already outrun the ceiling —
    ///         which it can, and which is not an error state: it is a closed till.
    function headroomOf(uint256 creatorId) public view returns (uint256) {
        uint256 capacity = ceilingOf(creatorId);
        uint256 consumed = usedBy(creatorId);
        return capacity > consumed ? capacity - consumed : 0;
    }

    /// @notice The network ceiling: the pool, once, plus the operator's total earned record.
    function ceiling() public view returns (uint256) {
        return _reserves().balance() + totalAllowance;
    }

    /// @notice Everything the operator is holding, of everybody, plus everything it owes.
    function used() public view returns (uint256) {
        IPoolReserves reserves = _reserves();
        return
            debts.outstanding() + reserves.reimbursementOutstanding()
                + reserves.penaltiesOutstanding();
    }

    /// @notice What is left across the whole network.
    function headroom() public view returns (uint256) {
        uint256 capacity = ceiling();
        uint256 consumed = used();
        return capacity > consumed ? capacity - consumed : 0;
    }

    /// @notice Whether allowance growth is frozen, and why: the operator owes the pool.
    function frozen() public view returns (bool) {
        return _reserves().reimbursementOutstanding() != 0;
    }

    /// @notice The one number the protocol publishes about the operator — and it is a rap sheet.
    /// @dev See `FailureRecord`. Every field is monotone in misbehaviour or is a balance; there is no
    ///      denominator anywhere in it, because a denominator is the thing a farmer manufactures.
    ///
    ///      Read this after a successful ceiling farm and it is byte-for-byte what it was before. That
    ///      is the property, and there is a test named for it.
    function record() external view returns (FailureRecord memory) {
        IPoolReserves reserves = _reserves();

        return FailureRecord({
            defaults: reserves.defaultCount(),
            defaultValue: reserves.defaultValue(),
            claimsVoided: debts.voidCount(),
            owedToPool: reserves.reimbursementOutstanding(),
            penaltiesUnpaid: reserves.penaltiesOutstanding(),
            growthFrozen: reserves.reimbursementOutstanding() != 0,
            poolBalance: reserves.balance()
        });
    }

    /// @dev Materializes a relationship at its genesis threshold, the first time its number moves.
    ///      Note what this does *not* do: it does not touch `totalAllowance`. Opening a relationship
    ///      grants that creator her threshold; it does not grant the network any more faith in Good.
    ///      If it did, an operator could print network capacity by registering counterparties, which
    ///      is the exact attack the bilateral rule exists to close — and closing it in one place while
    ///      leaving it open in the other would close nothing at all.
    function _open(uint256 creatorId) internal {
        if (_opened[creatorId]) return;
        _opened[creatorId] = true;
        _allowance[creatorId] = genesisAllowance;
    }

    function _reserves() internal view returns (IPoolReserves reserves) {
        reserves = pool;
        if (address(reserves) == address(0)) revert PoolNotSet();
    }
}
