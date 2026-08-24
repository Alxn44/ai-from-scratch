package bus

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// DISPATCH: dedupe, run, ack, retry or dead-letter.
//
// This is the port of consumeOn() in api/src/bus.ts and Consumer.on_message() in
// ai/src/course_ai/bus.py, and api/test/transport.mts is its specification. The
// decisions it must reproduce, each one a check over there:
//
//   - unreadable bytes go STRAIGHT to the DLQ (they cannot be retried into
//     readability),
//   - a type with no handler goes to the DLQ (parked, counted, replayable once
//     the handler ships) rather than being requeued into a loop,
//   - a duplicate is ACKED, not dropped and not retried,
//   - a failed attempt below the ceiling is republished to the delay tier for
//     its attempt number and then acked,
//   - a failed attempt AT the ceiling is dead-lettered,
//   - a handler that never returns is a FAILURE, not a permanently occupied
//     prefetch slot,
//   - if the retry publish itself cannot be confirmed, requeue ONCE -- and a
//     delivery that comes back already redelivered goes to the DLQ, so it cannot
//     spin.
//
// It is written against interfaces rather than against amqp091 so all of that is
// testable without a broker, which is how the sibling runtimes test it too.

// Delivery is the slice of an AMQP delivery this package uses. Naming the
// methods here is what makes a typo in one of them a compile error instead of a
// consumer that silently acknowledges nothing.
type Delivery interface {
	Body() []byte
	// Redelivered reports the broker's redelivered flag. It is the only thing
	// standing between "requeue once" and an infinite requeue loop.
	Redelivered() bool
	Ack() error
	// Nack with requeue=false is what sends the message to the queue's
	// x-dead-letter-exchange.
	Nack(requeue bool) error
}

// Publisher hands one envelope to the broker and returns only once the broker
// has taken durable responsibility for it.
type Publisher interface {
	Publish(ctx context.Context, exchange, key string, env Envelope) error
}

// Handler runs one message. The context carries the handler deadline: a handler
// that ignores it is a handler that will be reported as timed out.
type Handler func(ctx context.Context, payload map[string]any, env Envelope) error

// Stats are the counters a container log shows at shutdown. Same names as the
// two sibling runtimes, so three services report the same vocabulary.
type Stats struct {
	Taken     int64 `json:"taken"`
	Done      int64 `json:"done"`
	Duplicate int64 `json:"duplicate"`
	Retried   int64 `json:"retried"`
	Dead      int64 `json:"dead"`
	Malformed int64 `json:"malformed"`
	Requeued  int64 `json:"requeued"`
	// Abandoned has no counterpart in the other two runtimes because neither of
	// them can have the problem: a Go goroutine cannot be cancelled from
	// outside, so a handler that ignores its context keeps running after the
	// delivery has been failed. The count makes that leak visible instead of
	// letting it be a slow memory climb nobody can explain.
	Abandoned int64 `json:"abandoned"`
}

// Dispatcher applies the policy above to deliveries.
type Dispatcher struct {
	// Exchange is the MAIN exchange, needed to name the retry tiers.
	Exchange       string
	Queue          string
	Handlers       map[string]Handler
	Claims         Claims
	Publisher      Publisher
	HandlerTimeout time.Duration
	PublishTimeout time.Duration
	Log            *slog.Logger

	mu    sync.Mutex
	stats Stats
}

// Snapshot copies the counters. A copy, not a pointer: a caller serialising
// these while a delivery increments them would otherwise race.
func (d *Dispatcher) Snapshot() Stats {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.stats
}

func (d *Dispatcher) bump(f func(*Stats)) {
	d.mu.Lock()
	f(&d.stats)
	d.mu.Unlock()
}

func (d *Dispatcher) log() *slog.Logger {
	if d.Log != nil {
		return d.Log
	}
	return slog.Default()
}

func (d *Dispatcher) handlerTimeout() time.Duration {
	if d.HandlerTimeout > 0 {
		return d.HandlerTimeout
	}
	return 60 * time.Second
}

