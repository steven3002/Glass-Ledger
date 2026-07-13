// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {DebtLedger} from "../src/debt/DebtLedger.sol";
import {IDebtLedger} from "../src/interfaces/IDebtLedger.sol";
import {Types} from "../src/libs/Types.sol";
import {StubProofVerifier} from "../src/oracle/StubProofVerifier.sol";

/// @notice The stall attempt, on the clock.
///
///         The operator sells for cash on day 0 and does not pay the creator. It then tries to buy
///         time with a claim it cannot support. This suite is the arithmetic of what that costs
///         it, run against the settlement parameters the protocol is specified at rather than the
///         compressed ones a demo uses: a cash debt due on day 3, a five-day window in which the
///         recipient may test a claim, and three days for the operator to answer a test.
///
/// @dev The property under test is that stalling is *worse than doing nothing*, and that it can be
///      tried at most once. Both fall out of a single fact: the debt's clock never paused, so a
///      claim that dies hands back a debt that is already late.
contract StallAttemptTest is Test {
    uint32 internal constant SETTLEMENT_WINDOW = 3 days;
    uint32 internal constant CHALLENGE_WINDOW = 5 days;
    uint32 internal constant RESPONSE_WINDOW = 3 days;
    uint16 internal constant PENALTY_BPS = 100; // 1%

    // The currency is a tag, not a number: a short ISO code widened into a word.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 internal constant CURRENCY = bytes32("NGN");
    bytes32 internal constant CLAIM_REF = keccak256("the-payment-that-never-happened");
    bytes internal constant PROOF = hex"c0ffee";

    uint256 internal constant SALE = 100_000e18;
    uint256 internal constant CREATOR_DEBT = 80_000e18;
    uint256 internal constant PENALTY = 800e18; // 1% of the claimed amount
    uint256 internal constant ITEM = 1001;

    /// @notice Whose goods. One creator, which is what a worked example is: capacity is bilateral
    ///         now, and a single-creator deployment is the case in which none of that is visible.
    ///         These numbers must therefore be exactly the numbers they always were.
    uint256 internal constant CREATOR_ID = 1;

    address internal operator;
    address internal pool;
    address internal stranger;
    address internal creator;
    uint256 internal creatorKey;

    DebtLedger internal debts;
    StubProofVerifier internal proofs;

    uint256 internal day0;

    function setUp() public {
        operator = makeAddr("operator");
        pool = makeAddr("pool");
        stranger = makeAddr("stranger");
        (creator, creatorKey) = makeAddrAndKey("creator");

        proofs = new StubProofVerifier(operator);
        debts = new DebtLedger(
            operator, proofs, SETTLEMENT_WINDOW, CHALLENGE_WINDOW, RESPONSE_WINDOW, PENALTY_BPS
        );

        vm.startPrank(operator);
        debts.setSaleGateway(address(this)); // this suite stands in for the sale path
        debts.setPool(pool);
        vm.stopPrank();

        vm.prank(creator);
        debts.setAccountHash(CURRENCY, keccak256("creator-bank-account"));

        vm.warp(30 days);
        day0 = block.timestamp;
    }

    function _day(uint256 n) internal view returns (uint256) {
        return day0 + n * 1 days;
    }

    /// @dev A cash sale: the operator has the buyer's money and owes the creator 80% of it.
    function _sellForCash() internal returns (uint256 debtId) {
        IDebtLedger.Leg[] memory legs = new IDebtLedger.Leg[](1);
        legs[0] = IDebtLedger.Leg(Types.Role.CREATOR, creator, CREATOR_DEBT);

        uint256[] memory ids =
            debts.mintSaleDebts(ITEM, CREATOR_ID, Types.Rail.CUSTODY, CURRENCY, legs, bytes32(0));
        debtId = ids[0];
    }

    function _postClaim(uint256 debtId) internal returns (uint256 claimId) {
        uint256[] memory ids = new uint256[](1);
        ids[0] = debtId;
        vm.prank(operator);
        claimId = debts.postClaim(ids, CLAIM_REF);
    }

    // --- The stall ---

    /// @dev Day 0 mint, day 2 fake claim, day 2 challenge, day 5 void. The debt comes back at the
    ///      age it always had — five days old against a three-day deadline — so it is in default
    ///      the instant the lie dies.
    function test_theStallBuysTwoDaysOfDelayAndPaysAPenaltyForThem() public {
        uint256 debtId = _sellForCash();
        assertEq(debts.debt(debtId).deadline, _day(3));

        // Day 2: the operator claims to have paid, and the creator's phone finds no credit.
        vm.warp(_day(2));
        uint256 claimId = _postClaim(debtId);
        assertEq(uint8(debts.debt(debtId).state), uint8(Types.DebtState.PROVISIONAL));

        vm.prank(creator);
        debts.challenge(claimId);
        assertEq(debts.claim(claimId).responseDeadline, _day(5));

        // Day 3: the deadline passes while the claim is under test. Default is held off — but only
        // held off, and only while the operator's own clock is still running.
        vm.warp(_day(3) + 1);
        assertFalse(debts.isDefaultable(debtId));

        // Day 5: no proof was ever produced. Anyone may say so.
        vm.warp(_day(5) + 1);
        vm.prank(stranger);
        debts.voidChallenged(claimId);

        IDebtLedger.Debt memory owed = debts.debt(debtId);
        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.VOIDED));
        assertEq(uint8(owed.state), uint8(Types.DebtState.AGING));

        // The clock never moved: mint date and deadline are exactly what they were on day 0.
        assertEq(owed.mintedAt, day0);
        assertEq(owed.deadline, _day(3));
        assertTrue(debts.isDefaultable(debtId));

        // The lying fee: 1% of the claimed amount, half to the creator and half to the pool.
        assertEq(debts.penaltyOwed(creator, CURRENCY), PENALTY / 2);
        assertEq(debts.poolPenaltyOwed(CURRENCY), PENALTY / 2);

        // The default the operator delayed by two days now executes, on anyone's touch.
        vm.prank(pool);
        debts.markDefaulted(debtId);
        assertEq(uint8(debts.debt(debtId).state), uint8(Types.DebtState.DEFAULTED));
        assertEq(debts.outstanding(), 0);
    }

    /// @dev Doing nothing at all defaults on day 3. The stall defaults on day 5. The two days it
    ///      bought are the length of the tests it forced, and it paid a penalty for them — which is
    ///      the whole point: the cheapest way to delay a default is not to lie about it.
    function test_doingNothingDefaultsEarlierThanStalling() public {
        // Two identical debts of the same sale day, treated differently.
        uint256 idle = _sellForCash();
        uint256 stalled = _sellForCash();

        vm.warp(_day(2));
        uint256 claimId = _postClaim(stalled);
        vm.prank(creator);
        debts.challenge(claimId);

        vm.warp(_day(3));
        assertFalse(debts.isDefaultable(idle)); // the deadline is met on the second it falls

        // Day 3: the debt nobody lied about is already in default. The stalled one is not — that
        // is the entire prize, and it lasts exactly as long as the tests the lie forced.
        vm.warp(_day(3) + 1);
        assertTrue(debts.isDefaultable(idle));
        assertFalse(debts.isDefaultable(stalled));

        vm.warp(_day(5) + 1);
        debts.voidChallenged(claimId);
        assertTrue(debts.isDefaultable(stalled));

        // Two days bought, at the price of a penalty the idle debt never paid.
        assertEq(debts.penaltyOwed(creator, CURRENCY), PENALTY / 2);
    }

    /// @dev There is no second cycle. A defaulted debt accepts no claims, so the operator gets one
    ///      stall per deadline and it is the last thing it ever does to that debt.
    function test_atMostOneStallPerDeadline() public {
        uint256 debtId = _sellForCash();

        vm.warp(_day(2));
        uint256 first = _postClaim(debtId);
        vm.prank(creator);
        debts.challenge(first);

        vm.warp(_day(5) + 1);
        debts.voidChallenged(first);

        // A second claim, before anyone touches the default, only walks into the same trap: the
        // debt is already past its deadline, so the void lands late again — and it costs double.
        uint256 second = _postClaim(debtId);
        vm.prank(creator);
        debts.challenge(second);

        vm.warp(_day(8) + 2);
        debts.voidChallenged(second);
        assertEq(debts.penaltyOwed(creator, CURRENCY), PENALTY / 2 + PENALTY); // 1% then 2%
        assertTrue(debts.isDefaultable(debtId));

        // And once the default is executed, nothing attaches to it ever again.
        vm.prank(pool);
        debts.markDefaulted(debtId);

        uint256[] memory ids = new uint256[](1);
        ids[0] = debtId;
        vm.expectRevert(
            abi.encodeWithSelector(
                DebtLedger.DebtNotClaimable.selector, debtId, Types.DebtState.DEFAULTED
            )
        );
        vm.prank(operator);
        debts.postClaim(ids, CLAIM_REF);
    }

    /// @dev The general fact the table demonstrates: on a short rail a voided challenge lands past
    ///      the deadline *by construction*. Even the most favourable stall available — claim on day
    ///      0, challenged the same instant, the operator's full response window to answer — expires
    ///      after the debt was already due.
    function test_aVoidedChallengeAlwaysLandsPastTheDeadline() public {
        uint256 debtId = _sellForCash();

        uint256 claimId = _postClaim(debtId); // day 0: the earliest a claim can possibly exist
        vm.prank(creator);
        debts.challenge(claimId);

        uint64 responseDeadline = debts.claim(claimId).responseDeadline;
        uint64 debtDeadline = debts.debt(debtId).deadline;
        assertGe(responseDeadline, debtDeadline);

        vm.warp(responseDeadline + 1);
        debts.voidChallenged(claimId);
        assertTrue(debts.isDefaultable(debtId));
    }

    // --- The other three worlds ---

    /// @dev Honest, and nobody says anything: silence ratifies the claim when its window closes.
    function test_theHonestPathSettlesOnSilence() public {
        uint256 debtId = _sellForCash();

        vm.warp(_day(2));
        uint256 claimId = _postClaim(debtId);

        vm.warp(_day(7) + 1); // claim + five days
        vm.prank(stranger);
        debts.settleClaim(claimId);

        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.SETTLED));
        assertEq(uint8(debts.debt(debtId).state), uint8(Types.DebtState.SETTLED));
        assertEq(debts.outstanding(), 0);
        assertEq(debts.voidCount(), 0);
        assertEq(debts.penaltyOwed(creator, CURRENCY), 0);
    }

    /// @dev The reverse attack: the creator challenges *despite having been paid*. The operator was
    ///      honest, so the transfer exists and the proof lands inside the response window. The false
    ///      challenge achieves nothing — and costs the creator nothing either, which is deliberate:
    ///      a recipient must never be afraid to ask.
    function test_aFrivolousChallengeAchievesNothing() public {
        uint256 debtId = _sellForCash();

        vm.warp(_day(2));
        uint256 claimId = _postClaim(debtId);

        vm.prank(creator);
        debts.challenge(claimId);

        vm.warp(_day(3));
        vm.startPrank(operator);
        proofs.setVerdict(debts.statementOf(claimId), true);
        debts.respond(claimId, PROOF);
        vm.stopPrank();

        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.PROVEN));
        assertEq(uint8(debts.debt(debtId).state), uint8(Types.DebtState.PROVEN));
        assertEq(debts.outstanding(), 0);
        assertEq(debts.voidCount(), 0);

        vm.warp(_day(30));
        assertFalse(debts.isDefaultable(debtId));
    }

    /// @dev A recipient with no gas token is still a recipient. The signature is the gate; who pays
    ///      for the transaction is nobody's business.
    function test_theChallengeNeedsNoGasOfItsOwn() public {
        uint256 debtId = _sellForCash();

        vm.warp(_day(2));
        uint256 claimId = _postClaim(debtId);

        bytes32 structHash = keccak256(abi.encode(debts.CHALLENGE_TYPEHASH(), claimId, creator));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("Glass Ledger")),
                keccak256(bytes("1")),
                block.chainid,
                address(debts)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(creatorKey, keccak256(abi.encodePacked(hex"1901", domain, structHash)));

        vm.deal(creator, 0);
        vm.prank(stranger);
        debts.challengeFor(claimId, creator, abi.encodePacked(r, s, v));

        vm.warp(_day(5) + 1);
        debts.voidChallenged(claimId);
        assertTrue(debts.isDefaultable(debtId));
    }
}
