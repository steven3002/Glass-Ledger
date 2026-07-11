// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title CreatorRegistry
/// @notice The root of trust. A tag is genuine because the creator signed a voucher for it, and
///         the creator is who this registry says she is. Everything downstream — Merkle
///         membership, the sale, the split — rests on the key recorded here.
/// @dev A creator's key is both the key that signs vouchers off-chain and the account that
///      writes her prices on-chain, so there is exactly one key behind every claim the protocol
///      makes on her behalf.
///
///      Production note: this registry has no key rotation. A creator who loses her key loses the
///      ability to consign and to reprice, and the vouchers she already signed stay valid because
///      they are bound to the key that signed them. Production adds rotation with a validity
///      window per key, so that a rotation invalidates future signatures without orphaning the
///      items already on shelves.
contract CreatorRegistry is EIP712 {
    /// @notice What a creator signs to consign an item. Identity only: the price is not in here.
    /// @dev Prices move on an epoch cadence and vouchers are immutable and signed once, so a
    ///      price inside a voucher would either freeze the price or require re-signing every
    ///      item on every change. The voucher says which item this is and under which published
    ///      split it may be sold; what it costs is a separate, publicly-posted fact.
    struct ItemVoucher {
        uint256 creatorId;
        uint256 itemId;
        bytes32 metadataHash;
        bytes32 splitPolicyRef;
    }

    bytes32 public constant ITEM_VOUCHER_TYPEHASH = keccak256(
        "ItemVoucher(uint256 creatorId,uint256 itemId,bytes32 metadataHash,bytes32 splitPolicyRef)"
    );

    address public immutable operator;

    uint256 public creatorCount;
    mapping(uint256 creatorId => address key) private _keys;

    event CreatorRegistered(uint256 indexed creatorId, address indexed key);

    error NotOperator();
    error ZeroAddress();
    error UnknownCreator(uint256 creatorId);
    error UnknownCreatorSignature();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(address operator_) EIP712("Glass Ledger", "1") {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
    }

    /// @notice Registers a creator's key and returns her id.
    function register(address key) external onlyOperator returns (uint256 creatorId) {
        if (key == address(0)) revert ZeroAddress();
        creatorId = ++creatorCount;
        _keys[creatorId] = key;
        emit CreatorRegistered(creatorId, key);
    }

    /// @notice The key registered for a creator. Reverts if she is unknown.
    function keyOf(uint256 creatorId) public view returns (address key) {
        key = _keys[creatorId];
        if (key == address(0)) revert UnknownCreator(creatorId);
    }

    function isRegistered(uint256 creatorId) external view returns (bool) {
        return _keys[creatorId] != address(0);
    }

    /// @notice The EIP-712 domain separator vouchers are signed under.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice The digest a creator signs for a voucher, and the leaf her tranche commits to.
    /// @dev The signed digest is the Merkle leaf. The thing the creator put her name to and the
    ///      thing the consignment commits to are therefore the same 32 bytes — a tag cannot be
    ///      genuinely signed but absent from the tranche, or in the tranche but signed by nobody.
    function voucherDigest(ItemVoucher calldata voucher) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ITEM_VOUCHER_TYPEHASH,
                    voucher.creatorId,
                    voucher.itemId,
                    voucher.metadataHash,
                    voucher.splitPolicyRef
                )
            )
        );
    }

    /// @notice Checks a voucher against the creator it names, and returns its digest.
    /// @dev Accepts contract signatures as well as EOA signatures, so a creator whose key lives
    ///      in a smart account is a first-class creator.
    function requireValidVoucher(ItemVoucher calldata voucher, bytes calldata signature)
        external
        view
        returns (bytes32 digest)
    {
        address key = keyOf(voucher.creatorId);
        digest = voucherDigest(voucher);
        if (!SignatureChecker.isValidSignatureNowCalldata(key, digest, signature)) {
            revert UnknownCreatorSignature();
        }
    }
}
