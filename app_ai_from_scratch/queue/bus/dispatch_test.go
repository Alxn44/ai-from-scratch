package bus

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"
)

// These are the Go half of api/test/transport.mts. Each test name is the claim
// the JavaScript suite makes about the same decision, so the two can be read
// side by side when one of them changes.

func mute() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// fakeDelivery records how a delivery was settled.
type fakeDelivery struct {
	body        []byte
	redelivered bool
	ackErr      error
	nackErr     error

	mu     sync.Mutex
	acks   int
	nacks  []bool // one entry per nack, holding its requeue flag
	settle int
}

func (f *fakeDelivery) Body() []byte      { return f.body }
func (f *fakeDelivery) Redelivered() bool { return f.redelivered }

func (f *fakeDelivery) Ack() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.acks++
	f.settle++
	return f.ackErr
}

func (f *fakeDelivery) Nack(requeue bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nacks = append(f.nacks, requeue)
	f.settle++
	return f.nackErr
}

func (f *fakeDelivery) state() (acks int, nacks []bool, settled int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.acks, append([]bool(nil), f.nacks...), f.settle
}

type published struct {
	exchange string
	key      string
	env      Envelope
}

type fakePublisher struct {
	mu   sync.Mutex
	sent []published
	err  error
}

func (p *fakePublisher) Publish(_ context.Context, exchange, key string, env Envelope) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.err != nil {
		return p.err
	}
	p.sent = append(p.sent, published{exchange, key, env})
	return nil
}

func (p *fakePublisher) all() []published {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]published(nil), p.sent...)
}

