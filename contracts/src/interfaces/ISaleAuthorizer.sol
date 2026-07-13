// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Types} from "../libs/Types.sol";

/// @title ISaleAuthorizer
/// @notice The ceiling seam. Every path that consumes an item calls `authorize` before it
///         changes any state, so the constraint on how much of other people's money the operator
///         may hold is enforced by the sale itself rather than by a policy the operator applies
///         to itself.
///
///         Capacity is **bilateral**: earned with a creator, and spendable only on that creator's
///         goods. So a sale has to say whose goods it is — and the answer is not the operator's to
///         choose, because it comes from the tranche the item was consigned under, signed by the
///         creator's own key.
interface ISaleAuthorizer {
    /// @notice Thrown when a custody sale would take exposure on *this creator's* goods past what the
    ///         pool and the capacity earned *with this creator* can cover.
    /// @dev The creator is named because the refusal is about a relationship and not about the
    ///      operator in general. The till can be open for one creator and shut for another in the
    ///      same instant, and the sentence the buyer is shown should say which.
    error OverCeiling(uint256 creatorId, uint256 exposure, uint256 headroom);

    /// @notice Thrown when a custody sale would take the operator's *total* exposure past what the
    ///         pool and its total earned capacity can cover.
    /// @dev Belt and braces, and not decoration. Every bilateral ceiling counts the whole pool as its
    ///      backing — correctly, because the pool will pay whichever creator turns out to be the one
    ///      defaulted on. That is the right answer one relationship at a time and the wrong answer
    ///      across all of them at once: N relationships would each be told the money is there, and it
    ///      is there once. This gate is what stops the same naira being pledged twice.
    error OverNetworkCeiling(uint256 exposure, uint256 headroom);

    /// @notice Authorizes the exposure a sale is about to create, or reverts.
    /// @param creatorId Whose goods are being sold. Capacity is bilateral: the operator may hold this
    ///        creator's money against what it has proven *to this creator*, and against nothing else.
    ///        Capacity earned elsewhere is not spendable here — including capacity the operator
    ///        manufactured by trading with a creator it invented, which is the whole point.
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
    function authorize(uint256 creatorId, uint256 exposure, Types.Rail rail) external;
}
