// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IDebtLedger} from "../interfaces/IDebtLedger.sol";
import {IProofVerifier} from "../oracle/IProofVerifier.sol";
import {Types} from "../libs/Types.sol";
import {WindowMath} from "../libs/WindowMath.sol";

/// @title DebtLedger
/// @notice What the operator owes, to whom, since when — and what it says it has paid.
///
///         A debt is minted the moment an item is consumed and ages from that moment. A claim is
///         the operator's assertion that a debt was paid; it is not proof, and the ledger treats
///         it as an assertion under scrutiny. The recipient may test it, the sweep must eventually
///         back it, and an assertion that survives neither dies.
///
/// @dev The asymmetry the whole contract is built to preserve: **payment must be proven, but
///      non-payment proves itself.** An untouched debt walks into default on its own; nothing has
///      to be alleged, filed or noticed by anyone.
///
///      Re-aging is therefore not a mechanism — it is the absence of one. A debt's `mintedAt` and
///      `deadline` are written once at mint and never move again, so when a false claim dies the
///      debt simply resumes at the age it always had. The time the lie spent pending is not given
///      back, because the clock it was supposed to pause never paused. If the deadline has already
///      passed by the time the claim voids, the debt is in default the instant it voids — which is
///      what makes stalling cost more than doing nothing.
contract DebtLedger is IDebtLedger, EIP712 {
    using WindowMath for uint64;

    uint256 internal constant BPS = 10_000;

    /// @notice A recipient authorising a challenge they are not paying the gas for.
    bytes32 public constant CHALLENGE_TYPEHASH =
        keccak256("Challenge(uint256 claimId,address recipient)");

    /// @dev What every debt of one sale shares: the item, the denomination, and how the money
    ///      reached the parties. Held once per sale rather than copied into every leg.
    struct Sale {
        uint256 itemRef;
        bytes32 currency;
        Types.Rail rail;
    }

    /// @dev Storage shape of a debt. The reported shape is `IDebtLedger.Debt`; this one packs into
    ///      two slots, because a four-leg sale writes four of these and the ledger is the bill.
    struct Record {
        address recipient;
        Types.Role role;
        Types.DebtState state;
        uint64 mintedAt;
        uint128 amount;
        uint64 deadline;
        uint32 saleId;
        uint32 claimId;
    }

    /// @notice The operator's assertion that it paid a set of debts.
    /// @dev The commitments are captured from the ledger's own state at post time, never supplied
    ///      by the claimant. The statement a verifier is asked to check is therefore built from
    ///      what the ledger knew, not from what the operator would like it to have known — and a
    ///      recipient who rotates their account afterwards cannot retroactively unmake a claim, nor
    ///      can the operator point a proof at an account the claim never named.
    struct Claim {
        uint64 postedAt;
        uint64 challengeDeadline;
        uint64 responseDeadline;
        Types.ClaimState state;
        bytes32 refHash;
        bytes32 currency;
        bytes32 accountsCommitment;
        bytes32 amountsCommitment;
        uint256 totalAmount;
    }

    address public immutable operator;

    /// @dev The interface only. A verifier is swapped by deploying a new one and pointing at it;
    ///      nothing in this contract knows or cares what is behind it.
    IProofVerifier public immutable verifier;

    /// @notice How long the operator has to pay a debt before it is in default.
    uint32 public immutable settlementWindow;

    /// @notice How long a recipient has to test a claim before silence ratifies it.
    uint32 public immutable challengeWindow;

    /// @notice How long the operator has to answer a challenge with proof.
    uint32 public immutable responseWindow;

    /// @notice The lying fee on a voided claim, as a share of the amount claimed. Doubles with
    ///         every void the operator has ever caused.
    uint16 public immutable penaltyBps;

    address public saleGateway;
    address public pool;
    address public sweepRegistry;

    /// @notice How many claims the operator has had voided. The penalty rate doubles with each.
    uint256 public voidCount;

    /// @notice Penalties owed to a wronged recipient, per currency. Paid at the treasury.
    mapping(address recipient => mapping(bytes32 currency => uint256)) public penaltyOwed;

    /// @notice Penalties owed to the pool, per currency.
    mapping(bytes32 currency => uint256) public poolPenaltyOwed;

    uint256 private _debtCount;
    uint256 private _saleCount;
    uint256 private _claimCount;
    uint256 private _outstanding;

    mapping(uint256 debtId => Record) private _records;
    mapping(uint256 saleId => Sale) private _sales;
    mapping(uint256 claimId => Claim) private _claims;
    mapping(uint256 claimId => uint256[] debtIds) private _claimDebts;
    mapping(address recipient => mapping(bytes32 currency => bytes32 accountHash)) private
        _accounts;

    event SaleGatewaySet(address indexed saleGateway);
    event PoolSet(address indexed pool);
    event SweepRegistrySet(address indexed sweepRegistry);
    event AccountHashSet(address indexed recipient, bytes32 indexed currency, bytes32 accountHash);
    event DebtMinted(
        uint256 indexed debtId,
        uint256 indexed saleRef,
        address indexed recipient,
        Types.Role role,
        Types.Rail rail,
        uint256 amount,
        bytes32 currency,
        uint64 mintedAt,
        uint64 deadline,
        Types.DebtState state
    );
    event DebtStateChanged(
        uint256 indexed debtId, Types.DebtState from, Types.DebtState to, uint64 changedAt
    );
    event DebtDefaulted(uint256 indexed debtId, address indexed recipient, uint256 amount);
    event ObligationDischarged(uint256 indexed debtId, address indexed recipient);
    event ClaimPosted(
        uint256 indexed claimId,
        bytes32 indexed refHash,
        bytes32 currency,
        uint256 totalAmount,
        uint64 challengeDeadline,
        uint256[] debtIds
    );
    event ClaimChallenged(
        uint256 indexed claimId, address indexed challenger, uint64 responseDeadline
    );
    event ClaimSettled(uint256 indexed claimId);
    event ClaimProven(uint256 indexed claimId, address indexed by);
    event ClaimVoided(uint256 indexed claimId, uint256 penaltyBps, uint256 totalPenalty);
    event PenaltyAccrued(
        uint256 indexed claimId,
        address indexed recipient,
        bytes32 currency,
        uint256 toRecipient,
        uint256 toPool
    );

    error NotOperator();
    error NotGateway();
    error NotPool();
    error NotSweep();
    error ZeroAddress();
    error GatewayAlreadySet();
    error PoolAlreadySet();
    error SweepAlreadySet();
    error InvalidWindow();
    error InvalidPenalty();
    error InvalidAccountHash();
    error UnknownDebt(uint256 debtId);
    error UnknownClaim(uint256 claimId);
    error DebtNotOpen(uint256 debtId);
    error NotAnObligation(uint256 debtId);
    error NotDefaulted(uint256 debtId);
    error DebtNotClaimable(uint256 debtId, Types.DebtState state);
    error MixedCurrencyClaim();
    error NoAccountOnFile(address recipient, bytes32 currency);
    error MissingClaimRef();
    error EmptyClaim();
    error ClaimNotPending(uint256 claimId);
    error ClaimNotChallenged(uint256 claimId);
    error ClaimNotLive(uint256 claimId);
    error ChallengeWindowClosed(uint256 claimId, uint64 deadline);
    error ChallengeWindowOpen(uint256 claimId, uint64 deadline);
    error ResponseWindowClosed(uint256 claimId, uint64 deadline);
    error ResponseWindowOpen(uint256 claimId, uint64 deadline);
    error NotRecipient(uint256 claimId, address account);
    error BadChallengeSignature();
    error ProofRejected(uint256 claimId);

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier onlyGateway() {
        if (msg.sender != saleGateway) revert NotGateway();
        _;
    }

    modifier onlyPool() {
        if (msg.sender != pool) revert NotPool();
        _;
    }

    modifier onlySweep() {
        if (msg.sender != sweepRegistry) revert NotSweep();
        _;
    }

    constructor(
        address operator_,
        IProofVerifier verifier_,
        uint32 settlementWindow_,
        uint32 challengeWindow_,
        uint32 responseWindow_,
        uint16 penaltyBps_
    ) EIP712("Glass Ledger", "1") {
        if (operator_ == address(0) || address(verifier_) == address(0)) {
            revert ZeroAddress();
        }
        if (settlementWindow_ == 0 || challengeWindow_ == 0 || responseWindow_ == 0) {
            revert InvalidWindow();
        }
        if (penaltyBps_ == 0 || penaltyBps_ > BPS) revert InvalidPenalty();

        operator = operator_;
        verifier = verifier_;
        settlementWindow = settlementWindow_;
        challengeWindow = challengeWindow_;
        responseWindow = responseWindow_;
        penaltyBps = penaltyBps_;
    }

    // --- Deployment wiring. Set once each, and permanent. ---

    function setSaleGateway(address gateway) external onlyOperator {
        if (gateway == address(0)) revert ZeroAddress();
        if (saleGateway != address(0)) revert GatewayAlreadySet();
        saleGateway = gateway;
        emit SaleGatewaySet(gateway);
    }

    function setPool(address pool_) external onlyOperator {
        if (pool_ == address(0)) revert ZeroAddress();
        if (pool != address(0)) revert PoolAlreadySet();
        pool = pool_;
        emit PoolSet(pool_);
    }

    function setSweepRegistry(address sweep) external onlyOperator {
        if (sweep == address(0)) revert ZeroAddress();
        if (sweepRegistry != address(0)) revert SweepAlreadySet();
        sweepRegistry = sweep;
        emit SweepRegistrySet(sweep);
    }

    // --- Where a recipient is paid ---

    /// @notice Registers the account this caller is to be paid into, for one currency.
    /// @dev Written by the recipient's own key and by nobody else — not the operator, who would
    ///      otherwise be able to name the account it claims to have paid. A claim captures this
    ///      value at the moment it is posted, so rotating an account never reaches backwards into
    ///      claims already on the books.
    ///
    ///      Production note: the hash commits to the recipient's bank account details; the payment
    ///      proof is checked against it without those details ever appearing on-chain. In this
    ///      build it is an opaque word the recipient registers.
    function setAccountHash(bytes32 currency, bytes32 accountHash) external {
        if (currency == bytes32(0) || accountHash == bytes32(0)) revert InvalidAccountHash();
        _accounts[msg.sender][currency] = accountHash;
        emit AccountHashSet(msg.sender, currency, accountHash);
    }

    function accountHashOf(address recipient, bytes32 currency) external view returns (bytes32) {
        return _accounts[recipient][currency];
    }

    // --- Minting. Only the sale gateway. ---

    /// @inheritdoc IDebtLedger
    function mintSaleDebts(
        uint256 saleRef,
        Types.Rail rail,
        bytes32 currency,
        Leg[] calldata legs,
        bytes32 claimRef
    ) external onlyGateway returns (uint256[] memory debtIds) {
        uint256 saleId = _openSale(saleRef, currency, rail);
        uint64 mintedAt = uint64(block.timestamp);
        uint64 deadline = mintedAt.deadlineFrom(settlementWindow);

        debtIds = new uint256[](legs.length);
        uint256 claimable;

        for (uint256 i = 0; i < legs.length; ++i) {
            Leg calldata leg = legs[i];

            // The operator's own leg is owed to nobody: it is terminal where it is minted.
            Types.DebtState state =
                leg.role == Types.Role.OPERATOR ? Types.DebtState.RETAINED : Types.DebtState.AGING;
            if (state == Types.DebtState.AGING) ++claimable;

            debtIds[i] = _mint(
                Record({
                    recipient: leg.recipient,
                    role: leg.role,
                    state: state,
                    mintedAt: mintedAt,
                    amount: SafeCast.toUint128(leg.amount),
                    deadline: deadline,
                    saleId: SafeCast.toUint32(saleId),
                    claimId: 0
                }),
                saleRef,
                rail,
                currency
            );
        }

        // A rail that split the payment as it happened arrives with its reference already
        // attached, so the sale posts its own claim: the operator has said which payment this was,
        // in the same transaction that owed the money, and can be made to prove it. The operator's
        // own leg is not in the claim — there is no payment of yourself to prove.
        if (claimRef != bytes32(0)) {
            uint256[] memory claimed = new uint256[](claimable);
            uint256 next;
            for (uint256 i = 0; i < legs.length; ++i) {
                if (legs[i].role != Types.Role.OPERATOR) claimed[next++] = debtIds[i];
            }
            _openClaim(claimed, claimRef);
        }
    }

    /// @inheritdoc IDebtLedger
    function mintObligation(
        uint256 saleRef,
        address recipient,
        uint256 amount,
        bytes32 currency,
        uint64 deadline
    ) external onlyGateway returns (uint256 debtId) {
        uint256 saleId = _openSale(saleRef, currency, Types.Rail.CUSTODY);
        debtId = _mint(
            Record({
                recipient: recipient,
                role: Types.Role.BUYER,
                state: Types.DebtState.AGING,
                mintedAt: uint64(block.timestamp),
                amount: SafeCast.toUint128(amount),
                deadline: deadline,
                saleId: SafeCast.toUint32(saleId),
                claimId: 0
            }),
            saleRef,
            Types.Rail.CUSTODY,
            currency
        );
    }

    /// @inheritdoc IDebtLedger
    function dischargeObligation(uint256 debtId) external onlyGateway {
        Record storage record = _requireDebt(debtId);
        if (record.role != Types.Role.BUYER) revert NotAnObligation(debtId);
        if (record.state != Types.DebtState.AGING) revert DebtNotOpen(debtId);

        _setState(debtId, record, Types.DebtState.DISCHARGED);
        emit ObligationDischarged(debtId, record.recipient);
    }

    // --- Claims ---

    /// @notice The operator asserts that it paid these debts, referencing the payment.
    /// @dev Batched or single, it is one assertion with one fate: if it cannot be sustained, every
    ///      debt under it re-ages and every recipient under it is a wronged party.
    function postClaim(uint256[] calldata debtIds, bytes32 refHash)
        external
        onlyOperator
        returns (uint256 claimId)
    {
        return _openClaim(debtIds, refHash);
    }

    /// @notice A recipient tests a claim: they say they were not paid.
    /// @dev Gated on the recipient's key and on nothing else. There is no allow-list, no operator
    ///      approval and no privileged relay — the transaction is valid from any node on earth.
    function challenge(uint256 claimId) external {
        _challenge(claimId, msg.sender);
    }

    /// @notice The same challenge, authorised by the recipient's signature and broadcast by anyone.
    /// @dev A recipient who holds no gas token must still be able to say "I was not paid", and a
    ///      recipient who is sponsored must not thereby be dependent on their sponsor. Anyone may
    ///      carry this — including the operator, which gains nothing by it: the signature says what
    ///      it says.
    ///
    ///      No nonce: the signature authorises exactly one irreversible transition on exactly one
    ///      claim. Replaying it once the claim has moved on simply reverts.
    function challengeFor(uint256 claimId, address recipient, bytes calldata signature) external {
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(CHALLENGE_TYPEHASH, claimId, recipient)));
        if (!SignatureChecker.isValidSignatureNowCalldata(recipient, digest, signature)) {
            revert BadChallengeSignature();
        }
        _challenge(claimId, recipient);
    }

    /// @notice The operator answers a challenge with evidence.
    /// @dev The statement is built from the claim's captured state, not from the caller's
    ///      arguments, so the only thing the operator supplies is the proof itself. Real evidence
    ///      for a different payment does not match this statement and does not save this claim.
    function respond(uint256 claimId, bytes calldata proof) external onlyOperator {
        Claim storage claim_ = _requireClaim(claimId);
        if (claim_.state != Types.ClaimState.CHALLENGED) revert ClaimNotChallenged(claimId);
        if (claim_.responseDeadline.isPast(uint64(block.timestamp))) {
            revert ResponseWindowClosed(claimId, claim_.responseDeadline);
        }
        if (!verifier.verify(statementOf(claimId), proof)) revert ProofRejected(claimId);

        _prove(claimId, claim_);
    }

    /// @notice Silence ratifies a claim once its window closes. Anyone may record that.
    function settleClaim(uint256 claimId) external {
        Claim storage claim_ = _requireClaim(claimId);
        if (claim_.state != Types.ClaimState.PENDING) revert ClaimNotPending(claimId);
        if (!claim_.challengeDeadline.isPast(uint64(block.timestamp))) {
            revert ChallengeWindowOpen(claimId, claim_.challengeDeadline);
        }

        claim_.state = Types.ClaimState.SETTLED;
        _moveDebts(claimId, Types.DebtState.SETTLED);
        emit ClaimSettled(claimId);
    }

    /// @notice A challenged claim the operator never answered is dead. Anyone may record that.
    /// @dev Permissionless on purpose: the wronged recipient has already done the only thing the
    ///      protocol ever asks of them, which is to say they were not paid. Everything after that
    ///      is arithmetic a stranger can execute.
    function voidChallenged(uint256 claimId) external {
        Claim storage claim_ = _requireClaim(claimId);
        if (claim_.state != Types.ClaimState.CHALLENGED) revert ClaimNotChallenged(claimId);
        if (!claim_.responseDeadline.isPast(uint64(block.timestamp))) {
            revert ResponseWindowOpen(claimId, claim_.responseDeadline);
        }

        _void(claimId, claim_);
    }

    // --- The sweep's seam ---

    /// @notice The periodic attestation covered this claim: its evidence is on-chain.
    /// @dev Coverage may pre-empt an open window — evidence ends the question early rather than
    ///      waiting for a test nobody is going to run.
    function proveClaim(uint256 claimId) external onlySweep {
        Claim storage claim_ = _requireClaim(claimId);
        _requireLive(claimId, claim_);
        _prove(claimId, claim_);
    }

    /// @notice The claim's coverage deadline passed with no evidence behind it.
    /// @dev The sweep owns coverage deadlines; this is where their outcome lands. A claim still
    ///      inside a live response window is not void — the operator's own clock has not run out.
    function voidClaim(uint256 claimId) external onlySweep {
        Claim storage claim_ = _requireClaim(claimId);
        _requireLive(claimId, claim_);
        if (
            claim_.state == Types.ClaimState.CHALLENGED
                && !claim_.responseDeadline.isPast(uint64(block.timestamp))
        ) {
            revert ResponseWindowOpen(claimId, claim_.responseDeadline);
        }

        _void(claimId, claim_);
    }

    // --- Default ---

    /// @inheritdoc IDebtLedger
    function markDefaulted(uint256 debtId) external onlyPool {
        Record storage record = _requireDebt(debtId);
        if (!_isDefaultable(record)) revert NotDefaulted(debtId);

        _setState(debtId, record, Types.DebtState.DEFAULTED);
        emit DebtDefaulted(debtId, record.recipient, record.amount);
    }

    /// @notice Whether this debt is in default right now.
    /// @dev Default is a state, not an event: it is true by arithmetic the moment the deadline
    ///      passes with the debt still aging, and the touch that executes it only records what was
    ///      already so. A claim suspends nothing by existing — it suspends default by holding the
    ///      debt out of AGING while its windows run, and the instant it dies the debt is back where
    ///      it was, at the age it always had.
    function isDefaultable(uint256 debtId) external view returns (bool) {
        Record storage record = _records[debtId];
        if (record.state == Types.DebtState.NONE) revert UnknownDebt(debtId);
        return _isDefaultable(record);
    }

    // --- Reads ---

    /// @inheritdoc IDebtLedger
    function outstanding() external view returns (uint256) {
        return _outstanding;
    }

    /// @inheritdoc IDebtLedger
    function debt(uint256 debtId) external view returns (Debt memory) {
        Record memory record = _records[debtId];
        if (record.state == Types.DebtState.NONE) revert UnknownDebt(debtId);
        Sale memory sale = _sales[record.saleId];

        return Debt({
            saleRef: sale.itemRef,
            recipient: record.recipient,
            role: record.role,
            rail: sale.rail,
            state: record.state,
            mintedAt: record.mintedAt,
            deadline: record.deadline,
            amount: record.amount,
            currency: sale.currency,
            claimRef: record.claimId == 0 ? bytes32(0) : _claims[record.claimId].refHash
        });
    }

    /// @inheritdoc IDebtLedger
    function debtCount() external view returns (uint256) {
        return _debtCount;
    }

    function claim(uint256 claimId) external view returns (Claim memory) {
        Claim memory record = _claims[claimId];
        if (record.state == Types.ClaimState.NONE) revert UnknownClaim(claimId);
        return record;
    }

    function claimDebts(uint256 claimId) external view returns (uint256[] memory) {
        return _claimDebts[claimId];
    }

    function claimCount() external view returns (uint256) {
        return _claimCount;
    }

    /// @notice The statement a proof of this claim must be a proof of.
    /// @dev Assembled entirely from what the ledger captured when the claim was posted. Nothing a
    ///      caller passes can alter it, which is what makes the full-tuple check meaningful: the
    ///      operator cannot aim a real receipt at a statement of its own choosing.
    function statementOf(uint256 claimId) public view returns (IProofVerifier.Statement memory) {
        Claim memory record = _claims[claimId];
        if (record.state == Types.ClaimState.NONE) revert UnknownClaim(claimId);

        return IProofVerifier.Statement({
            claimId: claimId,
            refHash: record.refHash,
            recipientAccountHash: record.accountsCommitment,
            amountCommitment: record.amountsCommitment,
            currency: record.currency,
            success: true
        });
    }

    /// @notice The lying fee on the next void, as a share of the amount claimed.
    /// @dev Doubles with every void the operator has caused, and stops at the whole amount: a fee
    ///      for lying about a payment cannot exceed the payment lied about.
    function penaltyRateBps() public view returns (uint256) {
        uint256 offences = voidCount;
        if (offences >= 16) return BPS;
        uint256 rate = uint256(penaltyBps) << offences;
        return rate > BPS ? BPS : rate;
    }

    // --- Internals ---

    function _openSale(uint256 saleRef, bytes32 currency, Types.Rail rail)
        internal
        returns (uint256 saleId)
    {
        saleId = ++_saleCount;
        _sales[saleId] = Sale({itemRef: saleRef, currency: currency, rail: rail});
    }

    function _mint(Record memory record, uint256 saleRef, Types.Rail rail, bytes32 currency)
        internal
        returns (uint256 debtId)
    {
        if (record.recipient == address(0)) revert ZeroAddress();

        debtId = ++_debtCount;
        _records[debtId] = record;

        if (_isExposed(rail, record.state)) _outstanding += record.amount;

        emit DebtMinted(
            debtId,
            saleRef,
            record.recipient,
            record.role,
            rail,
            record.amount,
            currency,
            record.mintedAt,
            record.deadline,
            record.state
        );
    }

    function _openClaim(uint256[] memory debtIds, bytes32 refHash)
        internal
        returns (uint256 claimId)
    {
        if (refHash == bytes32(0)) revert MissingClaimRef();
        if (debtIds.length == 0) revert EmptyClaim();

        claimId = ++_claimCount;
        uint64 postedAt = uint64(block.timestamp);
        uint64 challengeDeadline = postedAt.deadlineFrom(challengeWindow);

        bytes32[] memory accounts = new bytes32[](debtIds.length);
        uint256[] memory amounts = new uint256[](debtIds.length);
        bytes32 currency;
        uint256 total;

        for (uint256 i = 0; i < debtIds.length; ++i) {
            uint256 debtId = debtIds[i];
            Record storage record = _requireDebt(debtId);

            // Only an aging debt can be claimed. A retained leg, a settled one, a defaulted one and
            // a debt already under claim all land here — and a repeated id in the same batch lands
            // here on its second pass, which is why duplicates cannot double-count a penalty.
            if (record.state != Types.DebtState.AGING) {
                revert DebtNotClaimable(debtId, record.state);
            }

            bytes32 debtCurrency = _sales[record.saleId].currency;
            if (i == 0) currency = debtCurrency;
            else if (debtCurrency != currency) revert MixedCurrencyClaim();

            // You cannot have paid someone you have no account for. This is also why the account
            // registry has to be writable by the recipient alone: an operator that could name the
            // account would be asserting the fact it is supposed to be proving.
            bytes32 accountHash = _accounts[record.recipient][debtCurrency];
            if (accountHash == bytes32(0)) revert NoAccountOnFile(record.recipient, debtCurrency);

            accounts[i] = accountHash;
            amounts[i] = record.amount;
            total += record.amount;

            record.claimId = SafeCast.toUint32(claimId);
            _setState(debtId, record, Types.DebtState.PROVISIONAL);
            _claimDebts[claimId].push(debtId);
        }

        _claims[claimId] = Claim({
            postedAt: postedAt,
            challengeDeadline: challengeDeadline,
            responseDeadline: 0,
            state: Types.ClaimState.PENDING,
            refHash: refHash,
            currency: currency,
            accountsCommitment: keccak256(abi.encode(accounts)),
            amountsCommitment: keccak256(abi.encode(amounts)),
            totalAmount: total
        });

        emit ClaimPosted(claimId, refHash, currency, total, challengeDeadline, debtIds);
    }

    function _challenge(uint256 claimId, address recipient) internal {
        Claim storage claim_ = _requireClaim(claimId);
        if (claim_.state != Types.ClaimState.PENDING) revert ClaimNotPending(claimId);

        uint64 timestamp = uint64(block.timestamp);
        if (claim_.challengeDeadline.isPast(timestamp)) {
            revert ChallengeWindowClosed(claimId, claim_.challengeDeadline);
        }
        if (!_isRecipientOf(claimId, recipient)) revert NotRecipient(claimId, recipient);

        uint64 responseDeadline = timestamp.deadlineFrom(responseWindow);
        claim_.responseDeadline = responseDeadline;
        claim_.state = Types.ClaimState.CHALLENGED;

        emit ClaimChallenged(claimId, recipient, responseDeadline);
    }

    function _prove(uint256 claimId, Claim storage claim_) internal {
        claim_.state = Types.ClaimState.PROVEN;
        _moveDebts(claimId, Types.DebtState.PROVEN);
        emit ClaimProven(claimId, msg.sender);
    }

    /// @dev The void is the whole trap. The claim dies, the operator pays an escalating fee to the
    ///      parties it said it had paid, and every debt underneath returns to aging exactly where
    ///      it left off — not reset, not credited for the time the lie was pending. On a short
    ///      settlement rail the void lands past the deadline by construction, so the debt is in
    ///      default the moment it comes back.
    function _void(uint256 claimId, Claim storage claim_) internal {
        uint256 rate = penaltyRateBps();
        ++voidCount;

        uint256[] storage debtIds = _claimDebts[claimId];
        bytes32 currency = claim_.currency;
        uint256 totalPenalty;

        for (uint256 i = 0; i < debtIds.length; ++i) {
            uint256 debtId = debtIds[i];
            Record storage record = _records[debtId];

            uint256 penalty = uint256(record.amount) * rate / BPS;
            uint256 toRecipient = penalty - penalty / 2; // the wronged party is never rounded down
            uint256 toPool = penalty - toRecipient;

            penaltyOwed[record.recipient][currency] += toRecipient;
            poolPenaltyOwed[currency] += toPool;
            totalPenalty += penalty;

            record.claimId = 0;
            _setState(debtId, record, Types.DebtState.AGING);

            emit PenaltyAccrued(claimId, record.recipient, currency, toRecipient, toPool);
        }

        claim_.state = Types.ClaimState.VOIDED;
        emit ClaimVoided(claimId, rate, totalPenalty);
    }

    function _moveDebts(uint256 claimId, Types.DebtState state) internal {
        uint256[] storage debtIds = _claimDebts[claimId];
        for (uint256 i = 0; i < debtIds.length; ++i) {
            uint256 debtId = debtIds[i];
            _setState(debtId, _records[debtId], state);
        }
    }

    function _setState(uint256 debtId, Record storage record, Types.DebtState next) internal {
        Types.DebtState previous = record.state;
        if (previous == next) return;

        Types.Rail rail = _sales[record.saleId].rail;
        bool was = _isExposed(rail, previous);
        bool now_ = _isExposed(rail, next);
        if (was && !now_) _outstanding -= record.amount;
        else if (!was && now_) _outstanding += record.amount;

        record.state = next;
        emit DebtStateChanged(debtId, previous, next, uint64(block.timestamp));
    }

    /// @dev Custody exposure is other people's money in the operator's hands.
    ///
    ///      A cash-rail debt is exposure from mint until it settles, is proven, or reverses: the
    ///      operator took the money and owes it onward, and a claim it has not yet sustained does
    ///      not change that.
    ///
    ///      An instant-rail debt is not exposure, because the rail split the payment at the point
    ///      of sale — but that is true only for as long as the rail's own claim stands. If that
    ///      claim dies, the debt returns to aging, and a debt that is aging is money the operator
    ///      is holding no matter which rail it swore the money went down.
    ///
    ///      The operator's own leg is retained, never aging, and so never exposure: owing yourself
    ///      is not custody.
    function _isExposed(Types.Rail rail, Types.DebtState state) internal pure returns (bool) {
        return state == Types.DebtState.AGING
            || (state == Types.DebtState.PROVISIONAL && rail == Types.Rail.CUSTODY);
    }

    function _isDefaultable(Record storage record) internal view returns (bool) {
        return
            record.state == Types.DebtState.AGING && record.deadline.isPast(uint64(block.timestamp));
    }

    function _isRecipientOf(uint256 claimId, address account) internal view returns (bool) {
        uint256[] storage debtIds = _claimDebts[claimId];
        for (uint256 i = 0; i < debtIds.length; ++i) {
            if (_records[debtIds[i]].recipient == account) return true;
        }
        return false;
    }

    function _requireLive(uint256 claimId, Claim storage claim_) internal view {
        Types.ClaimState state = claim_.state;
        if (state == Types.ClaimState.PROVEN || state == Types.ClaimState.VOIDED) {
            revert ClaimNotLive(claimId);
        }
    }

    function _requireDebt(uint256 debtId) internal view returns (Record storage record) {
        record = _records[debtId];
        if (record.state == Types.DebtState.NONE) revert UnknownDebt(debtId);
    }

    function _requireClaim(uint256 claimId) internal view returns (Claim storage claim_) {
        claim_ = _claims[claimId];
        if (claim_.state == Types.ClaimState.NONE) revert UnknownClaim(claimId);
    }
}
