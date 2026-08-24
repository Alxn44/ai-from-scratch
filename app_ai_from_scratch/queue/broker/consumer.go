package broker

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"course/queue/bus"
)

// Consumer runs one queue until it is stopped, surviving broker restarts.
//
// The reconnect policy, its numbers and the re-declaration of the topology are
// part of the contract and are written once per runtime with the same numbers on
// all three sides. amqp091 has no auto-recovery of its own, which suits: the
// Python side deliberately does not use aio-pika's connect_robust() for the same
// reason -- two recovery mechanisms stacked on each other is one too many to
// reason about.
type Consumer struct {
	URL      string
	Exchange string
	Queue    string
	Patterns []string
	Prefetch int
	// Dispatcher carries the policy. Its Publisher is wired to this consumer's
	// current channel, so a retry is published on the SAME channel the delivery
	// came from -- the same choice both sibling runtimes make.
	Dispatcher *bus.Dispatcher
	Drain      time.Duration
	Dial       func(url string) (*amqp.Connection, error)
	Log        *slog.Logger

	stopOnce sync.Once
	stop     chan struct{}
	// inflight is what a graceful shutdown waits on. Its size is bounded by
	// prefetch, because the broker will not hand over an (n+1)th unacked
	// delivery -- that is what makes "no unbounded goroutines" true here rather
	// than hoped for.
	inflight sync.WaitGroup

	mu       sync.Mutex
	ch       *confirmChannel
	conn     *amqp.Connection
	tag      string
	health   Health
	attempts int
}

// NewConsumer prepares a consumer. It does not connect.
func NewConsumer(c *Consumer) *Consumer {
	c.stop = make(chan struct{})
	if c.Dial == nil {
		c.Dial = func(u string) (*amqp.Connection, error) { return amqp.Dial(u) }
	}
	if c.Log == nil {
		c.Log = slog.Default()
	}
	if c.Prefetch <= 0 {
		c.Prefetch = 8
	}
	if c.Drain <= 0 {
		c.Drain = 20 * time.Second
	}
	c.health = Health{Configured: c.URL != "", Broker: redact(c.URL)}
	if c.Dispatcher != nil && c.Dispatcher.Publisher == nil {
		c.Dispatcher.Publisher = consumerPublisher{c}
	}
	return c
}

// Health is a snapshot for /health.
func (c *Consumer) Health() Health {
	c.mu.Lock()
	defer c.mu.Unlock()
	h := c.health
	h.Connected = c.conn != nil && !c.conn.IsClosed() && c.tag != ""
	h.Attempts = c.attempts
	return h
}

// Run consumes until Stop is called or ctx is cancelled.
//
// With no broker configured it does NOT return and does NOT crash: it waits to
// be stopped. A container with a restart policy would otherwise crash-loop over
// a missing variable, and a crash-loop reads as a bug in this code rather than as
// a variable nobody set. The same choice ai/src/course_ai/worker.py makes, for
// the same reason.
func (c *Consumer) Run(ctx context.Context) error {
	if c.URL == "" {
		c.Log.Warn("consumer idle: AMQP_URL is not set, so nothing is consumed and nothing is dispatched")
		select {
		case <-ctx.Done():
			return nil
		case <-c.stop:
			return nil
		}
	}
	if c.Dispatcher == nil {
		// Consuming with no dispatcher would ack messages into nothing.
		return fmt.Errorf("consumer for %q has no dispatcher", c.Queue)
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-c.stop:
			return nil
		default:
		}

		if err := c.session(ctx); err != nil {
			select {
			case <-c.stop:
				return nil
			default:
			}
			now := time.Now().UTC()
			c.mu.Lock()
			c.health.LastError = err.Error()
			c.health.LastErrorAt = &now
			c.mu.Unlock()
			c.Log.Error("connect/consume failed", "queue", c.Queue, "error", err)
		}

		select {
		case <-ctx.Done():
			return nil
		case <-c.stop:
			return nil
		default:
		}
		c.mu.Lock()
		n := c.attempts
		c.attempts++
		c.mu.Unlock()
		wait := bus.ReconnectDelay(n)
		c.Log.Warn("retrying the broker", "in", wait.String(), "queue", c.Queue)
		// The wait must be interruptible. Without this, a SIGTERM during a
		// 30-second backoff would make shutdown take 30 seconds and the
		// container runtime would SIGKILL it instead of letting it drain.
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return nil
		case <-c.stop:
			return nil
		}
	}
}

