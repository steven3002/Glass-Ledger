// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {DebtLedger} from "../src/debt/DebtLedger.sol";
import {IDebtLedger} from "../src/interfaces/IDebtLedger.sol";
import {ISaleAuthorizer} from "../src/interfaces/ISaleAuthorizer.sol";
import {Allowance} from "../src/treasury/Allowance.sol";
import {Types} from "../src/libs/Types.sol";
import {Fixture} from "./utils/Fixture.sol";

/// @notice Capacity is bilateral: earned with a creator, spendable only on that creator's goods.
///
///         This suite exists because of an attack that works. An operator can invent a creator, list
///         her imaginary dresses, sell them to itself, pay the proceeds into accounts it controls,
///         and prove every one of those payments — because every payment is real. Nothing is forged.
///         The money moves. The only lie is the counterparty, and no protocol has ever been able to
///         tell a fake counterparty from a real one.
///
///         So this one does not try. It makes the answer not matter: whatever the operator earns by
///         trading with itself, it can only ever spend on itself. The farm succeeds completely — the
///         allowance grows exactly as the arithmetic says — and it buys an empty room.
///
/// @dev The suite mints through the ledger's own seam rather than through the gateway, because what
///      is under test is the treasury and not the tag. The gateway's part is proven where it belongs:
///      it reads the creator off the signed tranche and passes it here, so the identity a sale spends
///      is never one the operator typed.
contract BilateralCapacityTest is Fixture {
    uint256 internal constant POOL_SKIM = 200_000e18;

    /// @dev Where the farm's money goes: the operator's other pocket. That it is the operator's is not
    ///      what makes the attack work, and it is not what makes it fail — the protocol never looks at
    ///      the destination. It is written this way only because it is what the attacker would do.
    address internal farmhand;

    function setUp() public override {
        super.setUp();
        _fundPool(POOL_SKIM);

        farmhand = makeAddr("the operator's other pocket");
        _registerAccount(farmhand);
    }

    // --- The headline ---

    /// @notice **The farm that buys nothing.**
    ///
    ///         Farm the invented creator's capacity to an enormous number through settled, proven,
    ///         self-dealt volume. Then look at the real creator's ceiling: unchanged, to the kobo. And
    ///         a sale of *her* goods past *her* limit still reverts.
    ///
    /// @dev This is the whole session in one test. Note what is asserted and what is not: the farm is
    ///      **not** prevented, detected, flagged or penalised. It runs to completion and it works. The
    ///      claim is only that it is worthless — which is a stronger guarantee than any detector could
    ///      give, because a detector can be fooled and an empty room cannot.
    function test_theFarmThatBuysNothing() public {
        uint256 realBefore = ceiling.allowanceOf(CREATOR_ID);
        uint256 realHeadroomBefore = ceiling.headroomOf(CREATOR_ID);

        // Twenty self-dealt sales of a million naira each, every one of them settled and proven.
        uint256 farmed = _farm(20, 1_000_000e18);

        // **The attack worked, and it is important to assert that rather than hope it.** ₦20,000,000
        // of self-dealt volume, of which ₦16,000,000 was payable to somebody other than the operator,
        // earns 1% of it: ₦160,000 of capacity, conjured out of an invented counterparty and credited
        // by a protocol that was told the truth at every step. If this number were zero the test below
        // would pass for the wrong reason, and the whole suite would be theatre.
        assertEq(farmed, 160_000e18);
        assertEq(ceiling.allowanceOf(FARM_CREATOR_ID), GENESIS_ALLOWANCE + farmed);
        emit log_named_decimal_uint("capacity conjured by the farm", farmed, 18);

        // And here is what it bought. Nothing. Under a single pooled allowance both of these would
        // have moved by the full ₦160,000 — that is precisely the hole, and this is precisely the fix.
        assertEq(ceiling.allowanceOf(CREATOR_ID), realBefore);
        assertEq(ceiling.headroomOf(CREATOR_ID), realHeadroomBefore);

        // Right up to the line of what she was always worth, her goods still sell.
        ceiling.authorize(CREATOR_ID, realHeadroomBefore, Types.Rail.CUSTODY);

        // One kobo past it, they do not — and the farmed millions are no answer to that, because they
        // were never hers to lend.
        vm.expectRevert(
            abi.encodeWithSelector(
                ISaleAuthorizer.OverCeiling.selector,
                CREATOR_ID,
                realHeadroomBefore + 1,
                realHeadroomBefore
            )
        );
        ceiling.authorize(CREATOR_ID, realHeadroomBefore + 1, Types.Rail.CUSTODY);
    }

    /// @notice **The record cannot be farmed.**
    ///
    ///         The one global number this protocol publishes about the operator is a record of
    ///         failure. Snapshot it, run the farm, snapshot it again: byte-identical.
    ///
    /// @dev Any statistic that aggregates across counterparties is farmable, *because a farmer
    ///      manufactures counterparties*. A total is farmable. An average is farmable. A **rate** is
    ///      worst of all, because a rate has a denominator and a denominator is exactly what gets
    ///      manufactured — sell to yourself ten thousand times and watch your default rate fall.
    ///
    ///      So there is no rate, no average and no score. There is a rap sheet, in absolute counts and
    ///      amounts, every field monotone in misbehaviour. You cannot farm a clean record. You can
    ///      only fail to have failed.
    ///
    ///      If this test ever fails, the field that moved is a score, and it does not belong in there.
    function test_theRecordCannotBeFarmed() public {
        bytes32 before = keccak256(abi.encode(ceiling.record()));

        uint256 farmed = _farm(20, 1_000_000e18);
        assertGt(farmed, 0); // the farm really did run

        assertEq(keccak256(abi.encode(ceiling.record())), before);
    }

    /// @notice And the record moves the moment the operator actually fails somebody.
    /// @dev The other half of the same claim. A record that never moved would not be un-farmable, it
    ///      would be useless — so here is the same struct, being told the truth about one default.
    function test_theRecordMovesWhenTheOperatorFails() public {
        Allowance.FailureRecord memory before = ceiling.record();
        assertEq(before.defaults, 0);
        assertEq(before.defaultValue, 0);
        assertFalse(before.growthFrozen);

        uint256[] memory ids = _mintSale(Types.Rail.CUSTODY, bytes32(0));
        uint256 owed = debts.debt(ids[0]).amount;

        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);
        vm.prank(stranger);
        pool.touch(ids[0]);

        Allowance.FailureRecord memory after_ = ceiling.record();
        assertEq(after_.defaults, 1);
        assertEq(after_.defaultValue, owed);
        assertEq(after_.owedToPool, owed);
        assertTrue(after_.growthFrozen);
    }

    // --- The rule, stated three more ways ---

    /// @notice A default on one creator's sale writes down her capacity and leaves the other's alone.
    /// @dev The write-down is a fact about a relationship, not a mood the operator is in. A creator
    ///      the operator has never wronged does not have her ceiling cut because it wronged somebody
    ///      else. What *does* reach her is the reimbursement the operator now owes the pool — charged
    ///      into every relationship's gate at once, so that refusing to square the books throttles
    ///      every counter Good has. That is deliberate, and it is asserted here too.
    function test_aDefaultOnOneCreatorLeavesTheOtherUntouched() public {
        // Open both relationships by dealing with each of them once, honestly.
        _mintSaleFor(FARM_CREATOR_ID, 2001, SALE_PRICE, Types.Rail.CUSTODY, bytes32(0));
        uint256[] memory hers = _mintSale(Types.Rail.CUSTODY, bytes32(0));

        uint256 otherBefore = ceiling.allowanceOf(FARM_CREATOR_ID);

        // The operator never pays creator A. A stranger collects it.
        uint256 defaulted = debts.debt(hers[0]).amount;
        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);
        vm.prank(stranger);
        pool.touch(hers[0]);

        // Her capacity is gone: five times what was defaulted, floored at nothing.
        uint256 assessed = defaulted * WRITE_DOWN_MULTIPLE;
        uint256 expected = assessed >= GENESIS_ALLOWANCE ? 0 : GENESIS_ALLOWANCE - assessed;
        assertEq(ceiling.allowanceOf(CREATOR_ID), expected);

        // The other creator's is untouched. Not reduced, not frozen, not adjusted: untouched.
        assertEq(ceiling.allowanceOf(FARM_CREATOR_ID), otherBefore);

        // But she is not unaffected, and she should not be — the operator owes the pool now, and that
        // debt is charged into her gate as it is into everybody's. Her till is throttled by what Good
        // owes, not by what her own record says.
        assertEq(ceiling.usedBy(FARM_CREATOR_ID), debts.outstandingOf(FARM_CREATOR_ID) + defaulted);
    }

    /// @notice Registering creators grants thresholds — and not one kobo of capacity on anyone else's
    ///         goods, nor any more faith from the network.
    /// @dev Two halves, and the second is the one that is easy to get wrong.
    ///
    ///      A genesis grant is per relationship: it is the day-one exposure *that creator* accepts, and
    ///      it is hers to accept. So every creator, registered or not, reads the same threshold.
    ///
    ///      But the *network's* unearned faith is granted **once**, not once per creator. If it were
    ///      summed over creators, an operator could print network capacity by registering
    ///      counterparties out of thin air — which is the very trick this session exists to close, and
    ///      closing it in the bilateral gate while leaving it open in the network gate would close
    ///      nothing at all.
    function test_genesisIsPerRelationshipAndTheNetworkGrantsItOnce() public view {
        assertEq(ceiling.allowanceOf(1), GENESIS_ALLOWANCE);
        assertEq(ceiling.allowanceOf(2), GENESIS_ALLOWANCE);
        assertEq(ceiling.allowanceOf(3), GENESIS_ALLOWANCE);
        assertEq(ceiling.allowanceOf(4_000_000), GENESIS_ALLOWANCE);

        // Four relationships, one grant. Inventing counterparties does not print capacity.
        assertEq(ceiling.totalAllowance(), GENESIS_ALLOWANCE);
        assertEq(ceiling.ceiling(), POOL_SKIM + GENESIS_ALLOWANCE);
    }

    /// @notice The network gate still binds. It is belt and braces, not decoration.
    /// @dev Each bilateral ceiling counts the whole pool as its backing — correctly, because the pool
    ///      will pay whichever creator turns out to be the one defaulted on. That is the right answer
    ///      one relationship at a time and the wrong answer across all of them at once: N creators
    ///      would each be told the money is there, and it is there once.
    ///
    ///      So here are two creators, each well inside her own ceiling, who together are not. The
    ///      second sale is refused — and it is refused by the *network* gate, which names itself.
    function test_theNetworkGateStopsOnePoolBeingPledgedTwice() public {
        uint256 room = ceiling.headroom();

        // Creator A takes the whole room, and it is hers to take: her own gate is satisfied, and so is
        // the network's, because there is exactly this much money behind them both.
        vm.prank(address(gateway));
        debts.mintObligation(
            3001, CREATOR_ID, buyer, room, CURRENCY, uint64(block.timestamp) + FULFILMENT_WINDOW
        );

        assertEq(ceiling.headroom(), 0);

        // Creator B has been wronged by nobody and has her full threshold. Her *own* ceiling would
        // happily take another sale — the pool is still standing there, and it is still hers to claim.
        assertGt(ceiling.headroomOf(FARM_CREATOR_ID), 0);

        // The network's does not, because that pool is already spoken for.
        uint256 exposure = ceiling.headroomOf(FARM_CREATOR_ID);
        vm.expectRevert(
            abi.encodeWithSelector(ISaleAuthorizer.OverNetworkCeiling.selector, exposure, 0)
        );
        ceiling.authorize(FARM_CREATOR_ID, exposure, Types.Rail.CUSTODY);
    }

    /// @notice Growth lands on the creator whose goods earned it, and a claim spanning two creators
    ///         splits it between them.
    /// @dev The operator supplies the proof and never the attribution: the creator on each debt was
    ///      fixed at mint, by the gateway, from a tranche the creator signed.
    function test_growthLandsOnTheCreatorWhoseGoodsEarnedIt() public {
        uint256[] memory mine = _mintSaleFor(CREATOR_ID, 4001, SALE_PRICE, Types.Rail.CUSTODY, "");
        uint256[] memory hers =
            _mintSaleFor(FARM_CREATOR_ID, 4002, SALE_PRICE, Types.Rail.CUSTODY, "");

        // One claim, one payment reference, two creators' debts inside it.
        uint256[] memory both = new uint256[](6);
        for (uint256 i = 0; i < 3; ++i) {
            both[i] = mine[i];
            both[3 + i] = hers[i];
        }

        vm.prank(operator);
        uint256 claimId = debts.postClaim(both, keccak256("one bank sweep, two creators"));

        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);
        debts.settleClaim(claimId);
        _setVerdict(claimId, true);

        uint256[] memory claimIds = new uint256[](1);
        claimIds[0] = claimId;
        vm.prank(operator);
        sweep.attest(claimIds, hex"c0ffee", keccak256("blob"));

        ceiling.creditSettlement(claimId);

        (uint256 c, uint256 l, uint256 m,) = _legs(SALE_PRICE, true);
        uint256 each = (c + l + m) * GROWTH_BPS / 10_000;

        // Each creator's own capacity grew by what her own goods settled, and by nothing else.
        assertEq(ceiling.allowanceOf(CREATOR_ID), GENESIS_ALLOWANCE + each);
        assertEq(ceiling.allowanceOf(FARM_CREATOR_ID), GENESIS_ALLOWANCE + each);

        // The network's grew by both, from the one grant it started with.
        assertEq(ceiling.totalAllowance(), GENESIS_ALLOWANCE + 2 * each);
    }

    // --- The farm itself ---

    /// @dev The creator the operator invented. She has no key, no goods and no existence; the protocol
    ///      neither knows nor cares, and that is the point.
    uint256 internal constant FARM_CREATOR_ID = 7;

    /// @notice Runs the attack, honestly, to completion, and returns the capacity it conjured.
    ///
    /// @dev Every step here is a legitimate operation and every one of them succeeds:
    ///
    ///        1. sell the invented creator's imaginary dress on the instant rail — the sale posts its
    ///           own claim, and consumes no ceiling, because the operator took no custody;
    ///        2. let the challenge window pass. Nobody challenges. Nobody would: the payments are real
    ///           and they landed in accounts the operator controls, so there is no wronged party
    ///           anywhere in this loop to notice;
    ///        3. attest to them, with a proof that is *valid*, because the money really did move;
    ///        4. collect the growth the proven claim earned.
    ///
    ///      The protocol is not fooled at any point. It is told the truth throughout, and the truth is
    ///      that the operator paid itself. The capacity is real. It is simply only good with a creator
    ///      who does not exist.
    function _farm(uint256 rounds, uint256 price) internal returns (uint256 conjured) {
        uint256 before = ceiling.allowanceOf(FARM_CREATOR_ID);

        for (uint256 round = 0; round < rounds; ++round) {
            uint256 saleRef = 9000 + round;

            IDebtLedger.Leg[] memory legs = new IDebtLedger.Leg[](2);
            legs[0] = IDebtLedger.Leg(Types.Role.CREATOR, farmhand, price * CREATOR_BPS / 10_000);
            legs[1] = IDebtLedger.Leg(Types.Role.OPERATOR, treasury, price * OPERATOR_BPS / 10_000);

            vm.prank(address(gateway));
            debts.mintSaleDebts(
                saleRef,
                FARM_CREATOR_ID,
                Types.Rail.INSTANT,
                CURRENCY,
                legs,
                keccak256(abi.encode("a payment the operator really made", round))
            );

            uint256 claimId = round + 1;

            vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);
            debts.settleClaim(claimId);

            _setVerdict(claimId, true);
            uint256[] memory claimIds = new uint256[](1);
            claimIds[0] = claimId;
            vm.prank(operator);
            sweep.attest(claimIds, hex"c0ffee", keccak256(abi.encode("evidence", round)));

            ceiling.creditSettlement(claimId);
        }

        conjured = ceiling.allowanceOf(FARM_CREATOR_ID) - before;
    }
}
