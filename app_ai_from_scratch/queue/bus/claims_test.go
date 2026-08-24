package bus

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestMemoryClaimsIsALeaseNotAFlag(t *testing.T) {
	c := NewMemoryClaims()
	ctx := context.Background()

	ok, err := c.Claim(ctx, "k")
	if err != nil || !ok {
		t.Fatalf("first claim = %v, %v; want true", ok, err)
	}
	// running, theirs -> skip. A second worker must not run the same work.
	ok, _ = c.Claim(ctx, "k")
	if ok {
		t.Fatal("the same key was claimed twice while it was running")
	}
	// A failed handler releases, and the scheduled retry must then be claimable
	// -- otherwise the retry is acked away as a duplicate and never runs.
	if err := c.Release(ctx, "k"); err != nil {
		t.Fatal(err)
	}
	ok, _ = c.Claim(ctx, "k")
	if !ok {
		t.Fatal("a released key could not be re-claimed: the retry would be lost")
	}
	// done -> skip, forever.
	if err := c.Complete(ctx, "k"); err != nil {
		t.Fatal(err)
	}
	ok, _ = c.Claim(ctx, "k")
	if ok {
		t.Fatal("a completed key was claimed again")
	}
	if c.Durable() {
		t.Fatal("MemoryClaims must not claim to be durable: a restart forgets it")
	}
}

func TestMemoryClaimsIsSafeUnderConcurrentClaimsOfOneKey(t *testing.T) {
	c := NewMemoryClaims()
	const n = 40
	wins := make(chan bool, n)
	for range n {
		go func() {
			ok, _ := c.Claim(context.Background(), "one")
			wins <- ok
		}()
	}
	won := 0
	for range n {
		if <-wins {
			won++
		}
	}
	if won != 1 {
		t.Fatalf("%d goroutines claimed the same key; exactly one may win", won)
	}
}

func TestAPIClaimsSpeaksTheWireContractApiExpects(t *testing.T) {
	var gotSecret, gotAction, gotKey, gotOwner string
	var gotLease float64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotSecret = r.Header.Get("x-ia-secreto")
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		gotAction, _ = body["action"].(string)
		gotKey, _ = body["key"].(string)
		gotOwner, _ = body["owner"].(string)
		gotLease, _ = body["lease_s"].(float64)
		_ = json.NewEncoder(w).Encode(map[string]any{"claimed": true})
	}))
	defer srv.Close()

	c := &APIClaims{URL: srv.URL, Secret: "s3cret", Owner: "queue-1", LeaseS: 300}
	ok, err := c.Claim(context.Background(), "league:2026-08-17")
	if err != nil || !ok {
		t.Fatalf("claim = %v, %v", ok, err)
	}
	// The header name stays Spanish because api and ai already send it.
	if gotSecret != "s3cret" {
		t.Fatalf("x-ia-secreto = %q", gotSecret)
	}
	if gotAction != "claim" || gotKey != "league:2026-08-17" || gotOwner != "queue-1" || gotLease != 300 {
		t.Fatalf("body = %q %q %q %v", gotAction, gotKey, gotOwner, gotLease)
	}
	if !c.Durable() {
		t.Fatal("APIClaims is the durable one and must say so")
	}
}

func TestAClaimServiceThatCannotBeReachedIsAnErrorNotAGoAhead(t *testing.T) {
	// Reading unreachable as "yes" would turn a network blip into a double run.
	c := &APIClaims{URL: "http://127.0.0.1:1/claim", Secret: "s", Owner: "o", Timeout: 200 * time.Millisecond}
	ok, err := c.Claim(context.Background(), "k")
	if err == nil {
		t.Fatal("an unreachable claim service returned no error")
	}
	if ok {
		t.Fatal("an unreachable claim service was read as permission to run")
	}
}

func TestAClaimServiceThatRefusesIsNotReadAsPermission(t *testing.T) {
	for _, tc := range []struct {
		name string
		h    http.HandlerFunc
	}{
		{"401", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(401) }},
		{"500", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(500) }},
		{"garbage body", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("not json")) }},
		{"no claimed field", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{}`)) }},
		{"claimed false", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"claimed":false}`)) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(tc.h)
			defer srv.Close()
			c := &APIClaims{URL: srv.URL, Secret: "s", Owner: "o"}
			ok, _ := c.Claim(context.Background(), "k")
			if ok {
				t.Fatalf("%s was read as permission to run", tc.name)
			}
		})
	}
}

func TestEveryClaimCallCarriesADeadline(t *testing.T) {
	// A claim service that accepts the connection and never answers would
	// otherwise hold a prefetch slot until the process is killed.
	block := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		<-block
	}))
	defer srv.Close()
	defer close(block)

	c := &APIClaims{URL: srv.URL, Secret: "s", Owner: "o", Timeout: 150 * time.Millisecond}
	start := time.Now()
	if _, err := c.Claim(context.Background(), "k"); err == nil {
		t.Fatal("a claim against a silent server returned no error")
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("the claim blocked for %s", elapsed)
	}
}

// The claim path runs twice per delivery and the consumer starts one goroutine
// per in-flight delivery, so its concurrency IS the prefetch. It therefore has to
// reuse connections: an http.Client built per call falls back to
// http.DefaultTransport, whose MaxIdleConnsPerHost is 2, and everything past the
// second concurrent call opens a fresh TCP connection and discards it.
//
// That is not a micro-optimisation. Measured at prefetch 16 the per-call version
// opened a connection for very nearly every claim and exhausted the host's
// ephemeral ports -- which presents as api refusing connections, not as a queue
// bug. The assertion is on SOCKETS rather than on nanoseconds, because the socket
// count is the thing that breaks and it is the thing that is stable enough to
// assert.
func TestTheClaimPathReusesConnectionsAcrossConcurrentDeliveries(t *testing.T) {
	const workers, rounds = 16, 4
	const calls = workers * rounds * 2 // Claim + Complete each round

	var opened atomic.Int64
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"claimed":true,"state":"running"}`))
	}))
	srv.Config.ConnState = func(_ net.Conn, s http.ConnState) {
		if s == http.StateNew {
			opened.Add(1)
		}
	}
	srv.Start()
	defer srv.Close()

	c := &APIClaims{URL: srv.URL, Secret: "s", Owner: "queue-1", LeaseS: 300}
	var wg sync.WaitGroup
	for i := range workers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for r := range rounds {
				key := fmt.Sprintf("job:%d:%d", i, r)
				if ok, err := c.Claim(context.Background(), key); err != nil || !ok {
					t.Errorf("claim %s = %v, %v", key, ok, err)
					return
				}
				if err := c.Complete(context.Background(), key); err != nil {
					t.Errorf("complete %s: %v", key, err)
					return
				}
			}
		}(i)
	}
	wg.Wait()

	// Up to `workers` connections is the floor nothing can beat: that many calls
	// really are in flight at once. Anything approaching `calls` means the pool
	// is not being reused. The bound is generous on purpose -- this test is here
	// to catch a return to one-connection-per-call, not to pin an exact number.
	if got := opened.Load(); got > int64(workers*2) {
		t.Fatalf("%d TCP connections for %d claim calls at concurrency %d. "+
			"The pool is not being reused; check that post() shares one http.Client "+
			"with a transport sized above DefaultTransport's MaxIdleConnsPerHost of 2",
			got, calls, workers)
	}
}
