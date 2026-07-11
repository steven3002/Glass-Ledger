// Package chain provides the RPC client, generated contract bindings, and
// transaction submission for the operator. The sponsor key is loaded from the
// environment; all buyer-facing transactions are sponsored by it, while
// permissionless touches are demonstrated from a separate stranger key.
package chain
