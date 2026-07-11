// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";

/// @notice Builds tranche roots and membership proofs the way the ledger verifies them: a binary
///         tree over the ordered leaves, hashing each pair commutatively. The off-chain builders
///         that produce proofs for the relayer and the browser must agree with this walk.
library MerkleBuilder {
    function build(bytes32[] memory leaves) internal pure returns (bytes32[] memory tree) {
        uint256 count = leaves.length;
        tree = new bytes32[](2 * count - 1);

        for (uint256 i = 0; i < count; ++i) {
            tree[2 * count - 2 - i] = leaves[i];
        }
        for (uint256 i = count - 1; i > 0; --i) {
            uint256 node = i - 1;
            tree[node] = Hashes.commutativeKeccak256(tree[2 * node + 1], tree[2 * node + 2]);
        }
    }

    function root(bytes32[] memory leaves) internal pure returns (bytes32) {
        return build(leaves)[0];
    }

    function proof(bytes32[] memory leaves, uint256 index)
        internal
        pure
        returns (bytes32[] memory path)
    {
        bytes32[] memory tree = build(leaves);
        uint256 node = 2 * leaves.length - 2 - index;

        uint256 depth = 0;
        for (uint256 walk = node; walk > 0; walk = (walk - 1) / 2) {
            ++depth;
        }

        path = new bytes32[](depth);
        for (uint256 i = 0; i < depth; ++i) {
            path[i] = tree[node % 2 == 1 ? node + 1 : node - 1];
            node = (node - 1) / 2;
        }
    }
}
