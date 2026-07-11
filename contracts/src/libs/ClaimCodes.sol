// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @title ClaimCodes
/// @notice Commitment scheme for the code a buyer presents to claim the certificate of an item
///         they bought. The sale stores the commitment; redemption reveals the preimage.
/// @dev The commitment binds the code to its item, so a code learned from one sale cannot redeem
///      another.
///
///      Production note: a claim code is a bearer secret revealed in cleartext in the redemption
///      transaction, which makes redemption front-runnable by anyone watching the mempool — the
///      code is only as safe as the moment between reveal and inclusion. Production binds the
///      certificate to a passkey-derived account at the point of sale, so nothing bearer-shaped
///      ever travels; the code path exists here because the demo hands a printed receipt to a
///      buyer who has no wallet.
library ClaimCodes {
    /// @notice The commitment stored at sale for `code` on `itemId`.
    function commitment(uint256 itemId, bytes32 code) internal pure returns (bytes32) {
        return keccak256(abi.encode(itemId, code));
    }
}
