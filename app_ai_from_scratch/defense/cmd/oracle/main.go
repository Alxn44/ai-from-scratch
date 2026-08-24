// Command oracle is line 4: it sees, and it never acts.
//
// Oracle consumes `defense.signal.*` -- events the application publishes about
// its own security-relevant moments -- counts them in a sliding window, and
// publishes a scored `defense.threat.*` when a threshold is crossed.
//
// WHY THE SCORING LIVES HERE AND NOT IN NEO
// There has to be exactly one place where "is this an attack" is decided, and it
// must not be the place holding the power. Splitting them means the component
// that can change the system only ever receives a verdict, so the whole
// question of "what convinced it" is answerable by reading one file. It also
// means Oracle can be made loud and speculative -- which is what a detector
// should be -- without that speculation turning into firewall rules.
//
// Oracle has no policy engine and no guard import, and internal/guard's test
// asserts that no package outside itself can start a process.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"course/defense/binding"
	"course/defense/internal/audit"
	"course/defense/internal/config"
	"course/defense/internal/finding"
	"course/defense/internal/policy"
	"course/defense/internal/report"
	qbroker "course/queue/broker"
	qbus "course/queue/bus"
)

// threshold is "this many of this signal about one subject, inside the window,
// is worth a threat".
//
// Every number here is a guess until it has met real traffic, and that is
// exactly why Neo defaults to propose: these thresholds get to be wrong for a
// while at the cost of an escalation, not an outage.
type threshold struct {
	signal string
	count  int
	sev    finding.Severity
	// action is what Oracle SUGGESTS. Neo is free to refuse it, and does: an
	// unknown or never-touch target is refused at the policy layer.
	action policy.Kind
	why    string
}

var thresholds = []threshold{
	{"auth.login_failed", 8, finding.High, policy.ThrottleIdentity,
		"eight failed logins for one account inside the window is credential stuffing, not a typo"},
	{"auth.session_reuse", 3, finding.Critical, policy.RevokeSession,
		"one session id arriving from materially different clients means the cookie has been taken"},
	{"tool.denied", 12, finding.High, policy.ThrottleIdentity,
		"repeated denials from one session is somebody mapping what the agent tools will allow"},
	{"paywall.blocked", 25, finding.Medium, policy.ThrottleIdentity,
		"a person hits the paywall once and stops; a scraper keeps going"},
	{"http.probe_404", 60, finding.Medium, policy.BlockEdge,
		"sixty misses from one source is a scanner walking a wordlist"},
}

func main() {
	lg := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg, err := config.Load("oracle")
	if err != nil {
		lg.Error("configuration refused", "err", err)
		os.Exit(2)
	}
	rep, err := report.New(cfg, os.Stdout, lg)
	if err != nil {
		lg.Error("could not build the reporter", "err", err)
		os.Exit(2)
	}
	defer rep.Close()

	me, err := binding.ByName("oracle")
	if err != nil {
		lg.Error("binding", "err", err)
		os.Exit(2)
	}
	w := &window{span: cfg.WatchWindow, seen: map[string][]time.Time{}, fired: map[string]time.Time{}}

	disp := &qbus.Dispatcher{
		Exchange: cfg.Exchange,
		Queue:    me.Queue,
		Claims:   qbus.NewMemoryClaims(),
		Log:      lg,
		Handlers: map[string]qbus.Handler{
			// One handler, keyed by envelope TYPE. A signal whose type is not
			// this one is dead-lettered by the dispatcher rather than silently
			// dropped, which is what makes an unbound producer visible.
			"defense.signal": func(ctx context.Context, payload map[string]any, env qbus.Envelope) error {
				return handle(ctx, rep, w, payload, env, lg)
			},
		},
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	lg.Info("starting", "agent", "oracle", "config", cfg.Redacted(),
		"thresholds", len(thresholds), "window", cfg.WatchWindow.String())

	c := qbroker.NewConsumer(&qbroker.Consumer{
		URL: cfg.AMQPURL, Exchange: cfg.Exchange, Queue: me.Queue, Patterns: me.Patterns,
		Prefetch: 16, Dispatcher: disp, Drain: 20 * time.Second, Log: lg,
	})
	if err := c.Run(ctx); err != nil && ctx.Err() == nil {
		lg.Error("consumer stopped", "err", err)
		os.Exit(1)
	}
}

// window counts signals per (signal, subject) inside a span.
type window struct {
	mu    sync.Mutex
	span  time.Duration
	seen  map[string][]time.Time
	fired map[string]time.Time
}

// add records one occurrence and returns the count inside the span.
func (w *window) add(key string, at time.Time) int {
	w.mu.Lock()
	defer w.mu.Unlock()
	cutoff := at.Add(-w.span)
	kept := w.seen[key][:0]
	for _, t := range w.seen[key] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	kept = append(kept, at)
	w.seen[key] = kept
	return len(kept)
}

// shouldFire keeps Oracle from re-publishing the same threat on every subsequent
// signal once a threshold is crossed. Without it, signal 9, 10 and 11 of a
// credential-stuffing run each produce a threat, and Neo's rate limit -- not
// Oracle's judgement -- becomes the thing deciding what happens.
func (w *window) shouldFire(key string, at time.Time) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	if last, ok := w.fired[key]; ok && at.Sub(last) < w.span {
		return false
	}
	w.fired[key] = at
	return true
}

func handle(ctx context.Context, rep *report.Reporter, w *window,
	payload map[string]any, env qbus.Envelope, lg *slog.Logger) error {
	sig, _ := payload["signal"].(string)
	subject, _ := payload["subject"].(string)
	if sig == "" || subject == "" {
		// Not retryable: a malformed signal will be malformed again. Returning
		// nil acks it, and the finding is the record that a producer is wrong.
		lg.Warn("a signal without a signal name or a subject", "type", env.Type, "id", env.ID)
		return nil
	}
	at := time.Now()
	key := sig + "\x00" + subject
	n := w.add(key, at)

	for _, th := range thresholds {
		if th.signal != sig || n < th.count {
			continue
		}
		if !w.shouldFire(key, at) {
			return nil
		}
		// The target for the SUGGESTED action. Oracle does not validate it --
		// policy does, and doing it twice in two places is how the two copies
		// drift apart.
		target, _ := payload["target"].(string)
		if target == "" {
			target = subject
		}
		f := finding.Finding{
			Rule: "detect." + sig, Line: finding.Detection, Source: "oracle",
			Severity: th.sev, Target: target,
			Summary: fmt.Sprintf("%d x %s for %s inside %s", n, sig, subject, w.span),
			Remedy: fmt.Sprintf("%s. The suggested containment is %s; whether it happens is Neo's "+
				"decision and its policy's", th.why, th.action),
			Evidence: map[string]string{
				"signal": sig, "subject": subject, "count": fmt.Sprint(n),
				"window": w.span.String(), "suggested_action": string(th.action),
			},
			FirstSeen: at,
		}
		if err := rep.Finding(ctx, f); err != nil {
			lg.Error("oracle built an unpublishable finding", "err", err)
		}
		rep.Event(ctx, "defense.threat."+th.sev.String(), "defense.threat",
			fmt.Sprintf("defense.threat:%s:%s", f.ID(), at.UTC().Format("2006-01-02T15:04")),
			audit.Record{Kind: string(th.action), Target: target, FindingID: f.ID(), Why: f.Summary},
			map[string]any{
				"finding_id": f.ID(), "signal": sig, "subject": subject,
				"severity": th.sev.String(), "count": n,
				"action": string(th.action), "target": target,
				"why": f.Summary + " -- " + th.why,
			})
		return nil
	}
	return nil
}
