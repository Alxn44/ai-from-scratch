package policy

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

// Verdict is what the engine decided. Three outcomes and no fourth: there is no
// «probably fine» path that quietly does the thing.
type Verdict string

const (
	// Act: allowed, within every limit. Argv is filled in when the action is a
	// process; a nil Argv with Act means «hand it to the service that owns it».
	Act Verdict = "act"
	// Escalate: this SHOULD happen and Neo may not do it. The decision carries
	// the exact argv that would have run, because an escalation a human cannot
	// execute is just a log line.
	Escalate Verdict = "escalate"
	// Refuse: this must not happen at all -- an invalid target, a never-touch
	// target, or an unknown action. Refuse is not a failure to be retried.
	Refuse Verdict = "refuse"
)

// Decision is the complete record of one call to Decide. Every field is written
// to the audit log, so this type is also the audit schema.
type Decision struct {
	Verdict Verdict       `json:"verdict"`
	Kind    Kind          `json:"kind"`
	Target  string        `json:"target,omitempty"`
	TTL     time.Duration `json:"-"`
	TTLSec  int           `json:"ttl_s"`
	// Argv is what would run, or did. Kept on an Escalate so the escalation is
	// actionable, and on a Refuse it is nil because nothing was ever built.
	Argv []string `json:"argv,omitempty"`
	Undo []string `json:"undo,omitempty"`
	// Why is for a human, and it is required for every verdict including Act:
	// «why did my server ban this» is the first question after an incident.
	Why string `json:"why"`
	// FindingID ties the action back to what caused it.
	FindingID string `json:"finding_id,omitempty"`
	Mode      Mode   `json:"mode"`
	At        time.Time
}

// Engine holds the mode, the clock and the recent-action history the rate limits
// are computed from.
//
// The history is in memory, and that is a real limitation with a real
// mitigation: a restart would otherwise hand an attacker a fresh action budget
// every time it managed to crash Neo. Replay() rebuilds the window from the
// audit log on startup, so the budget survives a restart as long as the log
// does. What it does not survive is losing the log, and that is stated here
// rather than discovered later.
type Engine struct {
	mu    sync.Mutex
	mode  Mode
	now   func() time.Time
	rules map[Kind]Rule
	// acted holds only the actions that ACTUALLY happened. Escalations do not
	// consume budget: if they did, an attacker could exhaust the budget with
	// findings that were never going to act, and then the one real detection
	// would be rate-limited into silence.
	acted []actedAt
}

type actedAt struct {
	kind Kind
	at   time.Time
}

// NewEngine builds an engine. It returns an error when the rule table itself is
// invalid, so a bad table cannot be loaded and then discovered at 3am.
func NewEngine(mode Mode, now func() time.Time) (*Engine, error) {
	if errs := Verify(); len(errs) > 0 {
		return nil, fmt.Errorf("policy: the rule table is invalid, refusing to start: %w", errors.Join(errs...))
	}
	if now == nil {
		now = time.Now
	}
	return &Engine{mode: mode, now: now, rules: ByKind()}, nil
}

// Mode reports the configured mode.
func (e *Engine) Mode() Mode { return e.mode }

// Replay seeds the rate-limit window from actions already recorded. Entries
// older than the widest window are ignored, so a long audit log costs nothing.
func (e *Engine) Replay(entries []struct {
	Kind Kind
	At   time.Time
}) {
	e.mu.Lock()
	defer e.mu.Unlock()
	cutoff := e.now().Add(-e.widestWindow())
	for _, en := range entries {
		if en.At.After(cutoff) {
			e.acted = append(e.acted, actedAt{kind: en.Kind, at: en.At})
		}
	}
}

func (e *Engine) widestWindow() time.Duration {
	w := GlobalLimit.Window
	for _, r := range e.rules {
		if r.Limit.Window > w {
			w = r.Limit.Window
		}
	}
	return w
}

