// Command indexerd serves the catalog index, and seeds it from the chain.
//
// The shop needs one thing the ledger cannot give it: grouping. Which items are the same product,
// what that product is called, whose line it belongs to. None of that is on chain and none of it
// should be, so it lives in Postgres and is served from here.
//
// Two modes, one binary:
//
//	indexerd -seed    read the chain and the published consignment, apply the grouping rule, write it
//	indexerd          serve what was written
//
// The failure mode is deliberate and worth stating: if this process is down, the collections page
// stops working and *nothing else does*. The ledger, the shelf, every item, debt, claim and the
// commons all read the chain directly in the browser and never touch this service. That is the right
// way round — the half that must survive an outage is the half that proves things, and grouping is
// editorial. An indexer that could take the ledger down with it would have inverted the whole point.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"goodhouse/relayer/internal/chain"
	"goodhouse/relayer/internal/index"
)

func main() {
	var (
		seed        = flag.Bool("seed", false, "read the chain and rewrite the index, then exit")
		addr        = flag.String("addr", envOr("INDEXER_ADDR", ":8080"), "listen address")
		rpcURL      = flag.String("rpc", envOr("RPC_URL", "https://evmrpc-testnet.0g.ai"), "chain RPC")
		consignment = flag.String("consignment", envOr("CONSIGNMENT", ""), "path to the published consignment.json")
		deployment  = flag.String("deployment", envOr("DEPLOYMENT", ""), "path to the deployment json")
		origins     = flag.String("origins", envOr("INDEXER_ORIGINS", "*"), "comma-separated allowed origins")
	)
	flag.Parse()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is not set. It is server-side only — never give it a NEXT_PUBLIC_ name.")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	if err := index.Migrate(ctx, pool); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	if *seed {
		if err := runSeed(ctx, pool, *rpcURL, *consignment, *deployment); err != nil {
			log.Fatalf("seed: %v", err)
		}
		return
	}

	serve(pool, *addr, strings.Split(*origins, ","))
}

/* ---- seeding ------------------------------------------------------------------------------------- */

func runSeed(ctx context.Context, pool *pgxpool.Pool, rpcURL, consignmentPath, deploymentPath string) error {
	if consignmentPath == "" {
		return fmt.Errorf("-consignment is required: the chain cannot say which creator an UNSOLD item belongs to, " +
			"because an item's tranche slot stays zero until a sale touches it and a tranche stores a count and a root, " +
			"never the ids. The published paperwork is the only source that can attribute one")
	}

	consigned, err := index.LoadConsignment(consignmentPath)
	if err != nil {
		return err
	}

	// Every consignment in the file, including the farm's — the invented creator's goods are on chain
	// and must be catalogued like anyone else's. Hiding them would be the catalog editorialising about
	// who deserves to be seen, which is not its job.
	byCreator := map[int64][]int64{}
	trancheOf := map[int64]int64{}
	for _, block := range []*index.Consignment{&consigned, consigned.Farm} {
		if block == nil {
			continue
		}
		for _, item := range block.Items {
			byCreator[block.CreatorID] = append(byCreator[block.CreatorID], item.ID)
			// The paperwork's tranche, not the chain's slot: an untouched item's slot names no tranche
			// at all, and most of a shelf is untouched.
			trancheOf[item.ID] = block.TrancheID
		}
	}
	if len(byCreator) == 0 {
		return fmt.Errorf("the consignment names no items")
	}

	client, err := chain.Dial(ctx, rpcURL)
	if err != nil {
		return fmt.Errorf("dial %s: %w", rpcURL, err)
	}

	chainID, err := client.ETH.ChainID(ctx)
	if err != nil {
		return fmt.Errorf("chain id: %w", err)
	}

	deploy, err := chain.LoadDeployment(chain.DeploymentPath(deploymentPath, "", chainID))
	if err != nil {
		return fmt.Errorf("deployment: %w", err)
	}
	contracts, err := chain.Bind(deploy, client.ETH)
	if err != nil {
		return fmt.Errorf("bind: %w", err)
	}

	// The price is read from the chain, never from the consignment file. The file records what an
	// item was priced at on intake; `effectivePrice` is what it costs now, and the grouping has to be
	// built on the number that is true today.
	prices := map[int64]*big.Int{}
	call := &bind.CallOpts{Context: ctx}
	for _, ids := range byCreator {
		for _, id := range ids {
			price, err := contracts.Prices.EffectivePrice(call, big.NewInt(id))
			if err != nil {
				return fmt.Errorf("price for item %d: %w", id, err)
			}
			prices[id] = price
		}
	}

	// The retired heuristic, run only over what it already grouped. New items are declared by the
	// scenario that mints them; see internal/index/seed.go.
	grouped := index.Group(byCreator, prices)
	declared, err := index.Merge(ctx, pool, chainID.Int64(), index.DeclaredFromGroups(grouped, trancheOf))
	if err != nil {
		return fmt.Errorf("read the existing catalog to preserve it: %w", err)
	}

	counts, err := index.Write(ctx, pool, chainID.Int64(), declared)
	if err != nil {
		return err
	}

	log.Printf("indexed chain %s: %d collections, %d products, %d variants, %d units",
		chainID, counts.Collections, counts.Products, counts.Variants, counts.Units)
	for creatorID, groups := range grouped {
		multi := 0
		for _, g := range groups {
			if len(g) > 1 {
				multi++
			}
		}
		log.Printf("  creator %d: %d products, %d of them holding more than one unit", creatorID, len(groups), multi)
	}
	return nil
}

