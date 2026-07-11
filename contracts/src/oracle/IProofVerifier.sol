// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @title IProofVerifier
/// @notice The evidence seam. A claim is the operator's assertion that it paid; a proof is what
///         turns that assertion into a fact the ledger will accept. Nothing in the protocol
///         treats a payment webhook, a bank alert or an operator's word as evidence — those are
///         triggers. Evidence passes through here or it does not exist.
interface IProofVerifier {
    /// @notice What a proof must be a proof *of*, bound per claim.
    /// @dev The full tuple is load-bearing. Coverage forecloses challenges, so a statement that
    ///      is cryptographically valid but describes a different payment must not verify: a
    ///      transfer of the right amount to the wrong account, or of the right number in the
    ///      wrong currency, is not payment of this debt. Verifying anything less than the whole
    ///      tuple would let the operator cover a claim with a real receipt for something else.
    struct Statement {
        uint256 claimId;
        bytes32 refHash;
        bytes32 recipientAccountHash;
        bytes32 amountCommitment;
        bytes32 currency;
        bool success;
    }

    /// @notice Whether `proof` proves `statement`.
    /// @dev A production verifier answers two independent questions, and a proof must pass both:
    ///
    ///      1. Is the proof cryptographically valid — do the attestor signatures verify, or does
    ///         the zero-knowledge proof check out against its verifying key? Fabricated evidence
    ///         fails here.
    ///
    ///      2. Does the proof's payload match this statement, field for field? Real evidence for
    ///         a different payment fails here.
    ///
    ///      A verifier that answers only the first question proves that *a* payment happened. The
    ///      ledger needs to know that *this* payment happened.
    function verify(Statement calldata statement, bytes calldata proof) external view returns (bool);
}
