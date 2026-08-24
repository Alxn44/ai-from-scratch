// Command neo is line 5: the only agent that may change the running system.
//
// # THE THREAT MODEL, stated plainly, because everything else here follows from it
//
// Neo acts on messages from the bus. AMQP has no per-message authentication, so
// ANYONE WHO CAN PUBLISH TO THE EXCHANGE CAN COMMAND NEO. The broker credential
// is the authentication, and that is the whole of it. Which means the interesting
// question is not "can Neo be tricked" -- assume it can -- but "what is the worst
// thing a fully trusted attacker can make it do".
//
// The answer, by construction:
//
//   - at most 10 actions in 10 minutes, across all kinds (policy.GlobalLimit);
//   - each one drawn from a five-entry allowlist, never a command;
//   - each one against a target that passed that rule's validator;
//   - each one expiring on its own, with the timeout held by the KERNEL and not
//     by a timer in this process;
//   - none of them touching cloudflared, Postgres, RabbitMQ, Mosquitto or the
//     migration job;
//   - all of them in a hash-chained audit log before and after;
//   - and by default, in propose mode, NONE of them happening at all.
//
// That is a bounded loss. An unbounded one would be a generic "run this" verb,
// which is why there isn't one.
package main

import (
	"context"
	"errors"
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
	"course/defense/internal/guard"
	"course/defense/internal/policy"
	"course/defense/internal/report"
	qbroker "course/queue/broker"
	qbus "course/queue/bus"
)

