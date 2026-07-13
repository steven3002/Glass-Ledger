package storage

import (
	"os"
	"path/filepath"
	"strings"
)

// FromEnv picks where the blobs go.
//
// The 0G backend is chosen by configuration, never by default, and it announces itself when it is
// used. A demo that quietly wrote a file to a laptop while claiming to have published to 0G Storage
// would be lying about one of the few things it exists to show — so the choice is explicit, it is made
// in exactly one place, and `Backend()` tells anyone who asks which way it went.
func FromEnv(dataDir string) (Store, error) {
	blobs := filepath.Join(dataDir, "blobs")

	if os.Getenv("GLASS_STORAGE") == "0g" {
		return NewZeroG(
			os.Getenv("GLASS_0G_RPC"),
			os.Getenv("GLASS_0G_INDEXER"),
			strings.TrimPrefix(os.Getenv("GLASS_0G_KEY"), "0x"),
			blobs,
		)
	}
	return NewLocal(blobs)
}
