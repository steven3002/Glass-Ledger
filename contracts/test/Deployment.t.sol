// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {CreatorRegistry} from "../src/identity/CreatorRegistry.sol";
import {DebtLedger} from "../src/debt/DebtLedger.sol";
import {ItemLedger} from "../src/items/ItemLedger.sol";
import {Allowance} from "../src/treasury/Allowance.sol";
import {Pool} from "../src/treasury/Pool.sol";
import {Types} from "../src/libs/Types.sol";

/// @notice The deployment, run as a test.
/// @dev The wiring is the protocol. Every seam here is a one-shot, operator-only setter, and a
///      deployment that got the order wrong or left an edge unset would produce a system that looks
///      finished and is not — a ledger with no pool cannot execute a default, a pool with no gateway
///      cannot price a write-off, a ceiling with no pool cannot authorize a sale. So the script is
///      exercised rather than trusted, and the setters are proven permanent.
/// @dev The test *is* the script, so the wiring calls it makes are the test contract's own and a
///      prank puts them behind the operator's key — exactly as `vm.startBroadcast` puts them behind
///      the operator's key in a real run. Calling a script contract from outside would deploy a
///      protocol whose operator is the script, which is a system nobody is going to run.
contract DeploymentTest is Test, Deploy {
    address internal operator;
    address internal treasury;

    function setUp() public {
        operator = makeAddr("operator");
        treasury = makeAddr("treasury");
    }

    function test_theDemoDeploymentIsFullyWired() public {
        vm.startPrank(operator);
        Deployment memory d = deploy(demoConfig(operator, treasury));
        vm.stopPrank();

        // Every contract knows the operator, and no contract invented one.
        assertEq(d.registry.operator(), operator);
        assertEq(d.items.operator(), operator);
        assertEq(d.debts.operator(), operator);
        assertEq(d.sweep.operator(), operator);
        assertEq(d.pool.operator(), operator);
        assertEq(d.ceiling.operator(), operator);
        assertEq(d.gateway.operator(), operator);
        assertEq(d.gateway.operatorRecipient(), treasury);

        // The item can only be consumed through the gateway, and the ledger only minted by it.
        assertEq(d.items.saleGateway(), address(d.gateway));
        assertEq(d.debts.saleGateway(), address(d.gateway));
        assertEq(d.pool.saleGateway(), address(d.gateway));

        // The ledger's two privileged callers.
        assertEq(d.debts.pool(), address(d.pool));
        assertEq(d.debts.sweepRegistry(), address(d.sweep));

        // The treasury is a loop, and it is closed.
        assertEq(address(d.ceiling.pool()), address(d.pool));
        assertEq(address(d.pool.ceiling()), address(d.ceiling));
        assertEq(address(d.pool.debts()), address(d.debts));

        // One protocol, one oracle root: the sweep took its verifier from the ledger. Nothing here
        // can be pointed at a second definition of what counts as proof, because there is no setter
        // that could point it.
        assertEq(address(d.sweep.verifier()), address(d.proofs));
        assertEq(address(d.debts.verifier()), address(d.proofs));

        // The ceiling the gateway asks is the ceiling the pool writes down.
        assertEq(address(d.gateway.authorizer()), address(d.ceiling));
        assertEq(address(d.gateway.writeOffs()), address(d.pool));

        // A relationship nobody has opened yet still stands at its threshold — that is what a genesis
        // grant *is*, and it is granted to the relationship rather than held centrally. Any creator,
        // even one who has never been registered, reads the same number.
        assertEq(d.ceiling.allowanceOf(1), d.ceiling.genesisAllowance());
        assertEq(d.ceiling.allowanceOf(999), d.ceiling.genesisAllowance());

        // And the network extends its unearned faith exactly **once**, not once per creator. This is
        // the line that stops an operator printing capacity by registering counterparties.
        assertEq(d.ceiling.totalAllowance(), d.ceiling.genesisAllowance());
    }

    /// @notice The demo and production profiles differ in their numbers and in nothing else.
    function test_theProductionProfileIsTheSameCodeToldToWaitLonger() public {
        vm.startPrank(operator);
        Deployment memory demo = deploy(demoConfig(operator, treasury));
        Deployment memory live = deploy(productionConfig(operator, treasury));
        vm.stopPrank();

        assertEq(demo.debts.settlementWindow(), 3 minutes);
        assertEq(live.debts.settlementWindow(), 3 days);
        assertEq(live.debts.challengeWindow(), 5 days);
        assertEq(live.debts.responseWindow(), 3 days);
        assertEq(live.sweep.coverageWindow(), 14 days);
        assertEq(live.gateway.fulfilmentWindow(), 3 days);
        assertEq(live.prices.epochLength(), 3 days);

        // Same contracts, same size, to the byte. The windows are immutables, so they are baked into
        // the runtime code as constants — which is exactly the property being claimed: the profiles
        // differ in the numbers the code was given and in nothing about the code that was given them.
        assertEq(address(demo.debts).code.length, address(live.debts).code.length);
        assertEq(address(demo.gateway).code.length, address(live.gateway).code.length);
        assertEq(address(demo.ceiling).code.length, address(live.ceiling).code.length);
        assertEq(address(demo.pool).code.length, address(live.pool).code.length);

        // (Byte-for-byte equality is not available and would not mean what it seems to: every
        // contract here carries immutables — windows, and the addresses of its neighbours — and
        // immutables live in the runtime code. Identical length is the honest form of the claim.)

        // Same economics, both ways.
        assertEq(demo.ceiling.growthBps(), live.ceiling.growthBps());
        assertEq(demo.ceiling.writeDownMultiple(), live.ceiling.writeDownMultiple());
        assertEq(demo.gateway.burnPenaltyBps(), live.gateway.burnPenaltyBps());
        assertEq(demo.gateway.splitPolicy(), live.gateway.splitPolicy());
    }

    /// @notice Every wiring setter is a one-shot. The deployment cannot be rewired afterwards.
    function test_theWiringIsPermanent() public {
        address impostor = makeAddr("impostor");

        vm.startPrank(operator);
        Deployment memory d = deploy(demoConfig(operator, treasury));

        vm.expectRevert(ItemLedger.GatewayAlreadySet.selector);
        d.items.setSaleGateway(impostor);

        vm.expectRevert(DebtLedger.GatewayAlreadySet.selector);
        d.debts.setSaleGateway(impostor);

        vm.expectRevert(DebtLedger.PoolAlreadySet.selector);
        d.debts.setPool(impostor);

        vm.expectRevert(DebtLedger.SweepAlreadySet.selector);
        d.debts.setSweepRegistry(impostor);

        vm.expectRevert(Allowance.PoolAlreadySet.selector);
        d.ceiling.setPool(impostor);

        vm.expectRevert(Pool.GatewayAlreadySet.selector);
        d.pool.setSaleGateway(impostor);

        vm.stopPrank();
    }
}