func (d *Dispatcher) publishTimeout() time.Duration {
	if d.PublishTimeout > 0 {
		return d.PublishTimeout
	}
	return 10 * time.Second
}

// HandlerTypes is the registered set, for /health and for the boot line.
func (d *Dispatcher) HandlerTypes() []string {
	return sortedKeys(d.Handlers)
}

func (d *Dispatcher) deadLetter(msg Delivery, why string) {
	d.log().Error("dead-lettering", "why", why, "queue", d.Queue)
	if err := msg.Nack(false); err != nil {
		// A nack that fails means the channel is gone. The message is NOT lost
		// -- an unacked delivery is redelivered when the connection drops -- but
		// saying so is the difference between a puzzle and a known state.
		d.log().Error("nack failed; the delivery will be redelivered", "error", err)
	}
}

// Deliver handles exactly one delivery and returns when the delivery has been
// settled (acked or nacked). It never returns an error: every outcome is either
// a settled delivery or a logged failure, because there is no caller above this
// that could do anything more useful with one.
func (d *Dispatcher) Deliver(ctx context.Context, msg Delivery) {
	d.bump(func(s *Stats) { s.Taken++ })

	env, err := ParseEnvelope(msg.Body())
	if err != nil {
		// Unreadable bytes cannot be retried into readability. Straight to the
		// DLQ, where they are visible and replayable instead of dropped.
		d.bump(func(s *Stats) { s.Malformed++ })
		d.deadLetter(msg, fmt.Sprintf("malformed envelope: %v", err))
		return
	}

	fn, ok := d.Handlers[env.Type]
	if !ok {
		// A type nobody here handles means a binding wider than the handler set.
		// A broker cannot hand it back to another instance without a requeue
		// loop, so it is parked in the DLQ: counted, and replayable once the
		// handler ships.
		d.bump(func(s *Stats) { s.Dead++ })
		d.deadLetter(msg, fmt.Sprintf("no handler for type %q on queue %q", env.Type, d.Queue))
		return
	}

	if d.Claims == nil {
		// Refusing is the only honest answer. Running the handler without a
		// claim would silently drop the at-most-once guarantee the other two
		// runtimes provide, and the message would be acked as if it had been
		// deduped correctly.
		d.bump(func(s *Stats) { s.Dead++ })
		d.deadLetter(msg, fmt.Sprintf("%v -- refusing to run %s unchecked", ErrNoClaims, env.Type))
		return
	}

	claimed, err := d.Claims.Claim(ctx, env.IdempotencyKey)
	if err != nil {
		// Unknown is not "go ahead". Fail the delivery so the retry ladder runs
		// and the work happens once the claim store is reachable again.
		d.fail(ctx, msg, env, fmt.Errorf("claim unavailable: %w", err))
		return
	}
	if !claimed {
		d.bump(func(s *Stats) { s.Duplicate++ })
		d.log().Info("duplicate, already claimed -- acking",
			"type", env.Type, "idempotency_key", env.IdempotencyKey)
		if err := msg.Ack(); err != nil {
			d.log().Error("ack of duplicate failed", "error", err)
		}
		return
	}

	if err := d.run(ctx, fn, env); err != nil {
		// Let the retry run: without the release, the scheduled retry would look
		// like a duplicate and be acked away without ever running.
		if rerr := d.Claims.Release(ctx, env.IdempotencyKey); rerr != nil {
			d.log().Error("releasing the claim failed; the retry may be seen as a duplicate",
				"idempotency_key", env.IdempotencyKey, "error", rerr)
		}
		d.fail(ctx, msg, env, err)
		return
	}

	if err := d.Claims.Complete(ctx, env.IdempotencyKey); err != nil {
		// The work IS done. Nacking now would run it a second time, which is
		// worse than a claim row left in `running` until its lease expires.
		d.log().Error("marking the claim complete failed; the work was done",
			"idempotency_key", env.IdempotencyKey, "error", err)
	}
	if err := msg.Ack(); err != nil {
		d.log().Error("ack failed after a successful handler; expect one redelivery",
			"type", env.Type, "error", err)
	}
	d.bump(func(s *Stats) { s.Done++ })
}

