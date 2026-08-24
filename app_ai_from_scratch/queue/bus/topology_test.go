package bus

import (
	"reflect"
	"testing"
	"time"
)

func TestTheRetryLadderIsTheNumbersTheContractStates(t *testing.T) {
	// attempt 1 -> 1s, 2 -> 4s, 3 -> 16s, 4 -> 60s (256s clipped by the cap),
	// 5 -> dead-letter. Five handler runs over ~81 seconds of deliberate waiting.
	for _, tc := range []struct{ attempt, want int }{
		{0, 1_000}, // a nonsense attempt must not produce a nonsense delay
		{1, 1_000},
		{2, 4_000},
		{3, 16_000},
		{4, 60_000},
		{5, 60_000},
		{99, 60_000},
	} {
		if got := DelayFor(tc.attempt); got != tc.want {
			t.Fatalf("DelayFor(%d) = %d; want %d", tc.attempt, got, tc.want)
		}
	}
}

func TestTheDelayTiersAreExactlyTheQueuesToDeclare(t *testing.T) {
	want := []int{1_000, 4_000, 16_000, 60_000}
	if got := DelayTiersMS(); !reflect.DeepEqual(got, want) {
		t.Fatalf("tiers = %v; want %v", got, want)
	}
	// Ascending and deduplicated: a duplicate would declare the same queue twice
	// and a descending list would make the printed topology unstable.
	tiers := DelayTiersMS()
	for i := 1; i < len(tiers); i++ {
		if tiers[i] <= tiers[i-1] {
			t.Fatalf("tiers are not strictly ascending: %v", tiers)
		}
	}
}

func TestReconnectBackoffIsSeparateFromMessageRetryAndClamps(t *testing.T) {
	// A broker that is down does not mean a message is bad, so the two ladders
	// are different numbers on purpose.
	if ReconnectDelay(0) != time.Second {
		t.Fatalf("first rung = %v", ReconnectDelay(0))
	}
	if got := ReconnectDelay(99); got != 30*time.Second {
		t.Fatalf("ReconnectDelay(99) = %v; want the last rung, clamped", got)
	}
	if got := ReconnectDelay(-1); got != time.Second {
		t.Fatalf("ReconnectDelay(-1) = %v; want the first rung", got)
	}
}

func TestTheTopologyIsExactlyWhatTheContractDescribes(t *testing.T) {
	topo, err := BuildTopology("course.events", "queue.work", []string{"queue.#", "bus.echo"})
	if err != nil {
		t.Fatal(err)
	}

	wantExchanges := []Exchange{
		{Name: "course.events", Kind: "topic", Durable: true},
		{Name: "course.events.dlx", Kind: "topic", Durable: true},
		// Fanout, not direct: a message dead-lettered out of a delay queue keeps
		// the routing key it was PUBLISHED with, so publishing to a direct
		// exchange would need the tier's name as the key and the message would
		// come back matching nothing.
		{Name: "course.events.retry.1000", Kind: "fanout", Durable: true},
		{Name: "course.events.retry.4000", Kind: "fanout", Durable: true},
		{Name: "course.events.retry.16000", Kind: "fanout", Durable: true},
		{Name: "course.events.retry.60000", Kind: "fanout", Durable: true},
	}
	if !reflect.DeepEqual(topo.Exchanges, wantExchanges) {
		t.Fatalf("exchanges =\n%#v\nwant\n%#v", topo.Exchanges, wantExchanges)
	}

	wantQueues := []Queue{
		{Name: "course.events.dead", Durable: true},
		{Name: "course.events.retry.1000", Durable: true, Args: map[string]any{
			"x-message-ttl": 1_000, "x-dead-letter-exchange": "course.events"}},
		{Name: "course.events.retry.4000", Durable: true, Args: map[string]any{
			"x-message-ttl": 4_000, "x-dead-letter-exchange": "course.events"}},
		{Name: "course.events.retry.16000", Durable: true, Args: map[string]any{
			"x-message-ttl": 16_000, "x-dead-letter-exchange": "course.events"}},
		{Name: "course.events.retry.60000", Durable: true, Args: map[string]any{
			"x-message-ttl": 60_000, "x-dead-letter-exchange": "course.events"}},
		{Name: "queue.work", Durable: true, Args: map[string]any{
			"x-dead-letter-exchange": "course.events.dlx"}},
	}
	if !reflect.DeepEqual(topo.Queues, wantQueues) {
		t.Fatalf("queues =\n%#v\nwant\n%#v", topo.Queues, wantQueues)
	}

	wantBindings := []Binding{
		{Queue: "course.events.dead", Exchange: "course.events.dlx", Pattern: "#"},
		{Queue: "course.events.retry.1000", Exchange: "course.events.retry.1000", Pattern: ""},
		{Queue: "course.events.retry.4000", Exchange: "course.events.retry.4000", Pattern: ""},
		{Queue: "course.events.retry.16000", Exchange: "course.events.retry.16000", Pattern: ""},
		{Queue: "course.events.retry.60000", Exchange: "course.events.retry.60000", Pattern: ""},
		{Queue: "queue.work", Exchange: "course.events", Pattern: "queue.#"},
		{Queue: "queue.work", Exchange: "course.events", Pattern: "bus.echo"},
	}
	if !reflect.DeepEqual(topo.Bindings, wantBindings) {
		t.Fatalf("bindings =\n%#v\nwant\n%#v", topo.Bindings, wantBindings)
	}
}

