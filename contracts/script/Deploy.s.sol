// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {CreatorRegistry} from "../src/identity/CreatorRegistry.sol";
import {DebtLedger} from "../src/debt/DebtLedger.sol";
import {SweepRegistry} from "../src/debt/SweepRegistry.sol";
import {ItemLedger} from "../src/items/ItemLedger.sol";
import {PriceBook} from "../src/items/PriceBook.sol";
import {StubProofVerifier} from "../src/oracle/StubProofVerifier.sol";
import {SaleGateway} from "../src/sale/SaleGateway.sol";
import {Allowance} from "../src/treasury/Allowance.sol";
import {MockNGN} from "../src/treasury/MockNGN.sol";
import {Pool} from "../src/treasury/Pool.sol";
import {Types} from "../src/libs/Types.sol";

/// @title Deploy
/// @notice The whole protocol, in one transaction sequence.
///
/// @dev The demo profile and the production profile run **identical code**. They differ in exactly
///      one thing — the numbers handed to the constructors — because a demo that ran different code
///      from the thing it is demonstrating would be a demonstration of nothing. Windows are minutes
///      here and days there; the state machine, the ceiling and the arithmetic do not know which.
///
///      Deployment order is a dependency order, and two of the edges matter:
///
///      - the sweep reads its verifier off the ledger, so the ledger must be constructed with the
///        real one. There is no `setVerifier` anywhere in this protocol: a mutable verifier pointer
///        under the operator's key would let the operator redefine what counts as proof. Swapping in
///        the real zkTLS verifier is a fresh deployment.
///      - the ceiling and the pool need each other, so one of them takes a one-shot setter. The
///        allowance does, and every wiring setter in this system is the same shape: operator-only,
///        once, and permanent. A protocol whose wiring can be changed is a protocol whose operator
///        can change it.
contract Deploy is Script {
    /// @notice Everything a deployment is free to choose.
    struct Config {
        address operator;
        address operatorRecipient;
        Types.Windows windows;
        SaleGateway.Splits splits;
        uint16 penaltyBps;
        uint16 growthBps;
        uint8 writeDownMultiple;
        uint16 burnPenaltyBps;
        uint256 genesisAllowance;
        bytes32 currency;
    }

    struct Deployment {
        CreatorRegistry registry;
        ItemLedger items;
        PriceBook prices;
        StubProofVerifier proofs;
        DebtLedger debts;
        SweepRegistry sweep;
        MockNGN ngn;
        Allowance ceiling;
        Pool pool;
        SaleGateway gateway;
    }

    /// @notice The published split: 80 / 5 / 2.5 / 12.5.
    function splits() public pure returns (SaleGateway.Splits memory) {
        return SaleGateway.Splits({
            creatorBps: 8000, landlordBps: 500, communityBps: 250, operatorBps: 1250
        });
    }

    /// @notice Minutes, so an audience can watch a settlement clock run out.
    function demoConfig(address operator, address operatorRecipient)
        public
        pure
        returns (Config memory)
    {
        return Config({
            operator: operator,
            operatorRecipient: operatorRecipient,
            windows: Types.Windows({
                settlement: 3 minutes,
                challenge: 2 minutes,
                response: 1 minutes,
                coverage: 5 minutes,
                fulfilment: 3 minutes,
                priceEpoch: 2 minutes
            }),
            splits: splits(),
            penaltyBps: 100,
            growthBps: 100,
            writeDownMultiple: 5,
            burnPenaltyBps: 100,
            // Sized for the demo: a cash sale authorizes against it on the first morning, and one
            // written-down default puts the next cash sale over the ceiling in front of the audience.
            genesisAllowance: 450_000e18,
            // forge-lint: disable-next-line(unsafe-typecast)
            currency: bytes32("NGN")
        });
    }

    /// @notice Days, as the protocol is specified. The same code, told to wait longer.
    function productionConfig(address operator, address operatorRecipient)
        public
        pure
        returns (Config memory config)
    {
        config = demoConfig(operator, operatorRecipient);
        config.windows = Types.Windows({
            settlement: 3 days,
            challenge: 5 days,
            response: 3 days,
            coverage: 14 days,
            fulfilment: 3 days,
            priceEpoch: 3 days
        });
    }

    function run() external returns (Deployment memory deployment) {
        address operator = msg.sender;
        address operatorRecipient = vm.envOr("OPERATOR_RECIPIENT", operator);

        vm.startBroadcast();
        deployment = deploy(demoConfig(operator, operatorRecipient));
        vm.stopBroadcast();

        _publish(deployment, operator, operatorRecipient);
    }

    /// @notice Writes the addresses where everything downstream reads them.
    /// @dev There is one deployment definition in this repository and it is this script — the one the
    ///      contract suite exercises, wiring order and one-shot setters included. The relayer and the
    ///      web read the file it writes; neither of them deploys anything, because a second deployment
    ///      path would be a second definition of the protocol's shape, and the two would disagree the
    ///      first time somebody changed a constructor.
    function _publish(Deployment memory d, address operator, address operatorRecipient) internal {
        string memory key = "deployment";

        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "operator", operator);
        vm.serializeAddress(key, "operatorRecipient", operatorRecipient);
        vm.serializeAddress(key, "registry", address(d.registry));
        vm.serializeAddress(key, "items", address(d.items));
        vm.serializeAddress(key, "prices", address(d.prices));
        vm.serializeAddress(key, "proofs", address(d.proofs));
        vm.serializeAddress(key, "debts", address(d.debts));
        vm.serializeAddress(key, "sweep", address(d.sweep));
        vm.serializeAddress(key, "ngn", address(d.ngn));
        vm.serializeAddress(key, "ceiling", address(d.ceiling));
        vm.serializeAddress(key, "pool", address(d.pool));
        string memory json = vm.serializeAddress(key, "gateway", address(d.gateway));

        string memory dir = "../artifacts/deployments";
        vm.createDir(dir, true);

        string memory path = string.concat(dir, "/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);

        console.log("deployment written to", path);
        console.log("gateway", address(d.gateway));
    }

    /// @notice Deploys and wires the full set. Callable from a test, which is how the wiring order is
    ///         held down rather than hoped for.
    /// @dev Must be called by the operator: every wiring setter is operator-gated.
    function deploy(Config memory config) public returns (Deployment memory d) {
        d.registry = new CreatorRegistry(config.operator);
        d.items = new ItemLedger(config.operator, d.registry);
        d.prices = new PriceBook(d.items, d.registry, config.windows.priceEpoch);

        d.proofs = new StubProofVerifier(config.operator);
        d.debts = new DebtLedger(
            config.operator,
            d.proofs,
            config.windows.settlement,
            config.windows.challenge,
            config.windows.response,
            config.penaltyBps
        );
        d.sweep = new SweepRegistry(config.operator, d.debts, config.windows.coverage);

        d.ngn = new MockNGN(config.operator);
        d.ceiling = new Allowance(
            config.operator,
            d.debts,
            config.genesisAllowance,
            config.growthBps,
            config.writeDownMultiple
        );
        d.pool = new Pool(config.operator, d.ngn, config.currency, d.debts, d.ceiling);

        d.gateway = new SaleGateway(
            config.operator,
            config.operatorRecipient,
            d.registry,
            d.items,
            d.prices,
            d.debts,
            d.ceiling,
            d.pool,
            config.splits,
            config.burnPenaltyBps,
            config.windows.fulfilment
        );

        d.items.setSaleGateway(address(d.gateway));
        d.debts.setSaleGateway(address(d.gateway));
        d.debts.setPool(address(d.pool));
        d.debts.setSweepRegistry(address(d.sweep));
        d.ceiling.setPool(address(d.pool));
        d.pool.setSaleGateway(address(d.gateway));
    }
}
