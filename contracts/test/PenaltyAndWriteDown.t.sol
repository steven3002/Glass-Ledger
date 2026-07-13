// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {DebtLedger} from "../src/debt/DebtLedger.sol";
import {IDebtLedger} from "../src/interfaces/IDebtLedger.sol";
import {SweepRegistry} from "../src/debt/SweepRegistry.sol";
import {IProofVerifier} from "../src/oracle/IProofVerifier.sol";
import {StubProofVerifier} from "../src/oracle/StubProofVerifier.sol";
import {Allowance} from "../src/treasury/Allowance.sol";
import {MockNGN} from "../src/treasury/MockNGN.sol";
import {Pool} from "../src/treasury/Pool.sol";
import {Types} from "../src/libs/Types.sol";

/// @notice Appendix B.2 — penalty versus write-down: two ledgers, one incident.
///
///         The worked example, at the numbers it is worked at. The operator stalls on an ₦80,000
///         debt exactly as it does in the stall attempt, and this suite follows the money out the
///         other side: what the lying fee costs, what the default costs, what the two of them do to
///         the ceiling, and what paying up four days late does and does not undo.
///
///         The point of the example is the asymmetry. The fee for lying is ₦800. The consequence of
///         not paying is that ₦480,000 of capacity disappears — six hundred times the fee, for a
///         debt six thousand times smaller than the ceiling it just cost. Nothing was confiscated,
///         because nothing was ever deposited. What was revoked was the right to hold other people's
///         money, and it is revoked by arithmetic.
///
/// @dev Run at the reference windows (T+3 settlement, 5-day challenge, 3-day response) rather than
///      the demo's minutes, so the days in the worked example are the days in this test.
contract PenaltyAndWriteDownTest is Test {
    uint32 internal constant SETTLEMENT_WINDOW = 3 days;
    uint32 internal constant CHALLENGE_WINDOW = 5 days;
    uint32 internal constant RESPONSE_WINDOW = 3 days;
    uint32 internal constant COVERAGE_WINDOW = 14 days;
    uint16 internal constant PENALTY_BPS = 100; // 1% of the claimed amount
    uint16 internal constant GROWTH_BPS = 100; // +1% of proven settled value
    uint8 internal constant WRITE_DOWN_MULTIPLE = 5;

    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 internal constant CURRENCY = bytes32("NGN");
    bytes32 internal constant CLAIM_REF = keccak256("the-payment-that-never-happened");
    bytes32 internal constant HONEST_REF = keccak256("a-payment-that-really-happened");
    bytes internal constant PROOF = hex"c0ffee";

    // The state before the incident, and the debt that causes it.
    uint256 internal constant POOL_BEFORE = 300_000e18;
    uint256 internal constant ALLOWANCE_BEFORE = 2_000_000e18;
    uint256 internal constant CREATOR_DEBT = 80_000e18;

    // What the incident costs, to the naira.
    uint256 internal constant PENALTY = 800e18; // 1% of ₦80,000
    uint256 internal constant PENALTY_HALF = 400e18; // half to the creator, half to the pool
    uint256 internal constant WRITE_DOWN = 400_000e18; // 5 × ₦80,000
    uint256 internal constant POOL_AFTER = 220_400e18; // 300,000 + 400 − 80,000
    uint256 internal constant ALLOWANCE_AFTER = 1_600_000e18; // 2,000,000 − 400,000
    uint256 internal constant CEILING_AFTER = 1_820_400e18; // and the new ceiling
    uint256 internal constant HEADROOM_LOST = 480_000e18; // what one ₦80,000 debt cost

    /// @notice Whose goods. One creator, which is what a worked example is: capacity is bilateral now,
    ///         and a single-creator deployment is the case in which nothing about it is visible. These
    ///         numbers must therefore be exactly the numbers they always were.
    uint256 internal constant CREATOR_ID = 1;

    uint256 internal constant SALE_REF = 1001;
    uint256 internal constant LATER_SALE = 1002;

    address internal operator;
    address internal stranger;
    address internal creator;
    address internal landlord;

    DebtLedger internal debts;
    SweepRegistry internal sweep;
    StubProofVerifier internal proofs;
    MockNGN internal ngn;
    Allowance internal ceiling;
    Pool internal pool;

    uint256 internal day0;
    uint256 internal creatorDebtId;
    uint256 internal claimId;

    function setUp() public {
        operator = makeAddr("operator");
        stranger = makeAddr("stranger");
        creator = makeAddr("creator");
        landlord = makeAddr("landlord");

        proofs = new StubProofVerifier(operator);
        debts = new DebtLedger(
            operator, proofs, SETTLEMENT_WINDOW, CHALLENGE_WINDOW, RESPONSE_WINDOW, PENALTY_BPS
        );
        sweep = new SweepRegistry(operator, debts, COVERAGE_WINDOW);
        ngn = new MockNGN(operator);
        ceiling = new Allowance(operator, debts, ALLOWANCE_BEFORE, GROWTH_BPS, WRITE_DOWN_MULTIPLE);
        pool = new Pool(operator, ngn, CURRENCY, debts, ceiling);

        vm.startPrank(operator);
        debts.setSaleGateway(address(this)); // this suite stands in for the sale path
        debts.setPool(address(pool));
        debts.setSweepRegistry(address(sweep));
        ceiling.setPool(address(pool));
        ngn.mint(operator, 10_000_000e18);
        ngn.approve(address(pool), type(uint256).max);
        pool.depositSkim(SALE_REF, POOL_BEFORE);
        vm.stopPrank();

        vm.startPrank(creator);
        debts.setAccountHash(CURRENCY, keccak256("creator-bank-account"));
        vm.stopPrank();

        vm.prank(landlord);
        debts.setAccountHash(CURRENCY, keccak256("landlord-bank-account"));

        vm.warp(30 days);
        day0 = block.timestamp;

        // Day 0: the cash sale. One creator debt of ₦80,000, due on day 3.
        creatorDebtId = _mint(SALE_REF, creator, CREATOR_DEBT);
    }

    // --- Helpers ---

    function _mint(uint256 saleRef, address recipient, uint256 amount)
        internal
        returns (uint256 debtId)
    {
        IDebtLedger.Leg[] memory legs = new IDebtLedger.Leg[](1);
        legs[0] = IDebtLedger.Leg(Types.Role.CREATOR, recipient, amount);
        uint256[] memory ids = debts.mintSaleDebts(
            saleRef, CREATOR_ID, Types.Rail.CUSTODY, CURRENCY, legs, bytes32(0)
        );
        return ids[0];
    }

    function _claim(uint256 debtId, bytes32 refHash) internal returns (uint256 id) {
        uint256[] memory ids = new uint256[](1);
        ids[0] = debtId;
        vm.prank(operator);
        return debts.postClaim(ids, refHash);
    }

    /// @dev Read the statement before arming the prank: an argument that makes its own call would
    ///      spend the impersonation on the read and leave the write to the test contract.
    function _sweepCovers(uint256 id) internal {
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;

        IProofVerifier.Statement memory statement = debts.statementOf(id);
        vm.prank(operator);
        proofs.setVerdict(statement, true);

        vm.prank(operator);
        sweep.attest(ids, PROOF, keccak256("attestation-blob"));
    }

    /// @dev Settles a claim the second after its challenge window closes, and proves it in the sweep.
    function _settleAndProve(uint256 id) internal {
        vm.warp(debts.claim(id).challengeDeadline + 1);
        debts.settleClaim(id);
        _sweepCovers(id);
    }

    /// @dev The day, counted from the sale. A deadline is met on the second it falls, so the events
    ///      that a window's *expiry* causes land on the second after it.
    function _day(uint256 n) internal view returns (uint256) {
        return day0 + n * 1 days;
    }

    /// @dev The incident of B.1, replayed to the point where the money moves: a fake claim on day 2,
    ///      challenged the same day, unanswered, dead on day 5 — with the debt already past its
    ///      deadline when it comes back.
    function _theIncident() internal {
        vm.warp(_day(2));
        claimId = _claim(creatorDebtId, CLAIM_REF);

        vm.prank(creator);
        debts.challenge(claimId);

        vm.warp(_day(5) + 1);
        debts.voidChallenged(claimId);
    }

    // --- The example ---

    /// @notice B.2, whole: ₦800 of penalty, ₦480,000 of capacity.
    function test_theIncidentCostsEightHundredInFeesAndHalfAMillionInCapacity() public {
        // Before: pool ₦300,000, allowance ₦2,000,000, ceiling ₦2,300,000 of permissible debt.
        assertEq(pool.balance(), POOL_BEFORE);
        assertEq(ceiling.allowanceOf(CREATOR_ID), ALLOWANCE_BEFORE);
        assertEq(ceiling.ceiling(), POOL_BEFORE + ALLOWANCE_BEFORE);
        assertEq(ceiling.used(), CREATOR_DEBT);

        _theIncident();

        // 1. The void penalty: 1% × ₦80,000 = ₦800 — ₦400 to the creator, ₦400 to the pool. The
        //    lying fee is small, escalating, and entirely separate from what follows. It is owed by
        //    the operator, and anyone may collect it on the wronged party's behalf.
        assertEq(debts.penaltyOwed(creator, CURRENCY), PENALTY_HALF);
        assertEq(debts.poolPenaltyOwed(CURRENCY), PENALTY_HALF);
        assertEq(pool.penaltyDue(creator), PENALTY_HALF);
        assertEq(pool.poolDuesOwed(), PENALTY_HALF);

        vm.startPrank(stranger);
        pool.collectPenalty(creator);
        pool.collectPoolDues();
        vm.stopPrank();

        assertEq(ngn.balanceOf(creator), PENALTY_HALF);
        assertEq(pool.balance(), POOL_BEFORE + PENALTY_HALF);
        assertEq(PENALTY_HALF * 2, PENALTY);

        uint256 headroomBefore = ceiling.headroom();

        // 2. The default, the same day: the pool pays the creator ₦80,000 in full, and the allowance
        //    takes five times that off the top.
        assertTrue(debts.isDefaultable(creatorDebtId));
        vm.prank(stranger);
        pool.touch(creatorDebtId);

        assertEq(ngn.balanceOf(creator), CREATOR_DEBT + PENALTY_HALF);
        assertEq(pool.balance(), POOL_AFTER); // 300,000 + 400 − 80,000 = ₦220,400
        assertEq(ceiling.allowanceOf(CREATOR_ID), ALLOWANCE_AFTER); // 2,000,000 − 400,000 = ₦1,600,000
        assertEq(ceiling.ceiling(), CEILING_AFTER); // ₦1,820,400
        assertEq(WRITE_DOWN, WRITE_DOWN_MULTIPLE * CREATOR_DEBT);

        // Headroom fell by ₦480,000 over one ₦80,000 debt. That asymmetry is the deterrent — and it
        // is exactly the pool's outlay plus the write-down, with the debt itself counted once: it
        // left `outstanding()` the moment it defaulted and reappeared as a reimbursement.
        assertEq(headroomBefore - ceiling.headroom(), HEADROOM_LOST);
        assertEq(debts.outstanding(), 0);
        assertEq(pool.reimbursementOutstanding(), CREATOR_DEBT);
        assertEq(ceiling.used(), CREATOR_DEBT);
    }

    /// @notice Paying late reimburses the pool. It does not un-default the debt.
    function test_payingLateRestoresThePoolAndNotTheWriteDown() public {
        _theIncident();

        vm.startPrank(stranger);
        pool.collectPenalty(creator);
        pool.collectPoolDues();
        vm.stopPrank();

        vm.prank(stranger);
        pool.touch(creatorDebtId);

        // Day 9: the operator pays. The creator is already whole, so the ₦80,000 goes to the pool.
        vm.warp(_day(9));
        vm.prank(operator);
        pool.reimburse(CREATOR_DEBT);

        assertEq(pool.balance(), POOL_AFTER + CREATOR_DEBT); // ₦300,400
        assertEq(pool.reimbursementOutstanding(), 0);
        assertFalse(ceiling.frozen());

        // The write-down stands. There is no payment that retroactively un-defaults a debt, and the
        // debt itself is terminal: the recipient's entitlement was closed when the pool paid it.
        assertEq(ceiling.allowanceOf(CREATOR_ID), ALLOWANCE_AFTER);
        assertEq(uint8(debts.debt(creatorDebtId).state), uint8(Types.DebtState.DEFAULTED));

        // Capacity heals only the way it was built. The ceiling is back to ₦1,900,400 — the pool
        // whole, the allowance still short by ₦400,000.
        assertEq(ceiling.ceiling(), POOL_AFTER + CREATOR_DEBT + ALLOWANCE_AFTER);
        assertEq(ceiling.headroom(), ceiling.ceiling());
    }

    /// @notice Days 5 to 9: commerce continues, and none of it earns anything.
    /// @dev The freeze is the sharpest edge of the design and the easiest to get wrong. It punishes
    ///      the operator's *growth*, never the participants' *income*: the sale below still happens,
    ///      the creator is still paid, her claim still settles and is still proven. What it earns the
    ///      operator is nothing at all — and when the freeze lifts, it is not counted retroactively.
    ///      Forfeited, not banked.
    function test_growthDuringTheFreezeIsForfeitedNotBanked() public {
        _theIncident();
        vm.prank(stranger);
        pool.touch(creatorDebtId);
        assertTrue(ceiling.frozen());

        // Day 5: a sale the operator settles honestly, under the reduced ceiling.
        uint256 honestDebt = _mint(LATER_SALE, landlord, 100_000e18);
        uint256 honestClaim = _claim(honestDebt, HONEST_REF);

        // Day 10: the challenge window closes, nobody having tested it, and the sweep proves it.
        // The value settled while the pool was short — it earns nothing, and the attempt to collect
        // it says exactly why.
        _settleAndProve(honestClaim);
        assertEq(uint8(debts.claim(honestClaim).state), uint8(Types.ClaimState.PROVEN));

        vm.expectRevert(
            abi.encodeWithSelector(Allowance.GrowthFrozen.selector, honestClaim, CREATOR_DEBT)
        );
        ceiling.creditSettlement(honestClaim);

        // The operator squares the pool. The freeze lifts — prospectively.
        vm.prank(operator);
        pool.reimburse(CREATOR_DEBT);
        assertFalse(ceiling.frozen());
        assertEq(ceiling.healingSince(), uint64(block.timestamp));

        // And the volume that settled during the freeze is still worth nothing. It was forfeited
        // when it settled, and the thaw does not reach backwards to collect it.
        vm.expectRevert(
            abi.encodeWithSelector(
                Allowance.GrowthForfeited.selector,
                honestClaim,
                debts.claim(honestClaim).challengeDeadline,
                ceiling.healingSince()
            )
        );
        ceiling.creditSettlement(honestClaim);
        assertEq(ceiling.allowanceOf(CREATOR_ID), ALLOWANCE_AFTER);
    }

    /// @notice Healing is prospective, and it is slow by construction.
    /// @dev Re-earning the ₦400,000 the write-down cost takes ₦40,000,000 of cleanly settled volume
    ///      at +1%. One afternoon of games; a long climb back.
    function test_healingResumesFromTheDayThePoolIsSquared() public {
        _theIncident();
        vm.prank(stranger);
        pool.touch(creatorDebtId);

        vm.warp(_day(9));
        vm.prank(operator);
        pool.reimburse(CREATOR_DEBT);

        // A sale settled *after* the pool was squared. This one counts.
        uint256 settled = 100_000e18;
        uint256 debtId = _mint(LATER_SALE, landlord, settled);
        uint256 id = _claim(debtId, HONEST_REF);
        _settleAndProve(id);

        uint256 growth = ceiling.creditSettlement(id);
        assertEq(growth, settled * GROWTH_BPS / 10_000);
        assertEq(ceiling.allowanceOf(CREATOR_ID), ALLOWANCE_AFTER + growth);

        // The arithmetic of the climb: at +1% of settled volume, the ₦400,000 that vanished in one
        // block needs ₦40,000,000 of honest, proven settlement to come back.
        assertEq(WRITE_DOWN * 10_000 / GROWTH_BPS, 40_000_000e18);
    }
}
