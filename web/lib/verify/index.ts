/**
 * Independent verification, as pure functions over public infrastructure:
 * fetch a voucher from 0G Storage, check the creator's signature against the
 * on-chain registry, verify Merkle membership against the posted tranche
 * root, and read item/nullifier state over public RPC.
 *
 * Boundary rule (enforced structurally, reviewed on every change): this
 * module must never import from any operator-run service client. Verification
 * has to produce identical results with the operator's backend switched off —
 * that property is the product, and it holds only if no code path in here can
 * reach operator infrastructure even by accident.
 */

export {};
