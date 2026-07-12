// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {DebtLedger} from "./DebtLedger.sol";
import {IProofVerifier} from "../oracle/IProofVerifier.sol";
import {Types} from "../libs/Types.sol";
import {WindowMath} from "../libs/WindowMath.sol";

/// @title SweepRegistry
/// @notice The ratchet. A challenge catches a false claim only if someone is awake to catch it; the
///         sweep is the test that runs whether anyone is awake or not.
///
///         On a fixed cadence the operator posts one batched proof over its processor's transfer
///         log. A claim is covered only if that log contains the payment the claim asserted — the
///         whole tuple of it — and a claim left uncovered past its deadline dies exactly as if it
///         had been challenged and never answered: void, penalty, and the debt back to aging at the
///         age it always had.
///
/// @dev Two independent tests, and a claim must survive both. Passing the challenge window proves
///      only that nobody looked. That is why the sleeping recipient is protected by arithmetic
///      rather than by vigilance: silence can delay the reckoning by one coverage window, and it
///      can never replace the evidence.
///
///      The attestation covers *claims, not debts*. A debt nobody has claimed has nothing to
///      attest — the sweep cannot touch it, cannot launder it, cannot save it. It ages toward
///      default on its own, which is the asymmetry the whole protocol is built on: payment must be
///      proven, and non-payment proves itself.
contract SweepRegistry {
    using WindowMath for uint64;

    /// @notice One posted attestation.
    struct Attestation {
        uint64 postedAt;
        uint32 claimsSubmitted;
        uint32 claimsCovered;
        bytes32 evidenceHash;
        bytes32 storagePointer;
    }

    address public immutable operator;
    DebtLedger public immutable debts;

    /// @notice The evidence seam, taken from the ledger rather than supplied here.
    /// @dev So that the sweep cannot be pointed at a verifier the ledger does not use. One protocol,
    ///      one oracle root: a second verifier would be a second definition of what counts as proof.
    IProofVerifier public immutable verifier;

    /// @notice How long a claim has to acquire evidence behind it, measured from the moment it was
    ///         posted. Not from the sale, and not from the challenge window's close: the operator
    ///         starts the clock itself, by asserting the payment.
    uint32 public immutable coverageWindow;

    uint256 private _attestationCount;
    mapping(uint256 sweepId => Attestation) private _attestations;

    /// @notice Which attestation covered a claim, if one did.
    mapping(uint256 claimId => uint256 sweepId) public coveredBy;

    event AttestationPosted(
        uint256 indexed sweepId,
        bytes32 indexed evidenceHash,
        bytes32 storagePointer,
        uint256 claimsSubmitted,
        uint256 claimsCovered
    );
    event ClaimCovered(uint256 indexed sweepId, uint256 indexed claimId);
    event ClaimUncovered(uint256 indexed sweepId, uint256 indexed claimId);
    event ClaimExempt(uint256 indexed sweepId, uint256 indexed claimId, Types.ClaimState state);
    event CoverageLapsed(uint256 indexed claimId, uint64 deadline);

    error NotOperator();
    error ZeroAddress();
    error InvalidWindow();
    error CoverageWindowTooShort(uint32 coverage, uint32 minimum);
    error EmptySweep();
    error EmptyEvidence();
    error CoverageWindowOpen(uint256 claimId, uint64 deadline);

    /// @dev The coverage window must outlast the primary machinery it is the backstop for. A claim
    ///      can be challenged at the last second of its challenge window, and the operator then has
    ///      its whole response window to answer — so the last moment a claim can still be decided on
    ///      its merits is `postedAt + challenge + response`. A coverage window shorter than that
    ///      would put the backstop's deadline before the primary deadline, and the configured
    ///      response window would become a number the deployment does not honour.
    ///
    ///      The ledger refuses such a void anyway (`voidClaim` will not touch a claim whose response
    ///      window is still live), so the effective deadline would silently become the response
    ///      window's close rather than the configured coverage deadline: not unsafe, but not what
    ///      the parameter says. A deployment states its windows honestly or it does not deploy.
    constructor(address operator_, DebtLedger debts_, uint32 coverageWindow_) {
        if (operator_ == address(0) || address(debts_) == address(0)) revert ZeroAddress();
        if (coverageWindow_ == 0) revert InvalidWindow();

        uint32 minimum = debts_.challengeWindow() + debts_.responseWindow();
        if (coverageWindow_ < minimum) revert CoverageWindowTooShort(coverageWindow_, minimum);

        operator = operator_;
        debts = debts_;
        verifier = debts_.verifier();
        coverageWindow = coverageWindow_;
    }

    /// @notice The periodic attestation: one proof, one blob, every claim of the period.
    /// @dev What "covering" means, exactly, is the load-bearing part of this contract, and it is one
    ///      line: the statement put to the verifier is `debts.statementOf(claimId)` — assembled by
    ///      the ledger out of what it captured when the claim was posted. The operator supplies the
    ///      evidence and nothing else. It cannot describe the payment it is proving, so a real
    ///      transfer of the right amount to the wrong account, or of the right number in the wrong
    ///      currency, proves a statement nobody asked about and covers nothing.
    ///
    ///      Anything looser would make the sweep a rubber stamp, and a rubber stamp is worse than no
    ///      sweep at all: coverage forecloses the ordinary challenge, so a claim wrongly covered is
    ///      a claim that can never be tested again.
    ///
    ///      A batch does not fail because one claim in it fails to cover. An uncovered claim simply
    ///      keeps its clock — it is still owed evidence, and it still dies at its deadline if no
    ///      later sweep produces any. Reverting the whole attestation instead would hand the
    ///      operator a way to make its own failures unrecordable.
    function attest(uint256[] calldata claimIds, bytes calldata evidence, bytes32 storagePointer)
        external
        returns (uint256 sweepId)
    {
        if (msg.sender != operator) revert NotOperator();
        if (claimIds.length == 0) revert EmptySweep();
        if (evidence.length == 0) revert EmptyEvidence();

        sweepId = ++_attestationCount;
        uint256 covered;

        for (uint256 i = 0; i < claimIds.length; ++i) {
            uint256 claimId = claimIds[i];

            // Reverts on a claim that does not exist: a sweep may be incomplete, never invented.
            Types.ClaimState state = debts.claim(claimId).state;

            // A claim already proven — in a challenge, or by an earlier sweep — has its evidence
            // on-chain already; the coverage rule exists to guarantee exactly that, and a won
            // challenge satisfied it outright. A voided claim is dead. Neither is an error inside a
            // batch: the operator attests to a period, and a period contains both.
            if (state == Types.ClaimState.PROVEN || state == Types.ClaimState.VOIDED) {
                emit ClaimExempt(sweepId, claimId, state);
                continue;
            }

            if (verifier.verify(debts.statementOf(claimId), evidence)) {
                debts.proveClaim(claimId);
                coveredBy[claimId] = sweepId;
                ++covered;
                emit ClaimCovered(sweepId, claimId);
            } else {
                emit ClaimUncovered(sweepId, claimId);
            }
        }

        _attestations[sweepId] = Attestation({
            postedAt: uint64(block.timestamp),
            claimsSubmitted: SafeCast.toUint32(claimIds.length),
            claimsCovered: SafeCast.toUint32(covered),
            evidenceHash: keccak256(evidence),
            storagePointer: storagePointer
        });

        emit AttestationPosted(
            sweepId, keccak256(evidence), storagePointer, claimIds.length, covered
        );
    }

    /// @notice The claim's coverage deadline passed and no evidence ever appeared behind it.
    /// @dev Permissionless, like every other collection of a fact that is already true. The claim
    ///      does not die because a stranger sent this transaction; it died when the deadline passed
    ///      with nothing to show, and the transaction only records it.
    ///
    ///      The ledger enforces the rest and this contract does not second-guess it: a claim that is
    ///      already terminal is beyond the sweep, and a challenged claim whose response window is
    ///      still running is not void yet — the operator's own clock has not run out, whatever the
    ///      coverage deadline says. Two deadlines can both be live; neither shortcuts the other.
    function touch(uint256 claimId) external {
        uint64 deadline = coverageDeadline(claimId);
        if (!deadline.isPast(uint64(block.timestamp))) {
            revert CoverageWindowOpen(claimId, deadline);
        }

        debts.voidClaim(claimId);
        emit CoverageLapsed(claimId, deadline);
    }

    /// @notice The moment after which this claim needs evidence or it is void.
    function coverageDeadline(uint256 claimId) public view returns (uint64) {
        return debts.claim(claimId).postedAt.deadlineFrom(coverageWindow);
    }

    function attestation(uint256 sweepId) external view returns (Attestation memory) {
        return _attestations[sweepId];
    }

    function attestationCount() external view returns (uint256) {
        return _attestationCount;
    }
}