// work builds the standard test message: one type, one stable idempotency key.
func work(t *testing.T, attempt int) []byte {
	t.Helper()
	env, err := NewEnvelope(NewEnvelopeOptions{
		Type: "work.do", Payload: map[string]any{"n": 1}, IdempotencyKey: "w-1", Attempt: attempt,
	})
	if err != nil {
		t.Fatal(err)
	}
	b, err := env.MarshalJSON()
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func newDispatcher(t *testing.T, h Handler, pub Publisher, claims Claims) *Dispatcher {
	t.Helper()
	handlers := map[string]Handler{}
	if h != nil {
		handlers["work.do"] = h
	}
	if claims == nil {
		claims = NewMemoryClaims()
	}
	return &Dispatcher{
		Exchange: "course.events", Queue: "queue.work",
		Handlers: handlers, Claims: claims, Publisher: pub,
		HandlerTimeout: 200 * time.Millisecond, PublishTimeout: 50 * time.Millisecond,
		Log: mute(),
	}
}

func TestHandlerRanOnceAndTheMessageWasAckedByHand(t *testing.T) {
	ran := 0
	d := newDispatcher(t, func(context.Context, map[string]any, Envelope) error { ran++; return nil }, &fakePublisher{}, nil)
	msg := &fakeDelivery{body: work(t, 1)}
	d.Deliver(context.Background(), msg)

	acks, nacks, _ := msg.state()
	if ran != 1 || acks != 1 || len(nacks) != 0 {
		t.Fatalf("ran=%d acks=%d nacks=%v; want 1, 1, none", ran, acks, nacks)
	}
	if got := d.Snapshot(); got.Done != 1 || got.Taken != 1 {
		t.Fatalf("stats = %+v; want Taken=1 Done=1", got)
	}
}

func TestUnreadableBytesGoStraightToTheDLQ(t *testing.T) {
	d := newDispatcher(t, func(context.Context, map[string]any, Envelope) error {
		t.Fatal("the handler must not run for a malformed envelope")
		return nil
	}, &fakePublisher{}, nil)
	msg := &fakeDelivery{body: []byte(`{"nope":true}`)}
	d.Deliver(context.Background(), msg)

	_, nacks, _ := msg.state()
	// requeue=false is what routes it to the dead-letter exchange. A requeue
	// would spin: bytes cannot be retried into readability.
	if len(nacks) != 1 || nacks[0] {
		t.Fatalf("nacks = %v; want exactly one with requeue=false", nacks)
	}
	if got := d.Snapshot(); got.Malformed != 1 {
		t.Fatalf("stats = %+v; want Malformed=1", got)
	}
}

func TestATypeWithNoHandlerIsParkedInTheDLQNotRequeued(t *testing.T) {
	d := newDispatcher(t, nil, &fakePublisher{}, nil) // no handlers registered
	msg := &fakeDelivery{body: work(t, 1)}
	d.Deliver(context.Background(), msg)

	_, nacks, _ := msg.state()
	if len(nacks) != 1 || nacks[0] {
		t.Fatalf("nacks = %v; want one dead-letter", nacks)
	}
	if got := d.Snapshot(); got.Dead != 1 {
		t.Fatalf("stats = %+v; want Dead=1", got)
	}
}

func TestADuplicateIsAckedNotRetried(t *testing.T) {
	claims := NewMemoryClaims()
	ran := 0
	d := newDispatcher(t, func(context.Context, map[string]any, Envelope) error { ran++; return nil }, &fakePublisher{}, claims)

	first := &fakeDelivery{body: work(t, 1)}
	d.Deliver(context.Background(), first)
	second := &fakeDelivery{body: work(t, 1)} // same idempotency key
	d.Deliver(context.Background(), second)

	if ran != 1 {
		t.Fatalf("the handler ran %d times; the second delivery is the same work", ran)
	}
	acks, nacks, _ := second.state()
	if acks != 1 || len(nacks) != 0 {
		t.Fatalf("duplicate: acks=%d nacks=%v; a duplicate is acked, never nacked", acks, nacks)
	}
	if got := d.Snapshot(); got.Duplicate != 1 {
		t.Fatalf("stats = %+v; want Duplicate=1", got)
	}
}

func TestAClaimStoreThatCannotBeReachedIsNotReadAsGoAhead(t *testing.T) {
	ran := 0
	pub := &fakePublisher{}
	d := newDispatcher(t, func(context.Context, map[string]any, Envelope) error { ran++; return nil }, pub, brokenClaims{})
	msg := &fakeDelivery{body: work(t, 1)}
	d.Deliver(context.Background(), msg)

	if ran != 0 {
		t.Fatal("the handler ran while the claim store was unreachable: that turns a network blip into a double run")
	}
	// It must be RETRIED, not dropped: the work still needs doing.
	if got := d.Snapshot(); got.Retried != 1 {
		t.Fatalf("stats = %+v; want Retried=1", got)
	}
	if len(pub.all()) != 1 {
		t.Fatalf("published %d retries; want 1", len(pub.all()))
	}
}

type brokenClaims struct{}

func (brokenClaims) Claim(context.Context, string) (bool, error) {
	return false, errors.New("claim service unreachable")
}
func (brokenClaims) Complete(context.Context, string) error { return nil }
func (brokenClaims) Release(context.Context, string) error  { return nil }

func TestNoClaimStoreAtAllRefusesToRunTheHandler(t *testing.T) {
	ran := 0
	d := newDispatcher(t, func(context.Context, map[string]any, Envelope) error { ran++; return nil }, &fakePublisher{}, nil)
	d.Claims = nil // the state config.Load refuses to produce
	msg := &fakeDelivery{body: work(t, 1)}
	d.Deliver(context.Background(), msg)

	if ran != 0 {
		t.Fatal("running unchecked would silently drop the dedupe guarantee")
	}
	_, nacks, _ := msg.state()
	if len(nacks) != 1 || nacks[0] {
		t.Fatalf("nacks = %v; want one dead-letter", nacks)
	}
}

func TestAFailedAttemptIsRepublishedToTheDelayTierForItsAttempt(t *testing.T) {
	for _, tc := range []struct {
		attempt int
		wantMS  int
	}{{1, 1000}, {2, 4000}, {3, 16000}, {4, 60000}} {
		pub := &fakePublisher{}
		d := newDispatcher(t, func(context.Context, map[string]any, Envelope) error {
			return errors.New("boom")
		}, pub, nil)
		msg := &fakeDelivery{body: work(t, tc.attempt)}
		d.Deliver(context.Background(), msg)

		sent := pub.all()
		if len(sent) != 1 {
			t.Fatalf("attempt %d: published %d; want 1", tc.attempt, len(sent))
		}
		wantEx := RetryExchange("course.events", tc.wantMS)
		if sent[0].exchange != wantEx {
			t.Fatalf("attempt %d went to %q; want %q", tc.attempt, sent[0].exchange, wantEx)
		}
		// The republished message is the SAME work, one attempt later.
		if sent[0].env.Attempt != tc.attempt+1 {
			t.Fatalf("republished attempt = %d; want %d", sent[0].env.Attempt, tc.attempt+1)
		}
		if sent[0].env.IdempotencyKey != "w-1" {
			t.Fatalf("the idempotency key changed on retry: %q", sent[0].env.IdempotencyKey)
		}
		// The routing key must survive, because the delay queue dead-letters
		// back to the main exchange with whatever key it was published with.
		if sent[0].key != "work.do" {
			t.Fatalf("retry routing key = %q; want work.do", sent[0].key)
		}
		acks, _, _ := msg.state()
		if acks != 1 {
			t.Fatalf("attempt %d: the delivery was not acked after the retry was scheduled", tc.attempt)
		}
	}
}

func TestAtTheCeilingItIsDeadLetteredInsteadOfRetried(t *testing.T) {
	pub := &fakePublisher{}
	d := newDispatcher(t, func(context.Context, map[string]any, Envelope) error {
		return errors.New("boom")
	}, pub, nil)
	msg := &fakeDelivery{body: work(t, MaxAttempts)}
	d.Deliver(context.Background(), msg)

	if len(pub.all()) != 0 {
		t.Fatal("a message at the attempt ceiling must not be retried again")
	}
	_, nacks, _ := msg.state()
	if len(nacks) != 1 || nacks[0] {
		t.Fatalf("nacks = %v; want one dead-letter", nacks)
	}
	if got := d.Snapshot(); got.Dead != 1 {
		t.Fatalf("stats = %+v; want Dead=1", got)
	}
}

func TestIfTheRetryCannotBePublishedTheMessageIsRequeuedOnce(t *testing.T) {
	pub := &fakePublisher{err: errors.New("broker said no")}
	d := newDispatcher(t, func(context.Context, map[string]any, Envelope) error {
		return errors.New("boom")
	}, pub, nil)

	first := &fakeDelivery{body: work(t, 1)}
	d.Deliver(context.Background(), first)
	_, nacks, _ := first.state()
	if len(nacks) != 1 || !nacks[0] {
		t.Fatalf("nacks = %v; want one requeue", nacks)
	}
	if got := d.Snapshot(); got.Requeued != 1 {
		t.Fatalf("stats = %+v; want Requeued=1", got)
	}

	// And if it comes back already redelivered it goes to the DLQ -- no spin.
	again := &fakeDelivery{body: work(t, 1), redelivered: true}
	d.Deliver(context.Background(), again)
	_, nacks2, _ := again.state()
	if len(nacks2) != 1 || nacks2[0] {
		t.Fatalf("nacks = %v; a redelivered message whose retry fails must be dead-lettered", nacks2)
	}
	if got := d.Snapshot(); got.Dead != 1 {
		t.Fatalf("stats = %+v; want Dead=1", got)
	}
}

func TestAHandlerThatNeverReturnsIsAFailureNotAStuckPrefetchSlot(t *testing.T) {
	release := make(chan struct{})
	// The handler ignores its context entirely, which is the worst case: nothing
	// but the deadline can free the slot.
	stuck := func(context.Context, map[string]any, Envelope) error {
		<-release
		return nil
	}
	pub := &fakePublisher{}
	d := newDispatcher(t, stuck, pub, nil)
	msg := &fakeDelivery{body: work(t, 1)}

	start := time.Now()
	d.Deliver(context.Background(), msg) // must return without release being closed
	elapsed := time.Since(start)

	if elapsed > 2*time.Second {
		t.Fatalf("Deliver blocked for %s: the prefetch slot was held", elapsed)
	}
	if got := d.Snapshot(); got.Retried != 1 {
		t.Fatalf("stats = %+v; want Retried=1", got)
	}
	if got := d.Snapshot(); got.Abandoned != 1 {
		t.Fatalf("stats = %+v; an abandoned goroutine must be counted, not hidden", got)
	}
	if len(pub.all()) != 1 {
		t.Fatalf("published %d; a timed-out handler is a failed attempt and must be retried", len(pub.all()))
	}
	// Letting it finish proves the buffered channel keeps the abandoned
	// goroutine from blocking forever: without the buffer this send would leak.
	close(release)
}

func TestAPanickingHandlerIsAFailedAttemptNotADeadProcess(t *testing.T) {
	pub := &fakePublisher{}
	d := newDispatcher(t, func(context.Context, map[string]any, Envelope) error {
		panic("handler exploded")
	}, pub, nil)
	msg := &fakeDelivery{body: work(t, 1)}
	d.Deliver(context.Background(), msg)

	if got := d.Snapshot(); got.Retried != 1 {
		t.Fatalf("stats = %+v; want Retried=1", got)
	}
}

func TestAFailedHandlerReleasesItsClaimSoTheRetryIsNotSeenAsADuplicate(t *testing.T) {
	claims := NewMemoryClaims()
	calls := 0
	d := newDispatcher(t, func(context.Context, map[string]any, Envelope) error {
		calls++
		if calls == 1 {
			return errors.New("boom")
		}
		return nil
	}, &fakePublisher{}, claims)

	d.Deliver(context.Background(), &fakeDelivery{body: work(t, 1)})
	// The retry arrives later, with the same idempotency key.
	d.Deliver(context.Background(), &fakeDelivery{body: work(t, 2)})

	if calls != 2 {
		t.Fatalf("the handler ran %d time(s); the scheduled retry was acked away as a duplicate", calls)
	}
	if got := d.Snapshot(); got.Done != 1 || got.Duplicate != 0 {
		t.Fatalf("stats = %+v; want Done=1 Duplicate=0", got)
	}
}

func TestTheHandlerReceivesADeadlineItCanObserve(t *testing.T) {
	var hadDeadline bool
	d := newDispatcher(t, func(ctx context.Context, _ map[string]any, _ Envelope) error {
		_, hadDeadline = ctx.Deadline()
		return nil
	}, &fakePublisher{}, nil)
	d.Deliver(context.Background(), &fakeDelivery{body: work(t, 1)})
	if !hadDeadline {
		t.Fatal("the handler context carried no deadline: a blocking call inside it could hang forever")
	}
}

func TestAShutdownCancelledContextStillLetsTheRetryBePublished(t *testing.T) {
	// On drain the caller's context is already cancelled. A retry publish that
	// inherited that cancellation would fail for that reason alone, turning a
	// clean drain into a requeue storm.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	var sawDeadline bool
	pub := publisherFunc(func(c context.Context, _, _ string, _ Envelope) error {
		if c.Err() != nil {
			return c.Err()
		}
		_, sawDeadline = c.Deadline()
		return nil
	})
	d := newDispatcher(t, func(context.Context, map[string]any, Envelope) error {
		return errors.New("boom")
	}, pub, nil)
	msg := &fakeDelivery{body: work(t, 1)}
	d.Deliver(ctx, msg)

	if got := d.Snapshot(); got.Retried != 1 {
		t.Fatalf("stats = %+v; the retry was lost because the caller's context was cancelled", got)
	}
	if !sawDeadline {
		t.Fatal("the retry publish ran without a deadline of its own")
	}
}

type publisherFunc func(context.Context, string, string, Envelope) error

func (f publisherFunc) Publish(ctx context.Context, ex, key string, env Envelope) error {
	return f(ctx, ex, key, env)
}

func TestStatsAreSafeUnderConcurrentDeliveries(t *testing.T) {
	// -race is what makes this test worth having: every counter is touched by one
	// goroutine per in-flight delivery.
	d := newDispatcher(t, func(context.Context, map[string]any, Envelope) error { return nil }, &fakePublisher{}, nil)
	const n = 50
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			env, err := NewEnvelope(NewEnvelopeOptions{
				Type: "work.do", IdempotencyKey: strings.Repeat("k", i+1),
			})
			if err != nil {
				t.Error(err)
				return
			}
			b, err := env.MarshalJSON()
			if err != nil {
				t.Error(err)
				return
			}
			d.Deliver(context.Background(), &fakeDelivery{body: b})
		}(i)
	}
	wg.Wait()
	if got := d.Snapshot(); got.Taken != n || got.Done != n {
		t.Fatalf("stats = %+v; want Taken=%d Done=%d", got, n, n)
	}
}

