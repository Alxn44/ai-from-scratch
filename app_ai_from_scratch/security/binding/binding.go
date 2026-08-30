// Package binding is the one place the defense fleet's queues and routing keys
// are written down.
//
// Same reason queue/binding exists: five main packages cannot import each
// other, and two copies of a routing pattern means an agent consuming keys the
// topology tool never declared. That failure is silent -- the tool reports
// success, the queue exists, and nothing ever arrives.
//
// THE KEY SPACE
//
//	defense.signal.<what>       an app event worth watching   (api -> Oracle)
//	defense.threat.<severity>   Oracle's verdict              (Oracle -> Neo)
//	defense.finding.<severity>  something is wrong            (any agent -> inbox)
//	defense.action.<kind>       Neo did something             (Neo -> inbox, api)
//	defense.escalation.<kind>   a human has to decide         (Neo -> inbox)
//	defense.scan.request        run the adversary pass        (cron/api -> Smith)
//	defense.host.request        re-apply host policy          (api -> Trinity)
//
// ONE DIRECTION ONLY, and this is load-bearing: Oracle publishes threats and
// consumes signals; Neo consumes threats and publishes actions. Neo does NOT
// publish threats and Oracle does NOT consume actions. A cycle between the
// detector and the responder is a feedback loop that produces its own traffic,
// and the traffic looks exactly like an attack.
package binding

import "fmt"

// Agent is one of the five.
type Agent struct {
	// Name is the binary name and the audit `agent` field.
	Name string
	// Line is 1..5.
	Line int
	// Queue is its own durable queue, or "" for an agent that only publishes.
	Queue string
	// Patterns are the routing keys it asks for. Empty for a publisher.
	Patterns []string
	// Publishes lists the key PREFIXES it is allowed to publish. Asserted by
	// Verify() against the one-direction rule above.
	Publishes []string
	// MayAct records whether this agent is allowed to change the system. It is
	// true for exactly one agent, and a test asserts that.
	MayAct bool
}

// Inbox queues hold messages for a human or for the api to drain. They have no
// consumer inside this module, and that is deliberate: an escalation nobody has
// read yet must still be there tomorrow.
const (
	FindingInbox    = "defense.findings"
	ActionInbox     = "defense.actions"
	EscalationInbox = "defense.escalations"
)

// Agents is the table.
func Agents() []Agent {
	return []Agent{
		{
			Name: "morpheus", Line: 1,
			Queue:     "defense.morpheus",
			Patterns:  []string{"defense.perimeter.request", "bus.echo"},
			Publishes: []string{"defense.finding."},
		},
		{
			Name: "trinity", Line: 2,
			Queue:     "defense.trinity",
			Patterns:  []string{"defense.host.request", "bus.echo"},
			Publishes: []string{"defense.finding."},
		},
		{
			Name: "smith", Line: 3,
			Queue:     "defense.smith",
			Patterns:  []string{"defense.scan.request", "bus.echo"},
			Publishes: []string{"defense.finding."},
		},
		{
			Name: "oracle", Line: 4,
			Queue: "defense.oracle",
			// Oracle binds to the signal channel and to nothing else. Binding
			// it to `#` would look like better observability and would be
			// sabotage: every message in the fleet copied into one queue, and
			// Oracle's own findings arriving back as input.
			Patterns:  []string{"defense.signal.#", "bus.echo"},
			Publishes: []string{"defense.threat.", "defense.finding."},
		},
		{
			Name: "neo", Line: 5,
			Queue:     "defense.neo",
			Patterns:  []string{"defense.threat.#", "bus.echo"},
			Publishes: []string{"defense.action.", "defense.escalation.", "defense.finding."},
			MayAct:    true,
		},
	}
}

// ByName looks up one agent, refusing an unknown name rather than returning a
// zero Agent that would bind to nothing.
func ByName(name string) (Agent, error) {
	for _, a := range Agents() {
		if a.Name == name {
			return a, nil
		}
	}
	return Agent{}, fmt.Errorf("binding: no agent named %q (have morpheus, trinity, smith, oracle, neo)", name)
}

// Inboxes are the durable queues with no consumer in this module.
func Inboxes() []Agent {
	return []Agent{
		{Name: FindingInbox, Queue: FindingInbox, Patterns: []string{"defense.finding.#"}},
		{Name: ActionInbox, Queue: ActionInbox, Patterns: []string{"defense.action.#"}},
		{Name: EscalationInbox, Queue: EscalationInbox, Patterns: []string{"defense.escalation.#"}},
	}
}

// Verify asserts the structural rules this package's header promises. Wired into
// `defense verify`.
func Verify() []error {
	var errs []error
	seenName := map[string]bool{}
	seenQueue := map[string]bool{}
	actors := 0
	for _, a := range Agents() {
		if seenName[a.Name] {
			errs = append(errs, fmt.Errorf("binding: %s declared twice", a.Name))
		}
		seenName[a.Name] = true
		if a.Queue != "" {
			if seenQueue[a.Queue] {
				errs = append(errs, fmt.Errorf("binding: queue %s claimed by two agents; they would "+
					"steal each other's messages", a.Queue))
			}
			seenQueue[a.Queue] = true
			if len(a.Patterns) == 0 {
				errs = append(errs, fmt.Errorf("binding: %s has a queue and no patterns, so nothing "+
					"routes to it. That reads as a broker problem and is a wiring problem", a.Name))
			}
		}
		if a.Line < 1 || a.Line > 5 {
			errs = append(errs, fmt.Errorf("binding: %s is on line %d, and there are five", a.Name, a.Line))
		}
		if len(a.Publishes) == 0 {
			errs = append(errs, fmt.Errorf("binding: %s publishes nothing, so it cannot report", a.Name))
		}
		if a.MayAct {
			actors++
		}
		for _, p := range a.Patterns {
			if p == "#" {
				errs = append(errs, fmt.Errorf("binding: %s binds to '#', which copies every message "+
					"in the fleet into its queue and feeds its own output back as input", a.Name))
			}
		}
	}
	if actors != 1 {
		errs = append(errs, fmt.Errorf("binding: %d agents may act. Exactly one may: containment is "+
			"the only power in this system and it has one owner", actors))
	}
	// The one-direction rule, asserted rather than described.
	oracle, _ := ByName("oracle")
	neo, _ := ByName("neo")
	for _, p := range oracle.Publishes {
		if p == "defense.action." || p == "defense.escalation." {
			errs = append(errs, fmt.Errorf("binding: oracle publishes %q. Oracle sees; it does not act, "+
				"and a detector that can emit actions is a responder with no rate limit", p))
		}
	}
	for _, pat := range oracle.Patterns {
		if pat == "defense.action.#" || pat == "defense.threat.#" {
			errs = append(errs, fmt.Errorf("binding: oracle consumes %q, which closes a loop between "+
				"the detector and the responder. The loop generates traffic that looks like an attack", pat))
		}
	}
	for _, pat := range neo.Patterns {
		if pat == "defense.signal.#" {
			errs = append(errs, fmt.Errorf("binding: neo consumes raw signals (%q). Neo must act only on "+
				"a scored threat, so that there is exactly one place where «is this an attack» is "+
				"decided and it is not the place with the power", pat))
		}
	}
	return errs
}
