// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {CreatorRegistry} from "../identity/CreatorRegistry.sol";
import {Types} from "../libs/Types.sol";
import {WindowMath} from "../libs/WindowMath.sol";

/// @title ItemLedger
/// @notice Consignments and the life of an item. A tranche is a Merkle root over the vouchers a
///         creator consigned, and it is the whole of the on-chain footprint until an item is
///         actually touched: posting thirteen items costs one root, not thirteen storage slots.
/// @dev Tranche proofs: a leaf is the EIP-712 digest the creator signed for that item, and
///      internal nodes are keccak256 over the sorted pair of their children. Any off-chain
///      builder whose proofs verify under that walk is a valid builder — the ledger checks the
///      walk, not the construction.
///
///      The nullifier is the state machine itself: consumption is terminal, so a second sale of
///      the same tag reverts on the state and no separate spent-set is needed. A commitment is
///      not a consumption — it reserves an item and lapses if the order is not fulfilled.
contract ItemLedger {
    using WindowMath for uint64;

    /// @notice A consignment: what the creator handed over, and where it sits.
    /// @dev `itemCount` is the creator's public declaration of how many items the root covers. It
    ///      cannot be enforced on-chain — a root is a root — and it is not meant to be: it is the
    ///      number a stranger counts against when they walk the floor and audit the shelf.
    struct Tranche {
        uint256 creatorId;
        address landlord;
        uint32 itemCount;
        uint64 postedAt;
        bytes32 root;
        bytes32 currency;
    }

    struct Item {
        uint256 trancheId;
        address owner;
        Types.ItemState state;
        uint64 committedUntil;
    }

    address public immutable operator;
    CreatorRegistry public immutable registry;

    /// @notice The only account that may consume an item. Set once, at deployment.
    address public saleGateway;

    uint256 public trancheCount;
    mapping(uint256 trancheId => Tranche) private _tranches;
    mapping(uint256 trancheId => string) private _locationLabels;
    mapping(uint256 itemId => Item) private _items;

    event SaleGatewaySet(address indexed saleGateway);
    event TranchePosted(
        uint256 indexed trancheId,
        uint256 indexed creatorId,
        address indexed landlord,
        bytes32 root,
        uint32 itemCount,
        bytes32 currency,
        string locationLabel
    );
    event ItemCommitted(uint256 indexed itemId, uint256 indexed trancheId, uint64 deadline);
    event ItemSold(uint256 indexed itemId, uint256 indexed trancheId);
    event ItemOwned(uint256 indexed itemId, address indexed owner);
    event ItemBurned(uint256 indexed itemId, uint256 indexed trancheId);
    event CommitmentReleased(uint256 indexed itemId, uint256 indexed trancheId);

    error NotOperator();
    error NotGateway();
    error GatewayAlreadySet();
    error ZeroAddress();
    error InvalidTranche();
    error UnknownTranche(uint256 trancheId);
    error AlreadySold(uint256 itemId);
    error ItemReserved(uint256 itemId, uint64 until);
    error ItemNotCommitted(uint256 itemId);
    error ItemNotSold(uint256 itemId);
    error FulfilmentWindowClosed(uint256 itemId, uint64 deadline);
    error CommitmentNotExpired(uint256 itemId, uint64 deadline);

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier onlyGateway() {
        if (msg.sender != saleGateway) revert NotGateway();
        _;
    }

    constructor(address operator_, CreatorRegistry registry_) {
        if (operator_ == address(0) || address(registry_) == address(0)) revert ZeroAddress();
        operator = operator_;
        registry = registry_;
    }

    /// @notice Wires the sale gateway. Deployment-time only, and permanent: the set of paths that
    ///         may consume an item is fixed for the life of the deployment.
    function setSaleGateway(address gateway) external onlyOperator {
        if (gateway == address(0)) revert ZeroAddress();
        if (saleGateway != address(0)) revert GatewayAlreadySet();
        saleGateway = gateway;
        emit SaleGatewaySet(gateway);
    }

    /// @notice Posts a consignment. Every leaf under `root` becomes sellable.
    function postTranche(
        uint256 creatorId,
        address landlord,
        bytes32 root,
        uint32 itemCount,
        bytes32 currency,
        string calldata locationLabel
    ) external onlyOperator returns (uint256 trancheId) {
        if (!registry.isRegistered(creatorId)) {
            revert CreatorRegistry.UnknownCreator(creatorId);
        }
        if (landlord == address(0)) revert ZeroAddress();
        if (root == bytes32(0) || itemCount == 0 || currency == bytes32(0)) {
            revert InvalidTranche();
        }

        trancheId = ++trancheCount;
        _tranches[trancheId] = Tranche({
            creatorId: creatorId,
            landlord: landlord,
            itemCount: itemCount,
            postedAt: uint64(block.timestamp),
            root: root,
            currency: currency
        });
        _locationLabels[trancheId] = locationLabel;

        emit TranchePosted(trancheId, creatorId, landlord, root, itemCount, currency, locationLabel);
    }

    // --- Item transitions. Only the sale gateway may consume or reserve an item. ---

    /// @notice Reserves an item for a buyer whose order is not yet fulfilled.
    function markCommitted(uint256 itemId, uint256 trancheId, uint64 deadline)
        external
        onlyGateway
    {
        _requireAvailable(itemId);
        Item storage item = _items[itemId];
        item.trancheId = trancheId;
        item.state = Types.ItemState.COMMITTED;
        item.committedUntil = deadline;
        emit ItemCommitted(itemId, trancheId, deadline);
    }

    /// @notice Consumes an item in a sale that completes on the spot.
    function markSold(uint256 itemId, uint256 trancheId) external onlyGateway {
        _requireAvailable(itemId);
        Item storage item = _items[itemId];
        item.trancheId = trancheId;
        item.state = Types.ItemState.SOLD;
        emit ItemSold(itemId, trancheId);
    }

    /// @notice Completes a reserved item's sale, on time.
    /// @dev A fulfilment after the window has closed is not a fulfilment: the promise the buyer
    ///      was given has already failed, and the refund path owns the item from that moment.
    function markFulfilled(uint256 itemId) external onlyGateway {
        Item storage item = _items[itemId];
        if (item.state != Types.ItemState.COMMITTED) revert ItemNotCommitted(itemId);
        uint64 deadline = item.committedUntil;
        if (deadline.isPast(uint64(block.timestamp))) {
            revert FulfilmentWindowClosed(itemId, deadline);
        }
        item.state = Types.ItemState.SOLD;
        item.committedUntil = 0;
        emit ItemSold(itemId, item.trancheId);
    }

    /// @notice Binds a sold item's certificate to the account that redeemed it.
    function markOwned(uint256 itemId, address owner) external onlyGateway {
        if (owner == address(0)) revert ZeroAddress();
        Item storage item = _items[itemId];
        if (item.state != Types.ItemState.SOLD) revert ItemNotSold(itemId);
        item.owner = owner;
        item.state = Types.ItemState.OWNED;
        emit ItemOwned(itemId, owner);
    }

    /// @notice Writes an item off. Terminal: a burned item is never sellable again.
    function markBurned(uint256 itemId, uint256 trancheId) external onlyGateway {
        _requireAvailable(itemId);
        Item storage item = _items[itemId];
        item.trancheId = trancheId;
        item.state = Types.ItemState.BURNED;
        emit ItemBurned(itemId, trancheId);
    }

    /// @notice Releases a reservation whose fulfilment window has closed. The item is sellable
    ///         again; what the buyer is owed is a debt, and it is not this contract's business.
    function releaseCommitment(uint256 itemId) external onlyGateway {
        Item storage item = _items[itemId];
        if (item.state != Types.ItemState.COMMITTED) revert ItemNotCommitted(itemId);
        uint64 deadline = item.committedUntil;
        if (!deadline.isPast(uint64(block.timestamp))) {
            revert CommitmentNotExpired(itemId, deadline);
        }
        item.state = Types.ItemState.LISTED;
        item.committedUntil = 0;
        emit CommitmentReleased(itemId, item.trancheId);
    }

    // --- Reads. Everything the public verifier needs, and nothing it has to trust. ---

    function tranche(uint256 trancheId) external view returns (Tranche memory) {
        Tranche memory t = _tranches[trancheId];
        if (t.root == bytes32(0)) revert UnknownTranche(trancheId);
        return t;
    }

    function locationOf(uint256 trancheId) external view returns (string memory) {
        return _locationLabels[trancheId];
    }

    function itemOf(uint256 itemId) external view returns (Item memory) {
        return _items[itemId];
    }

    function stateOf(uint256 itemId) external view returns (Types.ItemState) {
        return _items[itemId].state;
    }

    /// @notice Whether this item has been consumed. This is the answer a scanned tag needs.
    function isConsumed(uint256 itemId) public view returns (bool) {
        Types.ItemState state = _items[itemId].state;
        return state == Types.ItemState.SOLD || state == Types.ItemState.OWNED
            || state == Types.ItemState.BURNED;
    }

    function isAvailable(uint256 itemId) external view returns (bool) {
        Types.ItemState state = _items[itemId].state;
        return state == Types.ItemState.ABSENT || state == Types.ItemState.LISTED;
    }

    /// @notice Reverts with the reason this item cannot be sold, if it cannot be sold.
    function requireAvailable(uint256 itemId) external view {
        _requireAvailable(itemId);
    }

    /// @notice Whether `leaf` is committed to by a tranche's root.
    function verifyMembership(uint256 trancheId, bytes32 leaf, bytes32[] calldata proof)
        external
        view
        returns (bool)
    {
        bytes32 root = _tranches[trancheId].root;
        if (root == bytes32(0)) revert UnknownTranche(trancheId);
        return MerkleProof.verifyCalldata(proof, root, leaf);
    }

    function _requireAvailable(uint256 itemId) internal view {
        Item storage item = _items[itemId];
        Types.ItemState state = item.state;
        if (
            state == Types.ItemState.SOLD || state == Types.ItemState.OWNED
                || state == Types.ItemState.BURNED
        ) {
            revert AlreadySold(itemId);
        }
        if (state == Types.ItemState.COMMITTED) {
            revert ItemReserved(itemId, item.committedUntil);
        }
    }
}
