// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {CreatorRegistry} from "../identity/CreatorRegistry.sol";
import {ItemLedger} from "../items/ItemLedger.sol";
import {PriceBook} from "../items/PriceBook.sol";
import {IDebtLedger} from "../interfaces/IDebtLedger.sol";
import {ISaleAuthorizer} from "../interfaces/ISaleAuthorizer.sol";
import {IWriteOffSink} from "../interfaces/IWriteOffSink.sol";
import {ClaimCodes} from "../libs/ClaimCodes.sol";
import {Types} from "../libs/Types.sol";
import {WindowMath} from "../libs/WindowMath.sol";

/// @title SaleGateway
/// @notice The only path by which an item is consumed, and the reason the ledger can be trusted:
///         a sale is one transaction that checks the tag, checks the shelf, checks the ceiling,
///         consumes the item, mints what is owed and issues the certificate. There is no ordering
///         in which the operator can take the money and skip a step, because the steps are one
///         step.
/// @dev Every sub-call reverts the whole sale on failure — the item is not consumed unless the
///      debts are minted, and the debts are not minted unless the ceiling allowed the exposure.
///
///      The reentrancy guard is transient because the authorizer is a foreign contract by design
///      (the ceiling is swappable), and a foreign call inside a sale is a foreign call.
contract SaleGateway is ReentrancyGuardTransient {
    using WindowMath for uint64;

    uint256 internal constant BPS = 10_000;

    /// @notice The published split, in basis points. Economics are deployment parameters, never
    ///         literals in logic: a demo and a production deployment run the same code.
    struct Splits {
        uint16 creatorBps;
        uint16 landlordBps;
        uint16 communityBps;
        uint16 operatorBps;
    }

    /// @notice Everything a sale needs to prove it is entitled to consume an item.
    struct SaleInput {
        CreatorRegistry.ItemVoucher voucher;
        bytes signature;
        uint256 trancheId;
        bytes32[] proof;
        bytes32 claimCodeHash;
        bytes32 certificateCommitment;
        address communityRecipient;
        bytes32 communityVoucherHash;
    }

    /// @notice A write-off: the item is gone, and the tag still has to prove it was ever real.
    /// @dev No claim code and no certificate — nobody bought anything. No community voucher either:
    ///      there was no sale, so there was no referral to attribute. The evidence (the incident
    ///      report, the photographs, the insurer's file) lives in storage and is committed to here by
    ///      hash, so it cannot be swapped afterwards for a better story.
    struct WriteOff {
        CreatorRegistry.ItemVoucher voucher;
        bytes signature;
        uint256 trancheId;
        bytes32[] proof;
        bytes32 evidenceHash;
        bytes32 storagePointer;
    }

    /// @notice An order taken and paid for, not yet fulfilled.
    struct Commitment {
        address buyer;
        uint128 price;
        uint256 refundDebtId;
        bytes32 claimCodeHash;
        bytes32 certificateCommitment;
        address communityRecipient;
        bytes32 communityVoucherHash;
    }

    struct Certificate {
        bytes32 claimCodeHash;
        bytes32 commitment;
    }

    /// @notice What a write-off costs, split into the numbers the argument is made of.
    struct WriteOffMath {
        uint256 creatorAmount;
        uint256 landlordAmount;
        uint256 unattributed;
        uint256 paidAsSold;
        uint256 penalty;
        uint256 honestCommission;
    }

    /// @dev A verified sale, resolved once and passed down.
    struct Context {
        uint256 itemId;
        uint256 trancheId;
        address creator;
        address landlord;
        bytes32 currency;
        uint256 price;
    }

    address public immutable operator;

    /// @notice Where the operator's own leg is owed. Kept distinct from the key that signs
    ///         transactions: a hot key that runs sales is not a treasury.
    address public immutable operatorRecipient;

    CreatorRegistry public immutable registry;
    ItemLedger public immutable items;
    PriceBook public immutable prices;
    IDebtLedger public immutable debts;
    ISaleAuthorizer public immutable authorizer;

    /// @notice Where a write-off's dues are recorded. The pool, in every deployment — but held here
    ///         as the seam it is, because the gateway's business with the treasury is one sentence
    ///         long: this burn owes the fund this much.
    IWriteOffSink public immutable writeOffs;

    uint32 public immutable fulfilmentWindow;

    uint16 public immutable creatorBps;
    uint16 public immutable landlordBps;
    uint16 public immutable communityBps;
    uint16 public immutable operatorBps;

    /// @notice The write-off fee, as a share of the list price.
    /// @dev This is the entire deterrent against laundering a sale as shrinkage, and it is one
    ///      number. A write-off already pays every other party as if the item had sold, so an
    ///      operator that sells for cash off the books and then writes the item off has spent 87.5%
    ///      of the price to keep 100% of it — and this fee is what takes the remainder below the
    ///      12.5% it would have earned by simply being honest. Bounded by the commission it eats:
    ///      at the bound, a write-off earns the operator exactly nothing, which is the most a
    ///      pay-as-sold rule can say.
    uint16 public immutable burnPenaltyBps;

    /// @notice keccak256(abi.encode(creatorBps, landlordBps, communityBps, operatorBps)).
    /// @dev The voucher a creator signs names the split she consigned under. A voucher that names
    ///      a different split cannot be sold here — the shelf and the paper have to agree about
    ///      what she was promised.
    bytes32 public immutable splitPolicy;

    mapping(uint256 itemId => Commitment) private _commitments;
    mapping(uint256 itemId => Certificate) private _certificates;

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
    event Fulfilled(uint256 indexed itemId, address indexed buyer, uint256 price);
    event CommitmentExpired(uint256 indexed itemId, address indexed buyer, uint256 refundDebtId);
    event CertificateIssued(uint256 indexed itemId, bytes32 claimCodeHash, bytes32 commitment);
    event CertificateRedeemed(uint256 indexed itemId, address indexed owner);

    /// @notice The arithmetic of a write-off, emitted so it can be displayed rather than narrated.
    /// @param paidAsSold What the write-off pays out: every non-operator share of the list price.
    /// @param penalty The write-off fee, owed to the pool.
    /// @param honestCommission What an honest sale of this item would have earned the operator.
    /// @param launderedNet What writing it off earns the operator instead, if it sold the item off
    ///        the books at list price first — which is the best case for the launderer, and is still
    ///        the honest commission minus the fee. This is the number that closes the door: it is
    ///        strictly smaller than `honestCommission`, for every price, at every parameter setting.
    event Burned(
        uint256 indexed itemId,
        uint256 indexed trancheId,
        bytes32 indexed evidenceHash,
        uint256 price,
        bytes32 currency,
        uint256 paidAsSold,
        uint256 penalty,
        uint256 honestCommission,
        uint256 launderedNet,
        bytes32 storagePointer,
        uint256[] debtIds
    );

    error NotOperator();
    error ZeroAddress();
    error InvalidSplit();
    error InvalidWindow();
    error InvalidPenalty();
    error MissingEvidence();
    error UnknownSplitPolicy(bytes32 presented, bytes32 expected);
    error CreatorMismatch(uint256 voucherCreatorId, uint256 trancheCreatorId);
    error NotInTranche(uint256 itemId, uint256 trancheId);
    error MissingClaimRef();
    error MissingCertificate();
    error InvalidCommunityVoucher();
    error NoCommitment(uint256 itemId);
    error NoCertificate(uint256 itemId);
    error BadClaimCode(uint256 itemId);

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(
        address operator_,
        address operatorRecipient_,
        CreatorRegistry registry_,
        ItemLedger items_,
        PriceBook prices_,
        IDebtLedger debts_,
        ISaleAuthorizer authorizer_,
        IWriteOffSink writeOffs_,
        Splits memory splits_,
        uint16 burnPenaltyBps_,
        uint32 fulfilmentWindow_
    ) {
        if (
            operator_ == address(0) || operatorRecipient_ == address(0)
                || address(registry_) == address(0) || address(items_) == address(0)
                || address(prices_) == address(0) || address(debts_) == address(0)
                || address(authorizer_) == address(0) || address(writeOffs_) == address(0)
        ) {
            revert ZeroAddress();
        }
        if (fulfilmentWindow_ == 0) revert InvalidWindow();
        if (
            uint256(splits_.creatorBps) + splits_.landlordBps + splits_.communityBps
                    + splits_.operatorBps != BPS
        ) {
            revert InvalidSplit();
        }
        // A write-off fee larger than the commission it forfeits would make the laundering
        // arithmetic run backwards, and a fee of zero would make a write-off exactly as good as an
        // honest sale. The deterrent lives strictly between those two.
        if (burnPenaltyBps_ == 0 || burnPenaltyBps_ > splits_.operatorBps) revert InvalidPenalty();

        operator = operator_;
        operatorRecipient = operatorRecipient_;
        registry = registry_;
        items = items_;
        prices = prices_;
        debts = debts_;
        authorizer = authorizer_;
        writeOffs = writeOffs_;
        burnPenaltyBps = burnPenaltyBps_;
        fulfilmentWindow = fulfilmentWindow_;

        creatorBps = splits_.creatorBps;
        landlordBps = splits_.landlordBps;
        communityBps = splits_.communityBps;
        operatorBps = splits_.operatorBps;
        splitPolicy = keccak256(
            abi.encode(
                splits_.creatorBps, splits_.landlordBps, splits_.communityBps, splits_.operatorBps
            )
        );
    }

    /// @notice Sells an item on a rail that split the payment as it happened.
    /// @param claimRef The payment reference the rail reported. The debts open provisional against
    ///        it: the operator has said which payment this was, and can be made to prove it.
    function sellInstant(SaleInput calldata input, bytes32 claimRef)
        external
        onlyOperator
        nonReentrant
        returns (uint256[] memory debtIds)
    {
        if (claimRef == bytes32(0)) revert MissingClaimRef();
        return _sell(input, Types.Rail.INSTANT, claimRef);
    }

    /// @notice Sells an item for money the operator takes into its own hands.
    /// @dev No claim is attached, because none exists yet: the recipients have not been paid. The
    ///      debts age from this second, and the ceiling is checked before the item is consumed.
    function sellCash(SaleInput calldata input)
        external
        onlyOperator
        nonReentrant
        returns (uint256[] memory debtIds)
    {
        return _sell(input, Types.Rail.CUSTODY, bytes32(0));
    }

    /// @notice Takes a buyer's order and money for an item that has not been handed over yet.
    /// @dev The full price is the exposure: the operator is holding a stranger's money against a
    ///      promise. The refund the buyer is owed if that promise fails is minted here as an
    ///      ordinary debt, so it ages, defaults and is covered by exactly the machinery that
    ///      covers an unpaid creator. There is no separate refund path to get wrong.
    function commitOption(SaleInput calldata input, address buyer)
        external
        onlyOperator
        nonReentrant
        returns (uint256 refundDebtId)
    {
        if (buyer == address(0)) revert ZeroAddress();
        _requireCertificate(input.claimCodeHash, input.certificateCommitment);
        _requireCommunityVoucher(input.communityRecipient, input.communityVoucherHash);

        Context memory context =
            _resolve(input.voucher, input.signature, input.trancheId, input.proof);
        authorizer.authorize(context.price, Types.Rail.CUSTODY);

        uint64 deadline = uint64(block.timestamp).deadlineFrom(fulfilmentWindow);
        items.markCommitted(context.itemId, context.trancheId, deadline);
        refundDebtId =
            debts.mintObligation(context.itemId, buyer, context.price, context.currency, deadline);

        _commitments[context.itemId] = Commitment({
            buyer: buyer,
            price: SafeCast.toUint128(context.price),
            refundDebtId: refundDebtId,
            claimCodeHash: input.claimCodeHash,
            certificateCommitment: input.certificateCommitment,
            communityRecipient: input.communityRecipient,
            communityVoucherHash: input.communityVoucherHash
        });

        emit Committed(context.itemId, buyer, context.price, deadline, refundDebtId);
    }

    /// @notice Delivers a committed order: the item is the buyer's, and the split is owed.
    /// @dev The legs are minted against the price captured when the order was placed, not the
    ///      price in force today. A buyer is charged what they were shown, and a repricing that
    ///      matures during the fulfilment window cannot reach backwards into a sale that has
    ///      already happened.
    ///
    ///      No authorization is taken here. Fulfilment lowers custody exposure — a refund
    ///      obligation for the whole price is discharged and replaced by legs worth less than it —
    ///      and requiring headroom to *reduce* exposure would let a shrinking ceiling strand a
    ///      buyer whose order the operator is standing there ready to deliver.
    function fulfilCommitment(uint256 itemId)
        external
        onlyOperator
        nonReentrant
        returns (uint256[] memory debtIds)
    {
        Commitment memory order = _commitments[itemId];
        if (order.buyer == address(0)) revert NoCommitment(itemId);

        ItemLedger.Item memory item = items.itemOf(itemId);
        ItemLedger.Tranche memory tranche = items.tranche(item.trancheId);

        items.markFulfilled(itemId);
        debts.dischargeObligation(order.refundDebtId);

        Context memory context = Context({
            itemId: itemId,
            trancheId: item.trancheId,
            creator: registry.keyOf(tranche.creatorId),
            landlord: tranche.landlord,
            currency: tranche.currency,
            price: order.price
        });
        (IDebtLedger.Leg[] memory legs,) =
            _split(context, order.communityRecipient, order.communityVoucherHash);

        debtIds =
            debts.mintSaleDebts(itemId, Types.Rail.CUSTODY, tranche.currency, legs, bytes32(0));
        _issueCertificate(itemId, order.claimCodeHash, order.certificateCommitment);
        delete _commitments[itemId];

        emit Sold(
            itemId,
            item.trancheId,
            Types.Rail.CUSTODY,
            order.price,
            tranche.currency,
            bytes32(0),
            debtIds
        );
        emit Fulfilled(itemId, order.buyer, order.price);
    }

    /// @notice Releases an order the operator failed to fulfil in time.
    /// @dev Permissionless. A buyer's way out cannot run through the party that let them down: any
    ///      account may call this, and the refund obligation it leaves behind is an aged debt that
    ///      the default path covers without the operator's cooperation.
    function expireCommitment(uint256 itemId) external nonReentrant {
        Commitment memory order = _commitments[itemId];
        if (order.buyer == address(0)) revert NoCommitment(itemId);

        items.releaseCommitment(itemId);
        delete _commitments[itemId];

        emit CommitmentExpired(itemId, order.buyer, order.refundDebtId);
    }

    /// @notice Redeems the certificate of a sold item to the account presenting its claim code.
    /// @dev Permissionless: whoever holds the code holds the certificate, and needing the operator
    ///      to hand over what a buyer already paid for would be the same dependency this protocol
    ///      exists to remove. The code's weaknesses as a bearer secret are documented where it is
    ///      hashed.
    function redeemCertificate(uint256 itemId, bytes32 code, address owner) external nonReentrant {
        if (owner == address(0)) revert ZeroAddress();

        Certificate memory certificate = _certificates[itemId];
        if (certificate.claimCodeHash == bytes32(0)) revert NoCertificate(itemId);
        if (ClaimCodes.commitment(itemId, code) != certificate.claimCodeHash) {
            revert BadClaimCode(itemId);
        }

        items.markOwned(itemId, owner);

        emit CertificateRedeemed(itemId, owner);
    }

    /// @notice Writes an item off, paying everyone as if it had sold.
    /// @dev The dangerous door in every retail system, closed by pricing rather than by paperwork.
    ///      Damage, loss, theft, "unexplained shrinkage" — the historical laundering route is to sell
    ///      an item for cash off the books and then declare it destroyed. So a write-off here costs
    ///      the operator every share of the sale it did not keep: the creator is paid her 80% and the
    ///      landlord his 5%, exactly as a sale would have paid them, and the referral share of a sale
    ///      that never happened is owed to the pool rather than pocketed. Then the fee. What is left
    ///      for the launderer is the operator's own commission, minus the fee — strictly less than
    ///      the commission it would have earned by ringing the sale up honestly. There is no evidence
    ///      to fake, because the price is the price.
    ///
    ///      Two consequences worth stating out loud. The recipients are *financially indifferent*
    ///      between "your item sold" and "your item was destroyed" — that is the promise the split
    ///      makes, and it is why the payout is exactly the as-if-sold amount and not a penny more.
    ///      And the payouts are minted as ordinary debts, on the ordinary clock: a write-off is a
    ///      real obligation that ages, defaults, and is covered by the pool if the operator does not
    ///      pay it. Declaring the loss is not the same as bearing it.
    ///
    ///      No ceiling authorization is taken. A write-off is the operator being made to pay, and a
    ///      punishment that a full ceiling could block would be a punishment the operator could
    ///      escape by filling its own ceiling. The debts it mints do consume headroom afterwards, so
    ///      the write-off tightens the ceiling on the *next* sale — which is the correct direction.
    function burn(WriteOff calldata input)
        external
        onlyOperator
        nonReentrant
        returns (uint256[] memory debtIds)
    {
        if (input.evidenceHash == bytes32(0)) revert MissingEvidence();

        Context memory context =
            _resolve(input.voucher, input.signature, input.trancheId, input.proof);
        WriteOffMath memory sums = _writeOffMath(context.price);

        IDebtLedger.Leg[] memory legs = new IDebtLedger.Leg[](2);
        legs[0] = IDebtLedger.Leg(Types.Role.CREATOR, context.creator, sums.creatorAmount);
        legs[1] = IDebtLedger.Leg(Types.Role.LANDLORD, context.landlord, sums.landlordAmount);

        items.markBurned(context.itemId, context.trancheId);
        debtIds = debts.mintSaleDebts(
            context.itemId, Types.Rail.CUSTODY, context.currency, legs, bytes32(0)
        );
        writeOffs.accrueWriteOff(context.itemId, context.currency, sums.penalty, sums.unattributed);

        emit Burned(
            context.itemId,
            context.trancheId,
            input.evidenceHash,
            context.price,
            context.currency,
            sums.paidAsSold,
            sums.penalty,
            sums.honestCommission,
            sums.honestCommission - sums.penalty,
            input.storagePointer,
            debtIds
        );
    }

    /// @notice What a write-off of an item at this price costs, and what it leaves the operator.
    /// @dev Public because the arithmetic is the argument. The web's burn panel reads it, and so can
    ///      anyone else who wants to check that the door is really shut: for every price and every
    ///      parameter setting this contract can be deployed with, `honestCommission - penalty` is
    ///      strictly less than `honestCommission`.
    ///
    ///      Integer division floors the two payable legs. The remainder rides with the unattributed
    ///      share into the pool, never into the operator's pocket — so the operator forfeits exactly
    ///      its published commission, and the recipients are paid exactly their published shares.
    function _writeOffMath(uint256 price) internal view returns (WriteOffMath memory sums) {
        sums.honestCommission = price * operatorBps / BPS;
        sums.paidAsSold = price - sums.honestCommission;
        sums.creatorAmount = price * creatorBps / BPS;
        sums.landlordAmount = price * landlordBps / BPS;
        sums.unattributed = sums.paidAsSold - sums.creatorAmount - sums.landlordAmount;
        sums.penalty = price * burnPenaltyBps / BPS;
    }

    function commitmentOf(uint256 itemId) external view returns (Commitment memory) {
        return _commitments[itemId];
    }

    function certificateOf(uint256 itemId) external view returns (Certificate memory) {
        return _certificates[itemId];
    }

    function _sell(SaleInput calldata input, Types.Rail rail, bytes32 claimRef)
        internal
        returns (uint256[] memory debtIds)
    {
        _requireCertificate(input.claimCodeHash, input.certificateCommitment);
        _requireCommunityVoucher(input.communityRecipient, input.communityVoucherHash);

        Context memory context =
            _resolve(input.voucher, input.signature, input.trancheId, input.proof);
        (IDebtLedger.Leg[] memory legs, uint256 exposure) =
            _split(context, input.communityRecipient, input.communityVoucherHash);

        authorizer.authorize(exposure, rail);
        items.markSold(context.itemId, context.trancheId);
        debtIds = debts.mintSaleDebts(context.itemId, rail, context.currency, legs, claimRef);
        _issueCertificate(context.itemId, input.claimCodeHash, input.certificateCommitment);

        emit Sold(
            context.itemId,
            context.trancheId,
            rail,
            context.price,
            context.currency,
            claimRef,
            debtIds
        );
    }

    /// @dev The checks, in the order that gives an honest answer: is this tag genuine, is it in
    ///      this consignment, was it sold under the split the creator agreed to, is it still on
    ///      the shelf, and what does it cost right now. A tag that was already sold says so — it
    ///      does not fail later on a ceiling and leave the buyer wondering.
    function _resolve(
        CreatorRegistry.ItemVoucher calldata voucher,
        bytes calldata signature,
        uint256 trancheId,
        bytes32[] calldata proof
    ) internal view returns (Context memory context) {
        bytes32 digest = registry.requireValidVoucher(voucher, signature);
        ItemLedger.Tranche memory tranche = items.tranche(trancheId);

        if (voucher.creatorId != tranche.creatorId) {
            revert CreatorMismatch(voucher.creatorId, tranche.creatorId);
        }
        if (voucher.splitPolicyRef != splitPolicy) {
            revert UnknownSplitPolicy(voucher.splitPolicyRef, splitPolicy);
        }
        if (!items.verifyMembership(trancheId, digest, proof)) {
            revert NotInTranche(voucher.itemId, trancheId);
        }
        items.requireAvailable(voucher.itemId);

        context = Context({
            itemId: voucher.itemId,
            trancheId: trancheId,
            creator: registry.keyOf(tranche.creatorId),
            landlord: tranche.landlord,
            currency: tranche.currency,
            price: prices.effectivePriceIn(voucher.itemId, trancheId)
        });
    }

    /// @dev Integer division floors every beneficiary's leg and the remainder lands in the
    ///      operator's, so the parties are never short a wei and the legs always sum to the price.
    ///      The community leg mints only against a presented voucher; absent one, that share is
    ///      owed to nobody and no debt exists for it — the operator's leg stays exactly its
    ///      published share.
    function _split(
        Context memory context,
        address communityRecipient,
        bytes32 communityVoucherHash
    ) internal view returns (IDebtLedger.Leg[] memory legs, uint256 exposure) {
        bool hasCommunity = communityVoucherHash != bytes32(0);
        uint256 price = context.price;

        uint256 creatorAmount = price * creatorBps / BPS;
        uint256 landlordAmount = price * landlordBps / BPS;
        uint256 communityAmount = hasCommunity ? price * communityBps / BPS : 0;
        uint256 unmintedCommunity = hasCommunity ? 0 : price * communityBps / BPS;
        uint256 operatorAmount =
            price - creatorAmount - landlordAmount - communityAmount - unmintedCommunity;

        exposure = creatorAmount + landlordAmount + communityAmount;

        legs = new IDebtLedger.Leg[](hasCommunity ? 4 : 3);
        legs[0] = IDebtLedger.Leg(Types.Role.CREATOR, context.creator, creatorAmount);
        legs[1] = IDebtLedger.Leg(Types.Role.LANDLORD, context.landlord, landlordAmount);
        uint256 next = 2;
        if (hasCommunity) {
            legs[2] = IDebtLedger.Leg(Types.Role.COMMUNITY, communityRecipient, communityAmount);
            next = 3;
        }
        legs[next] = IDebtLedger.Leg(Types.Role.OPERATOR, operatorRecipient, operatorAmount);
    }

    function _issueCertificate(uint256 itemId, bytes32 claimCodeHash, bytes32 commitment) internal {
        _certificates[itemId] = Certificate({claimCodeHash: claimCodeHash, commitment: commitment});
        emit CertificateIssued(itemId, claimCodeHash, commitment);
    }

    function _requireCertificate(bytes32 claimCodeHash, bytes32 commitment) internal pure {
        if (claimCodeHash == bytes32(0) || commitment == bytes32(0)) revert MissingCertificate();
    }

    /// @dev A community leg needs a voucher and a recipient, or neither. Half of a referral is not
    ///      a referral.
    function _requireCommunityVoucher(address recipient, bytes32 voucherHash) internal pure {
        if ((voucherHash != bytes32(0)) != (recipient != address(0))) {
            revert InvalidCommunityVoucher();
        }
    }
}
