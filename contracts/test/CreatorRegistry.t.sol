// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {CreatorRegistry} from "../src/identity/CreatorRegistry.sol";
import {Fixture} from "./utils/Fixture.sol";

contract CreatorRegistryTest is Fixture {
    event CreatorRegistered(uint256 indexed creatorId, address indexed key);

    function test_registerRecordsKeyAndAssignsSequentialIds() public {
        assertEq(registry.keyOf(creatorId), creator);
        assertTrue(registry.isRegistered(creatorId));
        assertEq(registry.creatorCount(), 1);

        vm.expectEmit(true, true, false, false, address(registry));
        emit CreatorRegistered(2, stranger);

        vm.prank(operator);
        uint256 second = registry.register(stranger);
        assertEq(second, 2);
        assertEq(registry.creatorCount(), 2);
    }

    function test_registerRejectsNonOperator() public {
        vm.expectRevert(CreatorRegistry.NotOperator.selector);
        vm.prank(stranger);
        registry.register(stranger);
    }

    function test_registerRejectsZeroKey() public {
        vm.expectRevert(CreatorRegistry.ZeroAddress.selector);
        vm.prank(operator);
        registry.register(address(0));
    }

    function test_keyOfRejectsUnknownCreator() public {
        vm.expectRevert(abi.encodeWithSelector(CreatorRegistry.UnknownCreator.selector, 99));
        registry.keyOf(99);
        assertFalse(registry.isRegistered(99));
    }

    /// @dev The digest is the EIP-712 hash of the voucher under this registry's domain, and it is
    ///      also the tranche's Merkle leaf. Recomputed here from first principles so that a change
    ///      to the typehash or the domain cannot pass silently.
    function test_voucherDigestIsTheDomainBoundStructHash() public view {
        CreatorRegistry.ItemVoucher memory voucher = _voucher(itemIds[0]);

        bytes32 structHash = keccak256(
            abi.encode(
                registry.ITEM_VOUCHER_TYPEHASH(),
                voucher.creatorId,
                voucher.itemId,
                voucher.metadataHash,
                voucher.splitPolicyRef
            )
        );
        bytes32 expected =
            keccak256(abi.encodePacked(hex"1901", registry.domainSeparator(), structHash));

        assertEq(registry.voucherDigest(voucher), expected);
        assertEq(registry.voucherDigest(voucher), leaves[0]);
    }

    function test_requireValidVoucherAcceptsTheCreatorsSignature() public view {
        CreatorRegistry.ItemVoucher memory voucher = _voucher(itemIds[0]);
        bytes32 digest = registry.requireValidVoucher(voucher, _sign(voucher, creatorKey));
        assertEq(digest, registry.voucherDigest(voucher));
    }

    function test_requireValidVoucherRejectsAForgedSignature() public {
        CreatorRegistry.ItemVoucher memory voucher = _voucher(itemIds[0]);
        bytes memory forged = _sign(voucher, forgerKey);

        vm.expectRevert(CreatorRegistry.UnknownCreatorSignature.selector);
        registry.requireValidVoucher(voucher, forged);
    }

    /// @dev A signature is over the whole voucher: changing any field after signing breaks it.
    function test_requireValidVoucherRejectsATamperedVoucher() public {
        CreatorRegistry.ItemVoucher memory voucher = _voucher(itemIds[0]);
        bytes memory signature = _sign(voucher, creatorKey);
        voucher.itemId = itemIds[1];

        vm.expectRevert(CreatorRegistry.UnknownCreatorSignature.selector);
        registry.requireValidVoucher(voucher, signature);
    }

    function test_requireValidVoucherRejectsAnUnknownCreator() public {
        CreatorRegistry.ItemVoucher memory voucher = _voucher(itemIds[0]);
        voucher.creatorId = 99;
        bytes memory signature = _sign(voucher, creatorKey);

        vm.expectRevert(abi.encodeWithSelector(CreatorRegistry.UnknownCreator.selector, 99));
        registry.requireValidVoucher(voucher, signature);
    }
}
