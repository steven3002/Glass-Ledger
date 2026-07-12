// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @title IBurnPenaltySink
/// @notice The write-off fee's seam: the sale gateway tells the treasury what a burn owes the pool.
/// @dev A write-off pays every other party as if the item had sold, and then costs the operator a
///      little more than that. The little more is what makes laundering strictly worse than
///      honesty, and it is owed to the pool — never to the recipients, who must stay exactly
///      indifferent between "your item sold" and "your item was destroyed". A burn that paid them
///      *better* than a sale would be an invitation.
interface IBurnPenaltySink {
    /// @notice Records the penalty a write-off owes the pool.
    /// @dev An obligation, not a debt: a penalty minted as a debt could itself be claimed,
    ///      challenged, voided and penalised. It joins the pool's other penalty receivable and is
    ///      paid down the same path.
    function accrueBurnPenalty(uint256 itemRef, bytes32 currency, uint256 amount) external;
}
