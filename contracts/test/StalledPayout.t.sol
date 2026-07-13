// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Vm} from "forge-std/Vm.sol";
import {DebtLedger} from "../src/debt/DebtLedger.sol";
import {ISaleAuthorizer} from "../src/interfaces/ISaleAuthorizer.sol";
import {PriceBook} from "../src/items/PriceBook.sol";
import {SaleGateway} from "../src/sale/SaleGateway.sol";
import {Pool} from "../src/treasury/Pool.sol";
import {Types} from "../src/libs/Types.sol";
import {Fixture} from "./utils/Fixture.sol";

/// @notice The stalled payout: the thesis, executed.
///
///         The operator sells a dress for cash and simply never pays the creator. It does not even
///         lie about it — it posts no claim at all. Nothing is alleged, nothing is filed, nobody
///         complains. The debt ages in public, its deadline passes, and then a stranger who has
///         never met any of these people sends one transaction: the pool pays the creator in full,
///         the allowance takes a write-down five times the size of the debt, and the operator's
///         capacity to hold other people's money collapses. The next cash sale reverts at the
///         counter, in front of the customer — while an instant sale, which puts nothing in the
///         operator's hands, still goes through.
///
/// @dev The load-bearing assertion is the one about the creator, and it is made from the event log
///      rather than from a nonce. `vm.prank` does not move nonces, so `vm.getNonce(creator) == 0`
///      would pass whether or not she acted — a vacuous test of the exact claim the demo makes. Her
///      key has precisely three write-paths into this protocol (challenge a claim, register a payout
///      account, reprice an item), each of which emits a log; and the one permissionless transaction
///      in the story names its own sender. The recorded logs can therefore answer the question
///      directly: she did nothing, because none of the things she could have done happened.
contract StalledPayoutTest is Fixture {
    /// @dev Sized so the story lands: a cash sale authorizes comfortably on the first morning, and
    ///      one written-down default puts the very next one over the line.
    uint256 internal constant POOL_SKIM = 200_000e18;

    uint256 internal creatorDebt;
    uint256 internal landlordDebt;
    uint256 internal communityDebt;

    function setUp() public override {
        super.setUp();
        _fundPool(POOL_SKIM);

        (creatorDebt, landlordDebt, communityDebt,) = _legs(itemPrices[0], true);
    }

    /// @notice Act 5, whole: sale → silence → deadline → a stranger's touch → the till closes.
    function test_theStalledPayoutEndsWithTheNextCashSaleReverting() public {
        SaleGateway.SaleInput memory sale = _inputWithCommunity(0);
        SaleGateway.SaleInput memory next = _inputWithCommunity(1);

        vm.recordLogs();

        // --- The sale. The operator takes the money and owes it onward. ---
        vm.prank(operator);
        uint256[] memory debtIds = gateway.sellCash(sale);

        uint256 exposure = creatorDebt + landlordDebt + communityDebt;
        assertEq(debts.outstanding(), exposure);
        assertEq(ceiling.allowanceOf(CREATOR_ID), GENESIS_ALLOWANCE);
        assertEq(ceiling.ceiling(), POOL_SKIM + GENESIS_ALLOWANCE);
        assertEq(ceiling.headroom(), POOL_SKIM + GENESIS_ALLOWANCE - exposure);

        // --- Nothing happens. That is the whole attack, and it is the whole demo. ---
        assertEq(debts.claimCount(), 0);

        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);
        assertTrue(debts.isDefaultable(debtIds[0]));
        assertEq(ngn.balanceOf(creator), 0);

        // --- One transaction, from someone with no stake in any of it. ---
        vm.prank(stranger);
        pool.touch(debtIds[0]);

        // The creator is whole. She has still not sent a transaction.
        assertEq(ngn.balanceOf(creator), creatorDebt);
        assertEq(uint8(debts.debt(debtIds[0]).state), uint8(Types.DebtState.DEFAULTED));
        assertEq(pool.balance(), POOL_SKIM - creatorDebt);

        // The write-down: five times the debt, in one block. And the money the pool laid out is now
        // owed to the pool — it left `outstanding()` and became a reimbursement, counted once, never
        // twice.
        assertEq(
            ceiling.allowanceOf(CREATOR_ID), GENESIS_ALLOWANCE - WRITE_DOWN_MULTIPLE * creatorDebt
        );
        assertEq(pool.reimbursementOutstanding(), creatorDebt);
        assertEq(debts.outstanding(), landlordDebt + communityDebt);
        assertTrue(ceiling.frozen());

        // --- The next cash sale reverts at the counter. ---
        uint256 headroom = ceiling.headroom();
        (uint256 nextCreator, uint256 nextLandlord, uint256 nextCommunity,) =
            _legs(itemPrices[1], true);
        uint256 nextExposure = nextCreator + nextLandlord + nextCommunity;
        assertGt(nextExposure, headroom);

        vm.expectRevert(
            abi.encodeWithSelector(
                ISaleAuthorizer.OverCeiling.selector, CREATOR_ID, nextExposure, headroom
            )
        );
        vm.prank(operator);
        gateway.sellCash(next);

        // ...and the item is still on the shelf. A refused sale consumes nothing.
        assertEq(uint8(items.stateOf(itemIds[1])), uint8(Types.ItemState.ABSENT));

        // --- The same item, on the rail that never touches the operator's hands, still sells. ---
        vm.prank(operator);
        gateway.sellInstant(next, keccak256("processor-ref-after-the-default"));

        assertEq(uint8(items.stateOf(itemIds[1])), uint8(Types.ItemState.SOLD));
        assertEq(debts.outstanding(), landlordDebt + communityDebt);

        _assertTheCreatorNeverActed();
    }

    /// @notice The wronged party sent nothing, and a stranger did the collecting.
    /// @dev The event-scan standard: the three creator-authored events must be absent from the whole
    ///      story, and the one permissionless transaction in it must name someone else as its sender.
    function _assertTheCreatorNeverActed() internal {
        Vm.Log[] memory story = vm.getRecordedLogs();
        bool defaultCollected;

        for (uint256 i = 0; i < story.length; ++i) {
            bytes32 topic = story[i].topics[0];

            assertTrue(topic != DebtLedger.ClaimChallenged.selector);
            assertTrue(topic != PriceBook.PriceUpdateScheduled.selector);
            if (topic == DebtLedger.AccountHashSet.selector) {
                assertTrue(address(uint160(uint256(story[i].topics[1]))) != creator);
            }
            if (topic == Pool.DefaultCovered.selector) {
                // The pool's payout names the account that collected it — `by`, the third indexed
                // field. It is the stranger. It is never her.
                address by = address(uint160(uint256(story[i].topics[3])));
                assertEq(by, stranger);
                assertTrue(by != creator);
                defaultCollected = true;
            }
        }

        assertTrue(defaultCollected);
    }

    /// @notice The landlord's and the community's legs of the same sale are in default too — and
    ///         nobody has to bundle them. Each is its own touch, by whoever cares to send it.
    function test_everyLegOfAStalledSaleIsCollectableSeparately() public {
        SaleGateway.SaleInput memory sale = _inputWithCommunity(0);

        vm.prank(operator);
        uint256[] memory debtIds = gateway.sellCash(sale);
        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);

        vm.prank(stranger);
        pool.touch(debtIds[1]);
        vm.prank(buyer);
        pool.touch(debtIds[2]);

        assertEq(ngn.balanceOf(landlord), landlordDebt);
        assertEq(ngn.balanceOf(communityMember), communityDebt);
        assertEq(pool.reimbursementOutstanding(), landlordDebt + communityDebt);

        // The creator's leg is still aging, untouched and unpaid — a default is per-debt, and the
        // pool does not go looking for work.
        assertEq(uint8(debts.debt(debtIds[0]).state), uint8(Types.DebtState.AGING));
        assertEq(debts.outstanding(), creatorDebt);
    }

    /// @dev The operator's own leg is retained at mint: it is owed to nobody, so the pool will not
    ///      pay it and the default machinery cannot be pointed at it.
    function test_thePoolWillNotPayTheOperatorItsOwnCommission() public {
        SaleGateway.SaleInput memory sale = _inputWithCommunity(0);

        vm.prank(operator);
        uint256[] memory debtIds = gateway.sellCash(sale);
        uint256 ownLeg = debtIds[3];

        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.NotDefaulted.selector, ownLeg));
        vm.prank(stranger);
        pool.touch(ownLeg);

        assertEq(ngn.balanceOf(treasury), 0);
    }

    /// @dev A debt that is not yet late is not in default, and no amount of touching makes it one.
    function test_aDebtInsideItsWindowCannotBeTouched() public {
        SaleGateway.SaleInput memory sale = _inputWithCommunity(0);

        vm.prank(operator);
        uint256[] memory debtIds = gateway.sellCash(sale);

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.NotDefaulted.selector, debtIds[0]));
        vm.prank(stranger);
        pool.touch(debtIds[0]);
    }

    /// @dev And a debt cannot default twice: the second touch finds a terminal debt.
    function test_aDefaultIsCollectedOnce() public {
        SaleGateway.SaleInput memory sale = _inputWithCommunity(0);

        vm.prank(operator);
        uint256[] memory debtIds = gateway.sellCash(sale);
        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);

        vm.prank(stranger);
        pool.touch(debtIds[0]);

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.NotDefaulted.selector, debtIds[0]));
        vm.prank(stranger);
        pool.touch(debtIds[0]);

        assertEq(ngn.balanceOf(creator), creatorDebt);
    }
}
