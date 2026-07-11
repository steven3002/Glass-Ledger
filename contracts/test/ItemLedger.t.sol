// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {CreatorRegistry} from "../src/identity/CreatorRegistry.sol";
import {ItemLedger} from "../src/items/ItemLedger.sol";
import {Types} from "../src/libs/Types.sol";
import {Fixture} from "./utils/Fixture.sol";
import {MerkleBuilder} from "./utils/MerkleBuilder.sol";

contract ItemLedgerTest is Fixture {
    uint256 internal itemId;

    function setUp() public override {
        super.setUp();
        itemId = itemIds[0];
    }

    function _asGateway() internal {
        vm.prank(address(gateway));
    }

    // --- Consignment ---

    function test_postTrancheRecordsTheConsignment() public view {
        ItemLedger.Tranche memory tranche = items.tranche(trancheId);

        assertEq(tranche.creatorId, creatorId);
        assertEq(tranche.landlord, landlord);
        assertEq(tranche.itemCount, ITEM_COUNT);
        assertEq(tranche.root, MerkleBuilder.root(leaves));
        assertEq(tranche.currency, CURRENCY);
        assertEq(tranche.postedAt, uint64(block.timestamp));
        assertEq(items.locationOf(trancheId), "Lagos - Ikoyi");
        assertEq(items.trancheCount(), 1);
    }

    function test_postTrancheRejectsNonOperator() public {
        vm.expectRevert(ItemLedger.NotOperator.selector);
        vm.prank(stranger);
        items.postTranche(creatorId, landlord, keccak256("root"), 1, CURRENCY, "elsewhere");
    }

    function test_postTrancheRejectsUnknownCreator() public {
        vm.expectRevert(abi.encodeWithSelector(CreatorRegistry.UnknownCreator.selector, 99));
        vm.prank(operator);
        items.postTranche(99, landlord, keccak256("root"), 1, CURRENCY, "elsewhere");
    }

    function test_postTrancheRejectsAnEmptyConsignment() public {
        vm.startPrank(operator);

        vm.expectRevert(ItemLedger.InvalidTranche.selector);
        items.postTranche(creatorId, landlord, bytes32(0), 1, CURRENCY, "elsewhere");

        vm.expectRevert(ItemLedger.InvalidTranche.selector);
        items.postTranche(creatorId, landlord, keccak256("root"), 0, CURRENCY, "elsewhere");

        vm.expectRevert(ItemLedger.InvalidTranche.selector);
        items.postTranche(creatorId, landlord, keccak256("root"), 1, bytes32(0), "elsewhere");

        vm.expectRevert(ItemLedger.ZeroAddress.selector);
        items.postTranche(creatorId, address(0), keccak256("root"), 1, CURRENCY, "elsewhere");

        vm.stopPrank();
    }

    function test_trancheReadRejectsUnknownId() public {
        vm.expectRevert(abi.encodeWithSelector(ItemLedger.UnknownTranche.selector, 7));
        items.tranche(7);
    }

    // --- Wiring ---

    function test_saleGatewayIsSetOnceAndOnlyByTheOperator() public {
        vm.expectRevert(ItemLedger.NotOperator.selector);
        vm.prank(stranger);
        items.setSaleGateway(stranger);

        vm.expectRevert(ItemLedger.GatewayAlreadySet.selector);
        vm.prank(operator);
        items.setSaleGateway(stranger);

        assertEq(items.saleGateway(), address(gateway));
    }

    function test_onlyTheGatewayMayConsumeAnItem() public {
        vm.expectRevert(ItemLedger.NotGateway.selector);
        vm.prank(operator);
        items.markSold(itemId, trancheId);
    }

    // --- Membership ---

    function test_membershipHoldsForAConsignedLeafAndFailsForAForeignOne() public view {
        assertTrue(items.verifyMembership(trancheId, leaves[3], MerkleBuilder.proof(leaves, 3)));
        assertFalse(
            items.verifyMembership(
                trancheId, keccak256("off-books"), MerkleBuilder.proof(leaves, 3)
            )
        );
        assertFalse(items.verifyMembership(trancheId, leaves[3], MerkleBuilder.proof(leaves, 4)));
    }

    function test_membershipRejectsUnknownTranche() public {
        vm.expectRevert(abi.encodeWithSelector(ItemLedger.UnknownTranche.selector, 7));
        items.verifyMembership(7, leaves[0], MerkleBuilder.proof(leaves, 0));
    }

    // --- The state machine ---

    /// @dev Consignment costs one root, not thirteen slots: an item nobody has touched has no
    ///      storage, and reads back as absent while being perfectly sellable.
    function test_anUntouchedItemHasNoStorageAndIsAvailable() public view {
        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.ABSENT));
        assertTrue(items.isAvailable(itemId));
        assertFalse(items.isConsumed(itemId));
        items.requireAvailable(itemId);
    }

    function test_markSoldConsumesTheItem() public {
        _asGateway();
        items.markSold(itemId, trancheId);

        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.SOLD));
        assertTrue(items.isConsumed(itemId));
        assertFalse(items.isAvailable(itemId));
        assertEq(items.itemOf(itemId).trancheId, trancheId);
    }

    function test_theSameTagCannotBeSoldTwice() public {
        _asGateway();
        items.markSold(itemId, trancheId);

        vm.expectRevert(abi.encodeWithSelector(ItemLedger.AlreadySold.selector, itemId));
        _asGateway();
        items.markSold(itemId, trancheId);
    }

    function test_aReservedItemCannotBeSoldOutFromUnderItsBuyer() public {
        uint64 deadline = uint64(block.timestamp) + FULFILMENT_WINDOW;
        _asGateway();
        items.markCommitted(itemId, trancheId, deadline);

        vm.expectRevert(abi.encodeWithSelector(ItemLedger.ItemReserved.selector, itemId, deadline));
        _asGateway();
        items.markSold(itemId, trancheId);
    }

    function test_fulfilmentCompletesAReservationWithinTheWindow() public {
        uint64 deadline = uint64(block.timestamp) + FULFILMENT_WINDOW;
        _asGateway();
        items.markCommitted(itemId, trancheId, deadline);

        vm.warp(deadline);
        _asGateway();
        items.markFulfilled(itemId);

        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.SOLD));
        assertEq(items.itemOf(itemId).committedUntil, 0);
    }

    function test_fulfilmentAfterTheWindowIsNotFulfilment() public {
        uint64 deadline = uint64(block.timestamp) + FULFILMENT_WINDOW;
        _asGateway();
        items.markCommitted(itemId, trancheId, deadline);

        vm.warp(deadline + 1);
        vm.expectRevert(
            abi.encodeWithSelector(ItemLedger.FulfilmentWindowClosed.selector, itemId, deadline)
        );
        _asGateway();
        items.markFulfilled(itemId);
    }

    function test_fulfilmentRequiresAReservation() public {
        vm.expectRevert(abi.encodeWithSelector(ItemLedger.ItemNotCommitted.selector, itemId));
        _asGateway();
        items.markFulfilled(itemId);
    }

    function test_aReservationCannotBeReleasedBeforeItLapses() public {
        uint64 deadline = uint64(block.timestamp) + FULFILMENT_WINDOW;
        _asGateway();
        items.markCommitted(itemId, trancheId, deadline);

        vm.expectRevert(
            abi.encodeWithSelector(ItemLedger.CommitmentNotExpired.selector, itemId, deadline)
        );
        _asGateway();
        items.releaseCommitment(itemId);
    }

    function test_aLapsedReservationPutsTheItemBackOnTheShelf() public {
        uint64 deadline = uint64(block.timestamp) + FULFILMENT_WINDOW;
        _asGateway();
        items.markCommitted(itemId, trancheId, deadline);

        vm.warp(deadline + 1);
        _asGateway();
        items.releaseCommitment(itemId);

        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.LISTED));
        assertTrue(items.isAvailable(itemId));
        assertEq(items.itemOf(itemId).committedUntil, 0);

        _asGateway();
        items.markSold(itemId, trancheId);
        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.SOLD));
    }

    function test_ownershipBindsOnlyToASoldItem() public {
        vm.expectRevert(abi.encodeWithSelector(ItemLedger.ItemNotSold.selector, itemId));
        _asGateway();
        items.markOwned(itemId, buyer);

        _asGateway();
        items.markSold(itemId, trancheId);

        vm.expectRevert(ItemLedger.ZeroAddress.selector);
        _asGateway();
        items.markOwned(itemId, address(0));

        _asGateway();
        items.markOwned(itemId, buyer);

        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.OWNED));
        assertEq(items.itemOf(itemId).owner, buyer);
        assertTrue(items.isConsumed(itemId));
    }

    function test_aBurnedItemIsGoneForGood() public {
        _asGateway();
        items.markBurned(itemId, trancheId);

        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.BURNED));
        assertTrue(items.isConsumed(itemId));

        vm.expectRevert(abi.encodeWithSelector(ItemLedger.AlreadySold.selector, itemId));
        _asGateway();
        items.markSold(itemId, trancheId);
    }
}
