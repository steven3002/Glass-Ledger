// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {CreatorRegistry} from "../../src/identity/CreatorRegistry.sol";
import {DebtLedger} from "../../src/debt/DebtLedger.sol";
import {IDebtLedger} from "../../src/interfaces/IDebtLedger.sol";
import {ItemLedger} from "../../src/items/ItemLedger.sol";
import {PriceBook} from "../../src/items/PriceBook.sol";
import {SaleGateway} from "../../src/sale/SaleGateway.sol";
import {IProofVerifier} from "../../src/oracle/IProofVerifier.sol";
import {StubProofVerifier} from "../../src/oracle/StubProofVerifier.sol";
import {ClaimCodes} from "../../src/libs/ClaimCodes.sol";
import {Types} from "../../src/libs/Types.sol";
import {MerkleBuilder} from "./MerkleBuilder.sol";
import {MockAuthorizer} from "./MockAuthorizer.sol";

/// @notice A deployed protocol with one creator, one consignment of thirteen items, a seeded price
///         book and every payable party's account on file — the demo's opening state, and the
///         ground every suite stands on.
abstract contract Fixture is Test {
    uint32 internal constant SETTLEMENT_WINDOW = 3 minutes;
    uint32 internal constant CHALLENGE_WINDOW = 2 minutes;
    uint32 internal constant RESPONSE_WINDOW = 1 minutes;
    uint32 internal constant FULFILMENT_WINDOW = 3 minutes;
    uint32 internal constant PRICE_EPOCH = 2 minutes;
    uint16 internal constant PENALTY_BPS = 100;
    uint32 internal constant ITEM_COUNT = 13;

    /// @notice One sale, for the suites that mint debts through the ledger's own seam rather than
    ///         by selling an item. The price is item zero's, so the arithmetic matches the demo's.
    uint256 internal constant SALE_PRICE = 100_000e18;
    uint256 internal constant SALE_REF = 1001;

    // The currency is a tag, not a number: a short ISO code widened into a word.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 internal constant CURRENCY = bytes32("NGN");
    bytes32 internal constant CLAIM_REF = keccak256("processor-payment-reference");

    uint16 internal constant CREATOR_BPS = 8000;
    uint16 internal constant LANDLORD_BPS = 500;
    uint16 internal constant COMMUNITY_BPS = 250;
    uint16 internal constant OPERATOR_BPS = 1250;

    address internal operator;
    address internal treasury;
    address internal landlord;
    address internal communityMember;
    address internal buyer;
    address internal stranger;
    address internal creator;
    uint256 internal creatorKey;
    address internal forger;
    uint256 internal forgerKey;

    CreatorRegistry internal registry;
    ItemLedger internal items;
    PriceBook internal prices;
    DebtLedger internal debts;
    MockAuthorizer internal authorizer;
    StubProofVerifier internal proofs;
    SaleGateway internal gateway;

    uint256 internal creatorId;
    uint256 internal trancheId;
    uint256[] internal itemIds;
    uint256[] internal itemPrices;
    bytes32[] internal leaves;

    function setUp() public virtual {
        operator = makeAddr("operator");
        treasury = makeAddr("treasury");
        landlord = makeAddr("landlord");
        communityMember = makeAddr("communityMember");
        buyer = makeAddr("buyer");
        stranger = makeAddr("stranger");
        (creator, creatorKey) = makeAddrAndKey("creator");
        (forger, forgerKey) = makeAddrAndKey("forger");

        registry = new CreatorRegistry(operator);
        items = new ItemLedger(operator, registry);
        prices = new PriceBook(items, registry, PRICE_EPOCH);
        proofs = new StubProofVerifier(operator);
        debts = new DebtLedger(
            operator, proofs, SETTLEMENT_WINDOW, CHALLENGE_WINDOW, RESPONSE_WINDOW, PENALTY_BPS
        );
        authorizer = new MockAuthorizer();
        gateway = new SaleGateway(
            operator,
            treasury,
            registry,
            items,
            prices,
            debts,
            authorizer,
            SaleGateway.Splits({
                creatorBps: CREATOR_BPS,
                landlordBps: LANDLORD_BPS,
                communityBps: COMMUNITY_BPS,
                operatorBps: OPERATOR_BPS
            }),
            FULFILMENT_WINDOW
        );

        vm.startPrank(operator);
        items.setSaleGateway(address(gateway));
        debts.setSaleGateway(address(gateway));
        creatorId = registry.register(creator);
        vm.stopPrank();

        // Every party who can be owed money says where they are to be paid, in their own name.
        // The operator's treasury registers nothing: its own leg is retained, never claimed.
        _registerAccount(creator);
        _registerAccount(landlord);
        _registerAccount(communityMember);
        _registerAccount(buyer);

        for (uint256 i = 0; i < ITEM_COUNT; ++i) {
            itemIds.push(1001 + i);
            itemPrices.push((100_000 + i * 10_000) * 1e18);
            leaves.push(registry.voucherDigest(_voucher(1001 + i)));
        }

        vm.prank(operator);
        trancheId = items.postTranche(
            creatorId, landlord, MerkleBuilder.root(leaves), ITEM_COUNT, CURRENCY, "Lagos - Ikoyi"
        );

        vm.prank(creator);
        prices.seed(trancheId, itemIds, itemPrices);
    }

    function _accountHash(address who) internal pure returns (bytes32) {
        return keccak256(abi.encode("account", who));
    }

    /// @notice The verdict a real verifier would compute for this claim's statement.
    /// @dev The statement is always the ledger's own — never one the caller composes. A suite that
    ///      wants to prove a *different* statement has to build it deliberately, which is the point.
    function _setVerdict(uint256 claimId, bool valid) internal {
        // Read the statement before arming the prank: an argument that makes its own call would
        // spend the impersonation on the read and leave the write to the test contract.
        IProofVerifier.Statement memory statement = debts.statementOf(claimId);
        vm.prank(operator);
        proofs.setVerdict(statement, valid);
    }

    /// @notice The four legs of one sale at the listed price, community voucher presented.
    function _saleLegs() internal view returns (IDebtLedger.Leg[] memory legs) {
        (
            uint256 creatorAmount,
            uint256 landlordAmount,
            uint256 communityAmount,
            uint256 operatorAmount
        ) = _legs(SALE_PRICE, true);

        legs = new IDebtLedger.Leg[](4);
        legs[0] = IDebtLedger.Leg(Types.Role.CREATOR, creator, creatorAmount);
        legs[1] = IDebtLedger.Leg(Types.Role.LANDLORD, landlord, landlordAmount);
        legs[2] = IDebtLedger.Leg(Types.Role.COMMUNITY, communityMember, communityAmount);
        legs[3] = IDebtLedger.Leg(Types.Role.OPERATOR, treasury, operatorAmount);
    }

    /// @notice A sale's debts, minted through the seam the gateway mints through.
    function _mintSale(Types.Rail rail, bytes32 claimRef) internal returns (uint256[] memory) {
        vm.prank(address(gateway));
        return debts.mintSaleDebts(SALE_REF, rail, CURRENCY, _saleLegs(), claimRef);
    }

    /// @dev The three legs a claim can cover: everything but the operator's own.
    function _payable(uint256[] memory debtIds) internal pure returns (uint256[] memory owed) {
        owed = new uint256[](3);
        owed[0] = debtIds[0];
        owed[1] = debtIds[1];
        owed[2] = debtIds[2];
    }

    /// @notice A cash sale, and the operator's assertion that it paid for it.
    function _cashClaim() internal returns (uint256[] memory debtIds, uint256 claimId) {
        debtIds = _mintSale(Types.Rail.CUSTODY, bytes32(0));
        vm.prank(operator);
        claimId = debts.postClaim(_payable(debtIds), CLAIM_REF);
    }

    function _registerAccount(address who) internal {
        vm.prank(who);
        debts.setAccountHash(CURRENCY, _accountHash(who));
    }

    function _voucher(uint256 itemId) internal view returns (CreatorRegistry.ItemVoucher memory) {
        return CreatorRegistry.ItemVoucher({
            creatorId: creatorId,
            itemId: itemId,
            metadataHash: keccak256(abi.encode("item", itemId)),
            splitPolicyRef: gateway.splitPolicy()
        });
    }

    function _sign(CreatorRegistry.ItemVoucher memory voucher, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.voucherDigest(voucher));
        return abi.encodePacked(r, s, v);
    }

    function _claimCode(uint256 index) internal view returns (bytes32) {
        return keccak256(abi.encode("claim-code", itemIds[index]));
    }

    /// @notice A sale of item `index` with no community voucher presented.
    function _input(uint256 index) internal view returns (SaleGateway.SaleInput memory) {
        CreatorRegistry.ItemVoucher memory voucher = _voucher(itemIds[index]);
        return SaleGateway.SaleInput({
            voucher: voucher,
            signature: _sign(voucher, creatorKey),
            trancheId: trancheId,
            proof: MerkleBuilder.proof(leaves, index),
            claimCodeHash: ClaimCodes.commitment(itemIds[index], _claimCode(index)),
            certificateCommitment: keccak256(abi.encode("certificate", itemIds[index])),
            communityRecipient: address(0),
            communityVoucherHash: bytes32(0)
        });
    }

    /// @notice The same sale, with a community voucher presented.
    function _inputWithCommunity(uint256 index)
        internal
        view
        returns (SaleGateway.SaleInput memory input)
    {
        input = _input(index);
        input.communityRecipient = communityMember;
        input.communityVoucherHash = keccak256(abi.encode("community-voucher", itemIds[index]));
    }

    function _legs(uint256 price, bool hasCommunity)
        internal
        pure
        returns (
            uint256 creatorAmount,
            uint256 landlordAmount,
            uint256 communityAmount,
            uint256 operatorAmount
        )
    {
        creatorAmount = price * CREATOR_BPS / 10_000;
        landlordAmount = price * LANDLORD_BPS / 10_000;
        communityAmount = hasCommunity ? price * COMMUNITY_BPS / 10_000 : 0;
        uint256 unminted = hasCommunity ? 0 : price * COMMUNITY_BPS / 10_000;
        operatorAmount = price - creatorAmount - landlordAmount - communityAmount - unminted;
    }
}
