// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {DebtLedger} from "../debt/DebtLedger.sol";
import {IDebtLedger} from "../interfaces/IDebtLedger.sol";
import {IPoolReserves} from "../interfaces/IPoolReserves.sol";
import {IWriteOffSink} from "../interfaces/IWriteOffSink.sol";
import {Allowance} from "./Allowance.sol";
import {Types} from "../libs/Types.sol";

/// @title Pool
/// @notice The money that pays victims when the operator is the problem.
///
///         It is funded by a skim on every sale, carved out of the operator's own commission — the
///         operator funds the fund that insures its own failures, and the creator's, landlord's and
///         community's shares are untouched. Nobody deposits anything else, ever; the pool starts at
///         nothing and grows with trade.
///
///         Its one job is to make a victim whole without asking anyone's permission, so the
///         execution of a default is permissionless: `touch` is callable by any account on earth,
///         and the wronged party never has to send a transaction, file a claim, or know that any of
///         this happened.
///
/// @dev Production note — pool custody is on-chain and that is not a preference. The assets are
///      cNGN (primary) and USDC (secondary), held and disbursed by this contract. A segregated bank
///      account, however attested, sits inside the defaulting operator's blast radius, and this fund
///      exists precisely for the day the operator departs; no key the operator holds moves this
///      money, only protocol rules do.
///
///      Where the operator's money comes from, in this build: the pool never pulls from an account
///      it was not pointed at. Skims and reimbursements are pushed by whoever pays them. The fees
///      the operator owes — a void penalty, a write-off penalty — are *pulled* from the operator's
///      funding account against a standing ERC-20 approval, which is a condition of operating: a fee
///      that had to be volunteered by the party being fined is not a fee. If that approval is ever
///      withdrawn the fee simply stays owed and public; nothing else in the protocol is blocked by
///      it, and nothing a victim needs depends on it.
contract Pool is IPoolReserves, IWriteOffSink {
    using SafeERC20 for IERC20;

    /// @notice The operator's funding account: where skims are pushed from and fees are pulled from.
    address public immutable operator;

    /// @notice The asset. One pool, one asset, one currency — the protocol never converts.
    IERC20 public immutable token;

    /// @notice The currency tag the asset carries on the ledger. A debt in any other denomination is
    ///         not this pool's business.
    bytes32 public immutable currency;

    DebtLedger public immutable debts;
    Allowance public immutable ceiling;

    /// @notice The only account that may price a write-off. Set once, at deployment.
    address public saleGateway;

    /// @inheritdoc IPoolReserves
    uint256 public reimbursementOutstanding;

    /// @notice What write-offs have owed the pool, in total, ever.
    uint256 public writeOffAccrued;

    /// @notice What the pool has collected of everything the operator owes *it* — void penalties and
    ///         write-off dues alike.
    uint256 public poolDuesPaid;

    /// @notice What each wronged recipient has been paid of the penalties owed to them.
    mapping(address recipient => uint256) public penaltyPaid;

    /// @notice The same payments, totalled. The ceiling needs the sum; a mapping has none.
    uint256 public penaltyPaidTotal;

    /// @notice Running totals, for the public ledger view.
    uint256 public totalSkimmed;
    uint256 public totalCompensated;
    uint256 public totalReimbursed;

    event SaleGatewaySet(address indexed saleGateway);
    event SkimDeposited(uint256 indexed saleRef, uint256 amount, uint256 balance);
    event DefaultCovered(
        uint256 indexed debtId,
        address indexed recipient,
        address indexed by,
        uint256 owed,
        uint256 paid,
        uint256 writtenDown,
        uint256 reimbursementOutstanding
    );
    event PoolShortfall(uint256 indexed debtId, address indexed recipient, uint256 unpaid);
    event Reimbursed(
        address indexed by, uint256 amount, uint256 reimbursementOutstanding, uint256 balance
    );
    event PenaltyPaid(address indexed recipient, uint256 amount);
    event PoolDuesCollected(uint256 amount, uint256 balance);
    event WriteOffAccrued(
        uint256 indexed itemRef, uint256 penalty, uint256 unattributed, uint256 owed
    );

    error NotOperator();
    error NotGateway();
    error ZeroAddress();
    error ZeroAmount();
    error GatewayAlreadySet();
    error WrongCurrency(bytes32 expected, bytes32 presented);
    error NothingOwed();
    error ExcessReimbursement(uint256 amount, uint256 owed);

    constructor(
        address operator_,
        IERC20 token_,
        bytes32 currency_,
        DebtLedger debts_,
        Allowance ceiling_
    ) {
        if (
            operator_ == address(0) || address(token_) == address(0)
                || address(debts_) == address(0) || address(ceiling_) == address(0)
        ) {
            revert ZeroAddress();
        }
        if (currency_ == bytes32(0)) revert WrongCurrency(currency_, bytes32(0));

        operator = operator_;
        token = token_;
        currency = currency_;
        debts = debts_;
        ceiling = ceiling_;
    }

    /// @notice Wires the sale gateway. Deployment-time only, and permanent.
    function setSaleGateway(address gateway) external {
        if (msg.sender != operator) revert NotOperator();
        if (gateway == address(0)) revert ZeroAddress();
        if (saleGateway != address(0)) revert GatewayAlreadySet();
        saleGateway = gateway;
        emit SaleGatewaySet(gateway);
    }

    // --- Funding ---

    /// @notice The fifth leg: the skim a sale contributes to the fund.
    /// @dev Production note — the rail routes this at source, exactly like the other four legs. Here
    ///      the operator deposits it against the sale it came from, because in this build the buyer's
    ///      money is fiat and never touches the chain. The amount is not enforced on-chain for the
    ///      same reason: the contract cannot see a payment it never receives. What it can do, and
    ///      does, is make every deposit public and tied to the sale that owed it.
    function depositSkim(uint256 saleRef, uint256 amount) external {
        if (msg.sender != operator) revert NotOperator();
        if (amount == 0) revert ZeroAmount();

        totalSkimmed += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);

        emit SkimDeposited(saleRef, amount, balance());
    }

    // --- The default ---

    /// @notice Executes a default: the pool pays the recipient, the allowance takes the write-down.
    /// @dev Permissionless, and that is the entire point of the protocol in one function. The debt
    ///      was already in default — it went into default by arithmetic, the moment its deadline
    ///      passed with nobody having paid it. This transaction does not decide anything; it collects
    ///      a fact. A stranger can send it. The wronged party never has to.
    ///
    ///      The order matters: the ledger is asked to mark the default first, and it refuses if the
    ///      debt is not actually in default (`NotDefaulted`). Nothing here re-implements that test —
    ///      two contracts holding two copies of one state machine is how they drift apart.
    ///
    ///      If the pool cannot cover the debt in full it pays what it has and says so. The write-down
    ///      is still assessed on the whole defaulted amount: the punishment is for the default, and
    ///      an empty pool is not a mitigation. The uncovered remainder is the tail the ceiling exists
    ///      to keep small, and it is emitted rather than hidden.
    function touch(uint256 debtId) external {
        IDebtLedger.Debt memory owed = debts.debt(debtId);
        if (owed.currency != currency) revert WrongCurrency(currency, owed.currency);

        debts.markDefaulted(debtId);

        uint256 amount = owed.amount;
        uint256 available = balance();
        uint256 paid = amount > available ? available : amount;
        uint256 unpaid = amount - paid;

        if (paid != 0) {
            reimbursementOutstanding += paid;
            totalCompensated += paid;
            token.safeTransfer(owed.recipient, paid);
        }

        uint256 writtenDown = ceiling.writeDown(debtId, amount);

        emit DefaultCovered(
            debtId, owed.recipient, msg.sender, amount, paid, writtenDown, reimbursementOutstanding
        );
        if (unpaid != 0) emit PoolShortfall(debtId, owed.recipient, unpaid);
    }

    /// @notice Pays the pool back for a default it covered.
    /// @dev Paying late does not erase the default: the recipient was made whole by the pool, so the
    ///      operator's obligation changed creditor rather than disappearing, and the write-down
    ///      stands. This is the only way the operator un-chokes its own capacity — the duty and the
    ///      incentive are one mechanism — and it is open to anyone, because money arriving in the
    ///      pool is good news whoever sent it.
    function reimburse(uint256 amount) external {
        uint256 owed = reimbursementOutstanding;
        if (owed == 0) revert NothingOwed();
        if (amount == 0) revert ZeroAmount();
        if (amount > owed) revert ExcessReimbursement(amount, owed);

        uint256 remaining = owed - amount;
        reimbursementOutstanding = remaining;
        totalReimbursed += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);

        emit Reimbursed(msg.sender, amount, remaining, balance());

        // The freeze lifts the moment the pool is square, and healing starts from that moment —
        // never before it. The volume settled while the pool was short earns nothing, ever.
        if (remaining == 0) ceiling.liftFreeze();
    }

    // --- Fees the operator owes ---

    /// @notice Pays a wronged recipient the penalty a voided claim owed them.
    /// @dev Pulled from the operator's funding account, not from the fund: the pool insures debts,
    ///      not fees. Anyone may send this transaction — the recipient is owed the money whether or
    ///      not they are watching, and making them ask for it would be one more thing the protocol
    ///      requires of the party it exists to protect.
    function collectPenalty(address recipient) external returns (uint256 amount) {
        uint256 owed = debts.penaltyOwed(recipient, currency);
        uint256 paid = penaltyPaid[recipient];
        if (owed <= paid) revert NothingOwed();

        amount = owed - paid;
        penaltyPaid[recipient] = owed;
        penaltyPaidTotal += amount;
        token.safeTransferFrom(operator, recipient, amount);

        emit PenaltyPaid(recipient, amount);
    }

    /// @notice Collects everything the operator owes the pool in fees: the pool's half of every void
    ///         penalty, and every write-off's dues.
    function collectPoolDues() external returns (uint256 amount) {
        amount = poolDuesOwed();
        if (amount == 0) revert NothingOwed();

        poolDuesPaid += amount;
        token.safeTransferFrom(operator, address(this), amount);

        emit PoolDuesCollected(amount, balance());
    }

    /// @inheritdoc IWriteOffSink
    function accrueWriteOff(
        uint256 itemRef,
        bytes32 currency_,
        uint256 penalty,
        uint256 unattributed
    ) external {
        if (msg.sender != saleGateway) revert NotGateway();
        if (currency_ != currency) revert WrongCurrency(currency, currency_);

        uint256 owed = penalty + unattributed;
        writeOffAccrued += owed;

        emit WriteOffAccrued(itemRef, penalty, unattributed, owed);
    }

    // --- Reads ---

    /// @inheritdoc IPoolReserves
    function balance() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice What the operator still owes the pool in fees.
    function poolDuesOwed() public view returns (uint256) {
        return debts.poolPenaltyOwed(currency) + writeOffAccrued - poolDuesPaid;
    }

    /// @notice What a wronged recipient is still owed in penalties.
    function penaltyDue(address recipient) external view returns (uint256) {
        return debts.penaltyOwed(recipient, currency) - penaltyPaid[recipient];
    }

    /// @inheritdoc IPoolReserves
    /// @dev Both halves of every void penalty, plus every write-off's dues — everything the operator
    ///      owes and has not paid, other than the reimbursements counted separately.
    ///
    ///      The chain cannot reach into the operator's bank account, and this protocol never pretends
    ///      otherwise. What it can do is make refusing worse than paying: a fine the operator declines
    ///      to settle eats the headroom it needs to keep selling, exactly as an unpaid debt does. So
    ///      an operator that withdraws the pool's approval to dodge a fine has not escaped it — it has
    ///      throttled itself, in public, and the only way back is to pay. Nothing here is seized;
    ///      what is withheld is the right to keep trading, which is the only thing the chain controls.
    function penaltiesOutstanding() public view returns (uint256) {
        return (debts.recipientPenaltyOwed(currency) - penaltyPaidTotal) + poolDuesOwed();
    }
}
