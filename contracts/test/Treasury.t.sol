// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {DebtLedger} from "../src/debt/DebtLedger.sol";
import {IDebtLedger} from "../src/interfaces/IDebtLedger.sol";
import {ISaleAuthorizer} from "../src/interfaces/ISaleAuthorizer.sol";
import {SaleGateway} from "../src/sale/SaleGateway.sol";
import {Allowance} from "../src/treasury/Allowance.sol";
import {MockNGN} from "../src/treasury/MockNGN.sol";
import {Pool} from "../src/treasury/Pool.sol";
import {Types} from "../src/libs/Types.sol";
import {Fixture} from "./utils/Fixture.sol";

/// @notice The treasury's own surface: what it refuses, who may ask it, and what it says out loud.
/// @dev Every custom error in `Pool`, `Allowance` and `MockNGN` has a triggering test here. An error
///      nothing can trigger is either dead code or a bug that has not been found yet.
contract TreasuryTest is Fixture {
    uint256 internal constant POOL_SKIM = 200_000e18;

    function setUp() public override {
        super.setUp();
        _fundPool(POOL_SKIM);
    }

    // --- Wiring ---

    function test_theDeploymentIsWiredAndTheWiringIsPermanent() public {
        assertEq(address(ceiling.pool()), address(pool));
        assertEq(address(pool.ceiling()), address(ceiling));
        assertEq(address(pool.debts()), address(debts));
        assertEq(address(pool.token()), address(ngn));
        assertEq(pool.currency(), CURRENCY);
        assertEq(pool.saleGateway(), address(gateway));
        assertEq(debts.pool(), address(pool));

        vm.startPrank(operator);

        vm.expectRevert(Allowance.PoolAlreadySet.selector);
        ceiling.setPool(address(pool));

        vm.expectRevert(Pool.GatewayAlreadySet.selector);
        pool.setSaleGateway(address(gateway));

        vm.stopPrank();
    }

    function test_onlyTheOperatorWiresTheTreasury() public {
        Allowance fresh = new Allowance(operator, debts, 1e18, GROWTH_BPS, WRITE_DOWN_MULTIPLE);
        Pool loose = new Pool(operator, ngn, CURRENCY, debts, fresh);

        vm.expectRevert(Allowance.NotOperator.selector);
        vm.prank(stranger);
        fresh.setPool(address(loose));

        vm.expectRevert(Pool.NotOperator.selector);
        vm.prank(stranger);
        loose.setSaleGateway(address(gateway));
    }

    function test_theTreasuryRefusesNonsenseParameters() public {
        vm.expectRevert(Allowance.ZeroAddress.selector);
        new Allowance(address(0), debts, 1e18, GROWTH_BPS, WRITE_DOWN_MULTIPLE);

        vm.expectRevert(Allowance.ZeroAddress.selector);
        new Allowance(operator, DebtLedger(address(0)), 1e18, GROWTH_BPS, WRITE_DOWN_MULTIPLE);

        vm.expectRevert(Allowance.InvalidGrowth.selector);
        new Allowance(operator, debts, 1e18, 0, WRITE_DOWN_MULTIPLE);

        vm.expectRevert(Allowance.InvalidGrowth.selector);
        new Allowance(operator, debts, 1e18, 10_001, WRITE_DOWN_MULTIPLE);

        vm.expectRevert(Allowance.InvalidMultiple.selector);
        new Allowance(operator, debts, 1e18, GROWTH_BPS, 0);

        vm.expectRevert(Pool.ZeroAddress.selector);
        new Pool(address(0), ngn, CURRENCY, debts, ceiling);

        vm.expectRevert(Pool.ZeroAddress.selector);
        new Pool(operator, IERC20(address(0)), CURRENCY, debts, ceiling);

        vm.expectRevert(Pool.ZeroAddress.selector);
        new Pool(operator, ngn, CURRENCY, DebtLedger(address(0)), ceiling);

        vm.expectRevert(Pool.ZeroAddress.selector);
        new Pool(operator, ngn, CURRENCY, debts, Allowance(address(0)));

        vm.expectRevert(abi.encodeWithSelector(Pool.WrongCurrency.selector, bytes32(0), bytes32(0)));
        new Pool(operator, ngn, bytes32(0), debts, ceiling);

        vm.expectRevert(Allowance.ZeroAddress.selector);
        vm.prank(operator);
        ceiling.setPool(address(0));
    }

    /// @dev A ceiling with no pool behind it cannot answer the only question it exists to answer.
    function test_aCeilingWithNoPoolCannotAuthorizeAnything() public {
        Allowance orphan = new Allowance(operator, debts, 1e18, GROWTH_BPS, WRITE_DOWN_MULTIPLE);

        vm.expectRevert(Allowance.PoolNotSet.selector);
        orphan.authorize(CREATOR_ID, 1, Types.Rail.CUSTODY);

        vm.expectRevert(Allowance.PoolNotSet.selector);
        orphan.ceiling();

        // The instant rail is the one question it can answer without the pool: no.
        orphan.authorize(CREATOR_ID, 1e30, Types.Rail.INSTANT);
    }

    // --- The pool's gates ---

    function test_onlyTheOperatorDepositsTheSkim() public {
        vm.expectRevert(Pool.NotOperator.selector);
        vm.prank(stranger);
        pool.depositSkim(SALE_REF, 1e18);

        vm.expectRevert(Pool.ZeroAmount.selector);
        vm.prank(operator);
        pool.depositSkim(SALE_REF, 0);
    }

    function test_onlyTheGatewayPricesAWriteOff() public {
        vm.expectRevert(Pool.NotGateway.selector);
        vm.prank(operator);
        pool.accrueWriteOff(1001, CURRENCY, 1e18, 0);
    }

    /// @dev One pool, one asset, one currency. A debt denominated in something else is not this
    ///      pool's business, and the protocol never converts.
    function test_thePoolWillNotPayADebtInAnotherCurrency() public {
        // forge-lint: disable-next-line(unsafe-typecast)
        bytes32 dollars = bytes32("USD");

        vm.prank(creator);
        debts.setAccountHash(dollars, keccak256("creator-dollar-account"));

        IDebtLedger.Leg[] memory legs = new IDebtLedger.Leg[](1);
        legs[0] = IDebtLedger.Leg(Types.Role.CREATOR, creator, 1_000e18);

        vm.prank(address(gateway));
        uint256[] memory ids =
            debts.mintSaleDebts(9999, CREATOR_ID, Types.Rail.CUSTODY, dollars, legs, bytes32(0));

        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);
        assertTrue(debts.isDefaultable(ids[0]));

        vm.expectRevert(abi.encodeWithSelector(Pool.WrongCurrency.selector, CURRENCY, dollars));
        vm.prank(stranger);
        pool.touch(ids[0]);

        vm.expectRevert(abi.encodeWithSelector(Pool.WrongCurrency.selector, CURRENCY, dollars));
        vm.prank(address(gateway));
        pool.accrueWriteOff(9999, dollars, 1e18, 0);
    }

    // --- Reimbursement ---

    function test_reimbursingWhatIsNotOwedReverts() public {
        vm.expectRevert(Pool.NothingOwed.selector);
        vm.prank(operator);
        pool.reimburse(1e18);
    }

    function test_reimbursementIsBoundedByWhatIsOwed() public {
        uint256 debtId = _defaultOneDebt();
        uint256 owed = pool.reimbursementOutstanding();

        vm.startPrank(operator);

        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.reimburse(0);

        vm.expectRevert(abi.encodeWithSelector(Pool.ExcessReimbursement.selector, owed + 1, owed));
        pool.reimburse(owed + 1);

        // Part of it is fine, and the freeze holds until the last naira lands.
        pool.reimburse(owed - 1);
        assertTrue(ceiling.frozen());
        assertEq(ceiling.healingSince(), 0);

        pool.reimburse(1);
        vm.stopPrank();

        assertFalse(ceiling.frozen());
        assertEq(ceiling.healingSince(), uint64(block.timestamp));
        assertEq(debts.debt(debtId).amount, owed);
    }

    /// @dev Money arriving in the pool is good news whoever sent it. The freeze it lifts is the
    ///      operator's, and a stranger paying the operator's debt for it is a gift, not a hole.
    function test_anyoneMayReimburseThePool() public {
        _defaultOneDebt();
        uint256 owed = pool.reimbursementOutstanding();

        vm.prank(operator);
        ngn.mint(stranger, owed);

        vm.startPrank(stranger);
        ngn.approve(address(pool), owed);
        pool.reimburse(owed);
        vm.stopPrank();

        assertEq(pool.reimbursementOutstanding(), 0);
        assertFalse(ceiling.frozen());
    }

    // --- Penalties ---

    function test_aPenaltyNobodyIsOwedCannotBeCollected() public {
        vm.expectRevert(Pool.NothingOwed.selector);
        pool.collectPenalty(creator);

        vm.expectRevert(Pool.NothingOwed.selector);
        pool.collectPoolDues();
    }

    /// @dev The fee is pulled from the operator's funding account against a standing approval, and it
    ///      is pushed to the wronged party by anyone who cares to send the transaction. A fee that
    ///      had to be volunteered by the party being fined is not a fee.
    function test_theLyingFeeIsPaidByTheOperatorAndCollectableByAnyone() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();

        vm.prank(creator);
        debts.challenge(claimId);
        vm.warp(block.timestamp + RESPONSE_WINDOW + 1);
        debts.voidChallenged(claimId);

        uint256 claimed =
            debts.debt(ids[0]).amount + debts.debt(ids[1]).amount + debts.debt(ids[2]).amount;
        uint256 penalty = claimed * PENALTY_BPS / 10_000;
        uint256 toCreator = debts.penaltyOwed(creator, CURRENCY);

        assertEq(pool.penaltyDue(creator), toCreator);
        assertGt(toCreator, 0);

        uint256 operatorBefore = ngn.balanceOf(operator);

        vm.prank(stranger);
        uint256 paid = pool.collectPenalty(creator);

        assertEq(paid, toCreator);
        assertEq(ngn.balanceOf(creator), toCreator);
        assertEq(ngn.balanceOf(operator), operatorBefore - toCreator);
        assertEq(pool.penaltyDue(creator), 0);

        // Every recipient under the dead claim is a wronged party, and each is owed their half.
        vm.startPrank(stranger);
        pool.collectPenalty(landlord);
        pool.collectPenalty(communityMember);
        vm.stopPrank();

        // The pool's halves, likewise — out of the operator's pocket and into the fund.
        uint256 poolHalves = debts.poolPenaltyOwed(CURRENCY);
        vm.prank(stranger);
        pool.collectPoolDues();

        assertEq(pool.balance(), POOL_SKIM + poolHalves);

        // The lying fee, whole: 1% of what was claimed, and the wronged parties are never rounded
        // down — they take the ceiling half of every split, the pool takes the floor.
        uint256 toRecipients = toCreator + ngn.balanceOf(landlord) + ngn.balanceOf(communityMember);
        assertEq(toRecipients + poolHalves, penalty);
        assertGe(toRecipients, poolHalves);

        vm.expectRevert(Pool.NothingOwed.selector);
        pool.collectPenalty(creator);
    }

    /// @dev The write-off's dues are the operator's too, and they are counted the same way: a burn
    ///      whose fee is never paid keeps eating the ceiling until it is.
    function test_anUnpaidWriteOffFeeAlsoEatsTheHeadroom() public {
        SaleGateway.WriteOff memory writeOff = _writeOff(0);
        uint256 headroomBefore = ceiling.headroom();

        vm.prank(operator);
        uint256[] memory debtIds = gateway.burn(writeOff);

        uint256 paidAsSold = debts.debt(debtIds[0]).amount + debts.debt(debtIds[1]).amount;
        uint256 dues = pool.poolDuesOwed();

        assertEq(pool.penaltiesOutstanding(), dues);
        assertEq(ceiling.headroom(), headroomBefore - paidAsSold - dues);

        vm.prank(stranger);
        pool.collectPoolDues();

        // The debts the burn minted still occupy the ceiling — they are real obligations and they are
        // supposed to. What the payment clears is the fee, and the fee lands in the fund, where it
        // backs custody like any other naira of the pool.
        assertEq(pool.penaltiesOutstanding(), 0);
        assertEq(ceiling.headroom(), headroomBefore - paidAsSold + dues);
        assertEq(pool.balance(), POOL_SKIM + dues);
    }

    /// @dev The honest residual, stated rather than hidden: if the operator withdraws the standing
    ///      approval, the fee stays owed and public — and nothing a victim needs is blocked by it.
    ///      The default payout comes out of the fund, not out of the operator's cooperation. The
    ///      refusal costs the operator its own headroom (above) and costs the victim nothing.
    function test_anOperatorThatRevokesItsApprovalCannotBlockTheVictimsPayout() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();

        vm.prank(creator);
        debts.challenge(claimId);
        vm.warp(block.timestamp + RESPONSE_WINDOW + 1);
        debts.voidChallenged(claimId);

        vm.prank(operator);
        ngn.approve(address(pool), 0);

        // The fee cannot be collected...
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector,
                address(pool),
                0,
                pool.penaltyDue(creator)
            )
        );
        pool.collectPenalty(creator);
        assertGt(pool.penaltyDue(creator), 0); // still owed, still public

        // ...and the creator is still paid in full, on a stranger's touch, out of the fund. The debt
        // came back at the age it always had, so it is in default the moment its deadline passes.
        vm.warp(debts.debt(ids[0]).deadline + 1);
        vm.prank(stranger);
        pool.touch(ids[0]);
        assertEq(ngn.balanceOf(creator), debts.debt(ids[0]).amount);
    }

    // --- Growth ---

    function test_growthOnAClaimThatDoesNotExistReverts() public {
        vm.expectRevert(abi.encodeWithSelector(DebtLedger.UnknownClaim.selector, 7));
        ceiling.creditSettlement(7);
    }

    /// @dev Only the pool writes the allowance down, and only the pool lifts a freeze. An operator
    ///      that could do either could grant itself capacity.
    function test_onlyThePoolMovesTheAllowance() public {
        vm.startPrank(operator);

        vm.expectRevert(Allowance.NotPool.selector);
        ceiling.writeDown(1, 1e18);

        vm.expectRevert(Allowance.NotPool.selector);
        ceiling.liftFreeze();

        vm.stopPrank();
        assertEq(ceiling.allowanceOf(CREATOR_ID), GENESIS_ALLOWANCE);
    }

    /// @dev The write-down stops at zero. There is nothing behind zero: an operator with no allowance
    ///      has no custody capacity at all, which is the strongest thing the number can say. A
    ///      buyer's prepayment is the whole price, so five times it outruns the day-one allowance on
    ///      its own — one undeliverable order and the till is shut.
    function test_theWriteDownStopsAtZero() public {
        SaleGateway.SaleInput memory order = _inputWithCommunity(0);

        vm.prank(operator);
        uint256 refundDebtId = gateway.commitOption(order, buyer);

        vm.warp(block.timestamp + FULFILMENT_WINDOW + 1);
        vm.prank(stranger);
        pool.touch(refundDebtId);

        assertGt(WRITE_DOWN_MULTIPLE * itemPrices[0], GENESIS_ALLOWANCE);
        assertEq(ceiling.allowanceOf(CREATOR_ID), 0);
        assertEq(ceiling.ceiling(), pool.balance());
    }

    // --- The token ---

    function test_onlyTheOperatorMintsTheDemoAsset() public {
        vm.expectRevert(MockNGN.NotOperator.selector);
        vm.prank(stranger);
        ngn.mint(stranger, 1e18);

        vm.expectRevert(MockNGN.NotOperator.selector);
        new MockNGN(address(0));

        assertEq(ngn.decimals(), 18);
        assertEq(ngn.symbol(), "mNGN");
    }

    // --- Helpers ---

    /// @dev One cash sale, defaulted on the creator's leg. The pool is out of pocket and the freeze
    ///      is on.
    function _defaultOneDebt() internal returns (uint256 debtId) {
        SaleGateway.SaleInput memory sale = _inputWithCommunity(0);

        vm.prank(operator);
        uint256[] memory debtIds = gateway.sellCash(sale);

        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);
        vm.prank(stranger);
        pool.touch(debtIds[0]);

        return debtIds[0];
    }
}

