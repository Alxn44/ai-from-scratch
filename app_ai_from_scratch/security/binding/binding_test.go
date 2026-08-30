package binding

import "testing"

func TestTheTableSatisfiesItsOwnRules(t *testing.T) {
	for _, err := range Verify() {
		t.Errorf("binding.Verify: %v", err)
	}
}

// Containment is the only power in this system, and a power with two owners has
// no owner. If a second agent ever gets MayAct, the rate limit in policy is
// applied twice independently and the global cap stops meaning anything.
func TestExactlyOneAgentMayAct(t *testing.T) {
	var actors []string
	for _, a := range Agents() {
		if a.MayAct {
			actors = append(actors, a.Name)
		}
	}
	if len(actors) != 1 || actors[0] != "neo" {
		t.Fatalf("agents that may act: %v; want exactly [neo]", actors)
	}
}

func TestTheFiveLinesAreAllPresentAndDistinct(t *testing.T) {
	seen := map[int]string{}
	for _, a := range Agents() {
		if other, dup := seen[a.Line]; dup {
			t.Errorf("line %d is claimed by both %s and %s", a.Line, other, a.Name)
		}
		seen[a.Line] = a.Name
	}
	for l := 1; l <= 5; l++ {
		if seen[l] == "" {
			t.Errorf("no agent owns line %d", l)
		}
	}
}

func TestOracleCannotBeGivenAnActionChannel(t *testing.T) {
	o, err := ByName("oracle")
	if err != nil {
		t.Fatal(err)
	}
	if o.MayAct {
		t.Fatal("oracle may act. Oracle sees; a detector with power is a responder with no rate limit")
	}
	for _, p := range o.Publishes {
		if p == "defense.action." || p == "defense.escalation." {
			t.Errorf("oracle publishes %q", p)
		}
	}
}

// Neo must act only on a SCORED threat, so that «is this an attack» is decided
// in exactly one place and it is not the place holding the power.
func TestNeoDoesNotConsumeRawSignals(t *testing.T) {
	n, err := ByName("neo")
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range n.Patterns {
		if p == "defense.signal.#" {
			t.Errorf("neo binds to %q", p)
		}
	}
}

func TestNoAgentBindsToEverything(t *testing.T) {
	for _, a := range Agents() {
		for _, p := range a.Patterns {
			if p == "#" {
				t.Errorf("%s binds to '#': every message in the fleet lands in its queue and its "+
					"own output comes back as input", a.Name)
			}
		}
	}
}

func TestInboxesHaveNoConsumerAndStillGetDeclared(t *testing.T) {
	consumerQueues := map[string]bool{}
	for _, a := range Agents() {
		consumerQueues[a.Queue] = true
	}
	if len(Inboxes()) == 0 {
		t.Fatal("no inbox queues; an escalation nobody has read yet would be lost")
	}
	for _, in := range Inboxes() {
		if consumerQueues[in.Queue] {
			t.Errorf("%s is both an inbox and an agent queue; the agent would drain the human's mail",
				in.Queue)
		}
		if len(in.Patterns) == 0 {
			t.Errorf("inbox %s binds to nothing", in.Queue)
		}
	}
}

func TestByNameRefusesAnUnknownAgent(t *testing.T) {
	if _, err := ByName("morpheous"); err == nil {
		t.Fatal("a misspelled agent name returned an agent; it would bind to nothing and look healthy")
	}
}
