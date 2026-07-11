// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Types} from "../libs/Types.sol";

/// @title IDebtLedger
/// @notice The debt seam: everything other contracts need from the ledger of what the operator
///         owes. The claim lifecycle (posting claims, challenge and response windows, re-aging,
///         penalties) is the ledger's own public surface and is not part of this interface —
///         recipients and the operator call it directly, no contract calls it on their behalf.
interface IDebtLedger {
    /// @notice One leg of a sale's split, priced by the caller.
    struct Leg {
        Types.Role role;
        address recipient;
        uint256 amount;
    }

    /// @notice A debt as the ledger reports it.
    struct Debt {
        uint256 saleRef;
        address recipient;
        Types.Role role;
        Types.Rail rail;
        Types.DebtState state;
        uint64 mintedAt;
        uint64 deadline;
        uint256 amount;
        bytes32 currency;
        bytes32 claimRef;
    }

    /// @notice Mints the debts a sale creates. Callable only by the sale gateway.
    /// @param saleRef The consumed item.
    /// @param rail How the money reached the parties.
    /// @param currency The item's denomination. Debts carry the currency they were minted in and
    ///        are settled in it; the protocol never converts.
    /// @param legs The split, already priced by the gateway against the price in force at
    ///        execution.
    /// @param claimRef The payment reference when the rail settled the sale as it happened
    ///        (instant rail), zero when the operator took custody and still owes the money.
    ///        Debts minted with a reference open provisional; debts minted without one age.
    function mintSaleDebts(
        uint256 saleRef,
        Types.Rail rail,
        bytes32 currency,
        Leg[] calldata legs,
        bytes32 claimRef
    ) external returns (uint256[] memory debtIds);

    /// @notice Mints the refund obligation the operator owes a buyer whose money it holds against
    ///         an order it has not yet fulfilled. Callable only by the sale gateway.
    /// @dev This is a debt like any other and defaults like any other: if the order is not
    ///      fulfilled by `deadline`, the buyer is made whole through the same permissionless
    ///      default path that covers an unpaid creator. No separate refund machinery exists.
    function mintObligation(
        uint256 saleRef,
        address recipient,
        uint256 amount,
        bytes32 currency,
        uint64 deadline
    ) external returns (uint256 debtId);

    /// @notice Extinguishes an obligation by performance rather than payment — the ordered item
    ///         was delivered. Callable only by the sale gateway.
    /// @dev Terminal, and never settled value: nothing was paid, so it earns no allowance growth.
    function dischargeObligation(uint256 debtId) external;

    /// @notice Records that a debt defaulted and the pool covered it. Callable only by the pool.
    /// @dev Defaulting removes the debt from `outstanding`, because it stops being money the
    ///      operator holds and becomes a reimbursement the operator owes the pool. The treasury
    ///      counts that obligation against the ceiling; counting it here as well would double it.
    function markDefaulted(uint256 debtId) external;

    /// @notice Custody exposure: third-party money the operator currently holds and owes onward.
    /// @dev Counts the non-operator legs of custody-rail sales from mint until they settle,
    ///      reverse or default, plus unfulfilled buyer prepayments. Excludes instant-rail sales
    ///      (the operator never held that money) and the operator's own leg (owing yourself is
    ///      not custody). Excludes pool reimbursements, which the treasury tracks.
    function outstanding() external view returns (uint256);

    /// @notice Reads a debt. Reverts on an unknown id.
    function debt(uint256 debtId) external view returns (Debt memory);

    /// @notice The number of debts ever minted. Ids run from 1 to this value.
    function debtCount() external view returns (uint256);
}
