// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {CreatorRegistry} from "../identity/CreatorRegistry.sol";
import {ItemLedger} from "./ItemLedger.sol";
import {Types} from "../libs/Types.sol";
import {WindowMath} from "../libs/WindowMath.sol";

/// @title PriceBook
/// @notice What an item costs, in the currency of the place it is sold. One key writes prices —
///         the creator's — and a change she posts today does not take effect until the next epoch
///         boundary. The posting is immediate and public; only the effect waits.
/// @dev Why the delay: a price that could change in the same block as a sale would let the number
///      a buyer was shown differ from the number the split was computed on. The epoch boundary
///      makes the price in force at any instant a fact that was already public before the epoch
///      opened, so a sale can be audited against what the shelf said.
///
///      The protocol never converts money. A price is denominated in its tranche's currency, the
///      debts it mints carry that currency, and settlement is proven in that currency. There is
///      no exchange rate anywhere in this system, and so no rate to argue about.
contract PriceBook {
    using WindowMath for uint64;

    /// @dev `current` holds until `effectiveAt`; from `effectiveAt` the price is `pending`. A
    ///      matured pending price is folded into `current` the next time the entry is written, so
    ///      `effectivePrice` is the only correct read — the raw fields are a schedule, not a
    ///      price.
    struct Price {
        uint128 current;
        uint128 pending;
        uint64 effectiveAt;
        uint64 trancheId;
    }

    ItemLedger public immutable items;
    CreatorRegistry public immutable registry;

    /// @notice How long an epoch lasts. Repricing cadence is a property of the deployment, not of
    ///         a sale: minutes in a demo, days to a month for a real collection.
    uint32 public immutable epochLength;

    mapping(uint256 itemId => Price) private _prices;

    event PriceSeeded(uint256 indexed itemId, uint256 indexed trancheId, uint256 price);
    event PriceUpdateScheduled(
        uint256 indexed itemId, uint256 oldPrice, uint256 newPrice, uint64 effectiveAt
    );

    error NotCreator();
    error ZeroAddress();
    error InvalidEpoch();
    error InvalidPrice();
    error LengthMismatch();
    error PriceNotSeeded(uint256 itemId);
    error PriceAlreadySeeded(uint256 itemId);
    error ItemNotRepriceable(uint256 itemId);
    error PriceTrancheMismatch(uint256 itemId, uint256 expected, uint256 actual);

    constructor(ItemLedger items_, CreatorRegistry registry_, uint32 epochLength_) {
        if (address(items_) == address(0) || address(registry_) == address(0)) {
            revert ZeroAddress();
        }
        if (epochLength_ == 0) revert InvalidEpoch();
        items = items_;
        registry = registry_;
        epochLength = epochLength_;
    }

    /// @notice Seeds the prices of a consignment. Each item is priced once, at intake.
    function seed(uint256 trancheId, uint256[] calldata itemIds, uint256[] calldata prices)
        external
    {
        if (itemIds.length != prices.length) revert LengthMismatch();
        _requireCreatorOf(trancheId);

        uint64 tranche = SafeCast.toUint64(trancheId);
        for (uint256 i = 0; i < itemIds.length; ++i) {
            uint256 itemId = itemIds[i];
            uint256 price = prices[i];
            if (price == 0) revert InvalidPrice();
            Price storage entry = _prices[itemId];
            if (entry.trancheId != 0) revert PriceAlreadySeeded(itemId);
            entry.current = SafeCast.toUint128(price);
            entry.trancheId = tranche;
            emit PriceSeeded(itemId, trancheId, price);
        }
    }

    /// @notice Posts a new price for an item. Public immediately, in force at the next boundary.
    /// @dev Only an item that is still on the shelf can be repriced. Once it is reserved for a
    ///      buyer or sold, its price is history and history is not editable — the debts minted
    ///      against it are owed at the number that was in force when it sold.
    function setPrice(uint256 itemId, uint256 newPrice) external {
        if (newPrice == 0) revert InvalidPrice();

        Price storage entry = _prices[itemId];
        uint64 trancheId = entry.trancheId;
        if (trancheId == 0) revert PriceNotSeeded(itemId);

        ItemLedger.Tranche memory tranche = _requireCreatorOf(trancheId);
        if (!items.isAvailable(itemId)) revert ItemNotRepriceable(itemId);

        // Fold in an update that has already matured, so scheduling a new one never rewrites the
        // price that was in force before it.
        uint64 timestamp = uint64(block.timestamp);
        uint64 effectiveAt = entry.effectiveAt;
        if (effectiveAt != 0 && timestamp >= effectiveAt) {
            entry.current = entry.pending;
        }

        uint64 boundary = WindowMath.nextBoundary(tranche.postedAt, epochLength, timestamp);
        entry.pending = SafeCast.toUint128(newPrice);
        entry.effectiveAt = boundary;

        emit PriceUpdateScheduled(itemId, entry.current, newPrice, boundary);
    }

    /// @notice The price in force right now. The only correct read of this book.
    function effectivePrice(uint256 itemId) public view returns (uint256) {
        Price memory entry = _prices[itemId];
        if (entry.trancheId == 0) revert PriceNotSeeded(itemId);
        if (entry.effectiveAt != 0 && block.timestamp >= entry.effectiveAt) {
            return entry.pending;
        }
        return entry.current;
    }

    /// @notice The price in force right now, asserting the item belongs to the tranche the caller
    ///         proved membership against.
    function effectivePriceIn(uint256 itemId, uint256 trancheId) external view returns (uint256) {
        uint256 seeded = _prices[itemId].trancheId;
        if (seeded == 0) revert PriceNotSeeded(itemId);
        if (seeded != trancheId) revert PriceTrancheMismatch(itemId, trancheId, seeded);
        return effectivePrice(itemId);
    }

    /// @notice The scheduled state of an item's price: what is in force, what is coming, and when.
    function scheduleOf(uint256 itemId) external view returns (Price memory) {
        return _prices[itemId];
    }

    function trancheOf(uint256 itemId) external view returns (uint256) {
        return _prices[itemId].trancheId;
    }

    function _requireCreatorOf(uint256 trancheId)
        internal
        view
        returns (ItemLedger.Tranche memory tranche)
    {
        tranche = items.tranche(trancheId);
        if (msg.sender != registry.keyOf(tranche.creatorId)) revert NotCreator();
    }
}
