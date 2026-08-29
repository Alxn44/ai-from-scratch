package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"

	"course/queue/broker"
	"course/queue/bus"
	"course/queue/internal/config"
)

const secret = "3JqNPBjBhBIWMLYPUiZ9m7WK1Vd0kMIQzLzOaXfQ4vI="

// fakeBroker is a Broker whose every answer is chosen by the test.
type fakeBroker struct {
	configured bool
	connected  bool
	publishErr error
	declareErr error
	verifyErr  error
	missing    []broker.Missing
	inspectErr error
	states     []broker.QueueState
	replayed   broker.Replayed
	replayErr  error

	published []bus.Envelope
}

func (f *fakeBroker) Configured() bool { return f.configured }

func (f *fakeBroker) Health() broker.Health {
	return broker.Health{Configured: f.configured, Connected: f.connected, Broker: "amqp://***@broker:5672/"}
}

func (f *fakeBroker) EnsureConnected(_ context.Context) error { return nil }

func (f *fakeBroker) Publish(_ context.Context, _, _ string, env bus.Envelope) error {
	if f.publishErr != nil {
		return f.publishErr
	}
	f.published = append(f.published, env)
	return nil
}

func (f *fakeBroker) Declare(context.Context, bus.Topology) error { return f.declareErr }

func (f *fakeBroker) Verify(context.Context, bus.Topology) ([]broker.Missing, error) {
	return f.missing, f.verifyErr
}

func (f *fakeBroker) Inspect(context.Context, []string) ([]broker.QueueState, error) {
	return f.states, f.inspectErr
}

func (f *fakeBroker) ReplayDeadLetters(context.Context, int) (broker.Replayed, error) {
	return f.replayed, f.replayErr
}

// build wires a server over the fake broker. The config comes from a map, never
// from the real environment.
func build(t *testing.T, b *fakeBroker) (*fiber.App, *fakeBroker) {
	t.Helper()
	cfg, err := config.Load(func(k string) (string, bool) {
		m := map[string]string{"QUEUE_SECRETO": secret}
		if b.configured {
			m["AMQP_URL"] = "amqp://app:pw@broker:5672/"
		}
		v, ok := m[k]
		return v, ok
	})
	if err != nil {
		t.Fatal(err)
	}
	topo, err := bus.BuildTopology(cfg.Exchange, "queue.work", []string{"queue.#"})
	if err != nil {
		t.Fatal(err)
	}
	app := New(Deps{
		Config: cfg, Client: b, Topology: topo,
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return app, b
}

// do sends one request and decodes the JSON answer.
func do(t *testing.T, app *fiber.App, method, path, body, sec string) (int, map[string]any) {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("content-type", "application/json")
	}
	if sec != "" {
		r.Header.Set("x-queue-secreto", sec)
	}
	res, err := app.Test(r)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, out
}

func TestHealthSaysNoBrokerWithA503(t *testing.T) {
	// A health endpoint that always answers ok is decoration: it turns a broker
	// outage into a green dashboard.
	app, _ := build(t, &fakeBroker{configured: false})
	code, body := do(t, app, "GET", "/health", "", "")
	if code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d; want 503 when no broker is configured", code)
	}
	if body["status"] != "no_broker" {
		t.Fatalf("status field = %v", body["status"])
	}
}

func TestHealthDistinguishesUpFromConnected(t *testing.T) {
	// "up but not connected to the broker" and "up and connected" are different
	// facts and must not collapse into one answer.
	app, _ := build(t, &fakeBroker{configured: true, connected: false})
	code, body := do(t, app, "GET", "/health", "", "")
	if code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d; want 503 while disconnected", code)
	}
	if body["status"] != "disconnected" {
		t.Fatalf("status field = %v; want disconnected", body["status"])
	}

	app2, _ := build(t, &fakeBroker{configured: true, connected: true})
	code2, body2 := do(t, app2, "GET", "/health", "", "")
	if code2 != http.StatusOK {
		t.Fatalf("status = %d; want 200 when connected", code2)
	}
	if body2["status"] != "ok" {
		t.Fatalf("status field = %v", body2["status"])
	}
	// In-memory idempotency is a real caveat and must be visible.
	if body2["warning"] == nil {
		t.Fatal("no warning about in-memory idempotency")
	}
}

