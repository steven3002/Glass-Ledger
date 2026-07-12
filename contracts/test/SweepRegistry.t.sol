// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {DebtLedger} from "../src/debt/DebtLedger.sol";
import {SweepRegistry} from "../src/debt/SweepRegistry.sol";
import {IDebtLedger} from "../src/interfaces/IDebtLedger.sol";
import {IProofVerifier} from "../src/oracle/IProofVerifier.sol";
import {Types} from "../src/libs/Types.sol";
import {Fixture} from "./utils/Fixture.sol";

contract SweepRegistryTest is Fixture {
    uint32 internal constant COVERAGE_WINDOW = 5 minutes;

    bytes internal constant EVIDENCE = hex"c0ffee";
    bytes internal constant PROOF = hex"c0ffee";
    bytes32 internal constant POINTER = keccak256("storage-root-of-the-attestation-blob");

    address internal pool;
    SweepRegistry internal sweep;

    function setUp() public override {
        super.setUp();
        pool = makeAddr("pool");
        sweep = new SweepRegistry(operator, debts, COVERAGE_WINDOW);

        vm.startPrank(operator);
        debts.setPool(pool);
        debts.setSweepRegistry(address(sweep));
        vm.stopPrank();
    }

    // --- Helpers ---

    function _attest(uint256 claimId) internal returns (uint256 sweepId) {
        uint256[] memory claimIds = new uint256[](1);
        claimIds[0] = claimId;

        vm.prank(operator);
        return sweep.attest(claimIds, EVIDENCE, POINTER);
    }

    /// @dev A verdict for a statement the ledger never made. This is the only way a mismatch can be
    ///      staged at all — the sweep never lets the operator name the statement it is proving, so
    ///      the operator's alternative facts have to be injected straight into the verifier.
    function _setVerdictFor(IProofVerifier.Statement memory statement) internal {
        vm.prank(operator);
        proofs.setVerdict(statement, true);
    }

    /// @notice A deployment in which a claim's coverage deadline falls while the operator still has
    ///         time to answer a challenge — the one arrangement in which the two clocks collide.
    /// @dev Not reachable with the protocol's own parameters (challenge + response is well inside
    ///      the coverage window, in the demo profile and the production one alike). Built here on
    ///      purpose, because a guard is only load-bearing if something can push against it.
    function _ledgerWhereCoverageOutpacesTheResponse()
        internal
        returns (DebtLedger ledger, SweepRegistry registry_, uint256 claimId)
    {
        ledger = new DebtLedger(
            operator, proofs, SETTLEMENT_WINDOW, CHALLENGE_WINDOW, 5 minutes, PENALTY_BPS
        );
        registry_ = new SweepRegistry(operator, ledger, 3 minutes);

        vm.startPrank(operator);
        ledger.setSaleGateway(address(this));
        ledger.setSweepRegistry(address(registry_));
        vm.stopPrank();

        vm.prank(creator);
        ledger.setAccountHash(CURRENCY, _accountHash(creator));

        IDebtLedger.Leg[] memory legs = new IDebtLedger.Leg[](1);
        legs[0] = IDebtLedger.Leg(Types.Role.CREATOR, creator, SALE_PRICE);
        uint256[] memory ids =
            ledger.mintSaleDebts(SALE_REF, Types.Rail.CUSTODY, CURRENCY, legs, bytes32(0));

        vm.prank(operator);
        claimId = ledger.postClaim(ids, CLAIM_REF);
    }

    // --- Wiring ---

    /// @dev The sweep does not choose its own oracle. A second verifier would be a second definition
    ///      of what counts as proof, and the operator would own both of them.
    function test_theSweepTakesItsVerifierFromTheLedger() public view {
        assertEq(address(sweep.verifier()), address(proofs));
        assertEq(address(sweep.verifier()), address(debts.verifier()));
        assertEq(address(sweep.debts()), address(debts));
        assertEq(sweep.operator(), operator);
        assertEq(sweep.coverageWindow(), COVERAGE_WINDOW);
    }

    function test_theSweepRefusesNonsenseParameters() public {
        vm.expectRevert(SweepRegistry.ZeroAddress.selector);
        new SweepRegistry(address(0), debts, COVERAGE_WINDOW);

        vm.expectRevert(SweepRegistry.ZeroAddress.selector);
        new SweepRegistry(operator, DebtLedger(address(0)), COVERAGE_WINDOW);

        vm.expectRevert(SweepRegistry.InvalidWindow.selector);
        new SweepRegistry(operator, debts, 0);
    }

    function test_onlyTheOperatorAttests() public {
        (, uint256 claimId) = _cashClaim();
        uint256[] memory claimIds = new uint256[](1);
        claimIds[0] = claimId;

        vm.expectRevert(SweepRegistry.NotOperator.selector);
        vm.prank(stranger);
        sweep.attest(claimIds, EVIDENCE, POINTER);
    }

    function test_anAttestationNeedsClaimsAndEvidence() public {
        (, uint256 claimId) = _cashClaim();
        uint256[] memory none = new uint256[](0);
        uint256[] memory one = new uint256[](1);
        one[0] = claimId;

        vm.startPrank(operator);

        vm.expectRevert(SweepRegistry.EmptySweep.selector);
        sweep.attest(none, EVIDENCE, POINTER);

        // An attestation with nothing behind it is not an attestation.
        vm.expectRevert(SweepRegistry.EmptyEvidence.selector);
        sweep.attest(one, "", POINTER);

        vm.stopPrank();
    }

    /// @dev A sweep may be incomplete. It may never be invented.
    function test_aSweepCannotAttestToAClaimThatDoesNotExist() public {
        uint256[] memory claimIds = new uint256[](1);
        claimIds[0] = 99;

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.UnknownClaim.selector, 99));
        vm.prank(operator);
        sweep.attest(claimIds, EVIDENCE, POINTER);
    }

    // --- Coverage ---

    function test_coverageProvesTheClaimAndRecordsTheAttestation() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();
        _setVerdict(claimId, true);

        vm.expectEmit(true, true, false, true, address(sweep));
        emit SweepRegistry.ClaimCovered(1, claimId);
        uint256 sweepId = _attest(claimId);

        assertEq(sweepId, 1);
        assertEq(sweep.attestationCount(), 1);
        assertEq(sweep.coveredBy(claimId), 1);

        SweepRegistry.Attestation memory posted = sweep.attestation(sweepId);
        assertEq(posted.postedAt, uint64(block.timestamp));
        assertEq(posted.claimsSubmitted, 1);
        assertEq(posted.claimsCovered, 1);
        assertEq(posted.evidenceHash, keccak256(EVIDENCE));
        assertEq(posted.storagePointer, POINTER);

        // Evidence-backed, and the money is off the operator's book.
        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.PROVEN));
        assertEq(uint8(debts.debt(ids[0]).state), uint8(Types.DebtState.PROVEN));
        assertEq(debts.outstanding(), 0);
    }

    /// @dev The sweep is not a rubber stamp. A claim the evidence does not reach is simply not
    ///      covered — the batch does not fail, and the claim keeps its clock and its fate.
    function test_aClaimWithNoEvidenceBehindItIsNotCovered() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();

        vm.expectEmit(true, true, false, false, address(sweep));
        emit SweepRegistry.ClaimUncovered(1, claimId);
        _attest(claimId);

        assertEq(sweep.attestation(1).claimsCovered, 0);
        assertEq(sweep.coveredBy(claimId), 0);
        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.PENDING));
        assertEq(uint8(debts.debt(ids[0]).state), uint8(Types.DebtState.PROVISIONAL));
    }

    /// @dev The sweep covers what it can and records what it cannot, in one pass.
    function test_oneAttestationCoversWhatItCanAndSaysSoAboutTheRest() public {
        (, uint256 real) = _cashClaim();
        (, uint256 fake) = _cashClaim();
        _setVerdict(real, true);

        uint256[] memory claimIds = new uint256[](2);
        claimIds[0] = real;
        claimIds[1] = fake;

        vm.prank(operator);
        sweep.attest(claimIds, EVIDENCE, POINTER);

        SweepRegistry.Attestation memory posted = sweep.attestation(1);
        assertEq(posted.claimsSubmitted, 2);
        assertEq(posted.claimsCovered, 1);
        assertEq(uint8(debts.claim(real).state), uint8(Types.ClaimState.PROVEN));
        assertEq(uint8(debts.claim(fake).state), uint8(Types.ClaimState.PENDING));
    }

    // --- Coverage is the full-tuple test ---
    //
    // The four tests below are the reason the sweep is worth anything. Coverage forecloses the
    // ordinary challenge, so a claim covered by a real transfer that was not *this* transfer can
    // never be tested again by anyone. In each case the operator holds a perfectly valid verdict —
    // it simply describes a payment nobody asked about, and the statement the sweep puts to the
    // verifier is the ledger's, not the operator's.

    function test_aTransferToTheWrongAccountDoesNotCover() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();

        IProofVerifier.Statement memory wrongAccount = debts.statementOf(claimId);
        wrongAccount.recipientAccountHash = _accountHash(stranger);
        _setVerdictFor(wrongAccount);

        _attest(claimId);
        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.PENDING));
        assertEq(sweep.coveredBy(claimId), 0);

        // And the claim dies at its deadline, exactly as if no proof had ever been offered — which,
        // as far as this claim is concerned, is the truth.
        vm.warp(block.timestamp + COVERAGE_WINDOW + 1);
        sweep.touch(claimId);

        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.VOIDED));
        assertEq(uint8(debts.debt(ids[0]).state), uint8(Types.DebtState.AGING));
    }

    function test_aTransferOfTheWrongAmountDoesNotCover() public {
        (, uint256 claimId) = _cashClaim();

        IProofVerifier.Statement memory wrongAmount = debts.statementOf(claimId);
        wrongAmount.amountCommitment = keccak256(abi.encode("a smaller number"));
        _setVerdictFor(wrongAmount);

        _attest(claimId);
        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.PENDING));
    }

    /// @dev The protocol never converts money. A dollar transfer against a naira debt is a tuple
    ///      mismatch, not an exchange-rate argument.
    function test_aTransferInTheWrongCurrencyDoesNotCover() public {
        (, uint256 claimId) = _cashClaim();

        IProofVerifier.Statement memory wrongCurrency = debts.statementOf(claimId);
        // forge-lint: disable-next-line(unsafe-typecast)
        wrongCurrency.currency = bytes32("USD");
        _setVerdictFor(wrongCurrency);

        _attest(claimId);
        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.PENDING));
    }

    /// @dev Real evidence, real payment, wrong claim. The operator here is holding a verdict it is
    ///      fully entitled to — for the claim it actually paid — and the sweep simply never asks
    ///      about that statement. It asks about this one, and the claim id is inside the tuple, so
    ///      a proof cannot be lifted off the claim it belongs to and spent on one it does not.
    function test_aProofOfAnotherClaimDoesNotCover() public {
        (, uint256 paid) = _cashClaim();
        (, uint256 unpaid) = _cashClaim();

        _setVerdict(paid, true);

        _attest(unpaid);
        assertEq(uint8(debts.claim(unpaid).state), uint8(Types.ClaimState.PENDING));
        assertEq(sweep.coveredBy(unpaid), 0);

        // The evidence was real all along — it just belonged to the other claim, which it covers.
        _attest(paid);
        assertEq(uint8(debts.claim(paid).state), uint8(Types.ClaimState.PROVEN));
    }

    /// @dev An instant sale is not fire-and-forget. The claim it posts at mint is a claim like any
    ///      other, and the attestation sweeps it like everything else — so a rail that swore it had
    ///      split the payment must eventually prove it. If it never does, the debts come back, and
    ///      money the ceiling was told was never in the operator's custody is in its custody.
    function test_anInstantSalesOwnClaimIsSweptLikeAnyOther() public {
        uint256[] memory ids = _mintSale(Types.Rail.INSTANT, CLAIM_REF);
        uint256 claimId = 1;
        assertEq(debts.outstanding(), 0);

        _attest(claimId); // there is nothing to cover: the rail never paid anybody
        assertEq(sweep.coveredBy(claimId), 0);

        vm.warp(sweep.coverageDeadline(claimId) + 1);
        vm.prank(stranger);
        sweep.touch(claimId);

        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.VOIDED));
        assertEq(uint8(debts.debt(ids[0]).state), uint8(Types.DebtState.AGING));
        assertEq(debts.outstanding(), SALE_PRICE * 8750 / 10_000);
    }

    // --- What coverage does to the challenge ---

    /// @dev Once the deciding evidence is on-chain there is nothing left to decide. The window may
    ///      still be open; the question it was open for has been answered.
    function test_coverageForeclosesTheChallengeEvenInsideAnOpenWindow() public {
        (, uint256 claimId) = _cashClaim();
        _setVerdict(claimId, true);
        _attest(claimId);

        assertFalse(debts.claim(claimId).challengeDeadline < uint64(block.timestamp));

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.ClaimNotPending.selector, claimId));
        vm.prank(creator);
        debts.challenge(claimId);
    }

    /// @dev The exemption, from the sweep's side. A claim already proven in a challenge has done
    ///      what coverage exists to make it do; the sweep has nothing left to add and does not
    ///      choke on finding it in the batch.
    function test_aClaimProvenInAChallengeNeedsNoCoverage() public {
        (, uint256 claimId) = _cashClaim();

        vm.prank(creator);
        debts.challenge(claimId);

        _setVerdict(claimId, true);
        vm.prank(operator);
        debts.respond(claimId, PROOF);

        vm.expectEmit(true, true, false, true, address(sweep));
        emit SweepRegistry.ClaimExempt(1, claimId, Types.ClaimState.PROVEN);
        _attest(claimId);

        assertEq(sweep.attestation(1).claimsCovered, 0);
        assertEq(sweep.coveredBy(claimId), 0);

        // And the coverage deadline passing means nothing to it: there is no way to kill a claim
        // whose evidence is already on-chain.
        vm.warp(block.timestamp + COVERAGE_WINDOW + 1);
        vm.expectRevert(abi.encodeWithSelector(DebtLedger.ClaimNotLive.selector, claimId));
        vm.prank(stranger);
        sweep.touch(claimId);
    }

    function test_aVoidedClaimIsBeyondTheSweep() public {
        (, uint256 claimId) = _cashClaim();

        vm.prank(creator);
        debts.challenge(claimId);
        vm.warp(block.timestamp + RESPONSE_WINDOW + 1);
        debts.voidChallenged(claimId);

        vm.expectEmit(true, true, false, true, address(sweep));
        emit SweepRegistry.ClaimExempt(1, claimId, Types.ClaimState.VOIDED);
        _attest(claimId);

        assertEq(sweep.attestation(1).claimsCovered, 0);
    }

    // --- The coverage deadline ---

    /// @dev The clock starts when the operator asserts the payment, not when it made the sale. The
    ///      operator therefore starts it itself, and cannot lengthen it by claiming late — a late
    ///      claim runs into the settlement deadline instead.
    function test_theCoverageDeadlineRunsFromTheClaim() public {
        uint256[] memory ids = _mintSale(Types.Rail.CUSTODY, bytes32(0));
        uint64 sale = uint64(block.timestamp);

        vm.warp(sale + 1 minutes);
        vm.prank(operator);
        uint256 claimId = debts.postClaim(_payable(ids), CLAIM_REF);

        assertEq(debts.claim(claimId).postedAt, sale + 1 minutes);
        assertEq(sweep.coverageDeadline(claimId), sale + 1 minutes + COVERAGE_WINDOW);
    }

    function test_aClaimCannotBeTouchedBeforeItsCoverageDeadline() public {
        (, uint256 claimId) = _cashClaim();
        uint64 deadline = sweep.coverageDeadline(claimId);

        // On the second the deadline falls, the operator still has it: a window is not past until
        // it is past.
        vm.warp(deadline);
        vm.expectRevert(
            abi.encodeWithSelector(SweepRegistry.CoverageWindowOpen.selector, claimId, deadline)
        );
        vm.prank(stranger);
        sweep.touch(claimId);
    }

    function test_touchingAClaimThatDoesNotExistReverts() public {
        vm.expectRevert(abi.encodeWithSelector(DebtLedger.UnknownClaim.selector, 99));
        sweep.touch(99);
    }

    /// @dev The whole ratchet in one test: nobody challenged, the claim settled on silence, and it
    ///      died anyway — because silence was never evidence.
    function test_anUncoveredClaimDiesAtItsDeadlineAndTheDebtComesBack() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();
        uint64 mintedAt = debts.debt(ids[0]).mintedAt;
        uint64 deadline = debts.debt(ids[0]).deadline;
        uint256 creatorDebt = debts.debt(ids[0]).amount;

        // Nobody objects, so the claim settles. Two sweeps come and go with nothing to cover.
        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);
        debts.settleClaim(claimId);
        assertEq(uint8(debts.debt(ids[0]).state), uint8(Types.DebtState.SETTLED));
        assertEq(debts.outstanding(), 0);

        _attest(claimId);

        vm.warp(sweep.coverageDeadline(claimId) + 1);

        vm.expectEmit(true, false, false, true, address(sweep));
        emit SweepRegistry.CoverageLapsed(claimId, sweep.coverageDeadline(claimId));
        vm.prank(stranger);
        sweep.touch(claimId);

        // Void, penalty, and the debt back exactly where it was — settled or not, it was never paid.
        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.VOIDED));
        assertEq(uint8(debts.debt(ids[0]).state), uint8(Types.DebtState.AGING));
        assertEq(debts.debt(ids[0]).mintedAt, mintedAt);
        assertEq(debts.debt(ids[0]).deadline, deadline);
        assertEq(debts.penaltyOwed(creator, CURRENCY), creatorDebt * PENALTY_BPS / 10_000 / 2);
        assertEq(debts.outstanding(), SALE_PRICE * 8750 / 10_000);

        // The settlement deadline is long past, so the debt is in default the instant it returns.
        assertTrue(debts.isDefaultable(ids[0]));
        vm.prank(pool);
        debts.markDefaulted(ids[0]);
        assertEq(uint8(debts.debt(ids[0]).state), uint8(Types.DebtState.DEFAULTED));
    }

    /// @dev The economics the ratchet rests on. One proof spans a whole period, so the number that
    ///      matters is not what a sweep costs but what a *claim* costs inside one — and a claim
    ///      costs the state it changes: three debts moved to proven, and the evidence written once
    ///      for all of them. Measured, not asserted; the bound is a regression guard, not a target.
    function test_aSweepCostsWhatItsClaimsCostAndNotMore() public {
        uint256[] memory claimIds = new uint256[](10);
        for (uint256 i = 0; i < claimIds.length; ++i) {
            (, claimIds[i]) = _cashClaim();
            _setVerdict(claimIds[i], true);
        }

        vm.prank(operator);
        uint256 before = gasleft();
        sweep.attest(claimIds, EVIDENCE, POINTER);
        uint256 used = before - gasleft();

        emit log_named_uint("gas per covered claim (3 debts)", used / claimIds.length);
        assertLt(used / claimIds.length, 75_000);

        for (uint256 i = 0; i < claimIds.length; ++i) {
            assertEq(uint8(debts.claim(claimIds[i]).state), uint8(Types.ClaimState.PROVEN));
        }
    }

    /// @dev Two deadlines, and neither shortcuts the other. A challenged claim whose response window
    ///      is still running is not void, whatever the coverage clock says — the operator's own
    ///      clock has not run out, and the protocol never takes back a window it granted.
    function test_theCoverageDeadlineNeverShortcutsTheOperatorsOwnClock() public {
        (DebtLedger ledger, SweepRegistry registry_, uint256 claimId) =
            _ledgerWhereCoverageOutpacesTheResponse();

        vm.warp(block.timestamp + 1 minutes);
        vm.prank(creator);
        ledger.challenge(claimId);

        uint64 responseDeadline = ledger.claim(claimId).responseDeadline;
        uint64 coverageDeadline = registry_.coverageDeadline(claimId);
        assertGt(responseDeadline, coverageDeadline);

        vm.warp(coverageDeadline + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                DebtLedger.ResponseWindowOpen.selector, claimId, responseDeadline
            )
        );
        vm.prank(stranger);
        registry_.touch(claimId);

        // Once the operator's window has closed too, the claim dies on the same permissionless
        // touch — the coverage deadline waited for it, and did not forgive it.
        vm.warp(responseDeadline + 1);
        vm.prank(stranger);
        registry_.touch(claimId);
        assertEq(uint8(ledger.claim(claimId).state), uint8(Types.ClaimState.VOIDED));
    }
}
