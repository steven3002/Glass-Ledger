// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {DebtLedger} from "../src/debt/DebtLedger.sol";
import {IDebtLedger} from "../src/interfaces/IDebtLedger.sol";
import {IProofVerifier} from "../src/oracle/IProofVerifier.sol";
import {Types} from "../src/libs/Types.sol";
import {StubProofVerifier} from "../src/oracle/StubProofVerifier.sol";
import {Fixture} from "./utils/Fixture.sol";

contract DebtLedgerTest is Fixture {
    bytes internal constant PROOF = hex"c0ffee";

    /// @dev The ledger's two privileged seams, as the deployment wires them. This suite drives them
    ///      directly — the pool's default call and the sweep's coverage calls — because what is under
    ///      test is the ledger's own answer to them, not the treasury's arithmetic or the sweep's
    ///      cadence. To the ledger they are two addresses, and the gate is that they are *those* two.
    function _pool() internal view returns (address) {
        return address(pool);
    }

    function _sweep() internal view returns (address) {
        return address(sweep);
    }

    // --- Helpers ---

    function _proveNext(uint256 claimId) internal {
        _setVerdict(claimId, true);
    }

    // --- Minting ---

    function test_mintingRecordsTheSplitAndStartsTheClock() public {
        uint256[] memory ids = _mintSale(Types.Rail.CUSTODY, bytes32(0));
        assertEq(ids.length, 4);
        assertEq(debts.debtCount(), 4);

        IDebtLedger.Debt memory owed = debts.debt(ids[0]);
        assertEq(owed.saleRef, SALE_REF);
        assertEq(owed.recipient, creator);
        assertEq(uint8(owed.role), uint8(Types.Role.CREATOR));
        assertEq(uint8(owed.rail), uint8(Types.Rail.CUSTODY));
        assertEq(uint8(owed.state), uint8(Types.DebtState.AGING));
        assertEq(owed.amount, SALE_PRICE * CREATOR_BPS / 10_000);
        assertEq(owed.currency, CURRENCY);
        assertEq(owed.mintedAt, uint64(block.timestamp));
        assertEq(owed.deadline, uint64(block.timestamp) + SETTLEMENT_WINDOW);
        assertEq(owed.claimRef, bytes32(0));
    }

    /// @dev Good's own share is owed to nobody. It is minted so the ledger shows the whole sale,
    ///      and it is terminal where it is minted: it cannot age, be claimed, or be paid by a pool.
    function test_theOperatorsOwnLegIsRetainedAtMint() public {
        uint256[] memory ids = _mintSale(Types.Rail.CUSTODY, bytes32(0));
        uint256 own = ids[3];

        assertEq(uint8(debts.debt(own).state), uint8(Types.DebtState.RETAINED));
        assertFalse(debts.isDefaultable(own));

        uint256[] memory justTheOperator = new uint256[](1);
        justTheOperator[0] = own;
        vm.expectRevert(
            abi.encodeWithSelector(
                DebtLedger.DebtNotClaimable.selector, own, Types.DebtState.RETAINED
            )
        );
        vm.prank(operator);
        debts.postClaim(justTheOperator, CLAIM_REF);

        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);
        vm.expectRevert(abi.encodeWithSelector(DebtLedger.NotDefaulted.selector, own));
        vm.prank(_pool());
        debts.markDefaulted(own);
    }

    /// @dev A rail that split the payment as it happened says so in the same transaction that owed
    ///      the money — and can be made to prove it.
    function test_anInstantSaleClaimsItselfInTheSameTransaction() public {
        uint256[] memory ids = _mintSale(Types.Rail.INSTANT, CLAIM_REF);

        assertEq(debts.claimCount(), 1);
        assertEq(uint8(debts.claim(1).state), uint8(Types.ClaimState.PENDING));
        assertEq(debts.claim(1).refHash, CLAIM_REF);

        // The operator's leg is not in it: there is no payment of yourself to prove.
        assertEq(debts.claimDebts(1).length, 3);
        assertEq(uint8(debts.debt(ids[0]).state), uint8(Types.DebtState.PROVISIONAL));
        assertEq(uint8(debts.debt(ids[3]).state), uint8(Types.DebtState.RETAINED));
        assertEq(debts.debt(ids[0]).claimRef, CLAIM_REF);

        // The rail paid the recipients directly, so the operator holds nobody's money.
        assertEq(debts.outstanding(), 0);
    }

    function test_custodyExposureCountsEveryLegButTheOperatorsOwn() public {
        _mintSale(Types.Rail.CUSTODY, bytes32(0));
        assertEq(debts.outstanding(), SALE_PRICE * 8750 / 10_000);
    }

    function test_onlyTheGatewayMints() public {
        vm.expectRevert(DebtLedger.NotGateway.selector);
        vm.prank(operator);
        debts.mintSaleDebts(SALE_REF, Types.Rail.CUSTODY, CURRENCY, _saleLegs(), bytes32(0));
    }

    // --- Where a recipient is paid ---

    /// @dev An operator that could name the account it paid would be asserting the fact it is
    ///      supposed to be proving. It can only ever write its own.
    function test_onlyTheRecipientRegistersTheirOwnAccount() public {
        bytes32 forged = keccak256("operator-controlled-account");

        vm.prank(operator);
        debts.setAccountHash(CURRENCY, forged);

        assertEq(debts.accountHashOf(creator, CURRENCY), _accountHash(creator));
        assertEq(debts.accountHashOf(operator, CURRENCY), forged);
    }

    function test_anAccountHashIsNeverEmpty() public {
        vm.startPrank(creator);

        vm.expectRevert(DebtLedger.InvalidAccountHash.selector);
        debts.setAccountHash(CURRENCY, bytes32(0));

        vm.expectRevert(DebtLedger.InvalidAccountHash.selector);
        debts.setAccountHash(bytes32(0), keccak256("account"));

        vm.stopPrank();
    }

    /// @dev You cannot have paid someone you have no account for.
    function test_aClaimCannotNameAnAccountThatIsNotOnFile() public {
        IDebtLedger.Leg[] memory legs = new IDebtLedger.Leg[](1);
        legs[0] = IDebtLedger.Leg(Types.Role.CREATOR, stranger, 1e18);

        vm.prank(address(gateway));
        uint256[] memory ids =
            debts.mintSaleDebts(SALE_REF, Types.Rail.CUSTODY, CURRENCY, legs, bytes32(0));

        vm.expectRevert(
            abi.encodeWithSelector(DebtLedger.NoAccountOnFile.selector, stranger, CURRENCY)
        );
        vm.prank(operator);
        debts.postClaim(ids, CLAIM_REF);
    }

    /// @dev A claim captures where each party said they were to be paid at the moment it was
    ///      posted. Rotating an account afterwards cannot reach backwards and unmake it.
    function test_rotatingAnAccountDoesNotReachBackwards() public {
        (, uint256 claimId) = _cashClaim();
        IProofVerifier.Statement memory before = debts.statementOf(claimId);

        vm.prank(creator);
        debts.setAccountHash(CURRENCY, keccak256("creator-new-bank"));

        IProofVerifier.Statement memory later = debts.statementOf(claimId);
        assertEq(later.recipientAccountHash, before.recipientAccountHash);
    }

    // --- Claims ---

    function test_aClaimCapturesTheWholeTupleFromTheLedgersOwnState() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();
        (uint256 creatorAmount, uint256 landlordAmount, uint256 communityAmount,) =
            _legs(SALE_PRICE, true);

        assertEq(uint8(debts.debt(ids[0]).state), uint8(Types.DebtState.PROVISIONAL));
        assertEq(debts.claim(claimId).totalAmount, creatorAmount + landlordAmount + communityAmount);

        bytes32[] memory accounts = new bytes32[](3);
        accounts[0] = _accountHash(creator);
        accounts[1] = _accountHash(landlord);
        accounts[2] = _accountHash(communityMember);

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = creatorAmount;
        amounts[1] = landlordAmount;
        amounts[2] = communityAmount;

        IProofVerifier.Statement memory statement = debts.statementOf(claimId);
        assertEq(statement.claimId, claimId);
        assertEq(statement.refHash, CLAIM_REF);
        assertEq(statement.currency, CURRENCY);
        assertEq(statement.recipientAccountHash, keccak256(abi.encode(accounts)));
        assertEq(statement.amountCommitment, keccak256(abi.encode(amounts)));
        assertTrue(statement.success);

        // Posting a claim does not release the money: the operator is still holding it.
        assertEq(debts.outstanding(), SALE_PRICE * 8750 / 10_000);
    }

    function test_onlyTheOperatorPostsClaims() public {
        uint256[] memory ids = _mintSale(Types.Rail.CUSTODY, bytes32(0));

        vm.expectRevert(DebtLedger.NotOperator.selector);
        vm.prank(stranger);
        debts.postClaim(_payable(ids), CLAIM_REF);
    }

    function test_aClaimMustNameThePaymentAndTheDebts() public {
        uint256[] memory ids = _mintSale(Types.Rail.CUSTODY, bytes32(0));

        vm.expectRevert(DebtLedger.MissingClaimRef.selector);
        vm.prank(operator);
        debts.postClaim(_payable(ids), bytes32(0));

        vm.expectRevert(DebtLedger.EmptyClaim.selector);
        vm.prank(operator);
        debts.postClaim(new uint256[](0), CLAIM_REF);
    }

    /// @dev The protocol never converts money, so a single payment cannot answer for two
    ///      currencies. One claim, one denomination.
    function test_aClaimIsSingleCurrency() public {
        uint256[] memory ngn = _mintSale(Types.Rail.CUSTODY, bytes32(0));

        IDebtLedger.Leg[] memory legs = new IDebtLedger.Leg[](1);
        legs[0] = IDebtLedger.Leg(Types.Role.CREATOR, creator, 1e18);

        // A currency is a tag, not a number: a short ISO code widened into a word.
        // forge-lint: disable-next-line(unsafe-typecast)
        bytes32 usdTag = bytes32("USD");

        vm.prank(address(gateway));
        uint256[] memory usd =
            debts.mintSaleDebts(SALE_REF, Types.Rail.CUSTODY, usdTag, legs, bytes32(0));

        uint256[] memory mixed = new uint256[](2);
        mixed[0] = ngn[0];
        mixed[1] = usd[0];

        vm.expectRevert(DebtLedger.MixedCurrencyClaim.selector);
        vm.prank(operator);
        debts.postClaim(mixed, CLAIM_REF);
    }

    /// @dev The same debt twice in one batch fails on its second pass — which is why a duplicate
    ///      cannot double-count a penalty later.
    function test_aDebtUnderClaimCannotBeClaimedAgain() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();
        assertEq(claimId, 1);

        uint256[] memory again = new uint256[](1);
        again[0] = ids[0];

        vm.expectRevert(
            abi.encodeWithSelector(
                DebtLedger.DebtNotClaimable.selector, ids[0], Types.DebtState.PROVISIONAL
            )
        );
        vm.prank(operator);
        debts.postClaim(again, CLAIM_REF);
    }

    /// @dev Nothing attaches to a defaulted debt. It has stopped being a payable and become a
    ///      reimbursement the operator owes the pool.
    function test_aDefaultedDebtAcceptsNoClaims() public {
        uint256[] memory ids = _mintSale(Types.Rail.CUSTODY, bytes32(0));

        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);
        vm.prank(_pool());
        debts.markDefaulted(ids[0]);

        uint256[] memory late = new uint256[](1);
        late[0] = ids[0];

        vm.expectRevert(
            abi.encodeWithSelector(
                DebtLedger.DebtNotClaimable.selector, ids[0], Types.DebtState.DEFAULTED
            )
        );
        vm.prank(operator);
        debts.postClaim(late, CLAIM_REF);
    }

    // --- Silence ---

    function test_silenceRatifiesAClaimOnceItsWindowCloses() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();

        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);
        vm.prank(stranger);
        debts.settleClaim(claimId);

        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.SETTLED));
        assertEq(uint8(debts.debt(ids[0]).state), uint8(Types.DebtState.SETTLED));
        assertEq(debts.outstanding(), 0);
    }

    function test_aClaimCannotSettleWhileItsWindowIsOpen() public {
        (, uint256 claimId) = _cashClaim();
        uint64 deadline = debts.claim(claimId).challengeDeadline;

        vm.expectRevert(
            abi.encodeWithSelector(DebtLedger.ChallengeWindowOpen.selector, claimId, deadline)
        );
        debts.settleClaim(claimId);
    }

    function test_onlyAPendingClaimSettles() public {
        (, uint256 claimId) = _cashClaim();

        vm.prank(creator);
        debts.challenge(claimId);

        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);
        vm.expectRevert(abi.encodeWithSelector(DebtLedger.ClaimNotPending.selector, claimId));
        debts.settleClaim(claimId);
    }

    // --- Challenge ---

    function test_aRecipientMayChallengeWithinTheWindow() public {
        (, uint256 claimId) = _cashClaim();

        vm.prank(creator);
        debts.challenge(claimId);

        DebtLedger.Claim memory posted = debts.claim(claimId);
        assertEq(uint8(posted.state), uint8(Types.ClaimState.CHALLENGED));
        assertEq(posted.responseDeadline, uint64(block.timestamp) + RESPONSE_WINDOW);
    }

    function test_onlyARecipientOfTheClaimMayChallengeIt() public {
        (, uint256 claimId) = _cashClaim();

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.NotRecipient.selector, claimId, stranger));
        vm.prank(stranger);
        debts.challenge(claimId);
    }

    function test_aChallengeAfterTheWindowIsTooLate() public {
        (, uint256 claimId) = _cashClaim();
        uint64 deadline = debts.claim(claimId).challengeDeadline;

        vm.warp(deadline + 1);
        vm.expectRevert(
            abi.encodeWithSelector(DebtLedger.ChallengeWindowClosed.selector, claimId, deadline)
        );
        vm.prank(creator);
        debts.challenge(claimId);
    }

    function test_aClaimIsChallengedOnce() public {
        (, uint256 claimId) = _cashClaim();

        vm.prank(creator);
        debts.challenge(claimId);

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.ClaimNotPending.selector, claimId));
        vm.prank(landlord);
        debts.challenge(claimId);
    }

    /// @dev A recipient holding no gas token must still be able to say "I was not paid". The
    ///      signature is the gate; who pays for the transaction is nobody's business.
    function test_anyoneMayCarryASignedChallenge() public {
        (, uint256 claimId) = _cashClaim();

        bytes32 digest = _challengeDigest(claimId, creator);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(creatorKey, digest);

        vm.prank(stranger);
        debts.challengeFor(claimId, creator, abi.encodePacked(r, s, v));

        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.CHALLENGED));
    }

    function test_aForgedChallengeSignatureIsRejected() public {
        (, uint256 claimId) = _cashClaim();

        bytes32 digest = _challengeDigest(claimId, creator);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(forgerKey, digest);
        bytes memory forged = abi.encodePacked(r, s, v);

        vm.expectRevert(DebtLedger.BadChallengeSignature.selector);
        vm.prank(stranger);
        debts.challengeFor(claimId, creator, forged);
    }

    /// @dev A signed challenge names the ledger it was signed for. Two deployments of this protocol
    ///      — a testnet rehearsal and the live one, or two locations running their own instances —
    ///      hold claims under the same ids, so a signature that did not name its ledger could be
    ///      lifted from one and replayed on the other. This one names it: the deployment's address
    ///      is inside the digest, so the same bytes that challenge claim 1 here mean nothing there.
    function test_aChallengeSignatureDoesNotTravelToAnotherDeployment() public {
        (, uint256 claimId) = _cashClaim();

        // A second, identically parameterised deployment, carrying the same claim id over the same
        // debt. Everything about the two claims is the same except which ledger holds them.
        DebtLedger other = new DebtLedger(
            operator, proofs, SETTLEMENT_WINDOW, CHALLENGE_WINDOW, RESPONSE_WINDOW, PENALTY_BPS
        );
        vm.prank(operator);
        other.setSaleGateway(address(this));
        vm.prank(creator);
        other.setAccountHash(CURRENCY, _accountHash(creator));

        IDebtLedger.Leg[] memory legs = new IDebtLedger.Leg[](1);
        legs[0] = IDebtLedger.Leg(Types.Role.CREATOR, creator, SALE_PRICE);
        uint256[] memory ids =
            other.mintSaleDebts(SALE_REF, Types.Rail.CUSTODY, CURRENCY, legs, bytes32(0));

        vm.prank(operator);
        uint256 twin = other.postClaim(ids, CLAIM_REF);
        assertEq(twin, claimId);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(creatorKey, _challengeDigest(claimId, creator));
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert(DebtLedger.BadChallengeSignature.selector);
        vm.prank(stranger);
        other.challengeFor(twin, creator, signature);

        // The same bytes, on the ledger they were signed for, are a valid challenge — so the
        // rejection above was about *which deployment*, and nothing else.
        vm.prank(stranger);
        debts.challengeFor(claimId, creator, signature);
        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.CHALLENGED));
    }

    /// @dev And it names the chain. The same contract at the same address on a fork — or on a
    ///      testnet the operator also runs — is a different ledger, and a challenge signed for one
    ///      is not a challenge on the other.
    function test_aChallengeSignatureDoesNotTravelToAnotherChain() public {
        (, uint256 claimId) = _cashClaim();

        uint256 chain = block.chainid;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(creatorKey, _challengeDigest(claimId, creator));
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.chainId(chain + 1);
        vm.expectRevert(DebtLedger.BadChallengeSignature.selector);
        vm.prank(stranger);
        debts.challengeFor(claimId, creator, signature);

        vm.chainId(chain);
        vm.prank(stranger);
        debts.challengeFor(claimId, creator, signature);
        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.CHALLENGED));
    }

    function _challengeDigest(uint256 claimId, address recipient) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(debts.CHALLENGE_TYPEHASH(), claimId, recipient));
        return keccak256(
            abi.encodePacked(
                hex"1901",
                keccak256(
                    abi.encode(
                        keccak256(
                            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                        ),
                        keccak256(bytes("Glass Ledger")),
                        keccak256(bytes("1")),
                        block.chainid,
                        address(debts)
                    )
                ),
                structHash
            )
        );
    }

    // --- Response ---

    function test_aValidProofSavesTheClaim() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();

        vm.prank(creator);
        debts.challenge(claimId);

        _proveNext(claimId);
        vm.prank(operator);
        debts.respond(claimId, PROOF);

        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.PROVEN));
        assertEq(uint8(debts.debt(ids[0]).state), uint8(Types.DebtState.PROVEN));
        assertEq(debts.outstanding(), 0);
        assertEq(debts.voidCount(), 0);
    }

    function test_anInvalidProofIsRejected() public {
        (, uint256 claimId) = _cashClaim();

        vm.prank(creator);
        debts.challenge(claimId);

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.ProofRejected.selector, claimId));
        vm.prank(operator);
        debts.respond(claimId, PROOF);
    }

    function test_aResponseAfterTheWindowIsTooLate() public {
        (, uint256 claimId) = _cashClaim();

        vm.prank(creator);
        debts.challenge(claimId);
        uint64 deadline = debts.claim(claimId).responseDeadline;

        _proveNext(claimId);
        vm.warp(deadline + 1);

        vm.expectRevert(
            abi.encodeWithSelector(DebtLedger.ResponseWindowClosed.selector, claimId, deadline)
        );
        vm.prank(operator);
        debts.respond(claimId, PROOF);
    }

    function test_aResponseNeedsAChallenge() public {
        (, uint256 claimId) = _cashClaim();

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.ClaimNotChallenged.selector, claimId));
        vm.prank(operator);
        debts.respond(claimId, PROOF);
    }

    function test_onlyTheOperatorResponds() public {
        (, uint256 claimId) = _cashClaim();

        vm.prank(creator);
        debts.challenge(claimId);
        _proveNext(claimId);

        vm.expectRevert(DebtLedger.NotOperator.selector);
        vm.prank(stranger);
        debts.respond(claimId, PROOF);
    }

    // --- Void ---

    /// @dev Re-aging is not a reset. The debt's mint date and deadline never moved, so it comes
    ///      back at the age it always had, and the time the lie spent pending is not given back.
    function test_anUnansweredChallengeVoidsAndReAgesTheDebt() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();
        IDebtLedger.Debt memory before = debts.debt(ids[0]);

        vm.prank(creator);
        debts.challenge(claimId);

        vm.warp(debts.claim(claimId).responseDeadline + 1);
        vm.prank(stranger);
        debts.voidChallenged(claimId);

        IDebtLedger.Debt memory after_ = debts.debt(ids[0]);
        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.VOIDED));
        assertEq(uint8(after_.state), uint8(Types.DebtState.AGING));
        assertEq(after_.mintedAt, before.mintedAt);
        assertEq(after_.deadline, before.deadline);
        assertEq(after_.claimRef, bytes32(0));

        // The money is back where it always was: in the operator's hands.
        assertEq(debts.outstanding(), SALE_PRICE * 8750 / 10_000);
    }

    function test_aVoidCannotLandWhileTheOperatorStillHasTimeToAnswer() public {
        (, uint256 claimId) = _cashClaim();

        vm.prank(creator);
        debts.challenge(claimId);
        uint64 deadline = debts.claim(claimId).responseDeadline;

        vm.expectRevert(
            abi.encodeWithSelector(DebtLedger.ResponseWindowOpen.selector, claimId, deadline)
        );
        debts.voidChallenged(claimId);
    }

    function test_aVoidNeedsAChallenge() public {
        (, uint256 claimId) = _cashClaim();

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.ClaimNotChallenged.selector, claimId));
        debts.voidChallenged(claimId);
    }

    function test_thePenaltySplitsBetweenTheWrongedPartiesAndThePool() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();

        vm.prank(creator);
        debts.challenge(claimId);
        vm.warp(debts.claim(claimId).responseDeadline + 1);
        debts.voidChallenged(claimId);

        uint256 creatorDebt = debts.debt(ids[0]).amount;
        uint256 penalty = creatorDebt * PENALTY_BPS / 10_000;

        assertEq(debts.penaltyOwed(creator, CURRENCY), penalty - penalty / 2);
        assertEq(debts.penaltyOwed(landlord, CURRENCY) > 0, true);
        assertEq(debts.poolPenaltyOwed(CURRENCY) > 0, true);

        // 1% of the claimed amount, half to the wronged parties and half to the pool.
        uint256 claimed = debts.claim(claimId).totalAmount;
        uint256 total = debts.penaltyOwed(creator, CURRENCY) + debts.penaltyOwed(landlord, CURRENCY)
            + debts.penaltyOwed(communityMember, CURRENCY) + debts.poolPenaltyOwed(CURRENCY);
        assertEq(total, claimed * PENALTY_BPS / 10_000);
    }

    function test_thePenaltyDoublesWithEveryVoid() public {
        assertEq(debts.penaltyRateBps(), PENALTY_BPS);

        _voidOnce();
        assertEq(debts.voidCount(), 1);
        assertEq(debts.penaltyRateBps(), uint256(PENALTY_BPS) * 2);

        _voidOnce();
        assertEq(debts.voidCount(), 2);
        assertEq(debts.penaltyRateBps(), uint256(PENALTY_BPS) * 4);
    }

    function _voidOnce() internal {
        IDebtLedger.Leg[] memory legs = new IDebtLedger.Leg[](1);
        legs[0] = IDebtLedger.Leg(Types.Role.CREATOR, creator, 1e18);

        vm.prank(address(gateway));
        uint256[] memory ids =
            debts.mintSaleDebts(SALE_REF, Types.Rail.CUSTODY, CURRENCY, legs, bytes32(0));

        vm.prank(operator);
        uint256 claimId = debts.postClaim(ids, CLAIM_REF);

        vm.prank(creator);
        debts.challenge(claimId);

        vm.warp(debts.claim(claimId).responseDeadline + 1);
        debts.voidChallenged(claimId);
    }

    /// @dev An instant-rail debt is not custody exposure only for as long as the rail's own claim
    ///      stands. When that claim dies, the money is demonstrably in the operator's hands after
    ///      all — and the ledger says so.
    function test_aVoidedInstantClaimPutsTheMoneyBackIntoCustody() public {
        uint256[] memory ids = _mintSale(Types.Rail.INSTANT, CLAIM_REF);
        assertEq(debts.outstanding(), 0);

        vm.prank(creator);
        debts.challenge(1);

        vm.warp(debts.claim(1).responseDeadline + 1);
        debts.voidChallenged(1);

        assertEq(uint8(debts.debt(ids[0]).state), uint8(Types.DebtState.AGING));
        assertEq(debts.outstanding(), SALE_PRICE * 8750 / 10_000);
    }

    // --- The sweep's seam ---

    function test_onlyTheSweepProvesOrVoidsThroughCoverage() public {
        (, uint256 claimId) = _cashClaim();

        vm.expectRevert(DebtLedger.NotSweep.selector);
        vm.prank(operator);
        debts.proveClaim(claimId);

        vm.expectRevert(DebtLedger.NotSweep.selector);
        vm.prank(operator);
        debts.voidClaim(claimId);
    }

    function test_coverageProvesAClaimEvenBeforeItsWindowCloses() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();

        vm.prank(_sweep());
        debts.proveClaim(claimId);

        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.PROVEN));
        assertEq(uint8(debts.debt(ids[0]).state), uint8(Types.DebtState.PROVEN));
        assertEq(debts.outstanding(), 0);
    }

    /// @dev The sleeping recipient's case: nobody challenged, the window closed, and no evidence
    ///      ever arrived. The claim dies of the coverage deadline instead.
    function test_anUncoveredClaimVoidsAndTheDebtComesBack() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();

        vm.warp(block.timestamp + CHALLENGE_WINDOW + 1);
        debts.settleClaim(claimId);
        assertEq(debts.outstanding(), 0);

        // The coverage deadline outlives the settlement deadline, so by the time a claim dies of
        // never being attested the debt beneath it is already late.
        vm.warp(block.timestamp + SETTLEMENT_WINDOW);
        vm.prank(_sweep());
        debts.voidClaim(claimId);

        assertEq(uint8(debts.claim(claimId).state), uint8(Types.ClaimState.VOIDED));
        assertEq(uint8(debts.debt(ids[0]).state), uint8(Types.DebtState.AGING));
        assertEq(debts.outstanding(), SALE_PRICE * 8750 / 10_000);
        assertTrue(debts.isDefaultable(ids[0]));
    }

    function test_coverageCannotVoidAClaimTheOperatorStillHasTimeToAnswer() public {
        (, uint256 claimId) = _cashClaim();

        vm.prank(creator);
        debts.challenge(claimId);
        uint64 deadline = debts.claim(claimId).responseDeadline;

        vm.expectRevert(
            abi.encodeWithSelector(DebtLedger.ResponseWindowOpen.selector, claimId, deadline)
        );
        vm.prank(_sweep());
        debts.voidClaim(claimId);
    }

    function test_aTerminalClaimIsBeyondTheSweep() public {
        (, uint256 claimId) = _cashClaim();

        vm.prank(_sweep());
        debts.proveClaim(claimId);

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.ClaimNotLive.selector, claimId));
        vm.prank(_sweep());
        debts.voidClaim(claimId);
    }

    // --- Default ---

    /// @dev A claim suspends default only while its windows run. It does not suspend it by
    ///      existing, and it cannot suspend it by lasting.
    function test_aLiveClaimHoldsDefaultOff() public {
        (uint256[] memory ids, uint256 claimId) = _cashClaim();
        claimId;

        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);
        assertFalse(debts.isDefaultable(ids[0]));

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.NotDefaulted.selector, ids[0]));
        vm.prank(_pool());
        debts.markDefaulted(ids[0]);
    }

    function test_onlyThePoolMarksADefault() public {
        uint256[] memory ids = _mintSale(Types.Rail.CUSTODY, bytes32(0));
        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);

        vm.expectRevert(DebtLedger.NotPool.selector);
        vm.prank(operator);
        debts.markDefaulted(ids[0]);
    }

    function test_aDebtCannotDefaultBeforeItsDeadline() public {
        uint256[] memory ids = _mintSale(Types.Rail.CUSTODY, bytes32(0));

        assertFalse(debts.isDefaultable(ids[0]));
        vm.expectRevert(abi.encodeWithSelector(DebtLedger.NotDefaulted.selector, ids[0]));
        vm.prank(_pool());
        debts.markDefaulted(ids[0]);
    }

    function test_defaultingMovesTheExposureOffThisLedger() public {
        uint256[] memory ids = _mintSale(Types.Rail.CUSTODY, bytes32(0));
        uint256 before = debts.outstanding();
        uint256 amount = debts.debt(ids[0]).amount;

        vm.warp(block.timestamp + SETTLEMENT_WINDOW + 1);
        assertTrue(debts.isDefaultable(ids[0]));

        vm.prank(_pool());
        debts.markDefaulted(ids[0]);

        assertEq(uint8(debts.debt(ids[0]).state), uint8(Types.DebtState.DEFAULTED));
        assertEq(debts.outstanding(), before - amount);
    }

    // --- Buyer obligations ---

    function test_aBuyersPrepaymentIsExposureUntilTheOrderIsDelivered() public {
        uint64 deadline = uint64(block.timestamp) + FULFILMENT_WINDOW;

        vm.prank(address(gateway));
        uint256 id = debts.mintObligation(SALE_REF, buyer, SALE_PRICE, CURRENCY, deadline);

        IDebtLedger.Debt memory owed = debts.debt(id);
        assertEq(uint8(owed.role), uint8(Types.Role.BUYER));
        assertEq(uint8(owed.state), uint8(Types.DebtState.AGING));
        assertEq(owed.amount, SALE_PRICE);
        assertEq(debts.outstanding(), SALE_PRICE);

        vm.prank(address(gateway));
        debts.dischargeObligation(id);

        assertEq(uint8(debts.debt(id).state), uint8(Types.DebtState.DISCHARGED));
        assertEq(debts.outstanding(), 0);
    }

    function test_onlyAnObligationIsDischargeable() public {
        uint256[] memory ids = _mintSale(Types.Rail.CUSTODY, bytes32(0));

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.NotAnObligation.selector, ids[0]));
        vm.prank(address(gateway));
        debts.dischargeObligation(ids[0]);
    }

    function test_anObligationIsDischargedOnce() public {
        vm.prank(address(gateway));
        uint256 id = debts.mintObligation(
            SALE_REF, buyer, SALE_PRICE, CURRENCY, uint64(block.timestamp) + FULFILMENT_WINDOW
        );

        vm.prank(address(gateway));
        debts.dischargeObligation(id);

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.DebtNotOpen.selector, id));
        vm.prank(address(gateway));
        debts.dischargeObligation(id);
    }

    // --- Wiring and reads ---

    function test_theWiringIsSetOnceAndOnlyByTheOperator() public {
        vm.expectRevert(DebtLedger.NotOperator.selector);
        vm.prank(stranger);
        debts.setPool(stranger);

        vm.startPrank(operator);

        vm.expectRevert(DebtLedger.PoolAlreadySet.selector);
        debts.setPool(stranger);

        vm.expectRevert(DebtLedger.SweepAlreadySet.selector);
        debts.setSweepRegistry(stranger);

        vm.expectRevert(DebtLedger.GatewayAlreadySet.selector);
        debts.setSaleGateway(stranger);

        vm.expectRevert(DebtLedger.ZeroAddress.selector);
        debts.setPool(address(0));

        vm.stopPrank();
    }

    function test_readingWhatDoesNotExistReverts() public {
        vm.expectRevert(abi.encodeWithSelector(DebtLedger.UnknownDebt.selector, 99));
        debts.debt(99);

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.UnknownDebt.selector, 99));
        debts.isDefaultable(99);

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.UnknownClaim.selector, 99));
        debts.claim(99);

        vm.expectRevert(abi.encodeWithSelector(DebtLedger.UnknownClaim.selector, 99));
        debts.statementOf(99);
    }

    function test_theLedgerRefusesNonsenseParameters() public {
        vm.expectRevert(DebtLedger.ZeroAddress.selector);
        new DebtLedger(address(0), proofs, 1, 1, 1, 100);

        vm.expectRevert(DebtLedger.ZeroAddress.selector);
        new DebtLedger(operator, StubProofVerifier(address(0)), 1, 1, 1, 100);

        vm.expectRevert(DebtLedger.InvalidWindow.selector);
        new DebtLedger(operator, proofs, 0, 1, 1, 100);

        vm.expectRevert(DebtLedger.InvalidWindow.selector);
        new DebtLedger(operator, proofs, 1, 0, 1, 100);

        vm.expectRevert(DebtLedger.InvalidWindow.selector);
        new DebtLedger(operator, proofs, 1, 1, 0, 100);

        vm.expectRevert(DebtLedger.InvalidPenalty.selector);
        new DebtLedger(operator, proofs, 1, 1, 1, 0);

        vm.expectRevert(DebtLedger.InvalidPenalty.selector);
        new DebtLedger(operator, proofs, 1, 1, 1, 10_001);
    }
}