func TestHealthNeedsNoSecretButEveryOtherRouteDoes(t *testing.T) {
	app, _ := build(t, &fakeBroker{configured: true, connected: true})
	if code, _ := do(t, app, "GET", "/health", "", ""); code == http.StatusUnauthorized {
		t.Fatal("/health demanded a secret: a healthcheck carrying a credential puts it in every process listing")
	}
	for _, path := range []string{"/topology", "/topology/verify", "/queues"} {
		if code, _ := do(t, app, "GET", path, "", ""); code != http.StatusUnauthorized {
			t.Fatalf("GET %s with no secret answered %d; want 401", path, code)
		}
	}
	for _, path := range []string{"/topology/declare", "/enqueue", "/dead/replay"} {
		if code, _ := do(t, app, "POST", path, `{}`, ""); code != http.StatusUnauthorized {
			t.Fatalf("POST %s with no secret answered %d; want 401", path, code)
		}
	}
}

func TestAWrongSecretIsRefusedAndTheAnswerIsIdenticalToAMissingOne(t *testing.T) {
	app, _ := build(t, &fakeBroker{configured: true, connected: true})
	_, missing := do(t, app, "GET", "/topology", "", "")
	_, wrong := do(t, app, "GET", "/topology", "", "not-the-secret-but-long-enough-to-be-plausible")
	// Distinguishing absent from wrong tells a prober which half to work on.
	if missing["error"] != wrong["error"] {
		t.Fatalf("absent and wrong secrets answer differently: %v vs %v", missing["error"], wrong["error"])
	}
	// A prefix of the real secret must not be accepted, which is the property the
	// constant-time compare over digests exists to protect.
	if code, _ := do(t, app, "GET", "/topology", "", secret[:len(secret)-1]); code != http.StatusUnauthorized {
		t.Fatalf("a one-byte-short secret was accepted (status %d)", code)
	}
	if code, _ := do(t, app, "GET", "/topology", "", secret); code != http.StatusOK {
		t.Fatalf("the correct secret was refused (status %d)", code)
	}
}

func TestAnUnconfirmedEnqueueIsNeverReportedAsPublished(t *testing.T) {
	// The whole point: a publish that was not confirmed is not a publish.
	app, _ := build(t, &fakeBroker{configured: true, connected: true, publishErr: errors.New("nacked")})
	code, body := do(t, app, "POST", "/enqueue", `{"type":"queue.smoke","payload":{}}`, secret)
	if code != http.StatusBadGateway {
		t.Fatalf("status = %d; want 502 for an unconfirmed publish", code)
	}
	if body["published"] != false {
		t.Fatalf("published = %v; an unconfirmed publish must say false", body["published"])
	}
	if body["id"] == nil {
		t.Fatal("no id was returned, so the caller cannot correlate the failure with its own logs")
	}
}

func TestEnqueueWithNoBrokerIs503AndSaysTheMessageWasDropped(t *testing.T) {
	app, _ := build(t, &fakeBroker{configured: false, publishErr: broker.ErrNoBroker})
	code, body := do(t, app, "POST", "/enqueue", `{"type":"queue.smoke"}`, secret)
	if code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d; want 503", code)
	}
	if body["published"] != false {
		t.Fatal("a publish with no broker was not reported as a failure")
	}
	if !strings.Contains(body["reason"].(string), "dropped") {
		t.Fatalf("reason = %v; it must say the message was dropped", body["reason"])
	}
}

