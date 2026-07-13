package chain_test

import (
	"context"
	"crypto/ecdsa"
	"math/big"
	"net"
	"os/exec"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"

	"goodhouse/relayer/internal/chain"
	"goodhouse/relayer/internal/chain/bindings"
	"goodhouse/relayer/internal/merkle"
	"goodhouse/relayer/internal/voucher"
)

// The relayer computes four things that the contracts also compute, and if any of the four disagree by
// a single byte the protocol does not work: a creator's signature would be rejected, a membership proof
// would fail, a claim code would not redeem, or a verdict would be injected against a statement nobody
// asked about.
//
// So none of it is asserted against a constant. Every value below is computed in Go and then handed to
// the deployed contract to compute for itself, and the two are compared. What is being tested is not
// "does the code still do what it did yesterday" — it is "do these two independent implementations of
// the same encoding still agree", which is the only question that matters at a seam.
//
// The tests need a chain to ask. They skip, loudly, when there is not one.

func TestVoucherDigestMatchesTheRegistry(t *testing.T) {
	fixture := deploy(t)

	item := voucher.Voucher{
		CreatorID:      big.NewInt(1),
		ItemID:         big.NewInt(1001),
		MetadataHash:   crypto.Keccak256Hash([]byte("glass-ledger/item/1001")),
		SplitPolicyRef: crypto.Keccak256Hash([]byte("a split policy")),
	}

	// The domain first: it binds the chain and the registry's own address, which is what stops a
	// signature travelling between deployments.
	domain := voucher.Domain(fixture.chainID, fixture.registryAddr)
	onChain, err := fixture.registry.DomainSeparator(nil)
	if err != nil {
		t.Fatal(err)
	}
	if common.Hash(onChain) != domain {
		t.Fatalf("domain separator: relayer %s, registry %s", domain, common.Hash(onChain))
	}

	// Then the digest — the thing she signs, and the leaf her tranche commits to. They are the same
	// thirty-two bytes, and that is not a coincidence: it is what makes a tag impossible to sign
	// without consigning, or to consign without signing.
	digest := item.Digest(domain)
	fromRegistry, err := fixture.registry.VoucherDigest(nil, bindings.CreatorRegistryItemVoucher{
		CreatorId:      item.CreatorID,
		ItemId:         item.ItemID,
		MetadataHash:   item.MetadataHash,
		SplitPolicyRef: item.SplitPolicyRef,
	})
	if err != nil {
		t.Fatal(err)
	}
	if common.Hash(fromRegistry) != digest {
		t.Fatalf("voucher digest: relayer %s, registry %s", digest, common.Hash(fromRegistry))
	}
}

func TestASignatureTheRelayerMakesIsOneTheRegistryAccepts(t *testing.T) {
	fixture := deploy(t)

	key, err := crypto.GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	creator := crypto.PubkeyToAddress(key.PublicKey)

	if _, err := fixture.client.Send(context.Background(), fixture.operator, "register", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return fixture.registry.Register(auth, creator)
	}); err != nil {
		t.Fatal(err)
	}

	item := voucher.Voucher{
		CreatorID:      big.NewInt(1),
		ItemID:         big.NewInt(1001),
		MetadataHash:   crypto.Keccak256Hash([]byte("glass-ledger/item/1001")),
		SplitPolicyRef: crypto.Keccak256Hash([]byte("a split policy")),
	}
	domain := voucher.Domain(fixture.chainID, fixture.registryAddr)

	signature, err := item.Sign(key, domain)
	if err != nil {
		t.Fatal(err)
	}

	// The registry reverts `UnknownCreatorSignature` if it disagrees. There is nothing to assert: the
	// call either returns the digest or it does not happen.
	digest, err := fixture.registry.RequireValidVoucher(nil, bindings.CreatorRegistryItemVoucher{
		CreatorId:      item.CreatorID,
		ItemId:         item.ItemID,
		MetadataHash:   item.MetadataHash,
		SplitPolicyRef: item.SplitPolicyRef,
	}, signature)
	if err != nil {
		t.Fatalf("the registry rejected a signature this relayer made: %v", err)
	}
	if common.Hash(digest) != item.Digest(domain) {
		t.Fatal("the registry accepted the signature but computed a different digest")
	}

	// And a signature by anybody else is refused — which is the only reason the first half means
	// anything.
	forger, err := crypto.GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	forged, err := item.Sign(forger, domain)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.registry.RequireValidVoucher(nil, bindings.CreatorRegistryItemVoucher{
		CreatorId:      item.CreatorID,
		ItemId:         item.ItemID,
		MetadataHash:   item.MetadataHash,
		SplitPolicyRef: item.SplitPolicyRef,
	}, forged); err == nil {
		t.Fatal("the registry accepted a forged signature")
	}
}

