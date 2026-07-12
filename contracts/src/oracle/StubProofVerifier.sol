// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IProofVerifier} from "./IProofVerifier.sol";

/// @title StubProofVerifier
/// @notice The evidence layer with exactly one thing mocked: the verdict.
///
///         Everything around the verdict is real and is what production will use — the statement
///         the ledger builds, the call the sweep makes, the batched evidence blob, the pointer that
///         addresses it off-chain. The single thing this contract does not do is *derive* its
///         answer: where a real verifier checks attestor signatures and matches the payload against
///         the statement field for field, this one is told the answer by the operator.
///
/// @dev That the mock is nakedly a mock is the point. A stub that pretended to compute its verdict
///      from the proof bytes would look like a verifier while verifying nothing, and the seam it is
///      standing in for would stop being visible in the code. The operator injects a verdict, in
///      the open, under its own key; the day the real verifier lands, the injection is deleted and
///      the answer starts being computed. Nothing else about the shape changes.
///
///      Production note — what replaces this: a verifier that answers two independent questions and
///      passes a proof only if both hold. (1) Is the proof cryptographically valid: do the attestor
///      signatures verify, or does the zero-knowledge proof check against its verifying key?
///      Fabricated evidence dies here. (2) Does the proof's payload match this statement field for
///      field — the payment reference, the recipient's hashed account, the amount, the currency,
///      and a success status? Real evidence for some other payment dies here. A verifier that
///      answers only (1) proves that *a* payment happened; the ledger has to know that *this* one
///      did, because coverage forecloses the challenge that would otherwise have caught it.
contract StubProofVerifier is IProofVerifier {
    /// @notice The batched attestation blob behind a sweep.
    /// @dev The bytes are hashed into state so the blob cannot be swapped after the fact, and the
    ///      pointer addresses the copy anyone can fetch. Content-addressed storage returns a root
    ///      hash on upload, and that root is what this field is reserved to carry — so a reader can
    ///      resolve the pointer, hash what comes back, and compare it with what was attested to.
    struct Evidence {
        uint64 postedAt;
        bytes32 storagePointer;
    }

    address public immutable operator;

    /// @notice The injected verdict per statement. A statement with nothing on file is false, which
    ///         is the only honest default: absence of evidence is not evidence.
    mapping(bytes32 statementHash => bool valid) public verdicts;

    /// @notice The evidence blobs the operator has published, by the hash of their bytes.
    mapping(bytes32 evidenceHash => Evidence) public evidenceOf;

    event VerdictInjected(bytes32 indexed statementHash, bool valid, Statement statement);
    event EvidenceSubmitted(
        bytes32 indexed evidenceHash, bytes32 indexed storagePointer, uint256 length
    );

    error NotOperator();
    error ZeroAddress();
    error EmptyEvidence();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(address operator_) {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
    }

    /// @notice Injects the verdict a real verifier would have computed for this statement.
    /// @dev Operator-gated, and gated on nothing else — there is no world in which this is a
    ///      trusted operation, which is why it is the first thing to disappear. It is keyed by the
    ///      whole statement: a verdict is an answer to one exact question, and changing any field
    ///      of the question asks a different one, for which nothing is on file.
    function setVerdict(Statement calldata statement, bool valid) external onlyOperator {
        bytes32 statementHash = keccak256(abi.encode(statement));
        verdicts[statementHash] = valid;
        emit VerdictInjected(statementHash, valid, statement);
    }

    /// @notice Publishes the evidence blob a sweep is attesting to.
    /// @dev The chain keeps the hash; the blob itself lives where the pointer says. This is the
    ///      plumbing the real verifier keeps unchanged — one proof spanning thousands of claims is
    ///      the reason the ratchet is affordable at all, and it has to be fetchable by anyone who
    ///      wants to check the operator's arithmetic themselves.
    function submitEvidence(bytes calldata evidence, bytes32 storagePointer)
        external
        onlyOperator
        returns (bytes32 evidenceHash)
    {
        if (evidence.length == 0) revert EmptyEvidence();

        evidenceHash = keccak256(evidence);
        evidenceOf[evidenceHash] =
            Evidence({postedAt: uint64(block.timestamp), storagePointer: storagePointer});

        emit EvidenceSubmitted(evidenceHash, storagePointer, evidence.length);
    }

    /// @inheritdoc IProofVerifier
    /// @dev The proof bytes are accepted and ignored, and that is the whole of the mock: a real
    ///      verifier reads them and computes what this contract is simply told. The call shape is
    ///      the production one, so the sweep that hands over a batched blob today hands over the
    ///      same blob to the verifier that replaces this.
    function verify(Statement calldata statement, bytes calldata)
        external
        view
        returns (bool valid)
    {
        return verdicts[keccak256(abi.encode(statement))];
    }
}