/* ---- serving ------------------------------------------------------------------------------------- */

func serve(pool *pgxpool.Pool, addr string, origins []string) {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery(), cors(origins))

	router.GET("/healthz", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	router.GET("/catalog/:chainId", func(c *gin.Context) {
		chainID, err := strconv.ParseInt(c.Param("chainId"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "chain id must be a number"})
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
		defer cancel()

		catalog, err := index.Load(ctx, pool, chainID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// Short and revalidatable: the grouping changes when somebody reseeds, which is rare, but a
		// stale catalog beside a live ledger is the one thing this must not serve for long.
		c.Header("Cache-Control", "public, max-age=30, stale-while-revalidate=300")
		c.JSON(http.StatusOK, catalog)
	})

	router.GET("/catalog/:chainId/item/:itemId", func(c *gin.Context) {
		chainID, err := strconv.ParseInt(c.Param("chainId"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "chain id must be a number"})
			return
		}
		itemID, err := strconv.ParseInt(c.Param("itemId"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item id must be a number"})
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
		defer cancel()

		placement, err := index.FindItem(ctx, pool, chainID, itemID)
		if err != nil {
			// Not an error condition. An item the catalog has never grouped is a perfectly good item;
			// it simply has no editorial name yet, and the item page says so rather than breaking.
			c.JSON(http.StatusNotFound, gin.H{"error": "this item is not in the catalog"})
			return
		}
		c.Header("Cache-Control", "public, max-age=30, stale-while-revalidate=300")
		c.JSON(http.StatusOK, placement)
	})

	log.Printf("indexer listening on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("listen: %v", err)
	}
}

// cors decides who may read the catalog.
//
// The default is "*", and that is a considered choice rather than a shortcut. Everything this
// service serves is a shop's public catalog — line names, product names, and the item ids they group.
// There is no authentication, no cookie, no credentialed request, and nothing here that is not
// already visible to anyone who opens the shop. An allowlist would protect nothing and would break
// the app the moment it is opened from a laptop rather than the host it runs on, which is exactly
// what happened.
//
// Set -origins to a comma-separated list to lock it down; the secret worth guarding is DATABASE_URL,
// and that never leaves this process.
func cors(origins []string) gin.HandlerFunc {
	allowed := map[string]bool{}
	any := false
	for _, o := range origins {
		trimmed := strings.TrimSpace(o)
		if trimmed == "*" {
			any = true
		} else if trimmed != "" {
			allowed[trimmed] = true
		}
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if any {
			c.Header("Access-Control-Allow-Origin", "*")
			c.Header("Access-Control-Allow-Methods", "GET, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type")
		} else if allowed[origin] {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Methods", "GET, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
