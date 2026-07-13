package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	zgcommon "github.com/0gfoundation/0g-storage-client/common"
	"github.com/0gfoundation/0g-storage-client/common/blockchain"
	"github.com/0gfoundation/0g-storage-client/core"
	"github.com/0gfoundation/0g-storage-client/indexer"
	"github.com/0gfoundation/0g-storage-client/transfer"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/sirupsen/logrus"
)

// clientOptions configures the indexer client, and the LogLevel is load-bearing rather than cosmetic.
//
// logrus numbers its levels from PanicLevel = 0, so a zero-valued LogOption asks the storage client to
// log at panic level — and the client's retry reminder emits *at* the configured level, not merely above
// it. An upload therefore panics the process the first time a storage node reports that it has not yet
// synced the block carrying the upload's own transaction, which is a routine condition on a live network
// and not an error at all: the transaction is mined, the node is a second or two behind, and the next
// poll would have found it. Naming a level here is what turns that panic back into the wait it should be.
func clientOptions() indexer.IndexerClientOption {
	return indexer.IndexerClientOption{
		LogOption: zgcommon.LogOption{LogLevel: logrus.WarnLevel},
	}
}

// ZeroG publishes blobs to 0G Storage and reads them back through a public indexer.
//
// The pointer this returns is the file's Merkle root as 0G computes it — the same 32 bytes any
// reader hands the indexer to fetch the bytes again. That is what the on-chain record carries, and it
// is why a voucher cannot be swapped after the fact: a different voucher is a different root, and the
// root is what the tranche and the sweep committed to.
//
// The indexer is public 0G infrastructure and not the operator's. That distinction is the reason the
// verification path stays clean: a buyer checking a tag reads a public RPC and a public store, and
// touches nothing Good runs. Uploads cost the operator gas on 0G and need a funded key, which is why
// the local backend exists for a development chain — this one is exercised on the testnet, where
// there is a chain to pay.
type ZeroG struct {
	evmRPC     string
	indexerURL string
	privateKey string
	cache      string

	submissions []common.Hash
}

// NewZeroG configures the 0G Storage client. The endpoints are deployment facts, not defaults: they
// are supplied by whoever runs this, and recorded where the rest of the network's facts are recorded.
func NewZeroG(evmRPC, indexerURL, privateKey, cacheDir string) (*ZeroG, error) {
	if evmRPC == "" || indexerURL == "" || privateKey == "" {
		return nil, fmt.Errorf("storage: 0G backend needs an RPC endpoint, an indexer and a funded key")
	}
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return nil, fmt.Errorf("storage: %w", err)
	}

	// The uploader polls for its own receipt once a second and logs each miss through the process-wide
	// logger, which the client option below cannot reach. Eight lines per upload of "receipt: <nil>" is
	// not information — it is the inside of a retry loop — and thirteen vouchers of it would bury the
	// only thing the operator actually needs to see, which is where the bytes went. Warnings are left
	// on: the node-behind-the-chain-head retry is one, and it is a real condition.
	logrus.SetLevel(logrus.WarnLevel)

	return &ZeroG{
		evmRPC:     evmRPC,
		indexerURL: indexerURL,
		privateKey: privateKey,
		cache:      cacheDir,
	}, nil
}

func (z *ZeroG) Backend() string { return "0G Storage (" + z.indexerURL + ")" }

func (z *ZeroG) Put(ctx context.Context, _ string, blob []byte) (common.Hash, error) {
	w3, err := blockchain.NewWeb3(z.evmRPC, z.privateKey)
	if err != nil {
		return common.Hash{}, fmt.Errorf("storage: 0G rpc: %w", err)
	}
	defer w3.Close()

	client, err := indexer.NewClient(z.indexerURL, clientOptions())
	if err != nil {
		return common.Hash{}, fmt.Errorf("storage: 0G indexer: %w", err)
	}

	data, err := core.NewDataInMemory(blob)
	if err != nil {
		return common.Hash{}, fmt.Errorf("storage: %w", err)
	}

	// One replica, nearest node, trusted set: a demo's blob, not a nation's archive.
	uploader, err := client.NewUploaderFromIndexerNodes(
		ctx, data.NumSegments(), w3, 1, nil, "min", true,
	)
	if err != nil {
		return common.Hash{}, fmt.Errorf("storage: 0G uploader: %w", err)
	}

	// `SkipTx` does not skip the transaction. It skips it *only if the bytes are already on the
	// network* — the uploader computes the file's Merkle root, asks the storage nodes whether they
	// already hold it, and submits only when they do not. That is worth having on by default, because
	// the root is a pure function of the bytes: republishing a blob that is already published buys
	// nothing and costs a submission transaction, which is where nearly all of an upload's price is. A
	// voucher that has already been paid for is never paid for twice, on any machine, with no local
	// state involved in the decision.
	//
	// Upload returns the submission transaction hash *first* and the file's Merkle root second. Only the
	// root addresses the bytes: it is what the indexer resolves, what a reader hands back to fetch the
	// blob, and what the on-chain record commits to. The transaction hash names the payment, not the file,
	// and a pointer built from it resolves to nothing — the two are the same width and neither the compiler
	// nor a cursory reading will catch the confusion, so the two returns are named here rather than
	// positionally trusted.
	txHash, root, err := uploader.Upload(ctx, data, transfer.UploadOption{
		ExpectedReplica: 1,
		SkipTx:          true,
	})
	if err != nil {
		return common.Hash{}, fmt.Errorf("storage: 0G upload: %w", err)
	}

	// A zero transaction hash is the uploader saying it found the bytes already there and sent nothing.
	if txHash != (common.Hash{}) {
		z.submissions = append(z.submissions, txHash)
	}

	return root, nil
}

// Submissions are the uploads this store actually paid for, as against the ones whose bytes turned out
// to be published already. On a metered chain that difference is money: a demo that could not tell the
// two apart could not say what it had spent, and the bill would credit it with a payment it never made.
func (z *ZeroG) Submissions() []common.Hash { return z.submissions }

func (z *ZeroG) Get(ctx context.Context, pointer common.Hash) ([]byte, error) {
	client, err := indexer.NewClient(z.indexerURL, clientOptions())
	if err != nil {
		return nil, fmt.Errorf("storage: 0G indexer: %w", err)
	}

	// The SDK downloads to a file; the caller wants bytes. The proof is verified on the way down —
	// `withProof` is not optional here, because a store that hands back unverified bytes is a store
	// that has to be trusted, and the point of this one is that it does not.
	path := filepath.Join(z.cache, pointer.Hex()+".blob")
	if err := client.Download(ctx, pointer.Hex(), path, true); err != nil {
		return nil, fmt.Errorf("storage: 0G download: %w", err)
	}

	blob, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("storage: %w", err)
	}

	return blob, nil
}

// Fingerprint is the keccak of a blob's bytes — what an on-chain *evidence hash* commits to, as
// distinct from the storage pointer that says where the bytes live. The two are different questions
// and the contracts carry both: the hash says these bytes, the pointer says over there.
func Fingerprint(blob []byte) common.Hash { return crypto.Keccak256Hash(blob) }