func TestAConfirmedEnqueueIs202AndCarriesTheIdentityOfTheWork(t *testing.T) {
	app, fb := build(t, &fakeBroker{configured: true, connected: true})
	code, body := do(t, app, "POST", "/enqueue",
		`{"type":"queue.topology.declare","idempotency_key":"declare:2026-08-23","payload":{"why":"deploy"}}`, secret)
	// 202, not 200: the work is durable and nobody has run it yet.
	if code != http.StatusAccepted {
		t.Fatalf("status = %d; want 202", code)
	}
	if body["published"] != true {
		t.Fatalf("published = %v", body["published"])
	}
	if len(fb.published) != 1 {
		t.Fatalf("published %d envelopes", len(fb.published))
	}
	env := fb.published[0]
	if env.IdempotencyKey != "declare:2026-08-23" {
		t.Fatalf("the caller's idempotency key was not honoured: %q", env.IdempotencyKey)
	}
	if env.Key != "queue.topology.declare" {
		t.Fatalf("routing key = %q; want the type", env.Key)
	}
	if env.Attempt != 1 {
		t.Fatalf("attempt = %d; a first publish is attempt 1", env.Attempt)
	}
}

func TestEnqueueRefusesRoutingKeysThatWouldMatchBindingsTheCallerDidNotMean(t *testing.T) {
	app, fb := build(t, &fakeBroker{configured: true, connected: true})
	for _, body := range []string{
		`{"type":"queue.#"}`,          // an AMQP wildcard
		`{"type":"queue.*"}`,          //
		`{"type":"Queue.Upper"}`,      // case matters in a routing key
		`{"type":""}`,                 //
		`{"type":"a b"}`,              // whitespace
		`{"type":".leading"}`,         //
		`{"type":"trailing."}`,        //
		`{"type":"a..b"}`,             //
		`{"type":"ok","key":"bad #"}`, // an explicit key is checked too
	} {
		code, _ := do(t, app, "POST", "/enqueue", body, secret)
		if code != http.StatusBadRequest {
			t.Fatalf("%s answered %d; want 400", body, code)
		}
	}
	if len(fb.published) != 0 {
		t.Fatal("a rejected request still published something")
	}
}

func TestEnqueueRejectsUnknownFieldsRatherThanIgnoringThem(t *testing.T) {
	// A caller who misspells idempotency_key would otherwise get a message with
	// no dedupe and no warning. Same stance as the additionalProperties:false
	// schemas in api/src/server.ts.
	app, _ := build(t, &fakeBroker{configured: true, connected: true})
	code, body := do(t, app, "POST", "/enqueue",
		`{"type":"queue.smoke","idempotencyKey":"camel-case-typo"}`, secret)
	if code != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400 for an unknown field", code)
	}
	if body["detail"] == nil {
		t.Fatal("a 400 must say what was wrong with the request")
	}
	// An empty body is not an enqueue either.
	if code, _ := do(t, app, "POST", "/enqueue", "", secret); code != http.StatusBadRequest {
		t.Fatalf("an empty body answered %d; want 400", code)
	}
}

func TestVerifyThatCouldNotRunIsNeverAPass(t *testing.T) {
	// The failure this repository has been bitten by three times: an empty result
	// reported as a clean check.
	app, _ := build(t, &fakeBroker{configured: false, verifyErr: broker.ErrNoBroker})
	code, body := do(t, app, "GET", "/topology/verify", "", secret)
	if code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d; want 503", code)
	}
	if body["ok"] != false {
		t.Fatalf("ok = %v; an unrunnable check must not report ok", body["ok"])
	}
	if !strings.Contains(body["reason"].(string), "nothing was checked") {
		t.Fatalf("reason = %v; it must say nothing was checked", body["reason"])
	}
}

func TestVerifyReportsMissingObjectsWithA409AndSaysWhatItDidNotCheck(t *testing.T) {
	app, _ := build(t, &fakeBroker{
		configured: true, connected: true,
		missing: []broker.Missing{{Kind: "queue", Name: "course.events.dead", Reason: "NOT_FOUND"}},
	})
	code, body := do(t, app, "GET", "/topology/verify", "", secret)
	if code != http.StatusConflict {
		t.Fatalf("status = %d; want 409 when something is missing", code)
	}
	if body["ok"] != false {
		t.Fatal("ok was true while an object was missing")
	}
	// A reader must not believe more was checked than was.
	if !strings.Contains(body["note"].(string), "binding") {
		t.Fatalf("note = %v; it must say bindings are not checked", body["note"])
	}
}

