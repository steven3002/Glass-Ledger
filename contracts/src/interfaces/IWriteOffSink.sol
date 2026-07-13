// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @title IWriteOffSink
/// @notice What a write-off owes the pool. The sale gateway prices a burn; this is where the part
///         of that price which is owed to nobody in particular lands.
/// @dev A write-off pays every other party exactly as if the item had sold — no more, and no less.
///      No more, because a burn that paid a creator better than a sale would be an invitation to
///      want her goods destroyed, and the promise of the split is that she is financially
///      indifferent between "it sold" and "it was destroyed". No less, because that indifference is
///      the whole point.
///
///      Two amounts are therefore left over, and neither belongs to a participant:
///
///      - the **penalty**, the small excess that makes laundering strictly worse than honesty. It
///        cannot go to the recipients (see above) and it obviously cannot stay with the operator.
///      - the **unattributed share**, the referral leg of a sale that never happened. There is no
///        referrer for an item that was destroyed, so that share has no claimant — and it must not
///        fall to the operator either, or writing off an unattributed item would pay better than
///        writing off an attributed one.
///
///      Both go to the pool: the fund that exists for precisely this class of loss. They are
///      recorded as an obligation rather than minted as a debt — a penalty minted as a debt could
///      itself be claimed, challenged, voided and penalised.
interface IWriteOffSink {
    /// @notice Records what a write-off owes the pool.
    /// @param itemRef The item written off.
    /// @param currency The item's denomination. The protocol never converts: a pool holds one asset
    ///        and is owed in one currency.
    /// @param penalty The write-off fee.
    /// @param unattributed The share of the split with no claimant.
    function accrueWriteOff(
        uint256 itemRef,
        bytes32 currency,
        uint256 penalty,
        uint256 unattributed
    ) external;
}
