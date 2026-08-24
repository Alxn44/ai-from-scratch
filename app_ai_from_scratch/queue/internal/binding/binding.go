// Package binding is the one place this service's queue and routing patterns are
// written down.
//
// It is its own package for a boring, load-bearing reason: `cmd/queue` consumes
// the queue and `cmd/queue-topology` declares it, Go cannot import a main
// package from another main package, and two copies of a routing pattern is a
// service that consumes one set of keys while the tool declares another. That
// failure is silent -- the tool reports success, the queue exists, and messages
// route to nothing.
package binding

// Queue is this service's own queue. One queue per consumer, as the topology in
// internal/bus lays out.
const Queue = "queue.work"

// Patterns are the routing keys this service asks for. They are CODE, not
// configuration, so that widening one and adding the handler that serves it
// happen in the same diff: a delivery whose type has no handler is dead-lettered,
// so a pattern is a promise.
//
// WHY NOT `#`. Binding to everything would look like observability and would be
// sabotage: every message in the fleet would be copied here, and every type with
// no handler would be dead-lettered. Depth and flow are read from the broker
// instead (GET /queues, `queue-topology queues`), which observes without
// consuming.
//
//	queue.#    this service's own verbs (queue.topology.declare)
//	bus.echo   the fleet-wide smoke test, bound by all three workers
func Patterns() []string {
	// Returned by value rather than exported as a slice: an exported slice is
	// writable by any importer, and a handler that appended to it would change
	// what the tool declares.
	return []string{"queue.#", "bus.echo"}
}