func TestEveryQueueIsDeclaredBeforeTheBindingsThatReferenceIt(t *testing.T) {
	// A caller applies these slices in order, so a binding that names a queue
	// declared later would fail at declare time.
	topo, err := BuildTopology("ex", "consumer", []string{"a.#"})
	if err != nil {
		t.Fatal(err)
	}
	seenQ := map[string]bool{}
	for _, q := range topo.Queues {
		seenQ[q.Name] = true
	}
	seenE := map[string]bool{}
	for _, e := range topo.Exchanges {
		seenE[e.Name] = true
	}
	for _, b := range topo.Bindings {
		if !seenQ[b.Queue] {
			t.Fatalf("binding references the undeclared queue %q", b.Queue)
		}
		if !seenE[b.Exchange] {
			t.Fatalf("binding references the undeclared exchange %q", b.Exchange)
		}
	}
	// And every retry queue dead-letters back to the MAIN exchange, which is what
	// makes the delay a delay rather than a disposal.
	for _, q := range topo.Queues {
		if q.Args["x-message-ttl"] != nil && q.Args["x-dead-letter-exchange"] != "ex" {
			t.Fatalf("retry queue %q dead-letters to %v; want the main exchange",
				q.Name, q.Args["x-dead-letter-exchange"])
		}
	}
}

func TestAConsumerQueueWithNoPatternsIsRefusedAtDeclareTime(t *testing.T) {
	// A queue nothing routes to looks like a broker problem and is a wiring
	// problem, so it is said here rather than discovered as silence.
	if _, err := BuildTopology("ex", "consumer", nil); err == nil {
		t.Fatal("a queue with no routing patterns was accepted")
	}
	if _, err := BuildTopology("ex", "consumer", []string{}); err == nil {
		t.Fatal("a queue with an empty pattern list was accepted")
	}
	// No queue at all is legitimate: that is a publisher-only topology.
	if _, err := BuildTopology("ex", "", nil); err != nil {
		t.Fatalf("a publisher-only topology was refused: %v", err)
	}
	if _, err := BuildTopology("", "", nil); err == nil {
		t.Fatal("a topology with no exchange was accepted")
	}
}

func TestTheNameHelpersMatchTheOtherRuntimes(t *testing.T) {
	if got := DLX("course.events"); got != "course.events.dlx" {
		t.Fatalf("DLX = %q", got)
	}
	if got := DLQ("course.events"); got != "course.events.dead" {
		t.Fatalf("DLQ = %q", got)
	}
	if got := RetryExchange("course.events", 4000); got != "course.events.retry.4000" {
		t.Fatalf("RetryExchange = %q", got)
	}
	// The queue and its fanout share a name on purpose: they live in different
	// AMQP namespaces and one name for the pair is what keeps the management UI
	// readable.
	if RetryQueue("course.events", 4000) != RetryExchange("course.events", 4000) {
		t.Fatal("the retry queue and its exchange no longer share a name")
	}
}

func TestBuildTopologyDoesNotShareMutableStateBetweenCalls(t *testing.T) {
	// Two callers holding the same Args map would let one of them change what
	// the other declares.
	a, _ := BuildTopology("ex", "q", []string{"x.#"})
	b, _ := BuildTopology("ex", "q", []string{"x.#"})
	a.Queues[1].Args["x-message-ttl"] = 999999
	if b.Queues[1].Args["x-message-ttl"] == 999999 {
		t.Fatal("two topologies share one Args map")
	}
}
