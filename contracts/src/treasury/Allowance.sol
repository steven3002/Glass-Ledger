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
/// @dev The ceiling is a **gate on new sales, not an invariant**. Exposure can rise with nobody's
///      authorization — a voided instant claim puts its debts back into custody (the rail's own
///      claim died, so the money it swore had been split never was), a coverage lapse does the same
///      through the sweep, and a default converts a debt into a reimbursement that occupies the same
///      headroom. So `outstanding <= pool + allowance` may be transiently false, and the correct
///      response is not to revert something that already happened: it is that the *next* custody
///      sale does not happen. That is what `authorize` enforces, and it is the only thing it
///      enforces.
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

    /// @notice The disclosed, unearned threshold the deployment opens with.
    /// @dev Without it, custody rails would open at a ceiling of exactly zero and stay there
    ///      forever: no sales, so no settled volume, so no growth, so no sales. It is deliberately
    ///      modest, it is public, and it is the last number in this protocol taken on faith. Every
    ///      naira of capacity after it is earned.
    uint256 public immutable genesisAllowance;

    /// @notice What a proven currency of settled value adds to the allowance.
    uint16 public immutable growthBps;

    /// @notice What a default takes off it, as a multiple of the defaulted amount.
    uint8 public immutable writeDownMultiple;

    /// @notice The pool. Set once, at deployment, and permanent.
    IPoolReserves public pool;

    /// @notice The earned capacity, right now.
    uint256 public allowance;

    /// @notice The moment the last freeze lifted. Growth is creditable only for value settled after
    ///         it — healing is prospective, and the volume the freeze forfeited is never recovered.
    uint64 public healingSince;

    /// @notice Claims whose growth has been collected. A claim earns its growth once.
    mapping(uint256 claimId => bool) public credited;

    event PoolSet(address indexed pool);
    event AllowanceGrew(
        uint256 indexed claimId, uint256 settledValue, uint256 growth, uint256 allowance
    );
    event AllowanceWrittenDown(
        uint256 indexed debtId,
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

        allowance = genesisAllowance_;
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
    ///      corrupt — it reads four public numbers and either reverts or does not. Leaving it open
    ///      means the counter, the ledger view and anyone else can ask the ceiling the same question
    ///      the till asks it, and get the same answer, without sending a transaction.
    function authorize(uint256 exposure, Types.Rail rail) external view {
        // The instant rail never places third-party money in the operator's hands: the processor
        // split the payment at source. A sale that consumes no custody consumes no ceiling — which
        // is why commerce works on day one, at a genesis allowance of almost nothing.
        if (rail == Types.Rail.INSTANT) return;

        uint256 room = headroom();
        if (exposure > room) revert OverCeiling(exposure, room);
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
    ///      Two rules about the freeze, and they are the same rule twice: growth is refused while a
    ///      reimbursement is outstanding, and refused afterwards for anything that settled before
    ///      the pool was squared. Capacity is collected, not granted — and a freeze forfeits
    ///      everything not already collected.
    function creditSettlement(uint256 claimId) external returns (uint256 growth) {
        if (credited[claimId]) revert AlreadyCredited(claimId);

        DebtLedger.Claim memory record = debts.claim(claimId);
        if (record.state != Types.ClaimState.PROVEN) revert ClaimNotProven(claimId, record.state);

        uint256 owedToPool = _reserves().reimbursementOutstanding();
        if (owedToPool != 0) revert GrowthFrozen(claimId, owedToPool);

        // When the value settled: the moment the claim's challenge window closed. Fixed when the
        // claim was posted, so the operator cannot move it — and moving it by posting the claim
        // later only ages the debt closer to default.
        if (record.challengeDeadline < healingSince) {
            revert GrowthForfeited(claimId, record.challengeDeadline, healingSince);
        }

        uint256[] memory debtIds = debts.claimDebts(claimId);
        uint256 settledValue;

        for (uint256 i = 0; i < debtIds.length; ++i) {
            IDebtLedger.Debt memory owed = debts.debt(debtIds[i]);
            if (owed.state != Types.DebtState.PROVEN) continue;
            if (owed.role == Types.Role.OPERATOR || owed.role == Types.Role.BUYER) continue;
            settledValue += owed.amount;
        }

        if (settledValue == 0) revert NothingToCredit(claimId);

        credited[claimId] = true;
        growth = settledValue * growthBps / BPS;
        allowance += growth;

        emit AllowanceGrew(claimId, settledValue, growth, allowance);
    }

    /// @notice Takes the write-down a default costs. Callable only by the pool.
    /// @dev Assessed on the defaulted amount, not on what the pool managed to pay: the punishment is
    ///      for the default, and an empty pool is not a mitigation. It stops at zero because there is
    ///      nothing behind zero — an operator with no allowance has no custody capacity at all, which
    ///      is the strongest thing this number can say.
    function writeDown(uint256 debtId, uint256 defaulted)
        external
        onlyPool
        returns (uint256 applied)
    {
        uint256 assessed = defaulted * writeDownMultiple;
        uint256 current = allowance;

        applied = assessed > current ? current : assessed;
        allowance = current - applied;

        emit AllowanceWrittenDown(debtId, defaulted, assessed, applied, allowance);
    }

    /// @notice The pool has been made whole: growth may resume, from here forward. Pool only.
    function liftFreeze() external onlyPool {
        healingSince = uint64(block.timestamp);
        emit FreezeLifted(healingSince);
    }

    /// @notice What the network will let the operator hold at once: real money plus earned record.
    /// @dev The two halves are different kinds of guarantee. The pool is the compensation bound — it
    ///      is what actually pays a victim. The allowance is the deterrence bound — it is the future
    ///      income the operator forfeits by misbehaving. They are added because the ceiling's job is
    ///      to keep the uncompensated tail small, and both numbers shrink it.
    function ceiling() public view returns (uint256) {
        return _reserves().balance() + allowance;
    }

    /// @notice Everything currently counted against the ceiling: what the operator is holding, and
    ///         everything else it owes the system and has not settled.
    /// @dev Three numbers, and the last two are here for one reason. The chain cannot reach the
    ///      operator's bank account, so a punishment it cannot collect has to cost something anyway —
    ///      and what it costs is capacity. A defaulted debt the pool covered, and a fine for a false
    ///      claim, both count against this ceiling until they are settled. **No obligation in this
    ///      protocol can be escaped by simply refusing to pay it**: refusing throttles the operator's
    ///      own till, in public, and the only way back is to square the books.
    ///
    ///      A defaulted debt is counted exactly once — it leaves the ledger's `outstanding()` at the
    ///      instant it becomes a reimbursement here.
    function used() public view returns (uint256) {
        IPoolReserves reserves = _reserves();
        return
            debts.outstanding() + reserves.reimbursementOutstanding()
                + reserves.penaltiesOutstanding();
    }

    /// @notice What is left. Zero when exposure has already outrun the ceiling — which it can, and
    ///         which is not an error state: it is a closed till.
    function headroom() public view returns (uint256) {
        uint256 capacity = ceiling();
        uint256 consumed = used();
        return capacity > consumed ? capacity - consumed : 0;
    }

    /// @notice Whether allowance growth is frozen, and why: the operator owes the pool.
    function frozen() external view returns (bool) {
        return _reserves().reimbursementOutstanding() != 0;
    }

    function _reserves() internal view returns (IPoolReserves reserves) {
        reserves = pool;
        if (address(reserves) == address(0)) revert PoolNotSet();
    }
}
