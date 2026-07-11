// Package storage wraps the 0G Storage client used to upload item vouchers
// and sweep/burn evidence blobs. Uploads return the Merkle root that on-chain
// records point to; anyone can fetch and verify the same bytes through public
// 0G Storage infrastructure without touching operator systems.
package storage