func TestEveryPathSettlesTheDeliveryExactlyOnce(t *testing.T) {
	// A delivery that is neither acked nor nacked holds a prefetch slot until the
	// connection drops. A delivery settled twice is a channel error that kills
	// the consumer. Both are silent, so this walks every branch.
	cases := []struct {
		name    string
		body    []byte
		handler Handler
		pub     Publisher
		claims  Claims
	}{
		{"malformed", []byte("not json"), nil, &fakePublisher{}, nil},
		{"no handler", work(t, 1), nil, &fakePublisher{}, nil},
		{"success", work(t, 1), func(context.Context, map[string]any, Envelope) error { return nil }, &fakePublisher{}, nil},
		{"retried", work(t, 1), func(context.Context, map[string]any, Envelope) error { return errors.New("x") }, &fakePublisher{}, nil},
		{"dead at ceiling", work(t, MaxAttempts), func(context.Context, map[string]any, Envelope) error { return errors.New("x") }, &fakePublisher{}, nil},
		{"requeued", work(t, 1), func(context.Context, map[string]any, Envelope) error { return errors.New("x") }, &fakePublisher{err: errors.New("no")}, nil},
		{"claim unavailable", work(t, 1), func(context.Context, map[string]any, Envelope) error { return nil }, &fakePublisher{}, brokenClaims{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := tc.handler
			d := newDispatcher(t, h, tc.pub, tc.claims)
			if tc.name == "no handler" || tc.name == "malformed" {
				d.Handlers = map[string]Handler{}
			}
			msg := &fakeDelivery{body: tc.body}
			d.Deliver(context.Background(), msg)
			if _, _, settled := msg.state(); settled != 1 {
				t.Fatalf("settled %d times; every path must settle exactly once", settled)
			}
		})
	}
}