/// @notice The fine the operator refuses to pay throttles the operator's own till.
///
///         The chain cannot reach a bank account. So a punishment it cannot collect has to cost
///         something anyway — and what it costs is capacity. Withdraw the pool's standing approval to
///         dodge a fine and the fine does not go away: it sits on the books, in public, eating the
///         headroom needed in order to keep selling. **There is no obligation in this protocol that
///         can be escaped by refusing to settle it.** Nothing is seized; what is withheld is the right
///         to keep trading, which is the only thing the chain controls.
///
/// @dev The ceiling here is sized so the fee is decisive: the very same sale that fits *before* the
///      fine is refused *after* it, and goes through the moment the fine is paid. Capacity of
///      ₦184,000, one ₦87,500 claim voided, an ₦875 fine — and a ₦96,250 sale that fits in ₦96,500 of
///      headroom and does not fit in ₦95,625.
contract FineThrottleTest is Fixture {
    function _genesisAllowance() internal view virtual override returns (uint256) {
        return 184_000e18;
    }

    function test_aFineTheOperatorRefusesToPayEatsItsOwnHeadroom() public {
        SaleGateway.SaleInput memory first = _inputWithCommunity(0);
        SaleGateway.SaleInput memory second = _inputWithCommunity(1);

        // A cash sale, and a claim over it that the operator cannot support.
        vm.prank(operator);
        uint256[] memory ids = gateway.sellCash(first);

        vm.prank(operator);
        uint256 claimId = debts.postClaim(_payable(ids), CLAIM_REF);

        (uint256 c, uint256 l, uint256 m,) = _legs(itemPrices[1], true);
        uint256 exposure = c + l + m;
        uint256 headroomBefore = ceiling.headroom();
        assertGe(headroomBefore, exposure); // the second sale fits, today

        // The creator tests it. The operator has no proof, because there was no payment.
        vm.prank(creator);
        debts.challenge(claimId);
        vm.warp(block.timestamp + RESPONSE_WINDOW + 1);
        debts.voidChallenged(claimId);

        // The operator withdraws the approval the pool collects its fines against. The fine is not
        // escaped — it is now in the ceiling's arithmetic, to the naira.
        vm.prank(operator);
        ngn.approve(address(pool), 0);

        uint256 fine = pool.penaltiesOutstanding();
        assertGt(fine, 0);
        assertEq(ceiling.headroom(), headroomBefore - fine);

        // And the sale that fitted this morning is refused at the counter this afternoon. The
        // difference between selling and not selling is a fine the operator declined to pay.
        uint256 room = ceiling.headroom();
        assertGt(exposure, room);

        vm.expectRevert(
            abi.encodeWithSelector(ISaleAuthorizer.OverCeiling.selector, CREATOR_ID, exposure, room)
        );
        vm.prank(operator);
        gateway.sellCash(second);

        // Pay up: the approval goes back, and a stranger collects the fine on the wronged parties'
        // behalf. The obligation clears, and the headroom comes back with it.
        uint256 poolHalves = pool.poolDuesOwed();

        vm.prank(operator);
        ngn.approve(address(pool), type(uint256).max);

        vm.startPrank(stranger);
        pool.collectPenalty(creator);
        pool.collectPenalty(landlord);
        pool.collectPenalty(communityMember);
        pool.collectPoolDues();
        vm.stopPrank();

        assertEq(pool.penaltiesOutstanding(), 0);

        // And it comes back *with the pool's half of the fine inside it*. That half is now real money
        // in the fund, and the fund is half of what the ceiling is made of — so squaring a fine hands
        // the operator slightly more room than it had before the fine existed. This is not a loophole:
        // the operator paid the whole fine out of its own pocket, the wronged parties kept their half,
        // and what came back is the operator's own cash converted into capacity it has to keep
        // insuring. Refusing costs headroom; paying costs money.
        assertEq(ceiling.headroom(), headroomBefore + poolHalves);
        assertEq(pool.balance(), poolHalves);

        // The refused sale now goes through. The till reopens by paying, and by nothing else.
        vm.prank(operator);
        gateway.sellCash(second);
        assertEq(uint8(items.stateOf(itemIds[1])), uint8(Types.ItemState.SOLD));
    }
}

