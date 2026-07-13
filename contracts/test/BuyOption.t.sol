// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {DebtLedger} from "../src/debt/DebtLedger.sol";
import {IDebtLedger} from "../src/interfaces/IDebtLedger.sol";
import {ItemLedger} from "../src/items/ItemLedger.sol";
import {SaleGateway} from "../src/sale/SaleGateway.sol";
import {Allowance} from "../src/treasury/Allowance.sol";
import {Pool} from "../src/treasury/Pool.sol";
import {Types} from "../src/libs/Types.sol";
import {Fixture} from "./utils/Fixture.sol";

/// @notice The standing buy option catches off-books inventory.
///
///         An item that is listed is buyable — by anyone, at any moment, including the item the
///         operator quietly took home. A stranger buys its digital twin. The operator cannot deliver
///         what it does not have, the fulfilment window runs out, and the buyer is refunded from the
///         pool with the operator's allowance written down five times over.
///
///         Nobody accused anyone. Nothing was filed. The collision between a hidden item and an open
///         short position resolves itself, in public, on a clock.
///
/// @dev No new machinery: the buyer's refund is minted at commit time as an ordinary `Role.BUYER`
///      debt on the custody rail, for the full price, with the fulfilment deadline as its deadline.
///      So it ages, defaults and is covered by exactly the path that covers an unpaid creator. This
///      suite's job is to prove that the refund really does travel that path, and that fulfilling on
///      time really does extinguish it without paying anybody.
contract BuyOptionTest is Fixture {
    uint256 internal constant POOL_SKIM = 200_000e18;

    uint256 internal itemId;
    uint256 internal price;

    function setUp() public override {
        super.setUp();
        _fundPool(POOL_SKIM);

        itemId = itemIds[0];
        price = itemPrices[0];
    }

    /// @notice P3, whole: the off-books item is bought, cannot be delivered, and refunds itself.
    function test_anUnfulfilledOrderRefundsTheBuyerThroughTheDefaultPath() public {
        SaleGateway.SaleInput memory order = _inputWithCommunity(0);

        // The buyer's money is the operator's to hold — the whole price of it, not a share.
        vm.prank(operator);
        uint256 refundDebtId = gateway.commitOption(order, buyer);

        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.COMMITTED));
        assertEq(debts.outstanding(), price);

        IDebtLedger.Debt memory refund = debts.debt(refundDebtId);
        assertEq(refund.recipient, buyer);
        assertEq(refund.amount, price);
        assertEq(uint8(refund.role), uint8(Types.Role.BUYER));
        assertEq(uint8(refund.rail), uint8(Types.Rail.CUSTODY));
        assertEq(uint8(refund.state), uint8(Types.DebtState.AGING));
        assertEq(refund.deadline, uint64(block.timestamp) + FULFILMENT_WINDOW);

        // The operator cannot fulfil. It does not have the dress; it never did.
        vm.warp(block.timestamp + FULFILMENT_WINDOW + 1);

        // A stranger releases the reservation and collects the default. Two permissionless touches,
        // and the buyer sends neither.
        vm.startPrank(stranger);
        gateway.expireCommitment(itemId);
        pool.touch(refundDebtId);
        vm.stopPrank();

        assertEq(ngn.balanceOf(buyer), price);
        assertEq(uint8(debts.debt(refundDebtId).state), uint8(Types.DebtState.DEFAULTED));
        assertEq(pool.balance(), POOL_SKIM - price);

        // The write-down is on the whole price, because the whole price is what defaulted — and five
        // times a whole price is more than the day-one allowance ever was. One undeliverable order
        // takes the operator's entire capacity to hold anybody's money. It stops at zero because
        // there is nothing behind zero.
        assertGt(WRITE_DOWN_MULTIPLE * price, GENESIS_ALLOWANCE);
        assertEq(ceiling.allowanceOf(CREATOR_ID), 0);
        assertEq(pool.reimbursementOutstanding(), price);
        assertTrue(ceiling.frozen());

        // The item is back on the shelf, and it is still a lie: whoever holds it, the ledger says
        // nobody bought it.
        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.LISTED));
        assertEq(debts.outstanding(), 0);
    }

    /// @notice The refund does not wait for anyone to release the reservation.
    /// @dev The two touches are independent. A buyer's money comes back on the clock the buyer was
    ///      promised, whether or not anybody bothers to put the item back on the shelf.
    function test_theRefundDoesNotDependOnTheItemBeingReleased() public {
        SaleGateway.SaleInput memory order = _inputWithCommunity(0);

        vm.prank(operator);
        uint256 refundDebtId = gateway.commitOption(order, buyer);

        vm.warp(block.timestamp + FULFILMENT_WINDOW + 1);
        vm.prank(stranger);
        pool.touch(refundDebtId);

        assertEq(ngn.balanceOf(buyer), price);
        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.COMMITTED));
    }

    /// @notice Fulfilling on time extinguishes the refund without paying it.
    /// @dev `DISCHARGED`, not `SETTLED`: the obligation ended because the promise was kept, not
    ///      because money moved. It is never settled value and it earns the operator nothing — which
    ///      is the whole reason the state exists.
    function test_deliveringTheOrderDischargesTheRefundAndOwesTheSplit() public {
        SaleGateway.SaleInput memory order = _inputWithCommunity(0);

        vm.prank(operator);
        uint256 refundDebtId = gateway.commitOption(order, buyer);

        vm.prank(operator);
        uint256[] memory debtIds = gateway.fulfilCommitment(itemId);

        assertEq(uint8(debts.debt(refundDebtId).state), uint8(Types.DebtState.DISCHARGED));
        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.SOLD));
        assertEq(ngn.balanceOf(buyer), 0);

        // The refund is gone and the split is owed in its place — and the split is smaller than the
        // refund was, so custody exposure fell.
        (uint256 creatorAmount, uint256 landlordAmount, uint256 communityAmount,) =
            _legs(price, true);
        assertEq(debts.outstanding(), creatorAmount + landlordAmount + communityAmount);
        assertLt(debts.outstanding(), price);
        assertEq(debtIds.length, 4);

        // The buyer's refund debt is beyond the pool for good: performance closed it.
        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);
        vm.expectRevert(abi.encodeWithSelector(DebtLedger.NotDefaulted.selector, refundDebtId));
        vm.prank(stranger);
        pool.touch(refundDebtId);
    }

    /// @notice A late fulfilment is not a fulfilment.
    /// @dev The promise the buyer was given has already failed by then, and the refund path owns the
    ///      item from that moment. An operator that could deliver after the window closed could wait
    ///      to see whether anyone noticed.
    function test_theOperatorCannotDeliverAfterTheWindowHasClosed() public {
        SaleGateway.SaleInput memory order = _inputWithCommunity(0);

        vm.prank(operator);
        gateway.commitOption(order, buyer);
        uint64 deadline = items.itemOf(itemId).committedUntil;

        vm.warp(deadline + 1);
        vm.expectRevert(
            abi.encodeWithSelector(ItemLedger.FulfilmentWindowClosed.selector, itemId, deadline)
        );
        vm.prank(operator);
        gateway.fulfilCommitment(itemId);
    }

    /// @notice A buyer's prepayment is custody, and the ceiling counts it as such — at full price.
    function test_takingABuyersMoneyConsumesTheCeilingAtFullPrice() public {
        SaleGateway.SaleInput memory order = _inputWithCommunity(0);
        uint256 headroomBefore = ceiling.headroom();

        vm.prank(operator);
        gateway.commitOption(order, buyer);

        assertEq(ceiling.headroom(), headroomBefore - price);
        assertEq(debts.outstanding(), price);
    }

    /// @dev A refund the pool covered is not sale value, and it never becomes allowance growth. The
    ///      operator does not earn capacity by taking money it had to give back.
    function test_aBuyersRefundNeverEarnsAllowanceGrowth() public {
        SaleGateway.SaleInput memory order = _inputWithCommunity(0);

        vm.prank(operator);
        uint256 refundDebtId = gateway.commitOption(order, buyer);

        // The operator claims to have refunded the buyer in cash, and proves it.
        uint256[] memory refundOnly = new uint256[](1);
        refundOnly[0] = refundDebtId;
        vm.prank(operator);
        uint256 claimId = debts.postClaim(refundOnly, keccak256("the-refund-we-sent-the-buyer"));

        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);
        debts.settleClaim(claimId);
        _setVerdict(claimId, true);

        uint256[] memory claimIds = new uint256[](1);
        claimIds[0] = claimId;
        vm.prank(operator);
        sweep.attest(claimIds, hex"c0ffee", keccak256("blob"));

        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.PROVEN));

        // Proven, settled, and worth nothing: a refund is money returned, not value settled.
        vm.expectRevert(abi.encodeWithSelector(Allowance.NothingToCredit.selector, claimId));
        ceiling.creditSettlement(claimId);
        assertEq(ceiling.allowanceOf(CREATOR_ID), GENESIS_ALLOWANCE);
    }
}
