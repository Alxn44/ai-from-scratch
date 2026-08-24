package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"course/defense/internal/config"
	"course/defense/internal/guard"
	"course/defense/internal/policy"
	"course/defense/internal/report"
	qbus "course/queue/bus"
)

// countingRunner stands in for guard.Real. It counts what ACTUALLY ran, which is
// the only number the global cap is a statement about, and it holds the
// "action" open long enough for a second handler to reach Decide -- exactly the
// window a real nft or cloudflared call leaves open.
type countingRunner struct {
	mu    sync.Mutex
	calls int
	delay time.Duration
}

func (c *countingRunner) Run(_ context.Context, d policy.Decision) (guard.Result, error) {
	if d.Verdict != policy.Act {
		return guard.Result{}, fmt.Errorf("runner reached with verdict %q", d.Verdict)
	}
	c.mu.Lock()
	c.calls++
	c.mu.Unlock()
	time.Sleep(c.delay)
	return guard.Result{Argv: d.Argv, Output: "ok"}, nil
}

func (c *countingRunner) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls
}

func newHandler(t *testing.T, r guard.Runner) *handler {
	t.Helper()
	engine, err := policy.NewEngine(policy.Enforce, nil)
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	cfg := config.Config{
		Agent:     "neo",
		Exchange:  "defense",
		Mode:      policy.Enforce,
		AuditPath: filepath.Join(t.TempDir(), "audit.jsonl"),
	}
	lg := slog.New(slog.NewTextHandler(io.Discard, nil))
	rep, err := report.New(cfg, io.Discard, lg)
	if err != nil {
		t.Fatalf("report.New: %v", err)
	}
	t.Cleanup(func() { _ = rep.Close() })
	return &handler{engine: engine, rep: rep, runner: r, cfg: cfg, lg: lg}
}

func threat(i int) (map[string]any, qbus.Envelope) {
	return map[string]any{
			"action":     string(policy.ThrottleIdentity),
			"target":     fmt.Sprint(1000 + i),
			"why":        "eight failed logins inside the window",
			"finding_id": fmt.Sprintf("f-%04d", i),
		}, qbus.Envelope{
			ID: fmt.Sprintf("env-%04d", i), Type: "defense.threat",
		}
}

// THE GLOBAL CAP IS THE LAST THING BETWEEN A COMPROMISED DETECTION LAYER AND AN
// ACTION STORM, so it has to hold when handlers overlap and not only when they
// happen not to.
//
// Prefetch 1 on neo's consumer is what normally keeps them from overlapping, and
// that is a safety property rather than a throughput choice -- see the comment
// on the consumer in main(). It is NOT sufficient on its own, and this test is
// the reason: a handler that outruns Dispatcher.HandlerTimeout is ABANDONED, not
// cancelled (queue/bus/dispatch.go says so in Dispatcher.run). Its goroutine
// keeps running, its prefetch slot is released, and the next delivery is
// dispatched while the first handler is still on its way to Committed(). At that
// moment two handlers are live, and since Decide() only READS the budget that
// Committed() later spends, both can pass a cap of ten.
//
// The race detector cannot find this one: every field involved is already behind
// a mutex, so the bug is a lost update and not a data race. It has to be counted.
func TestTheGlobalCapHoldsWhenHandlersOverlap(t *testing.T) {
	const overlapping = 24
	if overlapping <= policy.GlobalLimit.Max {
		t.Fatalf("this test proves nothing unless it asks for more than the cap of %d",
			policy.GlobalLimit.Max)
	}
	runner := &countingRunner{delay: 5 * time.Millisecond}
	h := newHandler(t, runner)

	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := range overlapping {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			payload, env := threat(i)
			<-start
			if err := h.handle(context.Background(), payload, env); err != nil {
				t.Errorf("handle: %v", err)
			}
		}(i)
	}
	close(start)
	wg.Wait()

	if got := runner.count(); got > policy.GlobalLimit.Max {
		t.Fatalf("%d containments were carried out against a global cap of %d per %s. "+
			"Overlapping handlers each read the budget before any of them spent it",
			got, policy.GlobalLimit.Max, policy.GlobalLimit.Window)
	}
}

// The cap must also not be UNDER-spent: an engine that serialises by refusing
// everything would pass the test above and be useless. Ten threats, no overlap
// worth speaking of, and all ten should act.
func TestTheCapIsSpentInFullBeforeItEscalates(t *testing.T) {
	runner := &countingRunner{}
	h := newHandler(t, runner)
	for i := range policy.GlobalLimit.Max {
		payload, env := threat(i)
		if err := h.handle(context.Background(), payload, env); err != nil {
			t.Fatalf("handle: %v", err)
		}
	}
	if got := runner.count(); got != policy.GlobalLimit.Max {
		t.Fatalf("only %d of %d allowed containments happened; the cap is being under-spent",
			got, policy.GlobalLimit.Max)
	}
}
