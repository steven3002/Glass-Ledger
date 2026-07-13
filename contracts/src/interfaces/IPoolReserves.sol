// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @title IPoolReserves
/// @notice The two numbers the ceiling reads off the pool, and the only two it is allowed to.
/// @dev The ceiling is an inequality over four quantities: what the operator is holding, what it
///      owes the pool, what the pool has, and what the operator's record has earned. The first and
///      the last are the ledger's and the allowance's own; these are the pool's.
interface IPoolReserves {
    /// @notice The compensation the pool can actually pay right now: real money, in the contract.
    function balance() external view returns (uint256);

    /// @notice What the operator owes the pool for defaults the pool has already covered.
    /// @dev Occupies ceiling headroom exactly as an unpaid debt does, because that is what it is:
    ///      the money moved, the obligation did not vanish, it changed creditor. Counted here and
    ///      nowhere else — a defaulted debt leaves the ledger's `outstanding()` at the moment it
    ///      becomes this, so it is never counted twice.
    function reimbursementOutstanding() external view returns (uint256);

    /// @notice What the operator owes in fines and has not paid: the wronged parties' halves of every
    ///         void penalty, the pool's halves, and every write-off's dues.
    /// @dev Counted against the ceiling for the same reason as a reimbursement, and it is the same
    ///      reason both times: **there is no obligation in this protocol that can be escaped by
    ///      refusing to settle it.** A fine is collected by pulling on a standing approval the
    ///      operator granted; withdraw the approval and the fine does not disappear — it sits here,
    ///      public, eating the headroom the operator needs in order to keep selling.
    function penaltiesOutstanding() external view returns (uint256);

    /// @notice How many debts the operator has let default. Part of the failure record.
    function defaultCount() external view returns (uint256);

    /// @notice What those defaults were worth, in total, at the moment each one landed.
    /// @dev The whole defaulted amount, not the part the pool managed to cover: an empty pool is not a
    ///      smaller failure. Never decreases — paying the pool back afterwards settles a debt, and it
    ///      does not unmake a default.
    function defaultValue() external view returns (uint256);
}
