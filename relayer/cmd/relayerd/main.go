// Command relayerd is the operator's service: the mock payment-processor webhook, the simulated
// bank-alert feed, a status endpoint, and the kill switch.
//
// # This process is not load-bearing, and proving that is the point
//
// Everything Good runs is in here, and nothing anybody else needs is. A buyer verifying a tag, a
// creator checking whether she has been paid, an auditor reading the ledger, a stranger collecting a
// default — none of them call this service. They read the chain over a public RPC and they compute
// locally. The kill switch exists so that this can be *demonstrated* rather than asserted: stop the
// operator, and every verification still answers, every clock still runs, every permissionless touch
// still lands.
//
// What stops when this stops: new sales can no longer be rung up at Good's till, and the operator can
// no longer post claims, sweeps or verdicts. What does not stop: the debts already owed keep aging, the
// deadlines keep passing, the pool still pays, and the ceiling still refuses. The operator can stop
// serving. It cannot stop settling.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"goodhouse/relayer/internal/feeds"
	"goodhouse/relayer/internal/ops"
)

func main() {
	settings := ops.Flags(flag.CommandLine)
	addr := flag.String("addr", ":8790", "address to serve the operator's endpoints on")
	secret := flag.String(
		"secret", env("GLASS_WEBHOOK_SECRET", "demo-webhook-secret"),
		"the processor's HMAC secret — the operator's own, which is exactly why its payloads can never be evidence",
	)
	flag.Parse()

	logger := log.New(os.Stdout, "", log.LstdFlags)
	alerts := feeds.NewAlertFeed()

	// The counter. It is the only thing on this service the web needs, and it is the write path: a
	// sale is the one action in the protocol that nobody but the operator can take.
	counter, err := openTill(context.Background(), settings, *secret)
	if err != nil {
		logger.Printf("the till is closed (%v) — feeds, status and the kill switch still serve", err)
	}

	// The kill switch. A demo needs to stop the operator on cue, in front of people, and then show
	// that nothing which matters stopped with it.
	stop := make(chan struct{})
	var once sync.Once

	mux := http.NewServeMux()

	// The processor's webhook: a trigger, never evidence. The signature proves the message came from
	// the integration — it says nothing about whether money reached anybody, and the protocol never
	// asks it to.
	mux.HandleFunc("POST /webhook/processor", func(w http.ResponseWriter, r *http.Request) {
		var payload feeds.ProcessorPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "bad payload", http.StatusBadRequest)
			return
		}
		if !feeds.Verify(*secret, payload) {
			http.Error(w, "bad signature", http.StatusUnauthorized)
			return
		}

		logger.Printf(
			"processor webhook: item %d, ref %s — a doorbell. What goes on-chain is a claim, and the claim is what gets tested.",
			payload.ItemID, payload.Reference,
		)
		writeJSON(w, map[string]any{"accepted": true, "refHash": payload.RefHash()})
	})

	// The recipient's bank alerts. In production this service never exists: the alert goes to her
	// phone, and her app matches it against the operator's claims on her own device, where the
	// operator cannot watch. Here it is simulated so the ledger view can show the auto-match.
	mux.HandleFunc("GET /alerts", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, alerts.For(r.URL.Query().Get("recipient")))
	})

	mux.HandleFunc("POST /alerts", func(w http.ResponseWriter, r *http.Request) {
		var alert feeds.Alert
		if err := json.NewDecoder(r.Body).Decode(&alert); err != nil {
			http.Error(w, "bad alert", http.StatusBadRequest)
			return
		}
		alerts.Credit(alert.Recipient, alert.Reference, alert.Amount, alert.Currency)
		writeJSON(w, map[string]any{"recorded": true})
	})

	// The checkout. Stop this process and these two stop with it — which is precisely what a closed
	// shop looks like. Nothing a buyer, a creator, an auditor or a stranger does to *verify* anything
	// touches this service, and the kill switch is here to prove it rather than assert it.
	if counter != nil {
		mux.HandleFunc("POST /buy", counter.buy)
		mux.HandleFunc("POST /redeem", counter.redeem)
	} else {
		mux.HandleFunc("POST /buy", closed)
		mux.HandleFunc("POST /redeem", closed)
	}

	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{
			"operator": "up",
			"note": "verification does not run through this service. Stop it and check: the chain still " +
				"answers, the clocks still run, the pool still pays.",
		})
	})

	mux.HandleFunc("POST /kill", func(w http.ResponseWriter, r *http.Request) {
		logger.Print("kill switch pulled — the operator is going offline. Nothing that matters depends on it.")
		writeJSON(w, map[string]any{"stopping": true})
		once.Do(func() { close(stop) })
	})

	server := &http.Server{
		Addr:              *addr,
		Handler:           browsable(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		select {
		case sig := <-signals:
			logger.Printf("%s — shutting down cleanly", sig)
		case <-stop:
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := server.Shutdown(ctx); err != nil {
			logger.Printf("shutdown: %v", err)
		}
	}()

	logger.Printf("relayerd on %s — the operator is up", *addr)
	logger.Print("public verification never calls this process; that is what the kill switch is for")

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Fatalf("serve: %v", err)
	}

	logger.Print("operator offline. Verification is unaffected — check for yourself.")
}

func writeJSON(w http.ResponseWriter, body any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

// browsable lets the checkout page reach the counter from its own origin.
//
// Production note: this is open because a demo has no point-of-sale terminals to enrol, and the
// checkout page is served from a different port than the till. A real deployment authenticates the
// terminal and pins the origin. Nothing about that changes what the contracts check — an attacker with
// this endpoint can only ask the operator to sell its own stock and mint the debts that come with it,
// which is the one thing the ledger is built to make expensive.
func browsable(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
