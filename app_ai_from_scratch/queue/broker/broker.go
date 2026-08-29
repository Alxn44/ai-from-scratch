// Package broker is the amqp091 adapter: the only place in this service that
// knows a concrete AMQP driver exists.
//
// Everything about POLICY -- the envelope, the topology, the retry ladder, what
// counts as a failed publish -- lives in internal/bus and is tested without a
// broker. This package is the narrow layer that turns that policy into frames,
// plus the connection lifecycle: reconnect with backoff, re-declare on every
// connect, and an honest answer to "are you actually connected".
package broker

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"course/queue/bus"
)

// ErrNoBroker is returned by every operation when no AMQP_URL was configured.
//
// It exists so that "there is no broker" can never be mistaken for success. Both
// sibling runtimes make the same choice explicitly: api/src/bus.ts returns
// `published: false, reason: 'bus_disabled'` and logs at error level, and
// bus.py's Publisher does the same. A publish with no broker is a FAILURE.
var ErrNoBroker = errors.New("broker: no AMQP_URL configured, so nothing was published or verified")

// ErrNotConnected is returned when a broker is configured but the connection is
// not currently up. Distinct from ErrNoBroker on purpose: one is a missing
// variable, the other is a broker to chase.
var ErrNotConnected = errors.New("broker: not connected")

// Health is what /health reports about the broker. It distinguishes the three
// states that matter, because collapsing them is how a health endpoint becomes
// decoration: not configured, configured but down, and up.
type Health struct {
	Configured bool   `json:"configured"`
	Connected  bool   `json:"connected"`
	Broker     string `json:"broker"`
	// Pointers, not time.Time: `omitempty` does not omit a zero struct, so a
	// plain time.Time here rendered as "0001-01-01T00:00:00Z" in every healthy
	// answer -- a 1970-shaped timestamp that reads as corruption, which is the
	// exact thing Envelope.Timestamp() refuses to emit.
	Since *time.Time `json:"since,omitempty"`
	// LastError is the last connection or channel failure, kept after recovery
	// so a flapping broker leaves a trace instead of looking permanently fine.
	LastError   string     `json:"last_error,omitempty"`
	LastErrorAt *time.Time `json:"last_error_at,omitempty"`
	Attempts    int        `json:"reconnect_attempts"`
}

// Options configure a Client.
type Options struct {
	URL      string
	Exchange string
	// Dial is injectable so tests can drive the lifecycle without a broker.
	Dial func(url string) (*amqp.Connection, error)
	Log  *slog.Logger
	// PublishTimeout bounds a single publish end to end, including the confirm.
	PublishTimeout time.Duration
}

// Client owns the publisher connection and answers the questions the HTTP API
// asks: declare, verify, inspect, publish.
//
// The consumer gets its OWN connection (see consumer.go), not this one: a
// consumer under broker flow control must not be able to stall an unrelated
// publish.
type Client struct {
	opts Options
	log  *slog.Logger

	mu     sync.Mutex
	conn   *amqp.Connection
	ch     *confirmChannel
	health Health
}

// New builds a client. It does not connect: connecting is lazy so that a service
// with an unreachable broker still boots and still serves an honest /health.
func New(o Options) *Client {
	if o.Dial == nil {
		o.Dial = func(u string) (*amqp.Connection, error) { return amqp.Dial(u) }
	}
	if o.PublishTimeout <= 0 {
		o.PublishTimeout = 10 * time.Second
	}
	log := o.Log
	if log == nil {
		log = slog.Default()
	}
	return &Client{
		opts: o,
		log:  log,
		health: Health{
			Configured: o.URL != "",
			Broker:     redact(o.URL),
		},
	}
}

// Configured reports whether an AMQP_URL was given at all.
func (c *Client) Configured() bool { return c.opts.URL != "" }

// Health is a snapshot, safe to serialise while the client reconnects.
func (c *Client) Health() Health {
	c.mu.Lock()
	defer c.mu.Unlock()
	h := c.health
	h.Connected = c.conn != nil && !c.conn.IsClosed()
	return h
}

// EnsureConnected establishes the publisher connection when it is absent.
//
// Publishing is normally lazy, but a broker restart can otherwise leave an
// otherwise-working consumer reporting unhealthy until the next request happens
// to publish a message. Health probes use this bounded reconnect so an operator
// sees the actual ability to accept work, rather than the age of the last write.
func (c *Client) EnsureConnected(ctx context.Context) error {
	_, err := c.channel(ctx)
	return err
}

func (c *Client) noteError(err error) {
	now := time.Now().UTC()
	c.mu.Lock()
	c.health.LastError = err.Error()
	c.health.LastErrorAt = &now
	c.mu.Unlock()
}

