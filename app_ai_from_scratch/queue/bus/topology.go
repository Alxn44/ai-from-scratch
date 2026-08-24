package bus

import (
	"errors"
	"fmt"
	"sort"
)

// ---------------------------------------------------------------------------
// TOPOLOGY, as data. A pure function so it can be asserted without a broker,
// and applied idempotently on every connect so a cold start in ANY order
// converges: whoever arrives first declares, the rest re-declare the same thing,
// and an AMQP declaration with identical arguments is a no-op.
//
//	exchange  {ex}                topic    durable   the one everybody binds to
//	exchange  {ex}.dlx            topic    durable   dead letters
//	queue     {ex}.dead           durable            bound to .dlx with '#'
//	exchange  {ex}.retry.{ms}     fanout   durable   one per delay tier
//	queue     {ex}.retry.{ms}     durable            ttl={ms}, dead-letters to {ex}
//	queue     {consumer}          durable            dead-letters to {ex}.dlx
//
// Why fanout for the retry tiers and not one direct exchange: a message
// dead-lettered out of a delay queue keeps the routing key it was PUBLISHED
// with. Publishing to a direct exchange means publishing with the tier name as
// the key, and the message would return to the main exchange with that key and
// match nothing. A fanout ignores the routing key for routing while the message
// keeps its own, so a delayed message re-enters the main exchange exactly as it
// left it.

// RetryExchange names the fanout that fronts a delay tier.
func RetryExchange(exchange string, ms int) string {
	return fmt.Sprintf("%s.retry.%d", exchange, ms)
}

// RetryQueue names the delay queue of a tier. Same string as its exchange: a
// queue and an exchange live in different namespaces in AMQP, and one name for
// the pair is what makes the management UI readable.
func RetryQueue(exchange string, ms int) string {
	return fmt.Sprintf("%s.retry.%d", exchange, ms)
}

// DLX names the dead-letter exchange.
func DLX(exchange string) string { return exchange + ".dlx" }

// DLQ names the dead-letter queue: where a human looks.
func DLQ(exchange string) string { return exchange + ".dead" }

// Exchange is one exchange declaration.
type Exchange struct {
	Name    string `json:"name"`
	Kind    string `json:"type"`
	Durable bool   `json:"durable"`
}

// Queue is one queue declaration. Args carries the x-* arguments, which are part
// of the identity of the declaration: re-declaring with different arguments is a
// channel-level error, not a silent update.
type Queue struct {
	Name    string         `json:"name"`
	Durable bool           `json:"durable"`
	Args    map[string]any `json:"arguments,omitempty"`
}

// Binding is one queue-to-exchange binding.
type Binding struct {
	Queue    string `json:"queue"`
	Exchange string `json:"exchange"`
	Pattern  string `json:"pattern"`
}

// Topology is the whole declaration, as data.
type Topology struct {
	Exchanges []Exchange `json:"exchanges"`
	Queues    []Queue    `json:"queues"`
	Bindings  []Binding  `json:"bindings"`
}

// BuildTopology returns the declaration for an exchange, optionally including a
// consumer queue bound to the given patterns.
//
// Ordering is part of the contract, not an accident: exchanges before the queues
// that dead-letter into them, queues before the bindings that reference them. A
// caller that applies the slices in order never binds to something that does not
// exist yet.
func BuildTopology(exchange, queue string, patterns []string) (Topology, error) {
	if exchange == "" {
		return Topology{}, errors.New("bus: topology needs an exchange name")
	}
	t := Topology{
		Exchanges: []Exchange{
			{Name: exchange, Kind: "topic", Durable: true},
			{Name: DLX(exchange), Kind: "topic", Durable: true},
		},
		Queues: []Queue{
			{Name: DLQ(exchange), Durable: true},
		},
		Bindings: []Binding{
			{Queue: DLQ(exchange), Exchange: DLX(exchange), Pattern: "#"},
		},
	}
	for _, ms := range DelayTiersMS() {
		t.Exchanges = append(t.Exchanges, Exchange{Name: RetryExchange(exchange, ms), Kind: "fanout", Durable: true})
		t.Queues = append(t.Queues, Queue{
			Name:    RetryQueue(exchange, ms),
			Durable: true,
			Args: map[string]any{
				"x-message-ttl": ms,
				// Back to the main exchange, keeping the original routing key.
				"x-dead-letter-exchange": exchange,
			},
		})
		t.Bindings = append(t.Bindings, Binding{
			Queue: RetryQueue(exchange, ms), Exchange: RetryExchange(exchange, ms), Pattern: "",
		})
	}
	if queue != "" {
		// A consumer with no pattern is a queue nothing routes to. That looks
		// like a broker problem and is a wiring problem, so it is said at
		// declare time rather than discovered as silence.
		if len(patterns) == 0 {
			return Topology{}, fmt.Errorf("bus: queue %q declared with no routing patterns", queue)
		}
		t.Queues = append(t.Queues, Queue{
			Name:    queue,
			Durable: true,
			Args:    map[string]any{"x-dead-letter-exchange": DLX(exchange)},
		})
		for _, p := range patterns {
			t.Bindings = append(t.Bindings, Binding{Queue: queue, Exchange: exchange, Pattern: p})
		}
	}
	return t, nil
}

// sortedKeys gives map iteration a defined order. Go randomises it, and a tool
// whose output moves between runs cannot be diffed -- which is most of what
// `queue-topology print` is for.
func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
