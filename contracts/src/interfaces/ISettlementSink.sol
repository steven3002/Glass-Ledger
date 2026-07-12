// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @title ISettlementSink
/// @notice The ledger's outbound seam to the treasury: where settled value is reported as it
///         happens, so that the capacity it earns is decided at the moment it is earned.
/// @dev Why the ledger pushes rather than the treasury pulling. The allowance grows with settled
///      value, and growth is forfeited — not banked — while the operator owes the pool a
///      reimbursement. Both facts are true of *the moment a claim settles*, and of no other moment.
///      If the treasury had to be told later, by a transaction someone chose to send, then the
///      operator would decide when its own capacity was recognised: post the settlement's growth
///      after the freeze lifts and the forfeiture becomes a deferral. Reporting it here removes the
///      choice — the credit and the settlement are the same state change.
///
///      The implementation must not revert. It is called from inside `settleClaim`, which is
///      permissionless and must stay permissionless: a treasury that could refuse a settlement would
///      be a treasury that could suspend the ledger.
interface ISettlementSink {
    /// @notice A claim's value has become settled value: the payment it asserted now stands.
    /// @param claimId The claim, so the credit can be reversed by claim if the claim later dies.
    /// @param value The value settled — the sum of the claim's debts, which are only ever the legs
    ///        owed to third parties (the operator's own leg is retained at mint and can never be
    ///        claimed; a buyer's refund obligation is not claimable at all).
    function creditSettlement(uint256 claimId, uint256 value) external;

    /// @notice The settlement is undone: the claim died after having settled.
    /// @dev Reachable exactly once per claim, through the coverage lapse — a claim that settled on
    ///      silence and never acquired evidence behind it. The capacity that silence bought must
    ///      leave with it, or a lie that outlives the challenge window would be worth something.
    function reverseSettlement(uint256 claimId) external;
}