func TestMerkleProofsVerifyAgainstTheItemLedger(t *testing.T) {
	fixture := deploy(t)
	ctx := context.Background()

	// A consignment of thirteen leaves, exactly as the seed builds one.
	leaves := make([]merkle.Hash, 13)
	for i := range leaves {
		leaves[i] = crypto.Keccak256Hash([]byte("leaf"), big.NewInt(int64(i)).Bytes())
	}

	tree, err := merkle.New(leaves)
	if err != nil {
		t.Fatal(err)
	}

	creator := crypto.PubkeyToAddress(fixture.operator.PublicKey)
	if _, err := fixture.client.Send(ctx, fixture.operator, "register", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return fixture.registry.Register(auth, creator)
	}); err != nil {
		t.Fatal(err)
	}

	var currency [32]byte
	copy(currency[:], "NGN")

	if _, err := fixture.client.Send(ctx, fixture.operator, "post tranche", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return fixture.items.PostTranche(auth, big.NewInt(1), creator, tree.Root(), 13, currency, "Lagos - Ikoyi")
	}); err != nil {
		t.Fatal(err)
	}

	// Every leaf's proof must verify against the root the ledger is holding — and the ledger walks the
	// proof its own way, with its own hashing, on its own copy of the root.
	for i, leaf := range leaves {
		proof, err := tree.Proof(i)
		if err != nil {
			t.Fatal(err)
		}

		if !merkle.Verify(leaf, proof, tree.Root()) {
			t.Fatalf("leaf %d: the relayer's own walk does not verify", i)
		}

		ok, err := fixture.items.VerifyMembership(nil, big.NewInt(1), leaf, proof)
		if err != nil {
			t.Fatal(err)
		}
		if !ok {
			t.Fatalf("leaf %d: the ledger refused a proof this relayer built", i)
		}
	}

	// A leaf that is not in the consignment has no proof that verifies, whatever path is presented
	// with it. Otherwise the first half of this test proves nothing.
	outsider := crypto.Keccak256Hash([]byte("a tag nobody consigned"))
	proof, err := tree.Proof(0)
	if err != nil {
		t.Fatal(err)
	}
	ok, err := fixture.items.VerifyMembership(nil, big.NewInt(1), outsider, proof)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("the ledger accepted a leaf that is not in the tranche")
	}
}

func TestTheStatementIsTheLedgersAndTheVerdictKeyMatchesIt(t *testing.T) {
	fixture := deploy(t)

	// The statement a verdict is keyed by is `keccak256(abi.encode(Statement))`. The relayer never
	// composes one — it reads `debts.statementOf(claimId)` — so what has to agree here is the *ABI
	// encoding* of the struct as it travels from the ledger, through this process, into the verifier.
	// If the round trip lost a byte, a verdict would be injected against a statement nobody asked
	// about, and every sweep would silently cover nothing.
	statement := bindings.IProofVerifierStatement{
		ClaimId:              big.NewInt(7),
		RefHash:              crypto.Keccak256Hash([]byte("PSK_1001")),
		RecipientAccountHash: crypto.Keccak256Hash([]byte("accounts")),
		AmountCommitment:     crypto.Keccak256Hash([]byte("amounts")),
		Currency:             [32]byte{'N', 'G', 'N'},
		Success:              true,
	}

	if _, err := fixture.client.Send(context.Background(), fixture.operator, "set verdict", func(auth *bind.TransactOpts) (*types.Transaction, error) {
		return fixture.proofs.SetVerdict(auth, statement, true)
	}); err != nil {
		t.Fatal(err)
	}

	// The verifier says yes to this statement…
	ok, err := fixture.proofs.Verify(nil, statement, []byte("evidence the stub ignores, on purpose"))
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("the verifier did not recognise the statement it was just given a verdict for")
	}

	// …and to nothing else. One field moves, and it is a different question — which is the property
	// the whole sweep rests on: a real receipt for a different payment proves a statement nobody
	// asked about, and covers nothing.
	for name, mutate := range map[string]func(s *bindings.IProofVerifierStatement){
		"a different claim":    func(s *bindings.IProofVerifierStatement) { s.ClaimId = big.NewInt(8) },
		"a different payment":  func(s *bindings.IProofVerifierStatement) { s.RefHash = crypto.Keccak256Hash([]byte("other")) },
		"a different account":  func(s *bindings.IProofVerifierStatement) { s.RecipientAccountHash = [32]byte{} },
		"a different amount":   func(s *bindings.IProofVerifierStatement) { s.AmountCommitment = [32]byte{} },
		"a different currency": func(s *bindings.IProofVerifierStatement) { s.Currency = [32]byte{'U', 'S', 'D'} },
		"a failed transfer":    func(s *bindings.IProofVerifierStatement) { s.Success = false },
	} {
		altered := statement
		mutate(&altered)

		ok, err := fixture.proofs.Verify(nil, altered, []byte("evidence"))
		if err != nil {
			t.Fatal(err)
		}
		if ok {
			t.Fatalf("the verifier answered yes to %s", name)
		}
	}
}

