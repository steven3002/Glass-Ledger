// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {DebtLedger} from "../src/debt/DebtLedger.sol";
import {IDebtLedger} from "../src/interfaces/IDebtLedger.sol";
import {ISaleAuthorizer} from "../src/interfaces/ISaleAuthorizer.sol";
import {SaleGateway} from "../src/sale/SaleGateway.sol";
import {Allowance} from "../src/treasury/Allowance.sol";
import {Pool} from "../src/treasury/Pool.sol";
import {Types} from "../src/libs/Types.sol";
import {Fixture} from "./utils/Fixture.sol";

/// @notice The ceiling: risk can never outrun protection.
///
///         `outstanding <= pool + allowance`, checked inside the sale itself. Past the line the
///         contract stops authorizing custody sales — the scan at the counter reverts and no
///         certificate issues. The amount that can be at risk is capped, at every moment, by what
///         the pool and the operator's proven record can absorb.
///
/// @dev **The ceiling is a gate on new sales, not an invariant, and this suite is written that way
///      on purpose.** Three things raise exposure with nobody's authorization:
///
///      1. a voided instant claim (the rail's own assertion died, so money the operator swore it
///         never held is back in its hands);
///      2. a coverage lapse, which is the same thing arriving through the sweep;
///      3. a default, which converts a debt into a reimbursement occupying the same headroom.
///
///      So `outstanding <= pool + allowance` can be *transiently false*, and asserting otherwise
///      would be asserting something the protocol does not promise. What it promises is that the
///      next custody sale is refused — that is the assertion, and it is the one fuzzed here.
contract CeilingTest is Fixture {
    uint256 internal constant POOL_SKIM = 200_000e18;

    function setUp() public override {
        super.setUp();
        _fundPool(POOL_SKIM);
    }

    // --- The gate ---

    /// @notice A custody sale is authorized exactly when it fits, and refused exactly when it does
    ///         not — at every price, against every headroom.
    /// @dev The fuzz is over the two numbers that decide it: how much capacity there is, and how big
    ///      the sale is. The assertion is the gate itself — success iff `exposure <= headroom` — and
    ///      it is checked against the ceiling's own published numbers, so a bug that moved both would
    ///      have to move the sale's outcome too.
    function testFuzz_theGateAdmitsASaleExactlyWhenItFits(uint256 genesis, uint128 newPrice)
        public
    {
        genesis = bound(genesis, 0, 5_000_000e18);
        newPrice = uint128(bound(newPrice, 1e18, 1_000_000e18));

        // A fresh ceiling with the fuzzed capacity, wired to the same ledger and pool.
        Allowance fresh = new Allowance(operator, debts, genesis, GROWTH_BPS, WRITE_DOWN_MULTIPLE);
        vm.prank(operator);
        fresh.setPool(address(pool));

        uint64 anchor = items.tranche(trancheId).postedAt;
        vm.warp(anchor + 30);
        vm.prank(creator);
        prices.setPrice(itemIds[0], newPrice);
        vm.warp(anchor + PRICE_EPOCH);

        (uint256 creatorAmount, uint256 landlordAmount, uint256 communityAmount,) =
            _legs(newPrice, true);
        uint256 exposure = creatorAmount + landlordAmount + communityAmount;
        uint256 headroom = fresh.headroom();

        assertEq(headroom, POOL_SKIM + genesis); // nothing outstanding yet

        if (exposure <= headroom) {
            fresh.authorize(exposure, Types.Rail.CUSTODY);
        } else {
            vm.expectRevert(
                abi.encodeWithSelector(ISaleAuthorizer.OverCeiling.selector, exposure, headroom)
            );
            fresh.authorize(exposure, Types.Rail.CUSTODY);
        }

        // And whatever the capacity, the instant rail passes: the operator never held that money.
        fresh.authorize(exposure, Types.Rail.INSTANT);
    }

    /// @notice The instant rail consumes no ceiling, at any size, at any capacity.
    /// @dev This is what lets commerce work on day one at a genesis allowance of almost nothing —
    ///      and it is a property of the code path, not of a rail the operator gets to choose freely:
    ///      an instant sale asserts, in the same transaction, that the rail already paid these
    ///      parties, and that assertion is a claim it can be made to prove.
    function testFuzz_theInstantRailNeverConsumesTheCeiling(uint256 exposure) public view {
        ceiling.authorize(exposure, Types.Rail.INSTANT);
    }

    /// @notice Exposure rises with no authorization — and the ceiling's answer is to close the till.
    /// @dev The reason this suite refuses to assert `outstanding <= pool + allowance` as an
    ///      invariant. An instant sale consumed no headroom *because* the rail split the payment;
    ///      when the rail's own claim dies, that stops being true, and the debts come back into
    ///      custody at their original age. Nobody authorized that. Nobody could have.
    function test_aVoidedInstantClaimRaisesExposureWithNobodyAuthorizingIt() public {
        SaleGateway.SaleInput memory sale = _inputWithCommunity(0);

        vm.prank(operator);
        gateway.sellInstant(sale, CLAIM_REF);

        // The rail said it paid. The ceiling was not consulted, because there was nothing to hold.
        assertEq(debts.outstanding(), 0);
        assertEq(ceiling.used(), 0);
        assertEq(ceiling.headroom(), ceiling.ceiling());

        // The creator says she was never paid. The operator has no proof, because there was no
        // payment. The claim dies.
        uint256 claimId = 1;
        vm.prank(creator);
        debts.challenge(claimId);
        vm.warp(block.timestamp + RESPONSE_WINDOW + 1);
        debts.voidChallenged(claimId);

        // The money is back in the operator's hands, by the only measure that matters: it is owed,
        // and nobody has been paid. Exposure rose without a sale, and no invariant was violated —
        // because the protocol never promised one.
        (uint256 creatorAmount, uint256 landlordAmount, uint256 communityAmount,) =
            _legs(itemPrices[0], true);
        uint256 exposure = creatorAmount + landlordAmount + communityAmount;
        assertEq(debts.outstanding(), exposure);

        // And the till counts the lying fee too, from the second it is owed. A dead claim costs the
        // operator twice: the money it never paid is back on its books, and the fine for saying it
        // had is on them as well — unpaid, and therefore occupying the room it needs to sell again.
        uint256 fine = exposure * PENALTY_BPS / 10_000;
        assertEq(pool.penaltiesOutstanding(), fine);
        assertEq(ceiling.used(), exposure + fine);
        assertEq(ceiling.headroom(), ceiling.ceiling() - exposure - fine);
    }

    /// @notice The breach is real, it is transient, and the response is that the till closes.
    /// @dev Driven all the way to the state the invariant would forbid: used > ceiling, nothing
    ///      reverted, nothing was violated. The gate holds — a cash sale is refused, an instant sale
    ///      is not, and the headroom reads zero rather than going negative.
    function test_whenExposureOutrunsTheCeilingTheNextCashSaleIsRefused() public {
        SaleGateway.SaleInput memory first = _inputWithCommunity(0);
        SaleGateway.SaleInput memory second = _inputWithCommunity(1);

        vm.prank(operator);
        uint256[] memory debtIds = gateway.sellCash(first);

        // A default takes the pool's money and five times the debt off the allowance. Capacity falls
        // by ₦480,000-worth of the same arithmetic B.2 walks through.
        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);
        vm.prank(stranger);
        pool.touch(debtIds[0]);

        // Now put the second sale's exposure back on the books through the instant rail's back door:
        // sell instant, let the claim die. Exposure rises; nobody authorized it.
        vm.prank(operator);
        gateway.sellInstant(second, keccak256("a-rail-payment-that-never-happened"));

        uint256 railClaim = debts.claimCount(); // the cash sale posted none; this is the first
        vm.prank(creator);
        debts.challenge(railClaim);
        vm.warp(block.timestamp + RESPONSE_WINDOW + 1);
        debts.voidChallenged(railClaim);

        // The state the invariant would have forbidden. It is not an error. It is Tuesday.
        assertGt(ceiling.used(), ceiling.ceiling());
        assertEq(ceiling.headroom(), 0);

        // And the gate does the only thing a gate can do.
        SaleGateway.SaleInput memory third = _inputWithCommunity(2);
        (uint256 c, uint256 l, uint256 m,) = _legs(itemPrices[2], true);

        vm.expectRevert(abi.encodeWithSelector(ISaleAuthorizer.OverCeiling.selector, c + l + m, 0));
        vm.prank(operator);
        gateway.sellCash(third);

        vm.prank(operator);
        gateway.sellInstant(third, keccak256("a-rail-payment-that-did-happen"));
        assertEq(uint8(items.stateOf(itemIds[2])), uint8(Types.ItemState.SOLD));
    }

    /// @notice The genesis allowance is what opens the till on day one.
    /// @dev Without it a custody rail would open at a ceiling of exactly zero and stay there forever:
    ///      no sales, so no settled volume, so no growth, so no sales. It is the last number in this
    ///      protocol taken on faith, and the first cash sale is authorized against it.
    function test_theFirstCashSaleAuthorizesAgainstTheGenesisAllowanceAlone() public {
        SaleGateway.SaleInput memory sale = _inputWithCommunity(0);

        // The pool is what it is; take it out of the picture entirely by proving the sale fits under
        // the unearned threshold on its own.
        (uint256 c, uint256 l, uint256 m,) = _legs(itemPrices[0], true);
        assertLe(c + l + m, GENESIS_ALLOWANCE);
        assertEq(ceiling.allowance(), GENESIS_ALLOWANCE);
        assertEq(ceiling.genesisAllowance(), GENESIS_ALLOWANCE);

        vm.prank(operator);
        gateway.sellCash(sale);
        assertEq(debts.outstanding(), c + l + m);
    }

    // --- Growth ---

    /// @notice Capacity is earned by evidence, never by silence.
    /// @dev A claim that settled because nobody challenged it is not yet worth anything: it can still
    ///      die at its coverage deadline. Only a *proven* claim — one with evidence on-chain — grows
    ///      the allowance, and a proven claim is terminal, so growth once credited can never need to
    ///      be taken back. There is no reversal path in this contract because there is nothing to
    ///      reverse.
    function test_growthIsCreditedOnProvenClaimsAndNotOnSettledOnes() public {
        (, uint256 claimId) = _cashClaim();

        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);
        debts.settleClaim(claimId);
        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.SETTLED));

        // Settled on silence. Worth nothing yet.
        vm.expectRevert(
            abi.encodeWithSelector(
                Allowance.ClaimNotProven.selector, claimId, Types.ClaimState.SETTLED
            )
        );
        ceiling.creditSettlement(claimId);
        assertEq(ceiling.allowance(), GENESIS_ALLOWANCE);

        // The sweep puts the evidence on-chain. Now it is worth something.
        _setVerdict(claimId, true);
        uint256[] memory claimIds = new uint256[](1);
        claimIds[0] = claimId;
        vm.prank(operator);
        sweep.attest(claimIds, hex"c0ffee", keccak256("blob"));

        uint256 settledValue = debts.claim(claimId).totalAmount;
        uint256 growth = ceiling.creditSettlement(claimId);

        assertEq(growth, settledValue * GROWTH_BPS / 10_000);
        assertEq(ceiling.allowance(), GENESIS_ALLOWANCE + growth);

        // And it is earned once.
        vm.expectRevert(abi.encodeWithSelector(Allowance.AlreadyCredited.selector, claimId));
        ceiling.creditSettlement(claimId);
    }

    /// @notice A lie that outlives the challenge window is worth nothing while it lives.
    /// @dev The sleeping recipient's claim settles on day 7 and dies on day 16. If settling had
    ///      earned capacity, the operator would have had nine days of capacity it never earned, and
    ///      the ledger would have had to take it back. It never earns it, so there is nothing to take
    ///      back — the whole class of bug is structurally absent.
    function test_aClaimThatSettlesAndThenDiesNeverEarnedAnything() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();

        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);
        debts.settleClaim(claimId);
        assertEq(debts.outstanding(), 0);

        // No sweep ever covers it. At the coverage deadline it dies, and the debts come back.
        vm.warp(sweep.coverageDeadline(claimId) + 1);
        vm.prank(stranger);
        sweep.touch(claimId);

        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.VOIDED));
        assertEq(uint8(debts.debt(ids[0]).state), uint8(Types.DebtState.AGING));
        assertEq(ceiling.allowance(), GENESIS_ALLOWANCE);

        vm.expectRevert(
            abi.encodeWithSelector(
                Allowance.ClaimNotProven.selector, claimId, Types.ClaimState.VOIDED
            )
        );
        ceiling.creditSettlement(claimId);
    }

    /// @notice Growth is earned globally: the instant rail grows the allowance the cash rail spends.
    /// @dev Honest settled volume on any rail grows the single allowance number, and each custody
    ///      channel's ceiling draws on it. Were it earned only inside the channel it limits, a zero
    ///      ceiling would permit no sales, no sales would settle no volume, and the cash channel
    ///      could never bootstrap.
    function test_anInstantSaleGrowsTheAllowanceTheCashRailWillSpend() public {
        SaleGateway.SaleInput memory sale = _inputWithCommunity(0);

        vm.prank(operator);
        gateway.sellInstant(sale, CLAIM_REF);
        assertEq(ceiling.used(), 0); // consumed no ceiling

        uint256 claimId = 1;
        _setVerdict(claimId, true);
        uint256[] memory claimIds = new uint256[](1);
        claimIds[0] = claimId;
        vm.prank(operator);
        sweep.attest(claimIds, hex"c0ffee", keccak256("blob"));

        (uint256 c, uint256 l, uint256 m,) = _legs(itemPrices[0], true);
        uint256 growth = ceiling.creditSettlement(claimId);

        assertEq(growth, (c + l + m) * GROWTH_BPS / 10_000);
        assertEq(ceiling.allowance(), GENESIS_ALLOWANCE + growth);
        assertEq(ceiling.headroom(), POOL_SKIM + GENESIS_ALLOWANCE + growth);
    }

    /// @dev The operator's own leg is `RETAINED` at mint, so it is never in a claim and never in the
    ///      value a claim settles. Paying yourself proves nothing and earns nothing.
    function test_theOperatorsOwnLegIsNeverSettledValue() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();

        assertEq(debts.claimDebts(claimId).length, 3);
        assertEq(uint8(debts.debt(ids[3]).state), uint8(Types.DebtState.RETAINED));

        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);
        debts.settleClaim(claimId);
        _setVerdict(claimId, true);

        uint256[] memory claimIds = new uint256[](1);
        claimIds[0] = claimId;
        vm.prank(operator);
        sweep.attest(claimIds, hex"c0ffee", keccak256("blob"));

        (uint256 c, uint256 l, uint256 m, uint256 own) = _legs(SALE_PRICE, true);
        uint256 growth = ceiling.creditSettlement(claimId);

        // The growth is 1% of what was paid to other people, and Good's own 12.5% is not in it.
        assertEq(growth, (c + l + m) * GROWTH_BPS / 10_000);
        assertLt(growth, (c + l + m + own) * GROWTH_BPS / 10_000);
    }
}
