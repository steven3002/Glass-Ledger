// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {IProofVerifier} from "../src/oracle/IProofVerifier.sol";
import {StubProofVerifier} from "../src/oracle/StubProofVerifier.sol";

/// @notice The evidence seam, tested for the two things that must remain true when the real
///         verifier replaces it: a statement with nothing on file is false, and a verdict answers
///         one exact question — the whole tuple, not a family resemblance to it.
contract ProofVerifierTest is Test {
    bytes internal constant EVIDENCE = hex"c0ffee";
    bytes32 internal constant POINTER = keccak256("storage-root-of-the-attestation-blob");

    address internal operator;
    address internal stranger;
    StubProofVerifier internal verifier;

    function setUp() public {
        operator = makeAddr("operator");
        stranger = makeAddr("stranger");
        verifier = new StubProofVerifier(operator);
    }

    function _statement() internal pure returns (IProofVerifier.Statement memory) {
        return IProofVerifier.Statement({
            claimId: 1,
            refHash: keccak256("processor-payment-reference"),
            recipientAccountHash: keccak256("creator-bank-account"),
            amountCommitment: keccak256(abi.encode(uint256(80_000e18))),
            // forge-lint: disable-next-line(unsafe-typecast)
            currency: bytes32("NGN"),
            success: true
        });
    }

    function _inject(IProofVerifier.Statement memory statement, bool valid) internal {
        vm.prank(operator);
        verifier.setVerdict(statement, valid);
    }

    // --- Access ---

    function test_theVerifierNeedsAnOperator() public {
        vm.expectRevert(StubProofVerifier.ZeroAddress.selector);
        new StubProofVerifier(address(0));
    }

    /// @dev Injection is the mock, and the mock is the operator's. Anyone else being able to declare
    ///      payments proven would not be a stub — it would be a hole.
    function test_onlyTheOperatorInjectsAVerdict() public {
        vm.expectRevert(StubProofVerifier.NotOperator.selector);
        vm.prank(stranger);
        verifier.setVerdict(_statement(), true);
    }

    function test_onlyTheOperatorSubmitsEvidence() public {
        vm.expectRevert(StubProofVerifier.NotOperator.selector);
        vm.prank(stranger);
        verifier.submitEvidence(EVIDENCE, POINTER);
    }

    function test_evidenceIsNeverEmpty() public {
        vm.expectRevert(StubProofVerifier.EmptyEvidence.selector);
        vm.prank(operator);
        verifier.submitEvidence("", POINTER);
    }

    // --- Verdicts ---

    /// @dev The only honest default: absence of evidence is not evidence.
    function test_aStatementWithNothingOnFileIsFalse() public view {
        assertFalse(verifier.verify(_statement(), EVIDENCE));
    }

    function test_anInjectedVerdictIsWhatTheVerifierAnswers() public {
        _inject(_statement(), true);
        assertTrue(verifier.verify(_statement(), EVIDENCE));

        _inject(_statement(), false);
        assertFalse(verifier.verify(_statement(), EVIDENCE));
    }

    /// @dev The property the sweep leans its whole weight on. A verdict is an answer to one exact
    ///      question; change any field of the question and it is a different question, for which
    ///      nothing has been answered. This is what makes a real transfer to the wrong account —
    ///      or of the wrong amount, or in the wrong currency — cover nothing.
    function test_aVerdictAnswersOneExactQuestionAndNoOther() public {
        _inject(_statement(), true);

        IProofVerifier.Statement memory probe = _statement();
        probe.claimId = 2;
        assertFalse(verifier.verify(probe, EVIDENCE));

        probe = _statement();
        probe.refHash = keccak256("some other payment");
        assertFalse(verifier.verify(probe, EVIDENCE));

        probe = _statement();
        probe.recipientAccountHash = keccak256("somebody-elses-account");
        assertFalse(verifier.verify(probe, EVIDENCE));

        probe = _statement();
        probe.amountCommitment = keccak256(abi.encode(uint256(1e18)));
        assertFalse(verifier.verify(probe, EVIDENCE));

        probe = _statement();
        // forge-lint: disable-next-line(unsafe-typecast)
        probe.currency = bytes32("USD");
        assertFalse(verifier.verify(probe, EVIDENCE));

        // A proof that the transfer *failed* proves nothing about a debt being paid.
        probe = _statement();
        probe.success = false;
        assertFalse(verifier.verify(probe, EVIDENCE));

        // The question that was actually answered is still answered.
        assertTrue(verifier.verify(_statement(), EVIDENCE));
    }

    /// @dev What the stub does not do, stated as a test so nobody mistakes it for a verifier: the
    ///      proof bytes are accepted and ignored. A real verifier reads them and computes the answer
    ///      this contract is simply handed. Every other part of the seam — the statement, the call,
    ///      the blob, the pointer — is already the production one.
    function test_theStubIgnoresTheProofBytes() public {
        _inject(_statement(), true);

        assertTrue(verifier.verify(_statement(), EVIDENCE));
        assertTrue(verifier.verify(_statement(), hex"deadbeef"));
        assertTrue(verifier.verify(_statement(), ""));
    }

    // --- Evidence ---

    /// @dev The chain keeps the hash of the blob; the pointer says where the blob itself lives. A
    ///      reader can fetch it, hash what comes back, and check it against what was attested to —
    ///      which is the only reason the pointer is worth storing.
    function test_evidenceIsHashedIntoStateWithItsPointer() public {
        vm.expectEmit(true, true, false, true, address(verifier));
        emit StubProofVerifier.EvidenceSubmitted(keccak256(EVIDENCE), POINTER, EVIDENCE.length);

        vm.prank(operator);
        bytes32 evidenceHash = verifier.submitEvidence(EVIDENCE, POINTER);

        assertEq(evidenceHash, keccak256(EVIDENCE));
        (uint64 postedAt, bytes32 storagePointer) = verifier.evidenceOf(evidenceHash);
        assertEq(postedAt, uint64(block.timestamp));
        assertEq(storagePointer, POINTER);
    }

    function test_evidenceNobodySubmittedIsNotOnFile() public view {
        (uint64 postedAt, bytes32 storagePointer) = verifier.evidenceOf(keccak256("never posted"));
        assertEq(postedAt, 0);
        assertEq(storagePointer, bytes32(0));
    }
}
