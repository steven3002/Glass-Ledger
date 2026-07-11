// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @title WindowMath
/// @notice Deadline arithmetic. Every deadline is derived from an anchor timestamp that is
///         written once and never moved, which is what makes re-aging safe: recomputing a
///         deadline from the original anchor restores the debt's true age instead of resetting
///         the clock in the operator's favour.
library WindowMath {
    error InvalidWindow();

    /// @notice The deadline a window imposes on an anchor.
    function deadlineFrom(uint64 anchor, uint32 window) internal pure returns (uint64) {
        return anchor + uint64(window);
    }

    /// @notice Whether `timestamp` is strictly past `deadline`. A deadline is met on the second
    ///         it falls, so the party under the clock keeps the whole window.
    function isPast(uint64 deadline, uint64 timestamp) internal pure returns (bool) {
        return timestamp > deadline;
    }

    /// @notice The first epoch boundary strictly after `timestamp`, for epochs of length `epoch`
    ///         counted from `anchor`.
    /// @dev Used to schedule a change that is posted publicly now but must not take effect until
    ///      the next boundary. Strictly-after means a change posted exactly on a boundary waits
    ///      for the following one, so the price in force at any instant is the one that was
    ///      already public when the current epoch opened.
    function nextBoundary(uint64 anchor, uint32 epoch, uint64 timestamp)
        internal
        pure
        returns (uint64)
    {
        if (epoch == 0) revert InvalidWindow();
        if (timestamp < anchor) return anchor;
        uint64 length = uint64(epoch);
        return anchor + ((timestamp - anchor) / length + 1) * length;
    }
}
