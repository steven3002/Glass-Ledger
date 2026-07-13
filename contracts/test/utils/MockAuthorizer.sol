// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ISaleAuthorizer} from "../../src/interfaces/ISaleAuthorizer.sol";
import {Types} from "../../src/libs/Types.sol";

/// @notice Stands in for the ceiling while the treasury is not yet wired. Permissive by default;
///         the reject switch makes it fail exactly where the real ceiling fails, which is how the
///         sale's all-or-nothing property is tested without a treasury.
contract MockAuthorizer is ISaleAuthorizer {
    bool public rejects;
    uint256 public calls;
    uint256 public lastCreatorId;
    uint256 public lastExposure;
    Types.Rail public lastRail;

    function setRejects(bool value) external {
        rejects = value;
    }

    function authorize(uint256 creatorId, uint256 exposure, Types.Rail rail) external {
        ++calls;
        lastCreatorId = creatorId;
        lastExposure = exposure;
        lastRail = rail;
        if (rejects) revert OverCeiling(creatorId, exposure, 0);
    }
}
