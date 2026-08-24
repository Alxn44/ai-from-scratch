// Package bus is the inter-service transport contract, third runtime.
//
// THIS IS THE SAME DOCUMENT AS api/src/bus.ts AND ai/src/course_ai/bus.py.
//
// Those two files carry the argument for why orchestration is a library and not
// a service, and that argument still stands: the envelope, the routing keys, the
// idempotency rule and the retry ladder are compiled into every process that
// publishes or consumes, and no message is routed by application code. This
// package is a third implementation of the SAME numbers, not a new policy.
//
// WHAT THE `queue` SERVICE ADDS ON TOP, and why it is not the orchestrator
// docs/ARCHITECTURE.md refused to build:
//
//   - It DECLARES the topology and can VERIFY it. Every service already
//     re-declares on connect (idempotently), so this service being down changes
//     nothing about routing. It is not a hop; it is a second pair of eyes.
//   - It OBSERVES: queue depths, dead-letter depth, in-flight counters.
//   - It offers an HTTP way to enqueue for callers that are not on the bus.
//
// It is not on the chat path, it holds no course logic, and it has no database.
// If any of those three change, this service has become the thing four numbered
// paragraphs in docs/ARCHITECTURE.md argue against.
//
// THE COST OF A THIRD COPY, stated plainly: three files can drift. contract.go
// reads the constants out of the other two and fails when they disagree, and
// `queue-verify` refuses to pass without running that check.
package bus

import "time"

// ---------------------------------------------------------------------------
// RETRY POLICY. Numbers, not adjectives. Identical to the block in
// api/src/bus.ts and ai/src/course_ai/bus.py.
//
// delay(attempt) = min(CAP, BASE * FACTOR^(attempt-1))
//
//	attempt 1 fails -> wait  1s
//	attempt 2 fails -> wait  4s
//	attempt 3 fails -> wait 16s
//	attempt 4 fails -> wait 60s   (256s clipped by the cap)
//	attempt 5 fails -> dead-letter queue, no further retry
//
// Five handler runs spread over ~81 seconds of deliberate waiting. Past that the
// failure is not transitory and a human has to look at the DLQ.
//
// The wait happens IN THE BROKER, never in the consumer: the message is
// republished to a per-tier delay queue whose only job is to hold it for its TTL
// and then dead-letter it back to the main exchange. A nack with requeue=true
// would put the message straight back at the head of the queue and spin at
// broker speed -- that is the hot loop this design refuses.
//
// Fixed tiers instead of a per-message TTL: one delay queue with per-message
// expiry blocks head-of-line (a 60s message at the head holds up a 1s message
// behind it), which silently breaks the schedule above. The trade-off accepted
// is that tiers carry no jitter, so a batch that fails together retries
// together.
const (
	BaseDelayMS = 1_000
	DelayFactor = 4
	DelayCapMS  = 60_000
	MaxAttempts = 5
)

// DelayFor is the backoff for a failed attempt, in milliseconds.
func DelayFor(attempt int) int {
	n := attempt - 1
	if n < 0 {
		n = 0
	}
	d := BaseDelayMS
	// Multiplied in a loop rather than with math.Pow: FACTOR^n in float64 and
	// back to int is a rounding argument nobody should have to have, and the
	// exponent here never exceeds MaxAttempts-1.
	for range n {
		d *= DelayFactor
		if d >= DelayCapMS {
			return DelayCapMS
		}
	}
	if d > DelayCapMS {
		return DelayCapMS
	}
	return d
}

// DelayTiersMS is the distinct set of delays, which is exactly the set of retry
// queues to declare. Ascending, deduplicated -- the cap collapses the tail, so
// the list is shorter than MaxAttempts-1 as soon as BASE*FACTOR^n passes it.
func DelayTiersMS() []int {
	seen := make(map[int]bool, MaxAttempts)
	out := make([]int, 0, MaxAttempts)
	for attempt := 1; attempt < MaxAttempts; attempt++ {
		ms := DelayFor(attempt)
		if !seen[ms] {
			seen[ms] = true
			out = append(out, ms)
		}
	}
	// DelayFor is monotonic, so appending in attempt order is already ascending.
	return out
}

// ReconnectMS is a DIFFERENT policy from message retry and is kept separate on
// purpose: a broker that is down does not mean a message is bad.
var ReconnectMS = []time.Duration{
	1 * time.Second,
	2 * time.Second,
	4 * time.Second,
	8 * time.Second,
	16 * time.Second,
	30 * time.Second,
}

// ReconnectDelay is the wait before reconnect attempt n (0-based), clamped to
// the last rung.
func ReconnectDelay(n int) time.Duration {
	if n < 0 {
		n = 0
	}
	if n >= len(ReconnectMS) {
		n = len(ReconnectMS) - 1
	}
	return ReconnectMS[n]
}