/// @notice A pool too small for the debt that defaults on it.
/// @dev The honest residual, stated rather than hidden. Compensation is bounded by the fund: in the
///      correlated case — the operator defaulting on everything at once and walking away — victims
///      recover up to the pool and no further, and it is the *ceiling* that keeps that uncovered tail
///      small, not the pool. The protocol says so in public, with an event, and it still takes the
///      whole write-down: the punishment is for the default, and an empty fund is not a mitigation.
contract PoolShortfallTest is Fixture {
    uint256 internal constant SMALL_POOL = 50_000e18;

    function setUp() public override {
        super.setUp();
        _fundPool(SMALL_POOL);
    }

    function test_aPoolTooSmallPaysWhatItHasAndSaysSo() public {
        SaleGateway.SaleInput memory sale = _inputWithCommunity(0);
        (uint256 creatorAmount,,,) = _legs(itemPrices[0], true);

        vm.prank(operator);
        uint256[] memory debtIds = gateway.sellCash(sale);

        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);
        assertLt(pool.balance(), creatorAmount);

        vm.expectEmit(true, true, false, true, address(pool));
        emit Pool.PoolShortfall(debtIds[0], creator, creatorAmount - SMALL_POOL);
        vm.prank(stranger);
        pool.touch(debtIds[0]);

        // She got what there was. The rest is the tail the ceiling exists to keep small.
        assertEq(ngn.balanceOf(creator), SMALL_POOL);
        assertEq(pool.balance(), 0);
        assertEq(uint8(debts.debt(debtIds[0]).state), uint8(Types.DebtState.DEFAULTED));

        // The operator owes the pool what the pool actually laid out — and the write-down is on the
        // whole defaulted amount regardless, because the punishment is for the default.
        assertEq(pool.reimbursementOutstanding(), SMALL_POOL);
        assertEq(
            ceiling.allowanceOf(CREATOR_ID), GENESIS_ALLOWANCE - WRITE_DOWN_MULTIPLE * creatorAmount
        );

        // An empty pool and a written-down allowance: the ceiling is now the allowance alone, and
        // what is already outstanding has outrun it. The till is shut.
        assertEq(ceiling.ceiling(), ceiling.allowanceOf(CREATOR_ID));
        assertGt(ceiling.used(), ceiling.ceiling());
        assertEq(ceiling.headroom(), 0);
    }
}
