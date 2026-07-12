// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {DebtLedger} from "../src/debt/DebtLedger.sol";
import {SweepRegistry} from "../src/debt/SweepRegistry.sol";
import {IDebtLedger} from "../src/interfaces/IDebtLedger.sol";
import {IProofVerifier} from "../src/oracle/IProofVerifier.sol";
import {StubProofVerifier} from "../src/oracle/StubProofVerifier.sol";
import {Types} from "../src/libs/Types.sol";

/// @notice The sweep as the second test — the sleeping recipient.
///
///         Two cash debts, minted the same day, claimed the same day, and neither one ever
///         challenged. One recipient's phone matched the credit and she had nothing to say. The
///         other recipient is asleep with a dead phone, and was never paid at all.
///
///         The challenge would have caught the second one — if anybody had been awake to send it.
///         Nobody was. This suite is what happens anyway.
///
/// @dev The two tests are independent, and that is the whole point of the ratchet: claim B *passes*
///      its challenge window, is marked settled by the silence of a recipient who never saw it, and
///      still dies fourteen days after it was posted, because silence was never evidence. Run at the
///      windows the protocol is specified at — settlement T+3, challenge 5 days, response 3 days,
///      coverage 14 days — not the compressed ones a demo uses.
contract SleepingRecipientTest is Test {
    uint32 internal constant SETTLEMENT_WINDOW = 3 days;
    uint32 internal constant CHALLENGE_WINDOW = 5 days;
    uint32 internal constant RESPONSE_WINDOW = 3 days;
    uint32 internal constant COVERAGE_WINDOW = 14 days;
    uint16 internal constant PENALTY_BPS = 100; // 1%

    // The currency is a tag, not a number: a short ISO code widened into a word.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 internal constant CURRENCY = bytes32("NGN");
    bytes32 internal constant REF_A = keccak256("the-payment-that-happened");
    bytes32 internal constant REF_B = keccak256("the-payment-that-never-happened");

    bytes internal constant EVIDENCE = hex"c0ffee";
    bytes32 internal constant POINTER = keccak256("storage-root-of-the-weekly-attestation");

    uint256 internal constant DEBT = 80_000e18;
    uint256 internal constant PENALTY = 800e18; // 1% of the claimed amount

    address internal operator;
    address internal pool;
    address internal stranger;
    address internal alert; // her phone matched the credit
    address internal sleeper; // dead phone, and never paid

    DebtLedger internal debts;
    StubProofVerifier internal proofs;
    SweepRegistry internal sweep;

    uint256 internal day0;

    function setUp() public {
        operator = makeAddr("operator");
        pool = makeAddr("pool");
        stranger = makeAddr("stranger");
        alert = makeAddr("alert");
        sleeper = makeAddr("sleeper");

        proofs = new StubProofVerifier(operator);
        debts = new DebtLedger(
            operator, proofs, SETTLEMENT_WINDOW, CHALLENGE_WINDOW, RESPONSE_WINDOW, PENALTY_BPS
        );
        sweep = new SweepRegistry(operator, debts, COVERAGE_WINDOW);

        vm.startPrank(operator);
        debts.setSaleGateway(address(this)); // this suite stands in for the sale path
        debts.setPool(pool);
        debts.setSweepRegistry(address(sweep));
        vm.stopPrank();

        // Onboarding, before the story starts: both recipients say where they are to be paid.
        vm.prank(alert);
        debts.setAccountHash(CURRENCY, keccak256("alert-bank-account"));
        vm.prank(sleeper);
        debts.setAccountHash(CURRENCY, keccak256("sleeper-bank-account"));

        vm.warp(30 days);
        day0 = block.timestamp;
    }

    function _day(uint256 n) internal view returns (uint256) {
        return day0 + n * 1 days;
    }

    /// @dev A cash sale: the operator has the buyer's money and owes this recipient their share.
    function _sellForCash(address recipient, uint256 itemRef) internal returns (uint256 debtId) {
        IDebtLedger.Leg[] memory legs = new IDebtLedger.Leg[](1);
        legs[0] = IDebtLedger.Leg(Types.Role.CREATOR, recipient, DEBT);

        uint256[] memory ids =
            debts.mintSaleDebts(itemRef, Types.Rail.CUSTODY, CURRENCY, legs, bytes32(0));
        debtId = ids[0];
    }

    function _postClaim(uint256 debtId, bytes32 refHash) internal returns (uint256 claimId) {
        uint256[] memory ids = new uint256[](1);
        ids[0] = debtId;
        vm.prank(operator);
        claimId = debts.postClaim(ids, refHash);
    }

    /// @dev The weekly attestation: one blob, published where anyone can fetch it, covering every
    ///      claim of the period. It covers what the processor's log actually contains and nothing
    ///      else — which is why claim B is in every sweep and covered by none of them.
    function _weeklySweep(uint256 claimA, uint256 claimB) internal returns (uint256 sweepId) {
        uint256[] memory claimIds = new uint256[](2);
        claimIds[0] = claimA;
        claimIds[1] = claimB;

        vm.startPrank(operator);
        proofs.submitEvidence(EVIDENCE, POINTER);
        sweepId = sweep.attest(claimIds, EVIDENCE, POINTER);
        vm.stopPrank();
    }

    /// @notice Appendix B.3, on the clock.
    function test_theSleepingRecipientIsProtectedByArithmeticNotByVigilance() public {
        // Every transaction of the story, from day 0, so that "nobody challenged anything" can be
        // asserted rather than assumed.
        vm.recordLogs();

        // --- Day 0: two cash sales. One will be paid; one will not. ---
        uint256 debtA = _sellForCash(alert, 1001);
        uint256 debtB = _sellForCash(sleeper, 1002);
        assertEq(debts.debt(debtB).deadline, _day(3));
        assertEq(debts.outstanding(), 2 * DEBT);

        // --- Day 2: the operator claims both. One claim is true. ---
        vm.warp(_day(2));
        uint256 claimA = _postClaim(debtA, REF_A);
        uint256 claimB = _postClaim(debtB, REF_B);

        // The processor's log contains the transfer behind claim A, and no transfer behind claim B.
        // In production the verifier would compute that; here it is injected, in the open.
        IProofVerifier.Statement memory paid = debts.statementOf(claimA);
        vm.prank(operator);
        proofs.setVerdict(paid, true);

        // Each claim's coverage deadline is fourteen days from the claim: day 16.
        assertEq(sweep.coverageDeadline(claimA), _day(16));
        assertEq(sweep.coverageDeadline(claimB), _day(16));

        // --- Day 7: both challenge windows close in silence. ---
        // Neither recipient objected — one because she was paid, one because she was asleep. The
        // ledger cannot tell those two silences apart, and does not try to.
        vm.warp(_day(7) + 1);
        vm.startPrank(stranger);
        debts.settleClaim(claimA);
        debts.settleClaim(claimB);
        vm.stopPrank();

        assertEq(uint8(debts.claim(claimB).state), uint8(Types.ClaimState.SETTLED));
        assertEq(uint8(debts.debt(debtB).state), uint8(Types.DebtState.SETTLED));

        // For a moment the books are square and both debts look paid. This is exactly the state the
        // attestation exists to disbelieve.
        assertEq(debts.outstanding(), 0);

        // --- Day 7: the first sweep. It covers the payment that happened. ---
        _weeklySweep(claimA, claimB);

        assertEq(uint8(debts.claim(claimA).state), uint8(Types.ClaimState.PROVEN));
        assertEq(uint8(debts.debt(debtA).state), uint8(Types.DebtState.PROVEN));
        assertEq(sweep.coveredBy(claimA), 1);

        // And it cannot cover the one that did not: no such transfer exists to attest to.
        assertEq(uint8(debts.claim(claimB).state), uint8(Types.ClaimState.SETTLED));
        assertEq(sweep.coveredBy(claimB), 0);
        assertEq(sweep.attestation(1).claimsCovered, 1);

        // --- Day 14: the second sweep. Still nothing to cover. ---
        vm.warp(_day(14));
        _weeklySweep(claimA, claimB);

        assertEq(sweep.attestation(2).claimsCovered, 0); // A is exempt; B is unprovable
        assertEq(uint8(debts.claim(claimB).state), uint8(Types.ClaimState.SETTLED));

        // The claim is still uncovered and still alive on day 16 itself — a deadline is met on the
        // second it falls.
        vm.warp(_day(16));
        vm.expectRevert(
            abi.encodeWithSelector(
                SweepRegistry.CoverageWindowOpen.selector, claimB, uint64(_day(16))
            )
        );
        sweep.touch(claimB);

        // --- Day 16: the coverage deadline passes. Anyone may collect the consequence. ---
        vm.warp(_day(16) + 1);
        vm.prank(stranger);
        sweep.touch(claimB);

        assertEq(uint8(debts.claim(claimB).state), uint8(Types.ClaimState.VOIDED));

        // The debt comes back at the age it always had: minted day 0, due day 3, now sixteen days
        // old. Re-aging is not a reset — the fortnight the claim spent unproven is not given back.
        IDebtLedger.Debt memory owed = debts.debt(debtB);
        assertEq(uint8(owed.state), uint8(Types.DebtState.AGING));
        assertEq(owed.mintedAt, day0);
        assertEq(owed.deadline, _day(3));
        assertEq(debts.outstanding(), DEBT); // the money is back on the operator's book

        // The lying fee, and then the default it was always heading for.
        assertEq(debts.penaltyOwed(sleeper, CURRENCY), PENALTY / 2);
        assertEq(debts.poolPenaltyOwed(CURRENCY), PENALTY / 2);

        assertTrue(debts.isDefaultable(debtB));
        vm.prank(pool);
        debts.markDefaulted(debtB);
        assertEq(uint8(debts.debt(debtB).state), uint8(Types.DebtState.DEFAULTED));
        assertEq(debts.outstanding(), 0);

        // --- Day 21: the third sweep finds both claims settled beyond its reach. ---
        vm.warp(_day(21));
        _weeklySweep(claimA, claimB);
        assertEq(sweep.attestation(3).claimsCovered, 0);

        // The honest claim is untouched by any of it, and stays untouchable.
        assertEq(uint8(debts.debt(debtA).state), uint8(Types.DebtState.PROVEN));
        assertFalse(debts.isDefaultable(debtA));

        // --- And the sleeping recipient never sent a transaction. ---
        //
        // Asserted from the log, not from a nonce: a nonce reading would be vacuous here, because
        // an impersonated call in a test does not move one. A recipient has exactly one way to act
        // on a claim — the challenge — and it always leaves this event behind. There are none. So
        // every consequence above was collected by the operator, a stranger and the arithmetic,
        // while both recipients did nothing at all.
        Vm.Log[] memory story = vm.getRecordedLogs();
        for (uint256 i = 0; i < story.length; ++i) {
            assertTrue(story[i].topics[0] != DebtLedger.ClaimChallenged.selector);
        }
    }
}