// channel returns a live confirm channel, opening one if needed.
//
// The channel is rebuilt rather than reused after a failure: an unconfirmed
// publish usually means the channel is gone, and the next call should build a new
// one instead of reusing a corpse.
func (c *Client) channel(ctx context.Context) (*confirmChannel, error) {
	if !c.Configured() {
		return nil, ErrNoBroker
	}
	c.mu.Lock()
	if c.ch != nil && c.conn != nil && !c.conn.IsClosed() && !c.ch.closed() {
		ch := c.ch
		c.mu.Unlock()
		return ch, nil
	}
	c.mu.Unlock()

	// Dialling outside the lock: amqp.Dial blocks on the network, and holding
	// the mutex across it would make /health -- which only wants to read two
	// booleans -- wait for a TCP timeout.
	type result struct {
		conn *amqp.Connection
		err  error
	}
	done := make(chan result, 1)
	go func() {
		conn, err := c.opts.Dial(c.opts.URL)
		done <- result{conn, err}
	}()
	var conn *amqp.Connection
	select {
	case r := <-done:
		if r.err != nil {
			c.noteError(r.err)
			return nil, fmt.Errorf("dial: %w", r.err)
		}
		conn = r.conn
	case <-ctx.Done():
		// The dial goroutine is left to finish and close what it opens, because
		// abandoning a half-open connection is how a broker ends up holding one
		// dead socket per timed-out request.
		go func() {
			if r := <-done; r.err == nil {
				_ = r.conn.Close()
			}
		}()
		c.noteError(ctx.Err())
		return nil, fmt.Errorf("dial: %w", ctx.Err())
	}

	raw, err := conn.Channel()
	if err != nil {
		_ = conn.Close()
		c.noteError(err)
		return nil, fmt.Errorf("open channel: %w", err)
	}
	// Confirm mode is not optional. Without it a publish returns as soon as the
	// bytes are written to the socket, which says nothing about whether the
	// broker took durable responsibility for them.
	if err := raw.Confirm(false); err != nil {
		_ = conn.Close()
		c.noteError(err)
		return nil, fmt.Errorf("confirm mode: %w", err)
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	// Close whatever was there: two connections to the same broker from the same
	// client is a leak, and the loser of this race is the older one.
	if c.conn != nil && c.conn != conn {
		old := c.conn
		go func() { _ = old.Close() }()
	}
	c.conn = conn
	c.ch = newConfirmChannel(raw, c.log)
	now := time.Now().UTC()
	c.health.Since = &now
	return c.ch, nil
}

// Publish hands one envelope to the broker and returns only when the broker has
// taken durable responsibility for it. It satisfies bus.Publisher.
func (c *Client) Publish(ctx context.Context, exchange, key string, env bus.Envelope) error {
	if !c.Configured() {
		// Loud, and a failure. Never a silent success.
		c.log.Error("dropped a message: no broker configured",
			"type", env.Type, "id", env.ID, "exchange", exchange)
		return ErrNoBroker
	}
	ctx, cancel := context.WithTimeout(ctx, c.opts.PublishTimeout)
	defer cancel()
	ch, err := c.channel(ctx)
	if err != nil {
		return err
	}
	if err := ch.publish(ctx, exchange, key, env); err != nil {
		// Drop the channel so the next call builds a fresh one.
		c.mu.Lock()
		c.ch = nil
		c.mu.Unlock()
		c.noteError(err)
		c.log.Error("publish NOT confirmed", "type", env.Type, "id", env.ID, "error", err)
		return err
	}
	return nil
}

// Declare applies a topology. Idempotent by construction: an AMQP declaration
// with identical arguments is a no-op, so every service re-declaring on connect
// converges no matter who starts first.
func (c *Client) Declare(ctx context.Context, topo bus.Topology) error {
	if !c.Configured() {
		return ErrNoBroker
	}
	ch, err := c.channel(ctx)
	if err != nil {
		return err
	}
	return ch.declare(topo)
}

// Missing is one object the topology says should exist and the broker says does
// not -- or exists with different arguments.
type Missing struct {
	Kind   string `json:"kind"`
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

// Verify checks, against the broker, that every exchange and queue in a topology
// exists.
//
// It is PASSIVE: it declares nothing. A verifier that creates what it fails to
// find always passes, which makes it a declaration tool wearing a check's name.
//
// Bindings are NOT verified here and this is the honest reason: AMQP 0-9-1 has
// no passive binding query, so the only ways to check one are the management
// HTTP API (a second credential and a second port) or publishing a probe message
// (a side effect on a live exchange). Neither is done silently -- the return
// value says so, and `queue-topology verify` prints it.
//
// # THE LOOP IS SERIAL AND THAT IS AN OPEN QUESTION, NOT A DECISION
//
// This walks the topology one object at a time, and so does Inspect. For the
// default exchange that is 6 exchanges + 6 queues (2 fixed exchanges plus one
// per retry tier, and DelayTiersMS() yields four: 1s, 4s, 16s, 60s), each costing
// an open-channel, a passive-declare and a close -- so `GET /api/topology/verify`
// is about a dozen serial broker round-trips on a request path, and
// `GET /api/queues` about half that.
//
// Overlapping them would be SAFE: passive declares mutate nothing, each object
// already gets its own channel because a failed passive declare closes it, and
// AMQP multiplexes channels over the one connection, so the waits genuinely
// overlap. Order would have to be preserved by writing into an indexed slice
// rather than appending -- `states[0]` is read by ReplayDeadLetters, and the JSON
// arrays are expected in topology order.
//
// It has not been done because it has not been MEASURED. AMQP is deliberately
// not published to the host, so there is no way from a developer machine to put
// a number on the round-trip this would overlap, and a speedup claim with no
// number behind it is exactly what house rule 7 forbids. Whoever has a reachable
// broker: time these two endpoints first, then change them.
func (c *Client) Verify(ctx context.Context, topo bus.Topology) ([]Missing, error) {
	if !c.Configured() {
		return nil, ErrNoBroker
	}
	var missing []Missing
	for _, e := range topo.Exchanges {
		// A failed passive declare CLOSES the channel, so each check gets its
		// own. That is the price of the AMQP error model, and paying it per
		// object is what lets this report EVERY missing object instead of dying
		// on the first one.
		ch, err := c.freshChannel(ctx)
		if err != nil {
			return nil, err
		}
		err = ch.ExchangeDeclarePassive(e.Name, e.Kind, e.Durable, false, false, false, nil)
		_ = ch.Close()
		if err != nil {
			missing = append(missing, Missing{Kind: "exchange", Name: e.Name, Reason: err.Error()})
		}
	}
	for _, q := range topo.Queues {
		ch, err := c.freshChannel(ctx)
		if err != nil {
			return nil, err
		}
		_, err = ch.QueueDeclarePassive(q.Name, q.Durable, false, false, false, nil)
		_ = ch.Close()
		if err != nil {
			missing = append(missing, Missing{Kind: "queue", Name: q.Name, Reason: err.Error()})
		}
	}
	return missing, nil
}

// QueueState is the observability answer: how much work is waiting, and how many
// consumers are there to take it.
type QueueState struct {
	Name      string `json:"name"`
	Messages  int    `json:"messages"`
	Consumers int    `json:"consumers"`
	// Error is set when this one queue could not be read. It is per-queue rather
	// than fatal so a missing consumer queue does not hide the depth of the DLQ.
	Error string `json:"error,omitempty"`
}

// Inspect reads the depth and consumer count of each named queue.
//
// A queue that does not exist reports an Error, never a zero: "0 messages" and
// "I could not look" are different facts, and reporting the second as the first
// is the exact failure this codebase has been bitten by three times.
func (c *Client) Inspect(ctx context.Context, names []string) ([]QueueState, error) {
	if !c.Configured() {
		return nil, ErrNoBroker
	}
	out := make([]QueueState, 0, len(names))
	for _, n := range names {
		ch, err := c.freshChannel(ctx)
		if err != nil {
			return nil, err
		}
		q, err := ch.QueueDeclarePassive(n, true, false, false, false, nil)
		_ = ch.Close()
		if err != nil {
			out = append(out, QueueState{Name: n, Error: err.Error()})
			continue
		}
		out = append(out, QueueState{Name: n, Messages: q.Messages, Consumers: q.Consumers})
	}
	return out, nil
}

// Replayed is the outcome of a dead-letter replay.
type Replayed struct {
	Moved     int      `json:"moved"`
	Remaining int      `json:"remaining"`
	Faults    []string `json:"faults,omitempty"`
}

// ReplayDeadLetters moves messages from the dead-letter queue back onto the main
// exchange, at most `limit` of them.
//
// This is the one operational verb the DLQ needs: bus.ts sends a message here
// when it has run out of attempts, when its type has no handler, or when its
// bytes are unreadable, and the first two are usually fixed by shipping code --
// after which the parked work should run rather than be thrown away.
//
// Three rules make it safe to run against production:
//
//   - Get, not Consume: a synchronous fetch that reports an empty queue instead
//     of waiting on one, so the loop terminates on its own.
//   - the message is ACKED OFF THE DLQ ONLY AFTER the republish is confirmed. If
//     the publish fails the message is returned to the DLQ untouched, because
//     losing a dead letter is worse than replaying one twice.
//   - `attempt` is reset to 1, so a replayed message gets the full retry ladder
//     again instead of dead-lettering on its first stumble. Its id and
//     idempotency_key are NOT touched: if the work was already done by hand, the
//     claim is what stops it running twice.
func (c *Client) ReplayDeadLetters(ctx context.Context, limit int) (Replayed, error) {
	if !c.Configured() {
		return Replayed{}, ErrNoBroker
	}
	if limit <= 0 {
		return Replayed{}, errors.New("replay needs a positive limit: refusing to guess how much to move")
	}
	out := Replayed{}
	dlq := bus.DLQ(c.opts.Exchange)
	ch, err := c.channel(ctx)
	if err != nil {
		return out, err
	}
	for i := 0; i < limit; i++ {
		if err := ctx.Err(); err != nil {
			out.Faults = append(out.Faults, "stopped: "+err.Error())
			break
		}
		msg, ok, err := ch.get(dlq)
		if err != nil {
			return out, fmt.Errorf("reading %s: %w", dlq, err)
		}
		if !ok {
			break // The queue is empty. Nothing to report as a fault.
		}
		env, perr := bus.ParseEnvelope(msg.Body)
		if perr != nil {
			// Unreadable bytes cannot be replayed into readability. They stay in
			// the DLQ, where a human can look at them.
			out.Faults = append(out.Faults, fmt.Sprintf("left in place, unreadable: %v", perr))
			if nerr := msg.Nack(false, true); nerr != nil {
				return out, fmt.Errorf("returning an unreadable dead letter: %w", nerr)
			}
			continue
		}
		fresh := env
		fresh.Attempt = 1
		if perr := ch.publish(ctx, c.opts.Exchange, fresh.Key, fresh); perr != nil {
			// Put it back before reporting, so a failed replay leaves the DLQ
			// exactly as it was found.
			if nerr := msg.Nack(false, true); nerr != nil {
				return out, fmt.Errorf("republish of %s failed (%v) AND returning it to the DLQ failed: %w", env.ID, perr, nerr)
			}
			out.Faults = append(out.Faults, fmt.Sprintf("%s left in the DLQ: %v", env.ID, perr))
			break
		}
		if aerr := msg.Ack(false); aerr != nil {
			// The republish is durable and this ack is not, so the message is
			// now in both places. Saying so is the only honest move.
			out.Faults = append(out.Faults, fmt.Sprintf(
				"%s was republished but not removed from the DLQ (%v): it will be replayed again", env.ID, aerr))
			break
		}
		out.Moved++
	}
	if states, err := c.Inspect(ctx, []string{dlq}); err == nil && len(states) == 1 && states[0].Error == "" {
		out.Remaining = states[0].Messages
	} else {
		out.Faults = append(out.Faults, "could not re-read the dead-letter depth after the replay")
	}
	return out, nil
}

// freshChannel opens a throwaway channel on the shared connection, for the
// passive operations that close their channel when they fail.
func (c *Client) freshChannel(ctx context.Context) (*amqp.Channel, error) {
	if _, err := c.channel(ctx); err != nil {
		return nil, err
	}
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil || conn.IsClosed() {
		return nil, ErrNotConnected
	}
	ch, err := conn.Channel()
	if err != nil {
		c.noteError(err)
		return nil, fmt.Errorf("open channel: %w", err)
	}
	return ch, nil
}

// Close releases the publisher connection. For a clean process exit.
func (c *Client) Close() error {
	c.mu.Lock()
	conn := c.conn
	c.conn, c.ch = nil, nil
	c.mu.Unlock()
	if conn == nil {
		return nil
	}
	return conn.Close()
}

func redact(raw string) string {
	if raw == "" {
		return "(unset)"
	}
	// Deliberately not url.Parse here: this runs in a log path and a parse
	// failure must not be able to leak the raw string as a fallback.
	at := -1
	for i := 0; i < len(raw); i++ {
		if raw[i] == '@' {
			at = i
		}
	}
	scheme := ""
	for i := 0; i+2 < len(raw); i++ {
		if raw[i] == ':' && raw[i+1] == '/' && raw[i+2] == '/' {
			scheme = raw[:i+3]
			break
		}
	}
	if at < 0 || scheme == "" {
		if scheme == "" {
			return "(unparseable AMQP_URL)"
		}
		return raw
	}
	return scheme + "***@" + raw[at+1:]
}