func main() {
	lg := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg, err := config.Load("neo")
	if err != nil {
		lg.Error("configuration refused", "err", err)
		os.Exit(2)
	}
	engine, err := policy.NewEngine(cfg.Mode, nil)
	if err != nil {
		// The rule table failed its own invariants. Refusing to start is the
		// point: the alternative is an agent with power and a broken leash.
		lg.Error("the policy table is invalid; not starting", "err", err)
		os.Exit(2)
	}
	rep, err := report.New(cfg, os.Stdout, lg)
	if err != nil {
		lg.Error("could not build the reporter", "err", err)
		os.Exit(2)
	}
	defer rep.Close()

	// Rebuild the action budget from the audit log. Without this a restart hands
	// an attacker a fresh ten actions every time they manage to crash this
	// process, which turns a crash bug into an amplifier.
	if replayed := replay(cfg.AuditPath, engine, lg); replayed > 0 {
		lg.Info("action budget restored from the audit log", "actions_in_window", replayed)
	}

	me, err := binding.ByName("neo")
	if err != nil {
		lg.Error("binding", "err", err)
		os.Exit(2)
	}
	var runner guard.Runner = guard.Real{}
	if cfg.Mode != policy.Enforce {
		// Propose mode never reaches the runner -- the engine returns Escalate
		// long before -- but wiring DryRun here means that if it ever DID, the
		// worst case is a recorded no-op rather than a command.
		runner = &guard.DryRun{}
	}

	h := &handler{engine: engine, rep: rep, runner: runner, cfg: cfg, lg: lg}
	disp := &qbus.Dispatcher{
		Exchange: cfg.Exchange, Queue: me.Queue, Claims: qbus.NewMemoryClaims(), Log: lg,
		Handlers: map[string]qbus.Handler{"defense.threat": h.handle},
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	lg.Info("starting", "agent", "neo", "config", cfg.Redacted(),
		"mode", string(cfg.Mode), "actions", policy.Kinds(),
		"global_cap", fmt.Sprintf("%d per %s", policy.GlobalLimit.Max, policy.GlobalLimit.Window))
	if cfg.Mode != policy.Enforce {
		lg.Warn("propose mode: every containment will be escalated, not applied. " +
			"This is the default. Set DEFENSE_MODE=enforce only once the thresholds in oracle " +
			"have been watched against real traffic")
	}

	c := qbroker.NewConsumer(&qbroker.Consumer{
		URL: cfg.AMQPURL, Exchange: cfg.Exchange, Queue: me.Queue, Patterns: me.Patterns,
		// Prefetch 1. Containment is not throughput work, and a serialised
		// stream is what makes the rate limit mean what it says: with a
		// prefetch of 16, sixteen deliveries evaluate concurrently and all
		// sixteen can pass a cap of ten before any of them is committed.
		//
		// This is a SAFETY setting, not a tuning knob, and raising it is not a
		// performance win. handler.mu now enforces the same serialisation inside
		// the process -- read its comment for the case prefetch alone does not
		// cover -- but the two are belt and braces, not alternatives: prefetch 1
		// is what stops fifteen threats from queueing up on that mutex behind a
		// containment that takes twenty seconds.
		Prefetch: 1, Dispatcher: disp, Drain: 20 * time.Second, Log: lg,
	})
	if err := c.Run(ctx); err != nil && ctx.Err() == nil {
		lg.Error("consumer stopped", "err", err)
		os.Exit(1)
	}
}

type handler struct {
	engine *policy.Engine
	rep    *report.Reporter
	runner guard.Runner
	cfg    config.Config
	lg     *slog.Logger

	// ONE CONTAINMENT AT A TIME, IN THIS PROCESS.
	//
	// The global cap is only a real bound if the decide-then-act sequence is
	// serialised. Decide() READS the action budget and Committed() SPENDS it,
	// and between those two calls the budget is not yet consumed -- so N
	// handlers evaluating at once can all pass a cap of ten before any of them
	// commits. Measured before this mutex existed: 24 overlapping threats
	// produced 24 containments against a cap of 10. The test that counts them is
	// TestTheGlobalCapHoldsWhenHandlersOverlap.
	//
	// Prefetch 1 on the consumer is the FIRST line of that defence and it stays.
	// It is not sufficient on its own, which is the whole reason this field is
	// here: a handler that outruns Dispatcher.HandlerTimeout is ABANDONED, not
	// cancelled (queue/bus/dispatch.go, Dispatcher.run -- Go cannot cancel a
	// goroutine from outside). Its goroutine keeps running, its prefetch slot is
	// released, and the next delivery is dispatched underneath it. Prefetch
	// bounds what the BROKER hands over; it says nothing about how many handlers
	// this process still has in flight.
	//
	// The race detector cannot find that bug -- every field involved is already
	// behind the engine's own mutex, so it is a lost update rather than a data
	// race. It has to be counted, which is what the test does.
	//
	// Cost when prefetch is 1: nothing. There is never a second holder, so this
	// is an uncontended lock once per threat.
	mu sync.Mutex
}

func (h *handler) handle(ctx context.Context, payload map[string]any, env qbus.Envelope) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	// Waiting for the lock can outlast the delivery's own deadline. Refusing
	// here is the honest move: the alternative is beginning a containment on a
	// context the dispatcher has already given up on, which writes "about to
	// act" into the audit log and then fails halfway through. Returning the
	// error puts the threat on the retry ladder with nothing done.
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("waited for the containment lock past this delivery's deadline: %w", err)
	}

	kind, _ := payload["action"].(string)
	target, _ := payload["target"].(string)
	why, _ := payload["why"].(string)
	findingID, _ := payload["finding_id"].(string)
	if kind == "" || target == "" {
		h.lg.Warn("a threat with no action or target", "id", env.ID, "type", env.Type)
		return nil // not retryable
	}
	ttl := time.Duration(0) // 0 means "the rule's maximum", clamped by the engine
	if s, ok := payload["ttl_s"].(float64); ok && s > 0 {
		ttl = time.Duration(s) * time.Second
	}

	d := h.engine.Decide(policy.Kind(kind), target, ttl, findingID, why)

	// The decision is recorded BEFORE it is carried out. If the action wedges
	// the box, the log already says what was about to happen -- which is the
	// difference between an incident review and a guess.
	h.rep.Event(ctx, "defense.action."+kind+".decided", "defense.decision",
		fmt.Sprintf("defense.decision:%s:%s:%s", kind, target, env.ID),
		audit.Record{Verdict: string(d.Verdict), Kind: kind, Target: d.Target,
			FindingID: findingID, TTLSec: d.TTLSec, Argv: d.Argv, Undo: d.Undo, Why: d.Why},
		decisionPayload(d, env))

	switch d.Verdict {
	case policy.Refuse:
		// Refuse is still worth escalating: a refused containment means a
		// detection fired at something the policy protects, and that is either
		// a false positive worth fixing or an attacker probing the leash.
		h.escalate(ctx, d, env, "refused by policy")
		return nil
	case policy.Escalate:
		h.escalate(ctx, d, env, string(d.Verdict))
		return nil
	}

	res, err := h.runner.Run(ctx, d)
	if err != nil {
		// A failed action is escalated, not retried. A retry loop against a
		// broken command is an action storm with extra steps, and the rate limit
		// would not even see it because nothing was ever committed.
		h.lg.Error("the action failed", "kind", kind, "target", d.Target, "err", err)
		h.escalate(ctx, d, env, "the action FAILED: "+err.Error())
		return nil
	}
	h.engine.Committed(d)

	h.rep.Event(ctx, "defense.action."+kind, "defense.action",
		fmt.Sprintf("defense.action:%s:%s:%s", kind, d.Target, env.ID),
		audit.Record{Verdict: string(policy.Act), Kind: kind, Target: d.Target,
			FindingID: findingID, TTLSec: d.TTLSec, Argv: d.Argv, Undo: d.Undo,
			Why: d.Why, Extra: map[string]string{"output": res.Output}},
		decisionPayload(d, env))
	return nil
}

