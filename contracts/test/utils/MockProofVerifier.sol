// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IProofVerifier} from "../../src/oracle/IProofVerifier.sol";

/// @notice Stands in for the evidence layer while it is not yet built. Verdicts are injected per
///         statement, which is exactly the shape a real verifier answers in — the difference is
///         that a real one computes the answer instead of being told it.
/// @dev A statement with no verdict on file fails, which is the honest default: absence of evidence
///      is not evidence.
contract MockProofVerifier is IProofVerifier {
    mapping(bytes32 statementHash => bool valid) public verdicts;

    function setVerdict(Statement calldata statement, bool valid) external {
        verdicts[keccak256(abi.encode(statement))] = valid;
    }

    function verify(Statement calldata statement, bytes calldata) external view returns (bool) {
        return verdicts[keccak256(abi.encode(statement))];
    }
}
