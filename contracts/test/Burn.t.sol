// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {CreatorRegistry} from "../src/identity/CreatorRegistry.sol";
import {DebtLedger} from "../src/debt/DebtLedger.sol";
import {IDebtLedger} from "../src/interfaces/IDebtLedger.sol";
import {ISaleAuthorizer} from "../src/interfaces/ISaleAuthorizer.sol";
import {ItemLedger} from "../src/items/ItemLedger.sol";
import {SaleGateway} from "../src/sale/SaleGateway.sol";
import {Pool} from "../src/treasury/Pool.sol";
import {Types} from "../src/libs/Types.sol";
import {Fixture} from "./utils/Fixture.sol";
import {MerkleBuilder} from "./utils/MerkleBuilder.sol";

/// @notice Write-offs cannot launder sales.
///
///         The oldest trick in retail is to sell an item for cash off the books and then declare it
///         destroyed — "water damage" — pocketing the whole price. Under the usual rules the
///         write-off reimburses wholesale, so the launder nets several times the honest commission
///         and the write-off *is* the heist.
///
///         Here a write-off pays everyone as if the item had sold: the creator her 80%, the landlord
///         his 5%, the referral share of the sale that never happened to the pool, and then a fee on
///         top. What is left for the launderer is the commission it would have earned by ringing the
///         sale up honestly, minus that fee. The door is shut by arithmetic, and there is no evidence
///         to fake, because the price is the price.
///
/// @dev The two properties this suite exists to hold down:
///
///      1. **The launderer nets strictly less than the honest operator**, at every price and every
///         parameter setting the contract can be deployed with (fuzzed).
///      2. **The recipients are financially indifferent** between "your item sold" and "your item was
///         destroyed" — paid exactly their split, no more. A write-off that paid them *better* than a
///         sale would be an invitation to want their own goods destroyed.
contract BurnTest is Fixture {
    uint256 internal constant POOL_SKIM = 200_000e18;

    uint256 internal itemId;
    uint256 internal price;

    // The arithmetic of a write-off at the demo's parameters, for a ₦100,000 dress.
    uint256 internal constant CREATOR_PAID = 80_000e18; // 80%, exactly as a sale
    uint256 internal constant LANDLORD_PAID = 5_000e18; // 5%, exactly as a sale
    uint256 internal constant UNATTRIBUTED = 2_500e18; // 2.5%, to the pool — no referrer exists
    uint256 internal constant PAID_AS_SOLD = 87_500e18; // everything that is not the commission
    uint256 internal constant PENALTY = 1_000e18; // 1% of list
    uint256 internal constant HONEST = 12_500e18; // what an honest sale earns Good
    uint256 internal constant LAUNDERED = 11_500e18; // what the write-off earns it instead

    function setUp() public override {
        super.setUp();
        _fundPool(POOL_SKIM);

        itemId = itemIds[0];
        price = itemPrices[0];
    }

    /// @notice The write-off, and the arithmetic it emits for the panel that will display it.
    function test_aWriteOffPaysEveryoneAsIfTheItemHadSold() public {
        SaleGateway.WriteOff memory writeOff = _writeOff(0);

        vm.expectEmit(true, true, true, true, address(gateway));
        emit SaleGateway.Burned(
            itemId,
            trancheId,
            writeOff.evidenceHash,
            price,
            CURRENCY,
            PAID_AS_SOLD,
            PENALTY,
            HONEST,
            LAUNDERED,
            writeOff.storagePointer,
            _expectedDebtIds()
        );

        vm.prank(operator);
        uint256[] memory debtIds = gateway.burn(writeOff);

        // The item is gone, and it is gone terminally.
        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.BURNED));
        assertTrue(items.isConsumed(itemId));

        // The creator and the landlord are owed exactly what a sale would have owed them — as
        // ordinary debts, on the ordinary clock, with the ordinary deadline.
        assertEq(debtIds.length, 2);

        IDebtLedger.Debt memory creatorDebt = debts.debt(debtIds[0]);
        assertEq(creatorDebt.recipient, creator);
        assertEq(creatorDebt.amount, CREATOR_PAID);
        assertEq(uint8(creatorDebt.role), uint8(Types.Role.CREATOR));
        assertEq(uint8(creatorDebt.state), uint8(Types.DebtState.AGING));
        assertEq(creatorDebt.deadline, uint64(block.timestamp) + SETTLEMENT_WINDOW);

        assertEq(debts.debt(debtIds[1]).recipient, landlord);
        assertEq(debts.debt(debtIds[1]).amount, LANDLORD_PAID);

        // Good's own leg is not minted at all. There is nothing to retain: the commission is forfeit.
        assertEq(debts.debtCount(), 2);
        assertEq(debts.outstanding(), CREATOR_PAID + LANDLORD_PAID);

        // The fee and the referral share of a sale that never happened are owed to the pool.
        assertEq(pool.writeOffAccrued(), PENALTY + UNATTRIBUTED);
        assertEq(pool.poolDuesOwed(), PENALTY + UNATTRIBUTED);
    }

    /// @notice P6: laundering nets strictly less than honesty.
    /// @dev The honest baseline is not asserted from the same arithmetic that produces the burn —
    ///      it is measured off a real sale, minted by the real gateway, of a real item.
    function test_theWriteOffNetsTheOperatorLessThanTheHonestCommission() public {
        // The honest world: item 1 is sold for cash, and Good's own leg is minted at 12.5%.
        SaleGateway.SaleInput memory sale = _inputWithCommunity(1);
        vm.prank(operator);
        uint256[] memory soldIds = gateway.sellCash(sale);

        uint256 honestTake = debts.debt(soldIds[3]).amount;
        assertEq(debts.debt(soldIds[3]).recipient, treasury);
        assertEq(honestTake * 10_000 / itemPrices[1], OPERATOR_BPS); // 12.5% of the price

        // The launderer's world: item 0 was sold for cash off the books at list, and is now written
        // off as water damage. Good keeps the buyer's ₦100,000 and pays out everything but its own
        // commission — and then the fee.
        SaleGateway.WriteOff memory writeOff = _writeOff(0);
        vm.prank(operator);
        gateway.burn(writeOff);

        uint256 launderedTake = price - PAID_AS_SOLD - PENALTY;

        // Expressed as a share of the price, so the two prices are comparable: 11.5% against 12.5%.
        uint256 launderedBps = launderedTake * 10_000 / price;
        assertEq(launderedBps, OPERATOR_BPS - BURN_PENALTY_BPS);
        assertLt(launderedBps, OPERATOR_BPS);
        assertEq(launderedTake, LAUNDERED);

        // And the launder is worse in the only way that matters: the item is gone, so the shelf is
        // shorter by one dress, and the ₦11,500 is all it will ever earn from it.
        assertLt(launderedTake, HONEST);
    }

    /// @notice At every price the book can hold, laundering earns less — by exactly the fee.
    function testFuzz_launderingIsWorseThanHonestyAtEveryPrice(uint128 newPrice) public {
        newPrice = uint128(bound(newPrice, 1e18, 1e30));

        uint64 anchor = items.tranche(trancheId).postedAt;
        vm.warp(anchor + 30);
        vm.prank(creator);
        prices.setPrice(itemId, newPrice);
        vm.warp(anchor + PRICE_EPOCH);
        assertEq(prices.effectivePrice(itemId), newPrice);

        SaleGateway.WriteOff memory writeOff = _writeOff(0);
        vm.prank(operator);
        uint256[] memory debtIds = gateway.burn(writeOff);

        uint256 honest = uint256(newPrice) * OPERATOR_BPS / 10_000;
        uint256 penalty = uint256(newPrice) * BURN_PENALTY_BPS / 10_000;
        uint256 paidOut = debts.debt(debtIds[0]).amount + debts.debt(debtIds[1]).amount
            + pool.writeOffAccrued() - penalty;
        uint256 laundered = newPrice - paidOut - penalty;

        // The write-off pays out everything that is not the commission, and then the fee.
        assertEq(paidOut, newPrice - honest);
        assertEq(laundered, honest - penalty);
        assertLt(laundered, honest);

        // Nothing is created and nothing is lost: the price is exactly what was paid out, plus the
        // fee, plus what the launderer kept.
        assertEq(paidOut + penalty + laundered, newPrice);
    }

    /// @notice The recipients cannot tell the difference, and that is the promise.
    /// @dev Paid exactly their split — no more. A burn that paid a creator better than a sale would
    ///      make her want her own goods destroyed, and the fee that punishes the operator would land
    ///      as a bonus on the party the protocol is protecting.
    function test_theRecipientsAreIndifferentBetweenSoldAndDestroyed() public {
        (uint256 creatorAmount, uint256 landlordAmount,,) = _legs(price, true);

        SaleGateway.WriteOff memory writeOff = _writeOff(0);
        vm.prank(operator);
        uint256[] memory debtIds = gateway.burn(writeOff);

        assertEq(debts.debt(debtIds[0]).amount, creatorAmount);
        assertEq(debts.debt(debtIds[1]).amount, landlordAmount);

        // Not a naira more than the sale would have paid: the fee is the operator's to bear, and the
        // pool's to receive.
        assertEq(
            debts.debt(debtIds[0]).amount + debts.debt(debtIds[1]).amount,
            PAID_AS_SOLD - UNATTRIBUTED
        );
        assertEq(ngn.balanceOf(creator), 0);
    }

    /// @notice Declaring the loss is not the same as bearing it.
    /// @dev The payouts are debts like any others. If the operator does not actually pay them, they
    ///      default like any others, the pool covers them like any others, and the allowance takes
    ///      five times the write-down like any others. A write-off is a promise the same machinery
    ///      collects on.
    function test_aWriteOffThatIsNeverPaidDefaultsLikeAnyOtherDebt() public {
        SaleGateway.WriteOff memory writeOff = _writeOff(0);
        vm.prank(operator);
        uint256[] memory debtIds = gateway.burn(writeOff);

        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);
        assertTrue(debts.isDefaultable(debtIds[0]));

        vm.prank(stranger);
        pool.touch(debtIds[0]);

        assertEq(ngn.balanceOf(creator), CREATOR_PAID);
        assertEq(
            ceiling.allowanceOf(CREATOR_ID), GENESIS_ALLOWANCE - WRITE_DOWN_MULTIPLE * CREATOR_PAID
        );
        assertTrue(ceiling.frozen());
    }

    /// @notice The fee is collected from the operator, by anyone, into the pool.
    function test_theWriteOffFeeIsCollectedIntoThePool() public {
        SaleGateway.WriteOff memory writeOff = _writeOff(0);
        vm.prank(operator);
        gateway.burn(writeOff);

        uint256 due = PENALTY + UNATTRIBUTED;
        assertEq(pool.poolDuesOwed(), due);

        vm.expectEmit(false, false, false, true, address(pool));
        emit Pool.PoolDuesCollected(due, POOL_SKIM + due);
        vm.prank(stranger);
        pool.collectPoolDues();

        assertEq(pool.balance(), POOL_SKIM + due);
        assertEq(pool.poolDuesOwed(), 0);
        assertEq(ngn.balanceOf(operator), OPERATOR_FUNDS - POOL_SKIM - due);

        vm.expectRevert(Pool.NothingOwed.selector);
        vm.prank(stranger);
        pool.collectPoolDues();
    }

    /// @notice A burned item is gone. It cannot be burned twice, and it cannot be sold afterwards.
    function test_aBurnedItemIsBeyondEverySalePath() public {
        SaleGateway.WriteOff memory writeOff = _writeOff(0);
        SaleGateway.SaleInput memory sale = _inputWithCommunity(0);

        vm.startPrank(operator);
        gateway.burn(writeOff);

        vm.expectRevert(abi.encodeWithSelector(ItemLedger.AlreadySold.selector, itemId));
        gateway.burn(writeOff);

        vm.expectRevert(abi.encodeWithSelector(ItemLedger.AlreadySold.selector, itemId));
        gateway.sellCash(sale);

        vm.expectRevert(abi.encodeWithSelector(ItemLedger.AlreadySold.selector, itemId));
        gateway.sellInstant(sale, CLAIM_REF);
        vm.stopPrank();
    }

    /// @notice A write-off still has to prove the tag was real, and still has to post its evidence.
    function test_aWriteOffCannotBeInvented() public {
        SaleGateway.WriteOff memory writeOff = _writeOff(0);

        // Not the operator's to declare? Then it is not declared.
        vm.expectRevert(SaleGateway.NotOperator.selector);
        vm.prank(stranger);
        gateway.burn(writeOff);

        // No evidence, no write-off. The blob is committed by hash and cannot be swapped later for a
        // better story.
        SaleGateway.WriteOff memory blind = _writeOff(0);
        blind.evidenceHash = bytes32(0);
        vm.expectRevert(SaleGateway.MissingEvidence.selector);
        vm.prank(operator);
        gateway.burn(blind);

        // A tag the creator never signed cannot be written off — you cannot destroy what was never
        // consigned, and an operator that could would have invented an item to pay itself for.
        SaleGateway.WriteOff memory forged = _writeOff(0);
        forged.signature = _sign(_voucher(itemIds[0]), forgerKey);
        vm.expectRevert(CreatorRegistry.UnknownCreatorSignature.selector);
        vm.prank(operator);
        gateway.burn(forged);

        // Nor one that is not in the consignment it names.
        SaleGateway.WriteOff memory outsider = _writeOff(0);
        outsider.proof = MerkleBuilder.proof(leaves, 1);
        vm.expectRevert(
            abi.encodeWithSelector(SaleGateway.NotInTranche.selector, itemId, trancheId)
        );
        vm.prank(operator);
        gateway.burn(outsider);

        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.ABSENT));
    }

    /// @dev A fee of zero would make a write-off exactly as good as an honest sale, and a fee larger
    ///      than the commission it eats would run the arithmetic backwards.
    function test_theWriteOffFeeIsBoundedByTheCommissionItEats() public {
        SaleGateway.Splits memory splits = SaleGateway.Splits({
            creatorBps: CREATOR_BPS,
            landlordBps: LANDLORD_BPS,
            communityBps: COMMUNITY_BPS,
            operatorBps: OPERATOR_BPS
        });

        vm.expectRevert(SaleGateway.InvalidPenalty.selector);
        new SaleGateway(
            operator,
            treasury,
            registry,
            items,
            prices,
            debts,
            authorizer,
            pool,
            splits,
            0,
            FULFILMENT_WINDOW
        );

        vm.expectRevert(SaleGateway.InvalidPenalty.selector);
        new SaleGateway(
            operator,
            treasury,
            registry,
            items,
            prices,
            debts,
            authorizer,
            pool,
            splits,
            OPERATOR_BPS + 1,
            FULFILMENT_WINDOW
        );
    }

    function _expectedDebtIds() internal pure returns (uint256[] memory ids) {
        ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;
    }
}

