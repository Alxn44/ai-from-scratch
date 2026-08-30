package report

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"sync"
	"testing"

	"course/security/internal/audit"
	"course/security/internal/config"
	"course/security/internal/finding"
)

// quiet is a reporter with no broker and nothing to print: exactly the shape a
// developer machine runs, since AMQP is deliberately not published to the host.
func quiet(t *testing.T) *Reporter {
	t.Helper()
	r, err := New(config.Config{
		Agent:     "oracle",
		Exchange:  "defense",
		AuditPath: filepath.Join(t.TempDir(), "audit.jsonl"),
	}, io.Discard, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	return r
}

// A Reporter is shared by every in-flight delivery of its agent, so it must be
// safe to call from several goroutines at once. This is not hypothetical:
// cmd/oracle runs with Prefetch 16, and queue/broker's consumer starts one
// goroutine per delivery, so up to sixteen handlers hold this same *Reporter and
// call Finding concurrently.
//
// This test is worth nothing without -race. It exercises the no-broker path on
// purpose, because that is the path with the shared mutable state: the
// "no AMQP_URL" notice is emitted once per process, and "once" needs somewhere
// to remember that it has happened.
func TestAReporterIsSafeToShareBetweenConcurrentDeliveries(t *testing.T) {
	r := quiet(t)
	const goroutines = 16
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := range goroutines {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start // widen the window: everybody hits publish() together
			f := finding.Finding{
				Rule: "detect.auth.login_failed", Line: finding.Detection, Source: "oracle",
				Severity: finding.High, Target: "203.0.113.7",
				Summary:  "eight failed logins inside the window",
				Remedy:   "throttle the identity; this is credential stuffing, not a typo",
				Evidence: map[string]string{"n": "8"},
			}
			if err := r.Finding(context.Background(), f); err != nil {
				t.Errorf("Finding: %v", err)
			}
			r.Event(context.Background(), "defense.threat.high", "defense.threat",
				"defense.threat:test:"+f.ID(), audit.Record{
					Verdict: "escalate", Kind: "throttle_identity", Target: "7",
				}, map[string]any{"i": i})
		}(i)
	}
	close(start)
	wg.Wait()
}
