// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ItemLedger} from "../src/items/ItemLedger.sol";
import {PriceBook} from "../src/items/PriceBook.sol";
import {Fixture} from "./utils/Fixture.sol";

contract PriceBookTest is Fixture {
    uint256 internal itemId;
    uint256 internal seededPrice;
    uint64 internal anchor;

    uint256 internal constant NEW_PRICE = 175_000e18;
    uint256 internal constant LATER_PRICE = 190_000e18;

    function setUp() public override {
        super.setUp();
        itemId = itemIds[0];
        seededPrice = itemPrices[0];
        anchor = items.tranche(trancheId).postedAt;
    }

    // --- Seeding ---

    function test_seedPricesTheConsignmentAtIntake() public view {
        assertEq(prices.effectivePrice(itemId), seededPrice);
        assertEq(prices.effectivePrice(itemIds[12]), itemPrices[12]);
        assertEq(prices.trancheOf(itemId), trancheId);
    }

    function test_onlyTheCreatorsKeyWritesPrices() public {
        uint256[] memory ids = new uint256[](1);
        uint256[] memory values = new uint256[](1);
        ids[0] = 9001;
        values[0] = 1e18;

        vm.expectRevert(PriceBook.NotCreator.selector);
        vm.prank(operator);
        prices.seed(trancheId, ids, values);
    }

    function test_seedRejectsMismatchedInput() public {
        uint256[] memory ids = new uint256[](2);
        uint256[] memory values = new uint256[](1);

        vm.expectRevert(PriceBook.LengthMismatch.selector);
        vm.prank(creator);
        prices.seed(trancheId, ids, values);
    }

    function test_seedRejectsAZeroPrice() public {
        uint256[] memory ids = new uint256[](1);
        uint256[] memory values = new uint256[](1);
        ids[0] = 9001;

        vm.expectRevert(PriceBook.InvalidPrice.selector);
        vm.prank(creator);
        prices.seed(trancheId, ids, values);
    }

    function test_anItemIsPricedOnce() public {
        uint256[] memory ids = new uint256[](1);
        uint256[] memory values = new uint256[](1);
        ids[0] = itemId;
        values[0] = 1e18;

        vm.expectRevert(abi.encodeWithSelector(PriceBook.PriceAlreadySeeded.selector, itemId));
        vm.prank(creator);
        prices.seed(trancheId, ids, values);
    }

    function test_seedRejectsAnUnknownTranche() public {
        uint256[] memory ids = new uint256[](1);
        uint256[] memory values = new uint256[](1);
        ids[0] = 9001;
        values[0] = 1e18;

        vm.expectRevert(abi.encodeWithSelector(ItemLedger.UnknownTranche.selector, 7));
        vm.prank(creator);
        prices.seed(7, ids, values);
    }

    function test_anUnpricedItemHasNoPrice() public {
        vm.expectRevert(abi.encodeWithSelector(PriceBook.PriceNotSeeded.selector, 9001));
        prices.effectivePrice(9001);
    }

    function test_aPriceIsBoundToItsConsignment() public {
        vm.expectRevert(
            abi.encodeWithSelector(PriceBook.PriceTrancheMismatch.selector, itemId, 2, trancheId)
        );
        prices.effectivePriceIn(itemId, 2);
    }

    function test_constructorRejectsAZeroEpoch() public {
        vm.expectRevert(PriceBook.InvalidEpoch.selector);
        new PriceBook(items, registry, 0);
    }

    // --- The epoch gate ---

    function test_onlyTheCreatorsKeyReprices() public {
        vm.expectRevert(PriceBook.NotCreator.selector);
        vm.prank(operator);
        prices.setPrice(itemId, NEW_PRICE);
    }

    function test_repriceRejectsAZeroPrice() public {
        vm.expectRevert(PriceBook.InvalidPrice.selector);
        vm.prank(creator);
        prices.setPrice(itemId, 0);
    }

    /// @dev The change is public the moment it is posted, and inert until the epoch turns. The
    ///      price a buyer is quoted mid-epoch is the price the shelf has been showing all epoch.
    function test_anUpdateIsPublicAtOnceAndInForceOnlyAtTheBoundary() public {
        vm.warp(anchor + 30);
        vm.prank(creator);
        prices.setPrice(itemId, NEW_PRICE);

        PriceBook.Price memory schedule = prices.scheduleOf(itemId);
        assertEq(schedule.current, seededPrice);
        assertEq(schedule.pending, NEW_PRICE);
        assertEq(schedule.effectiveAt, anchor + PRICE_EPOCH);

        assertEq(prices.effectivePrice(itemId), seededPrice);

        vm.warp(anchor + PRICE_EPOCH - 1);
        assertEq(prices.effectivePrice(itemId), seededPrice);

        vm.warp(anchor + PRICE_EPOCH);
        assertEq(prices.effectivePrice(itemId), NEW_PRICE);
    }

    function test_theLastUpdateBeforeTheBoundaryWins() public {
        vm.warp(anchor + 30);
        vm.prank(creator);
        prices.setPrice(itemId, NEW_PRICE);

        vm.warp(anchor + 60);
        vm.prank(creator);
        prices.setPrice(itemId, LATER_PRICE);

        assertEq(prices.effectivePrice(itemId), seededPrice);

        vm.warp(anchor + PRICE_EPOCH);
        assertEq(prices.effectivePrice(itemId), LATER_PRICE);
    }

    /// @dev Scheduling a second change never rewrites the price the first one already put in
    ///      force: the matured price is folded into the current one before the new one is booked.
    function test_aMaturedUpdateIsNotRewrittenByTheNextOne() public {
        vm.warp(anchor + 30);
        vm.prank(creator);
        prices.setPrice(itemId, NEW_PRICE);

        vm.warp(anchor + PRICE_EPOCH + 10);
        assertEq(prices.effectivePrice(itemId), NEW_PRICE);

        vm.prank(creator);
        prices.setPrice(itemId, LATER_PRICE);

        PriceBook.Price memory schedule = prices.scheduleOf(itemId);
        assertEq(schedule.current, NEW_PRICE);
        assertEq(schedule.pending, LATER_PRICE);
        assertEq(schedule.effectiveAt, anchor + 2 * PRICE_EPOCH);

        assertEq(prices.effectivePrice(itemId), NEW_PRICE);

        vm.warp(anchor + 2 * PRICE_EPOCH);
        assertEq(prices.effectivePrice(itemId), LATER_PRICE);
    }

    // --- What may be repriced ---

    function test_aReservedItemCannotBeRepriced() public {
        vm.prank(address(gateway));
        items.markCommitted(itemId, trancheId, uint64(block.timestamp) + FULFILMENT_WINDOW);

        vm.expectRevert(abi.encodeWithSelector(PriceBook.ItemNotRepriceable.selector, itemId));
        vm.prank(creator);
        prices.setPrice(itemId, NEW_PRICE);
    }

    function test_aSoldItemsPriceIsHistory() public {
        vm.prank(address(gateway));
        items.markSold(itemId, trancheId);

        vm.expectRevert(abi.encodeWithSelector(PriceBook.ItemNotRepriceable.selector, itemId));
        vm.prank(creator);
        prices.setPrice(itemId, NEW_PRICE);
    }
}