// Decide evaluates one proposed action and never performs it. Separating the
// decision from the execution is what makes the whole policy testable without a
// root shell, and it is why Propose mode costs nothing to run.
//
// `ttl` is what the caller wants; the rule's MaxTTL clamps it. A caller asking
// for a longer ban than the rule allows gets the rule's limit and is told so in
// Why, rather than being refused -- refusing would mean a detection with a
// slightly optimistic TTL does nothing at all.
func (e *Engine) Decide(kind Kind, target string, ttl time.Duration, findingID, why string) Decision {
	e.mu.Lock()
	defer e.mu.Unlock()
	at := e.now()
	d := Decision{Kind: kind, Target: target, FindingID: findingID, Mode: e.mode, At: at, Why: why}

	r, ok := e.rules[kind]
	if !ok {
		d.Verdict = Refuse
		d.Why = fmt.Sprintf("unknown action %q; the allowlist is %v", kind, Kinds())
		return d
	}

	normalised, err := r.Validate(target)
	if err != nil {
		d.Verdict = Refuse
		d.Why = err.Error()
		return d
	}
	d.Target = normalised

	if ttl <= 0 || ttl > r.MaxTTL {
		clamped := r.MaxTTL
		if ttl > 0 && ttl < r.MaxTTL {
			clamped = ttl
		}
		if ttl != clamped {
			d.Why = fmt.Sprintf("%s (ttl clamped from %s to %s by the rule)", why, ttl, clamped)
		}
		ttl = clamped
	}
	d.TTL = ttl
	d.TTLSec = int(ttl.Seconds())

	if r.Argv != nil {
		argv, err := r.Argv(normalised, ttl)
		if err != nil {
			d.Verdict = Refuse
			d.Why = fmt.Sprintf("could not build the command: %v", err)
			return d
		}
		d.Argv = argv
	}
	if r.Undo != nil {
		if undo, err := r.Undo(normalised); err == nil {
			d.Undo = undo
		}
	}

	// Order matters below. A human requirement is checked BEFORE the rate
	// limits, because an action that always escalates should never be able to
	// report «rate limited» -- that would read as «it would have acted», which
	// is a different and much more alarming sentence.
	if r.NeedsHuman {
		d.Verdict = Escalate
		d.Why = fmt.Sprintf("%s [%s always requires a human: %s]", d.Why, kind, r.What)
		return d
	}
	if e.mode != Enforce {
		d.Verdict = Escalate
		d.Why = fmt.Sprintf("%s [mode is %s, so nothing was applied. Set DEFENSE_MODE=enforce to let "+
			"Neo act]", d.Why, e.mode)
		return d
	}
	if n := e.countLocked(kind, r.Limit.Window, at); n >= r.Limit.Max {
		d.Verdict = Escalate
		d.Why = fmt.Sprintf("%s [rate limit: %d %s actions already in the last %s, cap is %d]",
			d.Why, n, kind, r.Limit.Window, r.Limit.Max)
		return d
	}
	if n := e.countLocked("", GlobalLimit.Window, at); n >= GlobalLimit.Max {
		d.Verdict = Escalate
		d.Why = fmt.Sprintf("%s [GLOBAL rate limit: %d actions in the last %s, cap is %d. This is the "+
			"limit that stands between a compromised detection layer and an action storm, so it "+
			"escalates instead of widening]", d.Why, n, GlobalLimit.Window, GlobalLimit.Max)
		return d
	}
	d.Verdict = Act
	return d
}

// Committed records that an Act decision was actually carried out. It is a
// separate call on purpose: budget is spent by what HAPPENED, not by what was
// decided, so an action that failed to execute does not silently consume the
// allowance that the retry needs.
func (e *Engine) Committed(d Decision) {
	if d.Verdict != Act {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.acted = append(e.acted, actedAt{kind: d.Kind, at: d.At})
}

// countLocked counts actions in a window. An empty kind counts all of them.
func (e *Engine) countLocked(kind Kind, window time.Duration, at time.Time) int {
	cutoff := at.Add(-window)
	n := 0
	kept := e.acted[:0]
	for _, a := range e.acted {
		// Compact while scanning: the slice is bounded by the widest window
		// rather than growing for the life of the process.
		if a.at.After(at.Add(-e.widestWindow())) {
			kept = append(kept, a)
		}
		if a.at.After(cutoff) && (kind == "" || a.kind == kind) {
			n++
		}
	}
	e.acted = kept
	return n
}
