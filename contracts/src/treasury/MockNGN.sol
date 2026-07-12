// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockNGN
/// @notice The pool's asset in this build: a plain ERC-20 the operator can mint, standing in for a
///         regulated naira stablecoin.
///
/// @dev Production note — this is the only mocked *asset* in the protocol, and the thing it stands
///      for is not mocked at all. **Pool custody is on-chain and is not negotiable.** The production
///      assets are cNGN (primary — a naira stablecoin, so the pool's books stay in the same currency
///      as the debts it backs) and USDC (secondary, for corridors that need it), held and disbursed
///      by the Pool contract itself. There is no fiat pool: a segregated bank account, however
///      attested, sits inside the defaulting operator's blast radius, and the pool exists precisely
///      for the day the operator is the problem. The honest cost of that choice is that a victim is
///      paid in stablecoin and must convert it — friction, on what is already a bad day — and the
///      protocol accepts it because the alternative is worse in kind rather than in degree.
///
///      Nothing else about this contract is a stand-in. The Pool holds a balance of an ERC-20 and
///      moves it under protocol rules; swapping this token for cNGN is a constructor argument.
///
///      Minting is operator-gated because a demo has to start with money somewhere. In production
///      nobody mints: the pool is funded only by the skim of real sales.
contract MockNGN is ERC20 {
    address public immutable operator;

    error NotOperator();

    constructor(address operator_) ERC20("Mock Naira", "mNGN") {
        if (operator_ == address(0)) revert NotOperator();
        operator = operator_;
    }

    /// @notice Funds an account. Demo plumbing: the production asset is issued by its issuer.
    function mint(address to, uint256 amount) external {
        if (msg.sender != operator) revert NotOperator();
        _mint(to, amount);
    }
}
