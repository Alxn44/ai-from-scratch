package broker

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"course/queue/bus"
)

func mute() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// TestWithNoBrokerEveryOperationFailsAndNothingReportsSuccess is the fail-closed
// contract. api/src/bus.ts treats a publish with no broker as a failure and
// never a silent success, and so must this.
func TestWithNoBrokerEveryOperationFailsAndNothingReportsSuccess(t *testing.T) {
	c := New(Options{URL: "", Exchange: "course.events", Log: mute()})
	ctx := context.Background()
	topo, err := bus.BuildTopology("course.events", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	env, err := bus.NewEnvelope(bus.NewEnvelopeOptions{Type: "a.b"})
	if err != nil {
		t.Fatal(err)
	}

	if err := c.Publish(ctx, "course.events", "a.b", env); !errors.Is(err, ErrNoBroker) {
		t.Fatalf("Publish = %v; want ErrNoBroker", err)
	}
	if err := c.Declare(ctx, topo); !errors.Is(err, ErrNoBroker) {
		t.Fatalf("Declare = %v; want ErrNoBroker", err)
	}

	// Verify must NOT come back as "nothing missing". An empty result with a nil
	// error is exactly the shape that has produced a false green here before.
	missing, err := c.Verify(ctx, topo)
	if !errors.Is(err, ErrNoBroker) {
		t.Fatalf("Verify error = %v; want ErrNoBroker", err)
	}
	if missing != nil {
		t.Fatalf("Verify returned %v alongside the error: a caller reading only the slice would see a pass", missing)
	}

	states, err := c.Inspect(ctx, []string{"q"})
	if !errors.Is(err, ErrNoBroker) {
		t.Fatalf("Inspect error = %v; want ErrNoBroker", err)
	}
	if states != nil {
		t.Fatalf("Inspect returned %v alongside the error", states)
	}

	if _, err := c.ReplayDeadLetters(ctx, 10); !errors.Is(err, ErrNoBroker) {
		t.Fatalf("ReplayDeadLetters = %v; want ErrNoBroker", err)
	}
	if c.Configured() {
		t.Fatal("Configured() is true with no URL")
	}
}

func TestHealthDistinguishesNotConfiguredFromNotConnected(t *testing.T) {
	// Collapsing the two is how a health endpoint stops being useful: one is a
	// missing variable, the other is a broker to chase.
	none := New(Options{URL: "", Log: mute()}).Health()
	if none.Configured || none.Connected {
		t.Fatalf("health with no URL = %+v", none)
	}
	if none.Broker != "(unset)" {
		t.Fatalf("broker = %q; want (unset)", none.Broker)
	}

	set := New(Options{URL: "amqp://app:pw@broker:5672/", Log: mute()}).Health()
	if !set.Configured {
		t.Fatal("Configured is false with a URL set")
	}
	if set.Connected {
		t.Fatal("Connected is true before anything dialled")
	}
	if set.Broker != "amqp://***@broker:5672/" {
		t.Fatalf("broker = %q; the credentials must not be in a health body", set.Broker)
	}
}

func TestReplayRefusesAnUnboundedLimit(t *testing.T) {
	// Draining "everything" from a dead-letter queue is not a decision a default
	// gets to make.
	c := New(Options{URL: "amqp://app:pw@127.0.0.1:1/", Exchange: "course.events", Log: mute()})
	if _, err := c.ReplayDeadLetters(context.Background(), 0); err == nil {
		t.Fatal("limit 0 was accepted")
	}
	if _, err := c.ReplayDeadLetters(context.Background(), -1); err == nil {
		t.Fatal("a negative limit was accepted")
	}
}

func TestAnUnreachableBrokerFailsWithinTheDeadlineAndNotForever(t *testing.T) {
	// Port 1 refuses immediately on most systems, but the deadline is what makes
	// this safe on the ones where it blackholes instead.
	c := New(Options{
		URL: "amqp://app:pw@127.0.0.1:1/", Exchange: "course.events",
		Log: mute(), PublishTimeout: 500 * time.Millisecond,
	})
	env, _ := bus.NewEnvelope(bus.NewEnvelopeOptions{Type: "a.b"})
	start := time.Now()
	err := c.Publish(context.Background(), "course.events", "a.b", env)
	if err == nil {
		t.Fatal("a publish to an unreachable broker reported success")
	}
	if elapsed := time.Since(start); elapsed > 10*time.Second {
		t.Fatalf("the publish blocked for %s", elapsed)
	}
	// And the failure is remembered, so a flapping broker leaves a trace.
	if h := c.Health(); h.LastError == "" {
		t.Fatal("the failure was not recorded in Health()")
	}
}

func TestCloseIsSafeWhenNothingWasEverOpened(t *testing.T) {
	if err := New(Options{URL: "", Log: mute()}).Close(); err != nil {
		t.Fatalf("Close on an unused client = %v", err)
	}
}

func TestRedactNeverLeaksAndNeverFallsBackToTheRawString(t *testing.T) {
	cases := map[string]string{
		"":                                  "(unset)",
		"amqp://app:pw@broker:5672/":        "amqp://***@broker:5672/",
		"amqp://broker:5672/":               "amqp://broker:5672/",
		"amqps://u:p@rabbit.internal/vhost": "amqps://***@rabbit.internal/vhost",
		"garbage-with-no-scheme":            "(unparseable AMQP_URL)",
	}
	for in, want := range cases {
		if got := redact(in); got != want {
			t.Fatalf("redact(%q) = %q; want %q", in, got, want)
		}
	}
	// The property that matters more than any single case: a password must never
	// survive redaction, whatever the shape of the URL.
	for _, u := range []string{
		"amqp://app:sup3rs3cret@broker:5672/",
		"amqps://app:sup3rs3cret@broker/vh",
		"amqp://sup3rs3cret@broker/",
	} {
		if got := redact(u); contains(got, "sup3rs3cret") {
			t.Fatalf("redact(%q) leaked the credential: %q", u, got)
		}
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (func() bool {
		for i := 0; i+len(needle) <= len(haystack); i++ {
			if haystack[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	})()
}

func TestAConsumerWithNoBrokerIdlesInsteadOfCrashLooping(t *testing.T) {
	// A container with a restart policy would otherwise crash-loop over a missing
	// variable, and a crash-loop reads as a bug in this code.
	c := NewConsumer(&Consumer{URL: "", Queue: "queue.work", Log: mute()})
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- c.Run(ctx) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run with no broker returned %v; want a clean idle-until-stopped", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Run did not return when its context was cancelled")
	}
}

func TestAConsumerWithNoDispatcherRefusesRatherThanAckingIntoNothing(t *testing.T) {
	c := NewConsumer(&Consumer{URL: "amqp://app:pw@127.0.0.1:1/", Queue: "queue.work", Log: mute()})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := c.Run(ctx); err == nil {
		t.Fatal("a consumer with no dispatcher was allowed to run")
	}
}

func TestStopOnAConsumerThatNeverConnectedDoesNotHang(t *testing.T) {
	// The SIGTERM path has to work even when the broker was never reachable,
	// otherwise a container that started against a down broker cannot be stopped
	// without SIGKILL.
	c := NewConsumer(&Consumer{
		URL: "amqp://app:pw@127.0.0.1:1/", Queue: "queue.work", Log: mute(),
		Drain: 200 * time.Millisecond,
		Dispatcher: &bus.Dispatcher{
			Exchange: "course.events", Queue: "queue.work",
			Handlers: map[string]bus.Handler{}, Claims: bus.NewMemoryClaims(), Log: mute(),
		},
	})
	ctx, cancel := context.WithCancel(context.Background())
	go func() { _ = c.Run(ctx) }()
	time.Sleep(50 * time.Millisecond)

	stopped := make(chan bus.Stats, 1)
	go func() { stopped <- c.Stop(context.Background()) }()
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("Stop hung on a consumer that never connected")
	}
	cancel()
}

func TestStopIsIdempotent(t *testing.T) {
	// SIGTERM followed by SIGINT is a normal sequence, and closing a closed
	// channel would panic.
	c := NewConsumer(&Consumer{URL: "", Queue: "q", Log: mute(), Drain: 10 * time.Millisecond})
	c.Stop(context.Background())
	c.Stop(context.Background())
}
