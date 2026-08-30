// Package report is how an agent says something, and it says it three ways at
// once: on stdout, in the audit log, and on the bus.
//
// WHY ALL THREE, EVERY TIME
// Each channel fails in a different way and they fail independently. The bus is
// gone exactly when the broker is the thing under attack. The audit log is gone
// when the disk is full or when somebody has been tidying it. Stdout survives
// both and is what `docker logs` shows at 3am. An agent that reports on one
// channel is an agent that goes silent for the most interesting failures.
//
// The order is deliberate: stdout first, then the audit log, then the bus. The
// cheapest and most reliable channel gets the message before anything that can
// block on the network.
package report

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sync"
	"time"

	qbroker "course/queue/broker"
	qbus "course/queue/bus"
	"course/security/internal/audit"
	"course/security/internal/config"
	"course/security/internal/finding"
)

// Reporter publishes findings and events for one agent.
type Reporter struct {
	agent    string
	exchange string
	client   *qbroker.Client
	log      *audit.Log
	out      io.Writer
	slog     *slog.Logger
	now      func() time.Time
	// warnedNoBroker keeps the "no broker" notice to once per process rather
	// than once per finding: a scan emitting forty findings would otherwise bury
	// the findings in forty identical warnings.
	//
	// A sync.Once and not a bool, because ONE Reporter is shared by every
	// in-flight delivery of its agent and cmd/oracle runs with Prefetch 16 --
	// sixteen goroutines reaching this field at once. As a plain bool it was a
	// `if !r.warnedNoBroker { r.warnedNoBroker = true }` read-modify-write with
	// no synchronisation, which `go test -race` reports as a data race the
	// moment two deliveries overlap on a machine with no AMQP_URL. That is the
	// ordinary developer setup here, since AMQP is deliberately not published to
	// the host. Once is also the cheaper of the two: after the first call it is
	// a single atomic load, where a mutex would be a lock per published finding.
	warnedNoBroker sync.Once
}

// New wires a reporter from the config. It returns a working reporter even when
// the broker is unreachable, because a defence that refuses to start without a
// message bus is a defence that is down whenever the bus is.
func New(cfg config.Config, out io.Writer, lg *slog.Logger) (*Reporter, error) {
	if out == nil {
		out = os.Stdout
	}
	if lg == nil {
		lg = slog.Default()
	}
	al, err := audit.Open(cfg.AuditPath, nil)
	if err != nil {
		// A missing audit log is fatal only in enforce mode, and config.Load
		// already refuses that combination. Here it is reported and survived.
		lg.Warn("audit log unavailable; continuing with stdout and the bus only",
			"path", cfg.AuditPath, "err", err)
		al = nil
	}
	r := &Reporter{
		agent: cfg.Agent, exchange: cfg.Exchange, log: al, out: out, slog: lg, now: time.Now,
	}
	if cfg.AMQPURL != "" {
		r.client = qbroker.New(qbroker.Options{URL: cfg.AMQPURL, Exchange: cfg.Exchange, Log: lg})
	}
	return r, nil
}

// Close releases the broker connection.
func (r *Reporter) Close() error {
	if r.client == nil {
		return nil
	}
	return r.client.Close()
}

// Client exposes the broker for the agents that also declare topology or
// consume. It is nil when no AMQP_URL was configured.
func (r *Reporter) Client() *qbroker.Client { return r.client }

// AuditPath reports where the log is, for an escalation that tells a human where
// to look. Empty when the log could not be opened.
func (r *Reporter) AuditPath() string {
	if r.log == nil {
		return ""
	}
	return r.log.Path()
}

// Finding reports one finding on all three channels.
//
// It returns an error only when the finding itself is invalid. A channel that
// fails is logged and the others still carry the message: losing the bus must
// not lose the finding.
func (r *Reporter) Finding(ctx context.Context, f finding.Finding) error {
	if f.FirstSeen.IsZero() {
		f.FirstSeen = r.now()
	}
	if f.Source == "" {
		f.Source = r.agent
	}
	if err := f.Validate(); err != nil {
		// Fail closed and loudly: an invalid finding is a bug in a check, and
		// publishing it anyway would put an un-diagnosable row in front of a
		// human during an incident.
		return err
	}

	r.line(map[string]any{"channel": "finding", "key": f.Key(), "payload": f.Payload()})

	if r.log != nil {
		if _, err := r.log.Append(audit.Record{
			Agent: f.Source, Event: "finding", Kind: f.Rule, Target: f.Target,
			FindingID: f.ID(), Why: f.Summary,
			Extra: map[string]string{"severity": f.Severity.String(), "remedy": f.Remedy},
		}); err != nil {
			r.slog.Error("could not write to the audit log", "err", err)
		}
	}
	r.publish(ctx, f.Key(), "defense.finding", f.IdempotencyKey(), f.Payload())
	return nil
}

// Event reports something that is not a finding: a threat score, an action, an
// escalation. `kind` becomes the audit `event` and the envelope `type`.
func (r *Reporter) Event(ctx context.Context, key, kind, idempotency string, rec audit.Record, payload map[string]any) {
	r.line(map[string]any{"channel": kind, "key": key, "payload": payload})
	if r.log != nil {
		rec.Agent = r.agent
		rec.Event = kind
		if _, err := r.log.Append(rec); err != nil {
			r.slog.Error("could not write to the audit log", "err", err)
		}
	}
	r.publish(ctx, key, kind, idempotency, payload)
}

// line writes one JSON object per message to stdout. JSON rather than prose
// because `docker logs defense-neo | jq` during an incident should not require a
// parser nobody has written.
func (r *Reporter) line(v map[string]any) {
	v["agent"] = r.agent
	v["at"] = r.now().UTC().Format("2006-01-02T15:04:05.000Z")
	b, err := json.Marshal(v)
	if err != nil {
		fmt.Fprintf(r.out, `{"agent":%q,"error":"could not encode a report: %v"}`+"\n", r.agent, err)
		return
	}
	fmt.Fprintln(r.out, string(b))
}

func (r *Reporter) publish(ctx context.Context, key, typ, idempotency string, payload map[string]any) {
	if r.client == nil {
		r.warnedNoBroker.Do(func() {
			r.slog.Warn("no AMQP_URL: reporting to stdout and the audit log only. " +
				"Nothing downstream will see these findings")
		})
		return
	}
	env, err := qbus.NewEnvelope(qbus.NewEnvelopeOptions{
		Type: typ, Key: key, IdempotencyKey: idempotency, Payload: payload,
	})
	if err != nil {
		r.slog.Error("could not build an envelope", "type", typ, "err", err)
		return
	}
	// A publish timeout that outlives the incident is useless; the broker client
	// has its own, and this bounds the whole call including a reconnect.
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := r.client.Publish(ctx, r.exchange, key, env); err != nil {
		r.slog.Error("could not publish; the finding is still on stdout and in the audit log",
			"key", key, "err", err)
	}
}