/// @notice The write-off at a closed till.
/// @dev A ceiling of exactly zero: no pool, no allowance, no capacity to hold anyone's money. The
///      operator cannot sell a thing on the cash rail — and it can still be made to pay for an item
///      it destroyed. A punishment that a full ceiling could block would be a punishment the operator
///      could escape by filling its own ceiling, which is not a punishment at all.
contract BurnAtAClosedTillTest is Fixture {
    function _genesisAllowance() internal view virtual override returns (uint256) {
        return 0;
    }

    function test_aWriteOffTakesNoAuthorizationAndTightensTheCeilingForTheNextSale() public {
        assertEq(ceiling.ceiling(), 0);
        assertEq(ceiling.headroom(), 0);

        // Nothing can be sold for cash. The till is shut.
        SaleGateway.SaleInput memory sale = _inputWithCommunity(1);
        (uint256 c, uint256 l, uint256 m,) = _legs(itemPrices[1], true);
        vm.expectRevert(
            abi.encodeWithSelector(ISaleAuthorizer.OverCeiling.selector, CREATOR_ID, c + l + m, 0)
        );
        vm.prank(operator);
        gateway.sellCash(sale);

        // The write-off happens anyway.
        SaleGateway.WriteOff memory writeOff = _writeOff(0);
        vm.prank(operator);
        uint256[] memory debtIds = gateway.burn(writeOff);

        (uint256 creatorAmount, uint256 landlordAmount,,) = _legs(itemPrices[0], true);
        assertEq(debts.debt(debtIds[0]).amount, creatorAmount);
        assertEq(uint8(items.stateOf(itemIds[0])), uint8(Types.ItemState.BURNED));

        // And the debts it minted are exposure, so the write-off tightens the ceiling on what comes
        // next rather than being blocked by it. Exposure rose with nobody's authorization — which is
        // exactly why the ceiling is a gate on new sales and not an invariant.
        assertEq(debts.outstanding(), creatorAmount + landlordAmount);
        assertGt(ceiling.used(), ceiling.ceiling());
        assertEq(ceiling.headroom(), 0);
    }
}