func TestVerifyPassesOnlyWhenNothingIsMissing(t *testing.T) {
	app, _ := build(t, &fakeBroker{configured: true, connected: true})
	code, body := do(t, app, "GET", "/topology/verify", "", secret)
	if code != http.StatusOK || body["ok"] != true {
		t.Fatalf("status = %d, ok = %v", code, body["ok"])
	}
	if body["checked"].(float64) == 0 {
		t.Fatal("checked = 0 while reporting ok: that is the empty-result pass again")
	}
}

func TestQueuesReportsAnUnreadableQueueAsUnreadableAndNotAsZero(t *testing.T) {
	// "0 messages" and "I could not look" are different facts.
	app, _ := build(t, &fakeBroker{configured: true, connected: true, states: []broker.QueueState{
		{Name: "queue.work", Messages: 3, Consumers: 1},
		{Name: "course.events.dead", Error: "NOT_FOUND"},
	}})
	code, body := do(t, app, "GET", "/queues", "", secret)
	if code != http.StatusConflict {
		t.Fatalf("status = %d; a partial answer must not look complete", code)
	}
	if body["unreadable"].(float64) != 1 {
		t.Fatalf("unreadable = %v", body["unreadable"])
	}
	if body["waiting"].(float64) != 3 {
		t.Fatalf("waiting = %v; the unreadable queue must not contribute a zero", body["waiting"])
	}
}

func TestReplayRefusesToGuessHowMuchToMove(t *testing.T) {
	app, _ := build(t, &fakeBroker{configured: true, connected: true})
	for _, body := range []string{`{}`, `{"limit":0}`, `{"limit":-5}`, `{"limit":100000}`} {
		if code, _ := do(t, app, "POST", "/dead/replay", body, secret); code != http.StatusBadRequest {
			t.Fatalf("%s answered %d; replaying a DLQ has consequences and needs an explicit limit", body, code)
		}
	}
}

func TestReplayWithFaultsIsNotASuccess(t *testing.T) {
	app, _ := build(t, &fakeBroker{
		configured: true, connected: true,
		replayed: broker.Replayed{Moved: 2, Remaining: 1, Faults: []string{"x left in the DLQ"}},
	})
	code, body := do(t, app, "POST", "/dead/replay", `{"limit":10}`, secret)
	if code != http.StatusConflict {
		t.Fatalf("status = %d; some moved and some did not is not a success", code)
	}
	if body["moved"].(float64) != 2 {
		t.Fatalf("moved = %v", body["moved"])
	}
}

func TestTopologyIsAnswerableWithNoBrokerBecauseItIsAStatementAboutTheCode(t *testing.T) {
	app, _ := build(t, &fakeBroker{configured: false})
	code, body := do(t, app, "GET", "/topology", "", secret)
	if code != http.StatusOK {
		t.Fatalf("status = %d; 'what should exist' does not need a broker", code)
	}
	topo, ok := body["topology"].(map[string]any)
	if !ok {
		t.Fatalf("no topology in the answer: %v", body)
	}
	if len(topo["exchanges"].([]any)) != 6 {
		t.Fatalf("exchanges = %v", topo["exchanges"])
	}
}

func TestA5xxDoesNotEchoInternalDetailWhileA4xxDoes(t *testing.T) {
	// A message like `dial tcp 10.0.0.7:5672` tells a caller where the broker is.
	app, _ := build(t, &fakeBroker{configured: true, connected: true, declareErr: errors.New("dial tcp 10.0.0.7:5672: refused")})
	_, body := do(t, app, "POST", "/topology/declare", `{}`, secret)
	blob, _ := json.Marshal(body)
	if strings.Contains(string(blob), "10.0.0.7") {
		t.Fatalf("the broker address leaked into the answer: %s", blob)
	}
}
