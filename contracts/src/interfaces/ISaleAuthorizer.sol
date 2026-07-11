// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Types} from "../libs/Types.sol";

/// @title ISaleAuthorizer
/// @notice The ceiling seam. Every path that consumes an item calls `authorize` before it
///         changes any state, so the constraint on how much of other people's money the operator
///         may hold is enforced by the sale itself rather than by a policy the operator applies
///         to itself.
interface ISaleAuthorizer {
    /// @notice Thrown when a custody sale would take exposure past what the pool and the earned
    ///         allowance can cover.
    error OverCeiling(uint256 exposure, uint256 headroom);

    /// @notice Authorizes the exposure a sale is about to create, or reverts.
    /// @param exposure The custody exposure the sale creates, denominated in the item's currency:
    ///        the sum of the legs owed to parties other than the operator, or the full price when
    ///        the operator is taking a buyer's money for an order it has not yet fulfilled. The
    ///        operator's own leg is not exposure — owing yourself is not custody.
    /// @param rail How the money reached the parties. Instant-rail sales never place third-party
    ///        money in the operator's hands and so consume no ceiling; an implementation must
    ///        pass them without consuming headroom.
    /// @dev Not a view: an implementation may record state. It is called on every sale, including
    ///      instant-rail sales, so that the ceiling is a property of the code path rather than a
    ///      check the operator can route around by choosing a rail.
    ///
    ///      Denomination: the protocol never converts money, so exposure is only comparable to a
    ///      ceiling held in the same currency. A deployment serving several currencies runs one
    ///      authorizer per currency; this seam carries no currency tag because a single-currency
    ///      deployment has nothing to disambiguate.
    function authorize(uint256 exposure, Types.Rail rail) external;
}
