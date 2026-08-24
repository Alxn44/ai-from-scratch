package bus

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestTheEnvelopeSerialisesTheSevenFieldsInContractOrder(t *testing.T) {
	env, err := NewEnvelope(NewEnvelopeOptions{
		Type: "league.week.close", IdempotencyKey: "league:2026-08-17",
		Payload: map[string]any{"week": 34},
		ID:      "fixed-id", ProducedAt: "2026-08-23T14:05:00.000Z",
	})
	if err != nil {
		t.Fatal(err)
	}
	b, err := env.MarshalJSON()
	if err != nil {
		t.Fatal(err)
	}
	want := `{"id":"fixed-id","type":"league.week.close","key":"league.week.close",` +
		`"idempotency_key":"league:2026-08-17","attempt":1,` +
		`"produced_at":"2026-08-23T14:05:00.000Z","payload":{"week":34}}`
	if string(b) != want {
		t.Fatalf("bytes differ from the two sibling runtimes.\n got: %s\nwant: %s", b, want)
	}
}

func TestPayloadBytesAreNotHTMLEscaped(t *testing.T) {
	// Go escapes < > & by default; JSON.stringify and json.dumps(ensure_ascii=
	// False) do not. Left on, the same message would be different bytes here.
	env, _ := NewEnvelope(NewEnvelopeOptions{
		Type: "x.y", ID: "i", ProducedAt: "2026-01-01T00:00:00.000Z",
		Payload: map[string]any{"html": "<b>&</b>"},
	})
	b, err := env.MarshalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `<b>&</b>`) {
		t.Fatalf("the payload was escaped: %s", b)
	}
}