func (h *handler) escalate(ctx context.Context, d policy.Decision, env qbus.Envelope, reason string) {
	p := decisionPayload(d, env)
	p["reason"] = reason
	p["audit_log"] = h.rep.AuditPath()
	h.rep.Event(ctx, "defense.escalation."+string(d.Kind), "defense.escalation",
		fmt.Sprintf("defense.escalation:%s:%s:%s", d.Kind, d.Target, env.ID),
		audit.Record{Verdict: string(d.Verdict), Kind: string(d.Kind), Target: d.Target,
			FindingID: d.FindingID, TTLSec: d.TTLSec, Argv: d.Argv, Undo: d.Undo,
			Why: d.Why, Extra: map[string]string{"reason": reason}},
		p)
}

func decisionPayload(d policy.Decision, env qbus.Envelope) map[string]any {
	p := map[string]any{
		"verdict": string(d.Verdict), "kind": string(d.Kind), "mode": string(d.Mode),
		"ttl_s": d.TTLSec, "why": d.Why, "from_threat": env.ID,
	}
	if d.Target != "" {
		p["target"] = d.Target
	}
	if d.FindingID != "" {
		p["finding_id"] = d.FindingID
	}
	// The argv is carried on an escalation on purpose: an escalation a human
	// cannot execute is a log line, and this is the copy-pasteable half.
	if len(d.Argv) > 0 {
		p["argv"] = d.Argv
	}
	if len(d.Undo) > 0 {
		p["undo"] = d.Undo
	}
	return p
}

// replay rebuilds the rate-limit window from the audit log's committed actions.
func replay(path string, e *policy.Engine, lg *slog.Logger) int {
	recs, err := audit.Read(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			lg.Warn("could not read the audit log to restore the action budget; "+
				"this restart starts with a full budget", "path", path, "err", err)
		}
		return 0
	}
	var acted []struct {
		Kind policy.Kind
		At   time.Time
	}
	for _, r := range recs {
		if r.Event != "defense.action" || r.Verdict != string(policy.Act) {
			continue
		}
		at, err := time.Parse("2006-01-02T15:04:05.000Z", r.At)
		if err != nil {
			continue
		}
		acted = append(acted, struct {
			Kind policy.Kind
			At   time.Time
		}{policy.Kind(r.Kind), at})
	}
	e.Replay(acted)
	return len(acted)
}