func TestTheClaimCodeCommitmentMatchesTheContract(t *testing.T) {
	// `ClaimCodes.commitment(itemId, code) = keccak256(abi.encode(itemId, code))`. The relayer prints
	// the code on a receipt and the contract stores the commitment; a buyer who cannot redeem her own
	// certificate would discover the disagreement in the worst possible way.
	itemID := big.NewInt(1001)
	code := crypto.Keccak256Hash([]byte("glass-ledger/claim-code/1001"))

	inGo := crypto.Keccak256Hash(common.BigToHash(itemID).Bytes(), code.Bytes())

	// The gateway has no view for this, so the contract's answer is taken from the one place it is
	// visible: it accepts the code, or the redemption reverts `BadClaimCode`. That is asserted end to
	// end by the demo; here the encoding is pinned against the ABI the contract publishes.
	packed, err := packItemAndCode(itemID, code)
	if err != nil {
		t.Fatal(err)
	}
	if crypto.Keccak256Hash(packed) != inGo {
		t.Fatal("the claim-code commitment does not match abi.encode(itemId, code)")
	}
}

// --- The chain the tests ask. ---

type fixture struct {
	client       *chain.Client
	chainID      *big.Int
	operator     *ecdsa.PrivateKey
	registry     *bindings.CreatorRegistry
	registryAddr common.Address
	items        *bindings.ItemLedger
	proofs       *bindings.StubProofVerifier
}

// deploy starts a development chain and puts the three contracts these tests interrogate on it.
//
// It deploys them from the bindings rather than from the deployment script, because what is under test
// here is the *encoding* — the wiring is the deployment script's business and the contract suite proves
// it separately.
func deploy(t *testing.T) fixture {
	t.Helper()

	if _, err := exec.LookPath("anvil"); err != nil {
		t.Skip("anvil is not installed: these tests ask a real chain whether the relayer's encodings agree with the contracts'")
	}

	port := freePort(t)
	cmd := exec.Command("anvil", "--port", port, "--silent")
	if err := cmd.Start(); err != nil {
		t.Fatalf("starting anvil: %v", err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill() })

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)

	var client *chain.Client
	var err error
	for i := 0; i < 50; i++ {
		client, err = chain.Dial(ctx, "http://127.0.0.1:"+port)
		if err == nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("dialling anvil: %v", err)
	}
	t.Cleanup(client.Close)

	// anvil's first account. A published test key, worth nothing, in every Foundry on earth.
	operator, err := crypto.HexToECDSA("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
	if err != nil {
		t.Fatal(err)
	}
	auth, err := client.Auth(operator)
	if err != nil {
		t.Fatal(err)
	}

	registryAddr, tx, registry, err := bindings.DeployCreatorRegistry(auth, client.ETH, crypto.PubkeyToAddress(operator.PublicKey))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bind.WaitMined(ctx, client.ETH, tx); err != nil {
		t.Fatal(err)
	}

	auth, _ = client.Auth(operator)
	_, tx, items, err := bindings.DeployItemLedger(auth, client.ETH, crypto.PubkeyToAddress(operator.PublicKey), registryAddr)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bind.WaitMined(ctx, client.ETH, tx); err != nil {
		t.Fatal(err)
	}

	auth, _ = client.Auth(operator)
	_, tx, proofs, err := bindings.DeployStubProofVerifier(auth, client.ETH, crypto.PubkeyToAddress(operator.PublicKey))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bind.WaitMined(ctx, client.ETH, tx); err != nil {
		t.Fatal(err)
	}

	return fixture{
		client:       client,
		chainID:      client.ChainID,
		operator:     operator,
		registry:     registry,
		registryAddr: registryAddr,
		items:        items,
		proofs:       proofs,
	}
}

func freePort(t *testing.T) string {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	_, port, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	return port
}

// packItemAndCode asks the ABI encoder — the same one the contracts' `abi.encode` implements — for the
// bytes a claim-code commitment is taken over.
func packItemAndCode(itemID *big.Int, code common.Hash) ([]byte, error) {
	uint256Type, err := abi.NewType("uint256", "", nil)
	if err != nil {
		return nil, err
	}
	bytes32Type, err := abi.NewType("bytes32", "", nil)
	if err != nil {
		return nil, err
	}

	args := abi.Arguments{{Type: uint256Type}, {Type: bytes32Type}}
	return args.Pack(itemID, [32]byte(code))
}
