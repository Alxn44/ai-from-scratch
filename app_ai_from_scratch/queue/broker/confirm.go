package broker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"

	amqp "github.com/rabbitmq/amqp091-go"

	"course/queue/bus"
)

// ---------------------------------------------------------------------------
// PUBLISHING ON A CONFIRM CHANNEL.
//
// There are FOUR ways a publish can fail to be a publish, and all four must
// report failure rather than success. api/test/transport.mts has a check for
// each of the first three, and the fourth is Go's own:
//
//  1. the broker NACKs it,
//  2. the broker cannot route it and RETURNS it (mandatory=true) -- which is
//     followed by a POSITIVE confirm, so waiting for the confirm alone would
//     call an unroutable message delivered. That check is worded, over there,
//     as "a RETURNED publish is a failure even though the confirm was
//     positive",
//  3. nothing answers at all, which is what the deadline is for,
//  4. the envelope cannot be marshalled, which must not turn into publishing
//     partial bytes.
const returnBuffer = 8

// confirmChannel serialises publishes on one AMQP channel.
//
// WHY SERIALISED. Matching a basic.return to the publish it belongs to needs
// either a map of in-flight message ids (what api/src/bus.ts keeps) or one
// publish at a time. One at a time is correct by construction, and the cost is
// affordable here for a reason worth stating: this service publishes on an HTTP
// enqueue and on a retry, not in a firehose. If that ever changes, the map is
// the upgrade -- not dropping the return check.
type confirmChannel struct {
	ch      *amqp.Channel
	log     *slog.Logger
	returns chan amqp.Return

	mu   sync.Mutex
	dead bool
}

func newConfirmChannel(ch *amqp.Channel, log *slog.Logger) *confirmChannel {
	c := &confirmChannel{
		ch:  ch,
		log: log,
		// Buffered, and this matters for correctness rather than throughput:
		// amqp091 dispatches frames from a single reader, so an unbuffered
		// returns channel with nobody receiving yet would block that reader and
		// the confirm behind it would never arrive. With a buffer, the return is
		// parked and is readable the moment the confirm has been waited on.
		returns: make(chan amqp.Return, returnBuffer),
	}
	c.ch.NotifyReturn(c.returns)
	// A channel-level error kills this channel for good. Marking it dead is what
	// makes the next caller build a new one instead of publishing into a closed
	// socket and reading the failure as a broker problem.
	notify := c.ch.NotifyClose(make(chan *amqp.Error, 1))
	go func() {
		err, ok := <-notify
		c.mu.Lock()
		c.dead = true
		c.mu.Unlock()
		if ok && err != nil {
			log.Warn("channel closed", "code", err.Code, "reason", err.Reason)
		}
	}()
	return c
}

func (c *confirmChannel) closed() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.dead || c.ch.IsClosed()
}

// publish sends one envelope and waits for the broker to own it.
func (c *confirmChannel) publish(ctx context.Context, exchange, key string, env bus.Envelope) error {
	body, err := json.Marshal(env)
	if err != nil {
		// Failure 4. Nothing was sent, and nothing partial must be.
		return fmt.Errorf("envelope %s is not serialisable: %w", env.ID, err)
	}
	if key == "" {
		key = env.Key
	}
	msg := amqp.Publishing{
		ContentType: "application/json",
		// Delivery mode 2 = persist to disk. Not configurable, in any of the
		// three runtimes: a message the broker forgets on restart is not a
		// message, it is a hope.
		DeliveryMode: bus.PersistentDeliveryMode,
		MessageId:    env.MessageID(),
		Timestamp:    env.Timestamp(),
		Type:         env.Type,
		Headers:      amqp.Table(env.Headers()),
		Body:         body,
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.dead || c.ch.IsClosed() {
		return errors.New("publish on a closed channel")
	}

	// Any return still sitting in the buffer belongs to an earlier publish that
	// already gave up (a timeout, most likely). Drain it loudly rather than
	// letting it be blamed on this message.
	for {
		select {
		case stale := <-c.returns:
			c.log.Warn("discarding a stale unroutable return from an earlier publish",
				"message_id", stale.MessageId, "routing_key", stale.RoutingKey)
			continue
		default:
		}
		break
	}

	// mandatory=true is what makes failure 2 observable at all. Without it an
	// unroutable message is discarded by the broker and positively confirmed:
	// the publisher is told yes and the message never existed.
	conf, err := c.ch.PublishWithDeferredConfirmWithContext(ctx, exchange, key, true, false, msg)
	if err != nil {
		return fmt.Errorf("publish to %q: %w", exchange, err)
	}

	acked, err := conf.WaitContext(ctx)
	if err != nil {
		// Failure 3: no answer inside the deadline.
		return fmt.Errorf("publish confirm for %s: %w", env.MessageID(), err)
	}

	// Ordering, stated because the whole check rests on it: AMQP sends
	// basic.return BEFORE the basic.ack of the same message, and amqp091 pushes
	// both from one reader goroutine in frame order. So by the time the confirm
	// has been waited on, a return for this message is already in the buffer.
	select {
	case ret := <-c.returns:
		if ret.MessageId != "" && ret.MessageId != env.MessageID() {
			// It cannot legitimately belong to another publish -- publishes here
			// are serialised -- so the safe reading is that something is wrong
			// with this channel. Failing is the direction that never reports a
			// message delivered when it was not.
			c.log.Error("a return arrived for a message id that is not the one in flight",
				"got", ret.MessageId, "expected", env.MessageID())
		}
		return fmt.Errorf("unroutable: no queue bound for %q on exchange %q (reply %d %s)",
			key, exchange, ret.ReplyCode, ret.ReplyText)
	default:
	}

	if !acked {
		// Failure 1.
		return fmt.Errorf("broker said no: %s was nacked", env.MessageID())
	}
	return nil
}

// get fetches one message synchronously, or reports that the queue is empty.
// Used by the dead-letter replay, which must terminate rather than wait.
func (c *confirmChannel) get(queue string) (amqp.Delivery, bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ch.Get(queue, false)
}

// declare applies a topology in order: exchanges, then queues, then the bindings
// that reference both.
func (c *confirmChannel) declare(topo bus.Topology) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, e := range topo.Exchanges {
		if err := c.ch.ExchangeDeclare(e.Name, e.Kind, e.Durable, false, false, false, nil); err != nil {
			return fmt.Errorf("declare exchange %q: %w", e.Name, err)
		}
	}
	for _, q := range topo.Queues {
		var args amqp.Table
		if len(q.Args) > 0 {
			args = amqp.Table(q.Args)
		}
		if _, err := c.ch.QueueDeclare(q.Name, q.Durable, false, false, false, args); err != nil {
			// A mismatch on x-message-ttl or x-dead-letter-exchange lands here,
			// and the name of the queue is the whole diagnosis: it means the
			// queue exists with a policy other than the one this code believes
			// in, which is precisely the drift this service exists to catch.
			return fmt.Errorf("declare queue %q (arguments may differ from the existing queue): %w", q.Name, err)
		}
	}
	for _, b := range topo.Bindings {
		if err := c.ch.QueueBind(b.Queue, b.Pattern, b.Exchange, false, nil); err != nil {
			return fmt.Errorf("bind %q to %q with %q: %w", b.Queue, b.Exchange, b.Pattern, err)
		}
	}
	return nil
}
