// Package finding is what the five agents say to each other.
//
// One type, four severities, and a STABLE identity. The identity is the whole
// point: Smith re-runs every hour and Oracle re-scores every minute, so the same
// hole is reported hundreds of times. Without a stable id, "23 findings" means
// nothing -- it is one finding seen 23 times, and a dashboard counting rows
// reports an outbreak that is really a repeat.
package finding

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Severity is how much this matters. Ordered, so a threshold comparison is a
// number comparison and not a lookup table nobody keeps in sync.
type Severity int

const (
	Info Severity = iota
	Low
	Medium
	High
	Critical
)

var severityNames = [...]string{"info", "low", "medium", "high", "critical"}

func (s Severity) String() string {
	if s < Info || int(s) >= len(severityNames) {
		return fmt.Sprintf("severity(%d)", int(s))
	}
	return severityNames[s]
}

// ParseSeverity is the inverse. It refuses an unknown name rather than
// defaulting to Info: a typo in a threshold that silently means "report
// everything" is how an alert channel becomes noise nobody reads.
func ParseSeverity(s string) (Severity, error) {
	for i, n := range severityNames {
		if n == strings.ToLower(strings.TrimSpace(s)) {
			return Severity(i), nil
		}
	}
	return Info, fmt.Errorf("finding: unknown severity %q (want one of %s)",
		s, strings.Join(severityNames[:], ", "))
}

// Line is which of the five lines of defense owns this. It is not decoration:
// Neo refuses to act on a finding whose line has no containment (see policy).
type Line int

const (
	Perimeter Line = 1 // Morpheus -- the door
	Host      Line = 2 // Trinity  -- the walls
	Adversary Line = 3 // Smith    -- attacks us so we find it first
	Detection Line = 4 // Oracle   -- sees, never acts
	Response  Line = 5 // Neo      -- the only one that acts
)

var lineAgents = map[Line]string{
	Perimeter: "morpheus", Host: "trinity", Adversary: "smith",
	Detection: "oracle", Response: "neo",
}

// Agent names the agent that owns a line.
func (l Line) Agent() string {
	if n, ok := lineAgents[l]; ok {
		return n
	}
	return fmt.Sprintf("line(%d)", int(l))
}

// Finding is one thing that is wrong, or one thing that is happening.
//
// `Evidence` is deliberately a map and not a formatted string: it crosses the
// bus as JSON and a human reads it in a table, and a pre-formatted sentence
// cannot be filtered on. `Target` is what an action would be taken AGAINST, and
// it is the field policy validates -- so it is a separate field rather than
// something to be parsed back out of a description.
type Finding struct {
	// Rule is the stable name of the CHECK, e.g. "host.ssh.password_auth".
	// Dotted, lowercase, no spaces: it is a key, not a sentence.
	Rule string `json:"rule"`
	// Line and Source say who found it. Source is the agent binary name.
	Line   Line   `json:"line"`
	Source string `json:"source"`
	// Severity as a NAME on the wire. An integer would let a reordering of the
	// constants above silently reinterpret every stored finding.
	Severity Severity `json:"-"`
	// Target is what this is about: an IP, a container, a file, a session id.
	// Empty when the finding is about the system as a whole.
	Target string `json:"target,omitempty"`
	// Summary is one line for a human. Evidence is the machine-readable why.
	Summary  string            `json:"summary"`
	Evidence map[string]string `json:"evidence,omitempty"`
	// Remedy is what to DO. A finding with no remedy is a complaint.
	Remedy string `json:"remedy"`
	// FirstSeen is set by whoever creates the finding; the bus envelope carries
	// its own produced_at, and these are not the same instant once a finding is
	// republished on retry.
	FirstSeen time.Time `json:"first_seen"`
}

// Validate refuses a finding that cannot be acted on or counted.
//
// Fail closed: an agent that publishes a nameless finding has a bug, and
// accepting it means the bug shows up later as an un-diagnosable row.
func (f Finding) Validate() error {
	switch {
	case strings.TrimSpace(f.Rule) == "":
		return errors.New("finding: empty rule (the stable name of the check)")
	case strings.ContainsAny(f.Rule, " \t\n"):
		return fmt.Errorf("finding: rule %q contains whitespace; it is a key, not a sentence", f.Rule)
	case f.Rule != strings.ToLower(f.Rule):
		return fmt.Errorf("finding: rule %q must be lowercase", f.Rule)
	case strings.TrimSpace(f.Summary) == "":
		return fmt.Errorf("finding %s: empty summary", f.Rule)
	case strings.TrimSpace(f.Remedy) == "":
		// Enforced, not advisory. Every check this repository ships was written
		// with the fix already known; a finding without one is a check that
		// dumped its output and left the reader to guess.
		return fmt.Errorf("finding %s: no remedy (what should somebody DO about it)", f.Rule)
	case f.Line < Perimeter || f.Line > Response:
		return fmt.Errorf("finding %s: line %d is not one of the five", f.Rule, int(f.Line))
	case f.Severity < Info || f.Severity > Critical:
		return fmt.Errorf("finding %s: severity %d out of range", f.Rule, int(f.Severity))
	case strings.TrimSpace(f.Source) == "":
		return fmt.Errorf("finding %s: no source agent", f.Rule)
	}
	return nil
}

// ID is the dedupe key: the same hole found again has the same ID.
//
// Rule plus Target, and NOTHING else. Severity is excluded on purpose -- Oracle
// raises a score as an attack develops, and hashing the severity in would make
// every escalation look like a brand new finding and defeat the rate limit that
// stands between an attacker and an action storm.
func (f Finding) ID() string {
	h := sha256.Sum256([]byte(f.Rule + "\x00" + f.Target))
	return hex.EncodeToString(h[:])[:16]
}

// Payload renders the finding for the `payload` field of a bus envelope.
//
// A map[string]any because that is what the envelope takes in all three sibling
// runtimes -- ai/src/course_ai/bus.py asks `isinstance(payload, dict)` and
// api/src/bus.ts rejects a non-object, so anything else is a dead letter in two
// services out of three.
func (f Finding) Payload() map[string]any {
	ev := make(map[string]any, len(f.Evidence))
	for _, k := range sortedKeys(f.Evidence) {
		ev[k] = f.Evidence[k]
	}
	out := map[string]any{
		"id":         f.ID(),
		"rule":       f.Rule,
		"line":       int(f.Line),
		"agent":      f.Line.Agent(),
		"source":     f.Source,
		"severity":   f.Severity.String(),
		"summary":    f.Summary,
		"remedy":     f.Remedy,
		"first_seen": f.FirstSeen.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	if f.Target != "" {
		out["target"] = f.Target
	}
	if len(ev) > 0 {
		out["evidence"] = ev
	}
	return out
}

// Key is the bus routing key a finding goes out with, e.g.
// "defense.finding.high". Severity is IN the key so a consumer can bind to
// `defense.finding.critical` alone -- an escalation path that does not depend on
// every consumer filtering correctly.
func (f Finding) Key() string {
	return "defense.finding." + f.Severity.String()
}

// IdempotencyKey is the unit of "already reported". The ID plus the UTC hour:
// the same hole re-found within the hour is the same message, and the fleet's
// claim logic drops it instead of paging twice. An hour rather than a day
// because a re-found CRITICAL after a failed fix has to be able to speak again
// the same day.
func (f Finding) IdempotencyKey() string {
	return fmt.Sprintf("defense.finding:%s:%s", f.ID(), f.FirstSeen.UTC().Format("2006-01-02T15"))
}

func sortedKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
