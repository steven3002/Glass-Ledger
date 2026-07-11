// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @title Types
/// @notice Codes shared by every module. The public ledger, the off-chain bindings and the
///         contracts all decode the same values from here, so an enum's numbering is part of
///         the protocol's public surface: append new members, never reorder existing ones.
library Types {
    /// @notice Lifecycle of a consigned item.
    /// @dev Item storage is lazy: a slot materializes on the first transition. An item whose
    ///      voucher is in a posted tranche and that has never been committed, sold or burned
    ///      therefore reads back as ABSENT. Availability is proven by Merkle membership against
    ///      the tranche root, not asserted by a storage write, so ABSENT and LISTED are the two
    ///      available states — LISTED being an item whose slot exists because an earlier
    ///      commitment on it lapsed.
    enum ItemState {
        ABSENT,
        LISTED,
        COMMITTED,
        SOLD,
        OWNED,
        BURNED
    }

    /// @notice Who a debt is owed to. Every sale splits into these legs; BUYER is the refund
    ///         obligation that exists while the operator holds a buyer's money for an order it
    ///         has not yet fulfilled.
    enum Role {
        CREATOR,
        LANDLORD,
        COMMUNITY,
        OPERATOR,
        BUYER
    }

    /// @notice How the money for a sale reached the parties.
    /// @dev INSTANT: the payment rail split at the point of sale — the operator never held the
    ///      recipients' money, so the sale consumes no ceiling.
    ///      CUSTODY: the operator holds the money and owes it onward (the cash rail, and any
    ///      buyer prepayment). Custody sales are the ones the ceiling constrains.
    enum Rail {
        INSTANT,
        CUSTODY
    }

    /// @notice Lifecycle of a debt. Time flows only toward default: a debt never expires into paid.
    /// @dev Two of these are terminal without any money ever moving, and neither is settled value:
    ///
    ///      DISCHARGED — the obligation was extinguished by performance. The ordered item was
    ///      delivered, so the refund it guaranteed is owed to nobody.
    ///
    ///      RETAINED — the operator's own share of a sale. The payer and the payee are the same
    ///      party, so there was never anything to transfer: it is terminal from the instant it is
    ///      minted. It never ages, never accepts a claim, is never evidence-relevant, and the pool
    ///      never pays it. It exists only so the ledger shows the whole hundred per cent of a sale
    ///      instead of the part that happens to be owed outward.
    enum DebtState {
        NONE,
        AGING,
        PROVISIONAL,
        SETTLED,
        PROVEN,
        DEFAULTED,
        DISCHARGED,
        RETAINED
    }

    /// @notice Lifecycle of an operator's payment claim over a set of debts.
    enum ClaimState {
        NONE,
        PENDING,
        CHALLENGED,
        SETTLED,
        PROVEN,
        VOIDED
    }

    /// @notice Every deadline in the protocol, in seconds.
    /// @dev Deployment-time profile. A demo runs minutes and production runs days through the
    ///      identical code path; no window is ever a literal in logic. Each contract takes the
    ///      windows it enforces as constructor arguments, and deployment fans this struct out.
    struct Windows {
        uint32 settlement;
        uint32 challenge;
        uint32 response;
        uint32 coverage;
        uint32 fulfilment;
        uint32 priceEpoch;
    }
}