func TestAnAbsentPayloadIsAnEmptyObjectAndNeverNull(t *testing.T) {
	// Both sibling runtimes reject a null payload as malformed, so emitting one
	// would produce a message only this runtime can read.
	env := Envelope{ID: "i", Type: "t", Key: "t", IdempotencyKey: "k", Attempt: 1, ProducedAt: "p"}
	b, err := env.MarshalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"payload":{}`) {
		t.Fatalf("payload was not {}: %s", b)
	}
	if _, err := ParseEnvelope(b); err != nil {
		t.Fatalf("this runtime produced bytes it cannot itself read: %v", err)
	}
}

func TestTheDefaultIdempotencyKeyIsDerivedFromTheGeneratedID(t *testing.T) {
	// The bug this guards is recorded in api/src/bus.ts: deriving the key from
	// the ID PARAMETER gave every message of a type the same key, so two
	// unrelated publishes deduped into one and the second never ran.
	a, _ := NewEnvelope(NewEnvelopeOptions{Type: "work.do"})
	b, _ := NewEnvelope(NewEnvelopeOptions{Type: "work.do"})
	if a.IdempotencyKey == b.IdempotencyKey {
		t.Fatalf("two unrelated publishes share the key %q: the second would be deduped away", a.IdempotencyKey)
	}
	if a.IdempotencyKey != "work.do:"+a.ID {
		t.Fatalf("key = %q; want type:id", a.IdempotencyKey)
	}
}

func TestTheRoutingKeyDefaultsToTheTypeAndTheAttemptFloorIsOne(t *testing.T) {
	e, _ := NewEnvelope(NewEnvelopeOptions{Type: "a.b", Attempt: 0})
	if e.Key != "a.b" {
		t.Fatalf("key = %q; want the type", e.Key)
	}
	if e.Attempt != 1 {
		t.Fatalf("attempt = %d; want a floor of 1", e.Attempt)
	}
	if _, err := NewEnvelope(NewEnvelopeOptions{Type: ""}); err == nil {
		t.Fatal("an envelope with no type was accepted")
	}
}

func TestProducedAtHasMillisecondsAndATrailingZ(t *testing.T) {
	fixed := time.Date(2026, 8, 23, 14, 5, 0, 123_456_789, time.UTC)
	e, _ := NewEnvelope(NewEnvelopeOptions{Type: "a.b", Now: func() time.Time { return fixed }})
	if e.ProducedAt != "2026-08-23T14:05:00.123Z" {
		t.Fatalf("produced_at = %q; want JS toISOString() format", e.ProducedAt)
	}
}

func TestARetryIsTheSameMessageLater(t *testing.T) {
	first, _ := NewEnvelope(NewEnvelopeOptions{
		Type: "a.b", ID: "same", IdempotencyKey: "k", ProducedAt: "2026-01-01T00:00:00.000Z",
	})
	next := first.NextAttempt()
	if next.ID != first.ID {
		t.Fatal("the id changed on retry: a retry is the same message, later")
	}
	if next.ProducedAt != first.ProducedAt {
		t.Fatal("produced_at moved: 'this work is 40 minutes old' is no longer answerable")
	}
	if next.IdempotencyKey != first.IdempotencyKey {
		t.Fatal("the idempotency key changed, so the retry would not dedupe against the original")
	}
	if next.Attempt != 2 {
		t.Fatalf("attempt = %d; want 2", next.Attempt)
	}
	// The AMQP message id, by contrast, MUST differ per attempt: that is what
	// makes a confirm or a return correlatable to one publish.
	if first.MessageID() == next.MessageID() {
		t.Fatalf("both attempts share the message id %q", first.MessageID())
	}
	if first.MessageID() != "same:1" || next.MessageID() != "same:2" {
		t.Fatalf("message ids = %q, %q; want same:1 and same:2", first.MessageID(), next.MessageID())
	}
}

func TestUnknownFieldsSurviveARetry(t *testing.T) {
	// A newer producer must be able to add a field without an older consumer
	// silently stripping it on the republish.
	raw := []byte(`{"id":"i","type":"t","key":"t","idempotency_key":"k","attempt":1,` +
		`"produced_at":"2026-01-01T00:00:00.000Z","payload":{},"tenant":"co","trace":{"span":"a"}}`)
	env, err := ParseEnvelope(raw)
	if err != nil {
		t.Fatal(err)
	}
	if env.Extra["tenant"] != "co" {
		t.Fatalf("extras = %v; the unknown field was dropped at parse time", env.Extra)
	}
	out, err := env.NextAttempt().MarshalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), `"tenant":"co"`) || !strings.Contains(string(out), `"span":"a"`) {
		t.Fatalf("the republish dropped an unknown field: %s", out)
	}
}

func TestAnExtraFieldCannotOverwriteOneOfTheSeven(t *testing.T) {
	// Otherwise an unknown field could change the routing key or the attempt
	// count on a republish.
	env := Envelope{
		ID: "i", Type: "t", Key: "t", IdempotencyKey: "k", Attempt: 1, ProducedAt: "p",
		Extra: map[string]any{"attempt": 99, "key": "hijacked"},
	}
	b, err := env.MarshalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "hijacked") || strings.Contains(string(b), "99") {
		t.Fatalf("an extra field overwrote a contract field: %s", b)
	}
	back, err := ParseEnvelope(b)
	if err != nil {
		t.Fatal(err)
	}
	if back.Attempt != 1 || back.Key != "t" {
		t.Fatalf("round trip changed the contract fields: %+v", back)
	}
}

func TestParseRejectsEveryShapeThatIsNotAnEnvelope(t *testing.T) {
	base := `"id":"i","type":"t","key":"t","idempotency_key":"k","attempt":1,"produced_at":"p","payload":{}`
	bad := map[string]string{
		"not json":           `nope`,
		"not an object":      `[1,2]`,
		"null":               `null`,
		"missing id":         `{"type":"t","key":"t","idempotency_key":"k","attempt":1,"produced_at":"p","payload":{}}`,
		"empty id":           `{"id":"","type":"t","key":"t","idempotency_key":"k","attempt":1,"produced_at":"p","payload":{}}`,
		"missing type":       `{"id":"i","key":"t","idempotency_key":"k","attempt":1,"produced_at":"p","payload":{}}`,
		"missing key":        `{"id":"i","type":"t","idempotency_key":"k","attempt":1,"produced_at":"p","payload":{}}`,
		"missing idem":       `{"id":"i","type":"t","key":"t","attempt":1,"produced_at":"p","payload":{}}`,
		"missing producedAt": `{"id":"i","type":"t","key":"t","idempotency_key":"k","attempt":1,"payload":{}}`,
		"attempt zero":       `{` + strings.Replace(base, `"attempt":1`, `"attempt":0`, 1) + `}`,
		"attempt negative":   `{` + strings.Replace(base, `"attempt":1`, `"attempt":-3`, 1) + `}`,
		"attempt float":      `{` + strings.Replace(base, `"attempt":1`, `"attempt":1.5`, 1) + `}`,
		"attempt string":     `{` + strings.Replace(base, `"attempt":1`, `"attempt":"1"`, 1) + `}`,
		"attempt bool":       `{` + strings.Replace(base, `"attempt":1`, `"attempt":true`, 1) + `}`,
		"payload null":       `{` + strings.Replace(base, `"payload":{}`, `"payload":null`, 1) + `}`,
		"payload array":      `{` + strings.Replace(base, `"payload":{}`, `"payload":[]`, 1) + `}`,
		"payload string":     `{` + strings.Replace(base, `"payload":{}`, `"payload":"x"`, 1) + `}`,
		"missing payload":    `{"id":"i","type":"t","key":"t","idempotency_key":"k","attempt":1,"produced_at":"p"}`,
	}
	for name, body := range bad {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseEnvelope([]byte(body)); err == nil {
				t.Fatalf("accepted %s: %s", name, body)
			}
		})
	}
	// And the good one really is good, so the table above is not passing by
	// rejecting everything.
	if _, err := ParseEnvelope([]byte(`{` + base + `}`)); err != nil {
		t.Fatalf("rejected a valid envelope: %v", err)
	}
}

func TestTheHeadersCarryTheAttemptAndTheIdempotencyKey(t *testing.T) {
	// So a human reading a queue in the management UI sees both without opening
	// the body.
	env, _ := NewEnvelope(NewEnvelopeOptions{Type: "t", IdempotencyKey: "league:2026-08-17", Attempt: 3})
	h := env.Headers()
	if h["x-bus-attempt"] != 3 {
		t.Fatalf("x-bus-attempt = %v; want 3", h["x-bus-attempt"])
	}
	if h["x-bus-idempotency-key"] != "league:2026-08-17" {
		t.Fatalf("x-bus-idempotency-key = %v", h["x-bus-idempotency-key"])
	}
}

func TestTheTimestampFallsBackToNowRatherThanTo1970(t *testing.T) {
	env := Envelope{ProducedAt: "not a time"}
	if got := env.Timestamp(); got.Year() < 2020 {
		t.Fatalf("timestamp = %v; a 1970 timestamp reads as corruption", got)
	}
	env.ProducedAt = "2026-08-23T14:05:00.000Z"
	if got := env.Timestamp().UTC().Format(time.RFC3339); got != "2026-08-23T14:05:00Z" {
		t.Fatalf("timestamp = %v", got)
	}
}

func TestTheEnvelopeRoundTripsThroughEncodingJSON(t *testing.T) {
	// json.Marshal must go through MarshalJSON, not through the struct tags,
	// or the wire format would depend on which call site serialised it.
	env, _ := NewEnvelope(NewEnvelopeOptions{Type: "a.b", ID: "i", ProducedAt: "2026-01-01T00:00:00.000Z"})
	b, err := json.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(b), `{"id":"i","type":"a.b"`) {
		t.Fatalf("json.Marshal did not use the contract order: %s", b)
	}
}

// TestAnArrayPayloadIsRejected records a decision, not just a behaviour, because
// THE TWO EXISTING RUNTIMES DISAGREE WITH EACH OTHER HERE.
//
//	api/src/bus.ts:376   if (raw.payload == null || typeof raw.payload !== 'object')
//	                     `typeof [] === 'object'`, so an ARRAY payload is ACCEPTED.
//	bus.py:304           if not isinstance(payload, dict)
//	                     an array payload is REJECTED as malformed.
//
// So `{"payload": []}` is a valid message to Node and a dead letter to Python.
// Whichever service happens to consume it decides whether the work runs. Nothing
// currently publishes an array payload, which is why it has never been noticed.
//
// This runtime follows PYTHON, deliberately, for two reasons: the envelope
// documents `payload` as an object in all three headers ("free-form JSON, per
// type"), and of the two available behaviours the strict one cannot invent a
// silent divergence -- a publisher that sends an array gets a dead letter from
// two of three consumers instead of a coin flip.
//
// Reported upward rather than papered over: the fix belongs in bus.ts, whose
// check should be `typeof x === 'object' && !Array.isArray(x)`.
func TestAnArrayPayloadIsRejected(t *testing.T) {
	raw := []byte(`{"id":"i","type":"t","key":"t","idempotency_key":"k","attempt":1,` +
		`"produced_at":"2026-01-01T00:00:00.000Z","payload":[]}`)
	if _, err := ParseEnvelope(raw); err == nil {
		t.Fatal("an array payload was accepted; this runtime follows bus.py and rejects it")
	}
	// And the object case still works, so the check above is not rejecting
	// everything.
	ok := []byte(`{"id":"i","type":"t","key":"t","idempotency_key":"k","attempt":1,` +
		`"produced_at":"2026-01-01T00:00:00.000Z","payload":{"a":1}}`)
	if _, err := ParseEnvelope(ok); err != nil {
		t.Fatalf("an object payload was rejected: %v", err)
	}
}