// session is one connection's worth of consuming: connect, declare, consume,
// then park until the connection goes away or the service stops.
func (c *Consumer) session(ctx context.Context) error {
	conn, err := c.Dial(c.URL)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	// Everything opened below is closed on the way out of this function, even on
	// the error paths. Without that, a failure between "connected" and
	// "consuming" leaks one connection per retry, and a broker that rejects the
	// declare accumulates them until it refuses new ones.
	defer func() {
		c.mu.Lock()
		c.ch, c.conn, c.tag = nil, nil, ""
		c.mu.Unlock()
		_ = conn.Close()
	}()

	raw, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("open channel: %w", err)
	}
	// The retry path publishes on this channel, so it needs confirms too: a
	// retry that is not confirmed must not be acked as if it were scheduled.
	if err := raw.Confirm(false); err != nil {
		return fmt.Errorf("confirm mode: %w", err)
	}
	if err := raw.Qos(c.Prefetch, 0, false); err != nil {
		return fmt.Errorf("prefetch: %w", err)
	}
	cc := newConfirmChannel(raw, c.Log)

	topo, err := bus.BuildTopology(c.Exchange, c.Queue, c.Patterns)
	if err != nil {
		return err
	}
	// Re-declared on EVERY connect, not once at boot: after a broker restart
	// from an empty volume the exchanges are gone, and a consumer that assumes
	// otherwise consumes nothing, silently.
	if err := cc.declare(topo); err != nil {
		return err
	}

	closed := conn.NotifyClose(make(chan *amqp.Error, 1))

	// The consumer tag is CHOSEN here, not left to the driver.
	//
	// Passing "" makes amqp091 generate one and never tell you what it is, and
	// Stop() needs it: basic.cancel takes a tag, so cancelling with "" cancels
	// nothing and the drain degenerates into "close the connection and hope".
	// That silently turns a graceful shutdown into an abrupt one -- every
	// in-flight delivery is redelivered instead of finished. A tag per session,
	// because a stale tag from a previous connection is not cancellable either.
	tag := fmt.Sprintf("queue-%s-%d", c.Queue, time.Now().UnixNano())

	// ConsumeWithContext with a context that outlives the call on purpose: the
	// driver uses it to abort the consume SETUP, not to bound the stream.
	deliveries, err := raw.ConsumeWithContext(ctx, c.Queue, tag, false, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("consume %q: %w", c.Queue, err)
	}

	c.mu.Lock()
	c.ch, c.conn = cc, conn
	c.tag = tag
	sessionStart := time.Now().UTC()
	c.health.Since = &sessionStart
	// Only NOW is the backoff reset. Resetting it right after connecting made a
	// broker that accepts TCP but rejects the declaration (a half-configured
	// vhost, a missing permission) retry every second forever on the first rung.
	c.attempts = 0
	c.mu.Unlock()

	c.Log.Info("consuming", "queue", c.Queue, "prefetch", c.Prefetch,
		"exchange", c.Exchange, "patterns", c.Patterns, "types", c.Dispatcher.HandlerTypes())

	for {
		select {
		case d, ok := <-deliveries:
			if !ok {
				// The stream ended: either the channel closed or the consumer
				// was cancelled by Stop.
				return nil
			}
			c.inflight.Add(1)
			go func(d amqp.Delivery) {
				defer c.inflight.Done()
				// Each delivery gets a context that is NOT the session context:
				// on shutdown the session context is cancelled immediately, and
				// a handler that inherited it would be killed mid-work instead
				// of draining. The handler deadline inside Dispatcher is what
				// bounds it.
				c.Dispatcher.Deliver(context.WithoutCancel(ctx), delivery{d})
			}(d)
		case err := <-closed:
			if err != nil {
				return fmt.Errorf("connection closed: %w", err)
			}
			return nil
		case <-c.stop:
			return nil
		case <-ctx.Done():
			return nil
		}
	}
}

// Stop is the SIGTERM path, in this order: stop accepting deliveries, finish and
// ack what is in hand, then close.
//
// A message still unacked when the socket drops is redelivered by the broker --
// nothing is lost, it is only done twice, and the idempotency claim is what makes
// twice harmless.
func (c *Consumer) Stop(ctx context.Context) bus.Stats {
	c.stopOnce.Do(func() { close(c.stop) })

	c.mu.Lock()
	cc, conn, tag := c.ch, c.conn, c.tag
	c.mu.Unlock()

	if cc != nil && tag != "" {
		// Cancelling the consumer by its tag is what stops new deliveries
		// arriving while the ones in hand finish. Closing the channel first
		// would abort them mid-handler.
		if err := cc.ch.Cancel(tag, false); err != nil {
			c.Log.Warn("cancel failed; in-flight deliveries may be redelivered", "tag", tag, "error", err)
		}
	}

	drained := make(chan struct{})
	go func() {
		c.inflight.Wait()
		close(drained)
	}()
	deadline := time.NewTimer(c.Drain)
	defer deadline.Stop()
	select {
	case <-drained:
	case <-deadline.C:
		c.Log.Error("still draining after the deadline; those deliveries will be redelivered",
			"drain", c.Drain.String())
	case <-ctx.Done():
		c.Log.Error("shutdown context expired while draining; those deliveries will be redelivered")
	}

	if conn != nil {
		_ = conn.Close()
	}
	if c.Dispatcher != nil {
		return c.Dispatcher.Snapshot()
	}
	return bus.Stats{}
}

// consumerPublisher publishes retries on the consumer's CURRENT channel.
//
// An indirection rather than a field the reconnect loop overwrites: deliveries
// from the previous connection can still be in flight while a new one is being
// built, and mutating a shared field under them is a data race the race detector
// would find on the first reconnect.
type consumerPublisher struct{ c *Consumer }

func (p consumerPublisher) Publish(ctx context.Context, exchange, key string, env bus.Envelope) error {
	p.c.mu.Lock()
	cc := p.c.ch
	p.c.mu.Unlock()
	if cc == nil || cc.closed() {
		return ErrNotConnected
	}
	return cc.publish(ctx, exchange, key, env)
}

// delivery adapts an amqp091 delivery to bus.Delivery.
type delivery struct{ d amqp.Delivery }

func (x delivery) Body() []byte      { return x.d.Body }
func (x delivery) Redelivered() bool { return x.d.Redelivered }

// Ack acknowledges exactly this delivery. multiple=false, always: acking "all up
// to here" would acknowledge messages whose handlers are still running in other
// goroutines.
func (x delivery) Ack() error { return x.d.Ack(false) }

// Nack with requeue=false is what routes the message to the queue's
// x-dead-letter-exchange.
func (x delivery) Nack(requeue bool) error { return x.d.Nack(false, requeue) }
