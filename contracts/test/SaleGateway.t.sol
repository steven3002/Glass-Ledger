// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {CreatorRegistry} from "../src/identity/CreatorRegistry.sol";
import {IDebtLedger} from "../src/interfaces/IDebtLedger.sol";
import {ISaleAuthorizer} from "../src/interfaces/ISaleAuthorizer.sol";
import {ItemLedger} from "../src/items/ItemLedger.sol";
import {PriceBook} from "../src/items/PriceBook.sol";
import {SaleGateway} from "../src/sale/SaleGateway.sol";
import {Types} from "../src/libs/Types.sol";
import {Fixture} from "./utils/Fixture.sol";
import {MerkleBuilder} from "./utils/MerkleBuilder.sol";
import {MockAuthorizer} from "./utils/MockAuthorizer.sol";

/// @notice The fusion, and what it hands the ceiling.
/// @dev The one suite that does not run against the real `Allowance`. What is under test here is the
///      *call*: the exposure a sale declares, the rail it declares it on, and the fact that a refusal
///      unwinds everything. A spy answers those questions and a real ceiling cannot — it would only
///      say yes, and yes is what every ceiling says until the day it does not. The ceiling's own
///      arithmetic is tested against the ceiling, in `Ceiling.t.sol`.
contract SaleGatewayTest is Fixture {
    MockAuthorizer internal spy;

    uint256 internal itemId;
    uint256 internal price;
    uint64 internal anchor;

    uint256 internal constant REPRICED = 175_000e18;
    uint256 internal constant ODD_PRICE = 123_456_789_012_345_678_901;

    event Sold(
        uint256 indexed itemId,
        uint256 indexed trancheId,
        Types.Rail rail,
        uint256 price,
        bytes32 currency,
        bytes32 claimRef,
        uint256[] debtIds
    );
    event Committed(
        uint256 indexed itemId,
        address indexed buyer,
        uint256 price,
        uint64 deadline,
        uint256 refundDebtId
    );

    function setUp() public override {
        super.setUp();
        itemId = itemIds[0];
        price = itemPrices[0];
        anchor = items.tranche(trancheId).postedAt;
    }

    /// @inheritdoc Fixture
    function _saleAuthorizer() internal override returns (ISaleAuthorizer) {
        spy = new MockAuthorizer();
        return spy;
    }

    // --- The fusion ---

    /// @dev One call: the tag is checked, the shelf is checked, the ceiling is checked, the item
    ///      is consumed, the split is owed and the certificate exists. Nothing here can happen
    ///      without the rest of it happening.
    function test_anInstantSaleDoesEveryStepOrNone() public {
        SaleGateway.SaleInput memory input = _input(0);
        (uint256 creatorAmount, uint256 landlordAmount,, uint256 operatorAmount) =
            _legs(price, false);

        uint256[] memory expected = new uint256[](3);
        expected[0] = 1;
        expected[1] = 2;
        expected[2] = 3;

        vm.expectEmit(true, true, false, true, address(gateway));
        emit Sold(itemId, trancheId, Types.Rail.INSTANT, price, CURRENCY, CLAIM_REF, expected);

        vm.prank(operator);
        uint256[] memory debtIds = gateway.sellInstant(input, CLAIM_REF);

        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.SOLD));
        assertEq(debtIds.length, 3);

        IDebtLedger.Debt memory creatorDebt = debts.debt(debtIds[0]);
        assertEq(creatorDebt.recipient, creator);
        assertEq(creatorDebt.amount, creatorAmount);
        assertEq(uint8(creatorDebt.role), uint8(Types.Role.CREATOR));
        assertEq(uint8(creatorDebt.state), uint8(Types.DebtState.PROVISIONAL));
        assertEq(creatorDebt.claimRef, CLAIM_REF);

        assertEq(debts.debt(debtIds[1]).recipient, landlord);
        assertEq(debts.debt(debtIds[1]).amount, landlordAmount);
        assertEq(debts.debt(debtIds[2]).recipient, treasury);
        assertEq(debts.debt(debtIds[2]).amount, operatorAmount);
        assertEq(operatorAmount, price * OPERATOR_BPS / 10_000);

        assertEq(gateway.certificateOf(itemId).claimCodeHash, input.claimCodeHash);
        assertEq(gateway.certificateOf(itemId).commitment, input.certificateCommitment);

        // The rail paid the recipients directly, so the operator holds nobody's money.
        assertEq(debts.outstanding(), 0);
        assertEq(spy.calls(), 1);
        assertEq(spy.lastExposure(), creatorAmount + landlordAmount);
        assertEq(uint8(spy.lastRail()), uint8(Types.Rail.INSTANT));
    }

    function test_aCommunityVoucherMintsTheFourthLeg() public {
        SaleGateway.SaleInput memory input = _inputWithCommunity(0);
        (
            uint256 creatorAmount,
            uint256 landlordAmount,
            uint256 communityAmount,
            uint256 operatorAmount
        ) = _legs(price, true);

        vm.prank(operator);
        uint256[] memory debtIds = gateway.sellInstant(input, CLAIM_REF);

        assertEq(debtIds.length, 4);
        assertEq(debts.debt(debtIds[2]).recipient, communityMember);
        assertEq(debts.debt(debtIds[2]).amount, communityAmount);
        assertEq(uint8(debts.debt(debtIds[2]).role), uint8(Types.Role.COMMUNITY));
        assertEq(debts.debt(debtIds[3]).amount, operatorAmount);

        assertEq(creatorAmount + landlordAmount + communityAmount + operatorAmount, price);
        assertEq(spy.lastExposure(), creatorAmount + landlordAmount + communityAmount);
    }

    /// @dev A cash sale is the operator holding other people's money. The ledger says so from the
    ///      second the item leaves the shelf.
    function test_aCashSaleAgesDebtsAndBooksTheExposure() public {
        SaleGateway.SaleInput memory input = _inputWithCommunity(0);

        vm.prank(operator);
        uint256[] memory debtIds = gateway.sellCash(input);

        assertEq(uint8(debts.debt(debtIds[0]).state), uint8(Types.DebtState.AGING));
        assertEq(debts.debt(debtIds[0]).deadline, uint64(block.timestamp) + SETTLEMENT_WINDOW);
        assertEq(debts.outstanding(), price * 8750 / 10_000);
        assertEq(uint8(spy.lastRail()), uint8(Types.Rail.CUSTODY));
    }

    /// @dev Every beneficiary's leg floors and the remainder lands in the operator's, so the
    ///      parties are never short a wei and the legs always sum to exactly the price.
    function test_roundingDustFallsToTheOperatorNeverToABeneficiary() public {
        vm.warp(anchor + 30);
        vm.prank(creator);
        prices.setPrice(itemId, ODD_PRICE);
        vm.warp(anchor + PRICE_EPOCH);

        SaleGateway.SaleInput memory input = _inputWithCommunity(0);

        vm.prank(operator);
        uint256[] memory debtIds = gateway.sellInstant(input, CLAIM_REF);

        uint256 total;
        for (uint256 i = 0; i < debtIds.length; ++i) {
            total += debts.debt(debtIds[i]).amount;
        }

        assertEq(total, ODD_PRICE);
        assertGt(debts.debt(debtIds[3]).amount, ODD_PRICE * OPERATOR_BPS / 10_000);
    }

    /// @dev The split is computed on the price in force when the item is consumed — not the price
    ///      it was seeded at, and not one the operator supplies.
    function test_theSplitUsesThePriceInForceAtExecution() public {
        vm.warp(anchor + 30);
        vm.prank(creator);
        prices.setPrice(itemId, REPRICED);
        vm.warp(anchor + PRICE_EPOCH);

        SaleGateway.SaleInput memory input = _input(0);

        vm.prank(operator);
        uint256[] memory debtIds = gateway.sellCash(input);

        assertEq(debts.debt(debtIds[0]).amount, REPRICED * CREATOR_BPS / 10_000);
    }

    // --- The checkout defends itself ---

    function test_theSameTagCannotBeSoldTwice() public {
        SaleGateway.SaleInput memory input = _input(0);

        vm.prank(operator);
        gateway.sellInstant(input, CLAIM_REF);

        vm.expectRevert(abi.encodeWithSelector(ItemLedger.AlreadySold.selector, itemId));
        vm.prank(operator);
        gateway.sellInstant(input, CLAIM_REF);
    }

    function test_aForgedTagIsNotSellable() public {
        SaleGateway.SaleInput memory input = _input(0);
        input.signature = _sign(_voucher(itemId), forgerKey);

        vm.expectRevert(CreatorRegistry.UnknownCreatorSignature.selector);
        vm.prank(operator);
        gateway.sellInstant(input, CLAIM_REF);
    }

    /// @dev A genuinely signed voucher for an item that is not in this consignment: the signature
    ///      is real and the membership is not.
    function test_anItemOutsideTheConsignmentIsNotSellable() public {
        SaleGateway.SaleInput memory input = _input(0);
        input.proof = MerkleBuilder.proof(leaves, 5);

        vm.expectRevert(
            abi.encodeWithSelector(SaleGateway.NotInTranche.selector, itemId, trancheId)
        );
        vm.prank(operator);
        gateway.sellInstant(input, CLAIM_REF);
    }

    function test_anotherCreatorsVoucherCannotDrawOnThisConsignment() public {
        (address other, uint256 otherKey) = makeAddrAndKey("otherCreator");
        vm.prank(operator);
        uint256 otherId = registry.register(other);

        SaleGateway.SaleInput memory input = _input(0);
        input.voucher.creatorId = otherId;
        input.signature = _sign(input.voucher, otherKey);

        vm.expectRevert(
            abi.encodeWithSelector(SaleGateway.CreatorMismatch.selector, otherId, creatorId)
        );
        vm.prank(operator);
        gateway.sellInstant(input, CLAIM_REF);
    }

    /// @dev The paper and the shelf have to agree about what the creator was promised.
    function test_aVoucherConsignedUnderAnotherSplitIsNotSellable() public {
        SaleGateway.SaleInput memory input = _input(0);
        input.voucher.splitPolicyRef = keccak256("some-other-split");
        input.signature = _sign(input.voucher, creatorKey);
        bytes32 policy = gateway.splitPolicy();

        vm.expectRevert(
            abi.encodeWithSelector(
                SaleGateway.UnknownSplitPolicy.selector, input.voucher.splitPolicyRef, policy
            )
        );
        vm.prank(operator);
        gateway.sellInstant(input, CLAIM_REF);
    }

    /// @dev The whole point of the fusion: if the ceiling refuses, the sale did not happen. Not
    ///      the item, not the debts, not the certificate.
    function test_aRefusedCeilingLeavesNothingBehind() public {
        SaleGateway.SaleInput memory input = _input(0);
        (uint256 creatorAmount, uint256 landlordAmount,,) = _legs(price, false);
        spy.setRejects(true);

        vm.expectRevert(
            abi.encodeWithSelector(
                ISaleAuthorizer.OverCeiling.selector, CREATOR_ID, creatorAmount + landlordAmount, 0
            )
        );
        vm.prank(operator);
        gateway.sellCash(input);

        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.ABSENT));
        assertTrue(items.isAvailable(itemId));
        assertEq(debts.debtCount(), 0);
        assertEq(debts.outstanding(), 0);
        assertEq(gateway.certificateOf(itemId).claimCodeHash, bytes32(0));
    }

    function test_onlyTheOperatorSells() public {
        SaleGateway.SaleInput memory input = _input(0);

        vm.expectRevert(SaleGateway.NotOperator.selector);
        vm.prank(stranger);
        gateway.sellCash(input);
    }

    function test_anInstantSaleMustNameThePaymentItClaims() public {
        SaleGateway.SaleInput memory input = _input(0);

        vm.expectRevert(SaleGateway.MissingClaimRef.selector);
        vm.prank(operator);
        gateway.sellInstant(input, bytes32(0));
    }

    function test_everySaleIssuesACertificate() public {
        SaleGateway.SaleInput memory input = _input(0);
        input.claimCodeHash = bytes32(0);

        vm.expectRevert(SaleGateway.MissingCertificate.selector);
        vm.prank(operator);
        gateway.sellCash(input);
    }

    function test_halfACommunityVoucherIsNotAReferral() public {
        SaleGateway.SaleInput memory input = _input(0);
        input.communityRecipient = communityMember;

        vm.expectRevert(SaleGateway.InvalidCommunityVoucher.selector);
        vm.prank(operator);
        gateway.sellCash(input);
    }

    // --- Orders taken before the item is handed over ---

    function test_takingAnOrderReservesTheItemAndOwesTheBuyerARefund() public {
        SaleGateway.SaleInput memory input = _input(0);
        uint64 deadline = uint64(block.timestamp) + FULFILMENT_WINDOW;

        vm.expectEmit(true, true, false, true, address(gateway));
        emit Committed(itemId, buyer, price, deadline, 1);

        vm.prank(operator);
        uint256 refundDebtId = gateway.commitOption(input, buyer);

        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.COMMITTED));
        assertEq(gateway.commitmentOf(itemId).buyer, buyer);

        IDebtLedger.Debt memory refund = debts.debt(refundDebtId);
        assertEq(refund.recipient, buyer);
        assertEq(refund.amount, price);
        assertEq(uint8(refund.role), uint8(Types.Role.BUYER));
        assertEq(refund.deadline, deadline);

        // The operator is holding a stranger's whole payment: that is the exposure, not the split.
        assertEq(debts.outstanding(), price);
        assertEq(spy.lastExposure(), price);
        assertEq(uint8(spy.lastRail()), uint8(Types.Rail.CUSTODY));
    }

    /// @dev A buyer is charged what they were shown. A repricing that matures while their order is
    ///      in flight cannot reach backwards into a sale that already happened.
    function test_fulfilmentChargesThePriceTheBuyerWasShown() public {
        vm.warp(anchor + 30);
        vm.prank(creator);
        prices.setPrice(itemId, REPRICED);

        SaleGateway.SaleInput memory input = _input(0);

        vm.prank(operator);
        uint256 refundDebtId = gateway.commitOption(input, buyer);

        vm.warp(anchor + PRICE_EPOCH);
        assertEq(prices.effectivePrice(itemId), REPRICED);

        vm.prank(operator);
        uint256[] memory debtIds = gateway.fulfilCommitment(itemId);

        assertEq(debts.debt(debtIds[0]).amount, price * CREATOR_BPS / 10_000);
        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.SOLD));
        assertEq(uint8(debts.debt(refundDebtId).state), uint8(Types.DebtState.DISCHARGED));
        assertEq(gateway.commitmentOf(itemId).buyer, address(0));

        // Delivering the item replaced a refund for the whole price with legs worth less than it.
        assertEq(debts.outstanding(), price * 8500 / 10_000);
    }

    function test_anOrderCannotBeFulfilledAfterItsWindowCloses() public {
        SaleGateway.SaleInput memory input = _input(0);

        vm.prank(operator);
        gateway.commitOption(input, buyer);
        uint64 deadline = items.itemOf(itemId).committedUntil;

        vm.warp(deadline + 1);
        vm.expectRevert(
            abi.encodeWithSelector(ItemLedger.FulfilmentWindowClosed.selector, itemId, deadline)
        );
        vm.prank(operator);
        gateway.fulfilCommitment(itemId);
    }

    /// @dev A buyer's way out does not run through the party that let them down: any account may
    ///      release the item, and the refund they are owed keeps ageing toward default.
    function test_aStrangerMayReleaseAnOrderTheOperatorFailedToFulfil() public {
        SaleGateway.SaleInput memory input = _input(0);

        vm.prank(operator);
        uint256 refundDebtId = gateway.commitOption(input, buyer);
        uint64 deadline = items.itemOf(itemId).committedUntil;

        vm.warp(deadline + 1);
        vm.prank(stranger);
        gateway.expireCommitment(itemId);

        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.LISTED));
        assertEq(gateway.commitmentOf(itemId).buyer, address(0));

        // The item is back on the shelf; what the buyer is owed is untouched by that.
        assertEq(uint8(debts.debt(refundDebtId).state), uint8(Types.DebtState.AGING));
        assertEq(debts.outstanding(), price);

        vm.prank(operator);
        gateway.sellCash(input);
        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.SOLD));
    }

    function test_anOrderCannotBeReleasedBeforeItsWindowCloses() public {
        SaleGateway.SaleInput memory input = _input(0);

        vm.prank(operator);
        gateway.commitOption(input, buyer);
        uint64 deadline = items.itemOf(itemId).committedUntil;

        vm.expectRevert(
            abi.encodeWithSelector(ItemLedger.CommitmentNotExpired.selector, itemId, deadline)
        );
        gateway.expireCommitment(itemId);
    }

    function test_releasingWhatWasNeverOrderedReverts() public {
        vm.expectRevert(abi.encodeWithSelector(SaleGateway.NoCommitment.selector, itemId));
        gateway.expireCommitment(itemId);
    }

    // --- Certificates ---

    function test_theClaimCodeRedeemsTheCertificateToItsHolder() public {
        SaleGateway.SaleInput memory input = _input(0);

        vm.prank(operator);
        gateway.sellInstant(input, CLAIM_REF);

        vm.prank(stranger);
        gateway.redeemCertificate(itemId, _claimCode(0), buyer);

        assertEq(uint8(items.stateOf(itemId)), uint8(Types.ItemState.OWNED));
        assertEq(items.itemOf(itemId).owner, buyer);
    }

    function test_aWrongCodeRedeemsNothing() public {
        SaleGateway.SaleInput memory input = _input(0);

        vm.prank(operator);
        gateway.sellInstant(input, CLAIM_REF);

        vm.expectRevert(abi.encodeWithSelector(SaleGateway.BadClaimCode.selector, itemId));
        gateway.redeemCertificate(itemId, keccak256("guess"), buyer);
    }

    function test_aCertificateIsRedeemedOnce() public {
        SaleGateway.SaleInput memory input = _input(0);
        bytes32 code = _claimCode(0);

        vm.prank(operator);
        gateway.sellInstant(input, CLAIM_REF);
        gateway.redeemCertificate(itemId, code, buyer);

        vm.expectRevert(abi.encodeWithSelector(ItemLedger.ItemNotSold.selector, itemId));
        gateway.redeemCertificate(itemId, code, stranger);
    }

    function test_anUnsoldItemHasNoCertificate() public {
        bytes32 code = _claimCode(0);

        vm.expectRevert(abi.encodeWithSelector(SaleGateway.NoCertificate.selector, itemId));
        gateway.redeemCertificate(itemId, code, buyer);
    }

    // --- The bill ---

    /// @dev The two rails cost different things, and the difference is exactly what each one does.
    ///      A cash sale consumes the item and writes down what is owed. An instant sale does that
    ///      *and* files the operator's assertion about the payment that just happened — mint and
    ///      claim in one transaction, which is the whole reason an instant sale can be challenged
    ///      at all.
    function test_gasOfTheFusedSale() public {
        SaleGateway.SaleInput memory cash = _inputWithCommunity(0);

        vm.prank(operator);
        uint256 before = gasleft();
        gateway.sellCash(cash);
        uint256 cashGas = before - gasleft();

        SaleGateway.SaleInput memory instant = _inputWithCommunity(1);

        vm.prank(operator);
        before = gasleft();
        gateway.sellInstant(instant, CLAIM_REF);
        uint256 instantGas = before - gasleft();

        emit log_named_uint("cash sale gas (4 legs)", cashGas);
        emit log_named_uint("instant sale gas (4 legs, mint + claim)", instantGas);

        // Guards against the fusion quietly ballooning, not targets. What a sale costs is dominated
        // by the records it writes, and writing them is the point of the thing.
        //
        // Bilateral capacity moved these, and it is worth writing down what it cost rather than
        // quietly raising a number. A cash sale went from 562,902 to 632,466 gas — **+69,564**, about
        // 12% — and every gas of it is the feature: the sale record carries the creator (one slot), the
        // exposure it creates is recorded against that creator as well as in total (one slot, warm
        // after the first leg), and the ceiling is asked two questions instead of one. An instant sale
        // pays less of it (659,520 → 688,327) because it takes no custody, so it writes no bilateral
        // exposure and the gate returns before it reads anything.
        //
        // At this network's 4 gwei, +69,564 gas is about **7 kobo** on a cash sale. That is the price
        // of the guarantee that trust earned with one creator cannot be spent on another, and it is
        // not a close call.
        assertLt(cashGas, 700_000);
        assertLt(instantGas, 850_000);
    }
}