// run executes the handler under a deadline.
//
// A handler that never returns must be a failure and not a permanently occupied
// prefetch slot -- api/test/transport.mts has a check for exactly that. Go
// cannot cancel a goroutine from outside, so the deadline frees the SLOT and the
// goroutine is abandoned. Two things keep that from being a leak nobody sees:
// the channel is buffered, so an abandoned handler that eventually returns can
// send and exit instead of blocking forever; and Stats.Abandoned counts it.
func (d *Dispatcher) run(ctx context.Context, fn Handler, env Envelope) error {
	ctx, cancel := context.WithTimeout(ctx, d.handlerTimeout())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		defer func() {
			// A panicking handler must not take the process down: one bad
			// message would then stop every other message on the queue.
			if r := recover(); r != nil {
				done <- fmt.Errorf("handler panicked: %v", r)
			}
		}()
		done <- fn(ctx, env.Payload, env)
	}()

	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		d.bump(func(s *Stats) { s.Abandoned++ })
		return fmt.Errorf("handler %s did not return within %s (goroutine abandoned): %w",
			env.Type, d.handlerTimeout(), ctx.Err())
	}
}

// fail is the retry ladder: republish to the delay tier for this attempt, or
// dead-letter at the ceiling.
func (d *Dispatcher) fail(ctx context.Context, msg Delivery, env Envelope, cause error) {
	if env.Attempt >= MaxAttempts {
		d.bump(func(s *Stats) { s.Dead++ })
		d.deadLetter(msg, fmt.Sprintf("%s failed %d attempts, last: %v", env.Type, env.Attempt, cause))
		return
	}
	ms := DelayFor(env.Attempt)
	target := RetryExchange(d.Exchange, ms)

	// A deadline that does NOT inherit the caller's cancellation. On shutdown
	// the caller's context is already cancelled, and a retry publish that
	// inherits it would fail for that reason alone -- turning a drain into a
	// requeue storm.
	pctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), d.publishTimeout())
	defer cancel()

	var perr error
	if d.Publisher == nil {
		perr = errors.New("no publisher configured")
	} else {
		// The delay queue is the only thing bound to that fanout, so an
		// unroutable return here means the topology is not there yet.
		perr = d.Publisher.Publish(pctx, target, env.Key, env.NextAttempt())
	}
	if perr != nil {
		// The retry could not be handed to the broker. Requeue ONCE: this is the
		// single place a requeue is correct, because the alternative is losing
		// the message -- and it cannot spin, since a delivery that comes back
		// already redelivered goes to the DLQ instead.
		if msg.Redelivered() {
			d.bump(func(s *Stats) { s.Dead++ })
			d.deadLetter(msg, fmt.Sprintf("retry publish failed twice for %s: %v", env.Type, perr))
			return
		}
		d.bump(func(s *Stats) { s.Requeued++ })
		d.log().Error("retry publish failed, requeueing once", "type", env.Type, "error", perr)
		if err := msg.Nack(true); err != nil {
			d.log().Error("requeue nack failed", "error", err)
		}
		return
	}
	if err := msg.Ack(); err != nil {
		// The retry is durably in the broker and this delivery was not acked, so
		// the message will be delivered again: the same work is now scheduled
		// twice. The idempotency claim is what makes twice harmless, and this
		// line is what makes it explicable.
		d.log().Error("ack after a scheduled retry failed; expect one duplicate delivery",
			"type", env.Type, "error", err)
	}
	d.bump(func(s *Stats) { s.Retried++ })
	d.log().Warn("attempt failed, retry scheduled",
		"type", env.Type, "attempt", env.Attempt, "delay_ms", ms, "error", cause.Error())
}
