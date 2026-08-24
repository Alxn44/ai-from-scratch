package bus

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// THE ENVELOPE -- keep identical to the block in api/src/bus.ts and
// ai/src/course_ai/bus.py.
//
//	{
//	  "id":              "0f9c1e6a-...",             uuid4, the message identity
//	  "type":            "league.week.close",        what to do / what happened
//	  "key":             "league.week.close",        routing key it went out with
//	  "idempotency_key": "league.week.close:2026-08-17",  the unit of "already done"
//	  "attempt":         1,                          1 on first publish, +1 per retry
//	  "produced_at":     "2026-08-23T14:05:00.000Z", RFC3339, UTC, milliseconds
//	  "payload":         {}                          free-form JSON, per type
//	}
//
// Rules that make the three runtimes interoperable:
//   - snake_case field names, because a third of the readers are Python.
//   - `id` is STABLE across retries: a retry is the same message, later. The AMQP
//     message-id property carries "{id}:{attempt}", which IS unique per publish
//     attempt, so a confirm or a mandatory-return can be correlated without
//     adding a field nobody reads.
//   - `produced_at` is the time of the FIRST publish and is copied forward by
//     retries. That is what makes "this work is 40 minutes old" answerable.
//   - `attempt` is an integer >= 1. `idempotency_key` is what dedupe keys on, so
//     it MUST survive the republish untouched.
//   - unknown extra fields are preserved on retry, so a newer producer can add
//     one without an older consumer dropping it.

// EnvelopeFields is the field list, in order. Asserted by contract.go against
// both sibling runtimes: renaming one here without renaming it there breaks the
// other services silently.
var EnvelopeFields = []string{"id", "type", "key", "idempotency_key", "attempt", "produced_at", "payload"}

// PersistentDeliveryMode is AMQP delivery mode 2: persist to disk. Not
// configurable, in any of the three runtimes -- a message the broker forgets on
// restart is not a message, it is a hope.
const PersistentDeliveryMode = 2

// producedAtLayout is byte-compatible with JavaScript's toISOString() and with
// the Python side's hand-built format: milliseconds, then a literal Z. Go's
// time.RFC3339Nano would print microseconds and drop trailing zeros, so two
// runtimes would produce different bytes for the same instant.
const producedAtLayout = "2006-01-02T15:04:05.000Z"

// ErrMalformedEnvelope is bytes that are not a readable envelope. It cannot be
// retried into readability, so the caller dead-letters it.
var ErrMalformedEnvelope = errors.New("malformed envelope")

// Envelope is the unit that crosses a service boundary.
type Envelope struct {
	ID             string
	Type           string
	Key            string
	IdempotencyKey string
	Attempt        int
	ProducedAt     string
	Payload        map[string]any
	// Extra holds fields a NEWER producer added that this consumer does not
	// know. Kept so a retry republished from here does not silently strip them.
	Extra map[string]any
}

// MarshalJSON writes the seven fields in EnvelopeFields order, then the unknown
// extras, with HTML escaping OFF.
//
// Both of those are required for byte-compatibility, not style. Go's default
// marshaller escapes the three HTML-significant bytes into \u sequences, which
// neither JSON.stringify nor json.dumps(ensure_ascii=False) does -- so a payload
// containing one of them would serialise to different bytes in this runtime than
// in the other two, and any check that compares envelope bytes across runtimes
// would fail for a reason that has nothing to do with the message.
func (e Envelope) MarshalJSON() ([]byte, error) {
	var out bytes.Buffer
	out.WriteByte('{')
	write := func(name string, v any) error {
		if out.Len() > 1 {
			out.WriteByte(',')
		}
		k, err := encodeNoEscape(name)
		if err != nil {
			return err
		}
		out.Write(k)
		out.WriteByte(':')
		b, err := encodeNoEscape(v)
		if err != nil {
			return fmt.Errorf("envelope field %q: %w", name, err)
		}
		out.Write(b)
		return nil
	}
	payload := e.Payload
	if payload == nil {
		// An absent payload is `{}` on the wire, never `null`: the other two
		// runtimes reject a null payload as malformed, so emitting one would
		// produce a message only this runtime can read.
		payload = map[string]any{}
	}
	fields := []struct {
		name string
		val  any
	}{
		{"id", e.ID},
		{"type", e.Type},
		{"key", e.Key},
		{"idempotency_key", e.IdempotencyKey},
		{"attempt", e.Attempt},
		{"produced_at", e.ProducedAt},
		{"payload", payload},
	}
	for _, f := range fields {
		if err := write(f.name, f.val); err != nil {
			return nil, err
		}
	}
	for _, k := range sortedKeys(e.Extra) {
		// A newer producer's field cannot be allowed to overwrite one of the
		// seven: that would let an unknown field change the routing key or the
		// attempt count on a republish.
		if isEnvelopeField(k) {
			continue
		}
		if err := write(k, e.Extra[k]); err != nil {
			return nil, err
		}
	}
	out.WriteByte('}')
	return out.Bytes(), nil
}

func encodeNoEscape(v any) ([]byte, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	// Encode appends a newline that Marshal does not.
	return bytes.TrimRight(b.Bytes(), "\n"), nil
}

func isEnvelopeField(name string) bool {
	for _, f := range EnvelopeFields {
		if f == name {
			return true
		}
	}
	return false
}

// NewEnvelopeOptions is the argument set of NewEnvelope. A struct rather than
// six positional parameters, because `key` and `idempotencyKey` are both
// optional strings and swapping them at a call site would compile.
type NewEnvelopeOptions struct {
	Type           string
	Payload        map[string]any
	Key            string
	IdempotencyKey string
	Attempt        int
	ID             string
	ProducedAt     string
	// Now is injectable so a test can assert the timestamp format without
	// sleeping or matching a regexp against the real clock.
	Now func() time.Time
}

// NewEnvelope builds an envelope, filling the defaults the contract specifies.
func NewEnvelope(o NewEnvelopeOptions) (Envelope, error) {
	if o.Type == "" {
		return Envelope{}, errors.New("bus: envelope needs a type")
	}
	now := o.Now
	if now == nil {
		now = time.Now
	}
	// The id is generated FIRST because the default idempotency key is derived
	// from it. Deriving it from the ID *parameter* instead gave every message of
	// a type the same key ("type:auto"), so two unrelated publishes deduped into
	// one and the second was acked without ever running. That bug is recorded in
	// api/src/bus.ts; it is not repeated here.
	id := o.ID
	if id == "" {
		id = uuid.NewString()
	}
	key := o.Key
	if key == "" {
		key = o.Type
	}
	idem := o.IdempotencyKey
	if idem == "" {
		// The safe default is "this publish is its own unit of work": dedupe
		// only collapses two messages when the caller says what "the same work"
		// means.
		idem = o.Type + ":" + id
	}
	attempt := o.Attempt
	if attempt < 1 {
		attempt = 1
	}
	producedAt := o.ProducedAt
	if producedAt == "" {
		producedAt = now().UTC().Format(producedAtLayout)
	}
	payload := o.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	return Envelope{
		ID:             id,
		Type:           o.Type,
		Key:            key,
		IdempotencyKey: idem,
		Attempt:        attempt,
		ProducedAt:     producedAt,
		Payload:        payload,
	}, nil
}

// NextAttempt is the same message, one attempt later. id, idempotency_key and
// produced_at are kept: a retry is the same work, later, not new work.
func (e Envelope) NextAttempt() Envelope {
	next := e
	next.Attempt = e.Attempt + 1
	// The maps are shared with the original on purpose -- a retry carries the
	// same payload bytes -- but Extra is copied because the republish path is
	// the one place that could otherwise mutate a caller's map.
	if e.Extra != nil {
		next.Extra = make(map[string]any, len(e.Extra))
		for k, v := range e.Extra {
			next.Extra[k] = v
		}
	}
	return next
}

// MessageID is the AMQP message-id property: unique per publish ATTEMPT, while
// Envelope.ID is stable across them. That is what lets a confirm or a
// mandatory-return be matched to the exact publish it belongs to.
func (e Envelope) MessageID() string {
	return fmt.Sprintf("%s:%d", e.ID, e.Attempt)
}

// Headers are the AMQP headers every publish carries. They duplicate two
// envelope fields on purpose: a human reading a queue in the management UI sees
// the attempt and the idempotency key without opening the body.
func (e Envelope) Headers() map[string]any {
	return map[string]any{
		"x-bus-attempt":         e.Attempt,
		"x-bus-idempotency-key": e.IdempotencyKey,
	}
}

// Timestamp is the AMQP timestamp property: the FIRST publish, to the second.
// An unparseable produced_at falls back to now rather than to the zero time,
// which the broker would show as 1970 and a reader would take for corruption.
func (e Envelope) Timestamp() time.Time {
	t, err := time.Parse(producedAtLayout, e.ProducedAt)
	if err != nil {
		if t, err = time.Parse(time.RFC3339Nano, e.ProducedAt); err != nil {
			return time.Now().UTC()
		}
	}
	return t
}

// ParseEnvelope reads bytes off the wire. Every failure is
// ErrMalformedEnvelope, because the caller's only correct response to any of
// them is the same: dead-letter it, do not retry it.
func ParseEnvelope(b []byte) (Envelope, error) {
	bad := func(format string, a ...any) (Envelope, error) {
		return Envelope{}, fmt.Errorf("%w: %s", ErrMalformedEnvelope, fmt.Sprintf(format, a...))
	}
	var raw map[string]json.RawMessage
	// UseNumber is not needed here because every numeric field is read
	// explicitly below, but a decoder is used rather than Unmarshal so that
	// trailing garbage after a valid object is an error and not ignored bytes.
	dec := json.NewDecoder(bytes.NewReader(b))
	if err := dec.Decode(&raw); err != nil {
		return bad("not a JSON object: %v", err)
	}
	if raw == nil {
		return bad("envelope is null")
	}
	str := func(name string) (string, error) {
		v, ok := raw[name]
		if !ok {
			return "", fmt.Errorf("field %q missing", name)
		}
		var s string
		if err := json.Unmarshal(v, &s); err != nil || s == "" {
			return "", fmt.Errorf("field %q missing", name)
		}
		return s, nil
	}
	var e Envelope
	var err error
	if e.ID, err = str("id"); err != nil {
		return bad("%v", err)
	}
	if e.Type, err = str("type"); err != nil {
		return bad("%v", err)
	}
	if e.Key, err = str("key"); err != nil {
		return bad("%v", err)
	}
	if e.IdempotencyKey, err = str("idempotency_key"); err != nil {
		return bad("%v", err)
	}
	if e.ProducedAt, err = str("produced_at"); err != nil {
		return bad("%v", err)
	}
	// The attempt must be a JSON NUMBER, not a string that looks like one.
	//
	// The quote check is not belt-and-braces: json.Number is a string type, and
	// Go's decoder happily accepts `"attempt":"1"` into one. The other two
	// runtimes both reject that -- bus.ts with Number.isInteger and bus.py with
	// isinstance(attempt, int) -- so accepting it here would let this runtime
	// read a message the other two dead-letter, which is worse than either
	// behaviour on its own. Found by envelope_test.go, not by review.
	av, ok := raw["attempt"]
	if !ok {
		return bad(`field "attempt" invalid`)
	}
	if trimmed := bytes.TrimSpace(av); len(trimmed) == 0 || trimmed[0] == '"' {
		return bad(`field "attempt" invalid`)
	}
	var num json.Number
	if err := json.Unmarshal(av, &num); err != nil {
		return bad(`field "attempt" invalid`)
	}
	n, err := num.Int64()
	if err != nil || n < 1 {
		return bad(`field "attempt" invalid`)
	}
	e.Attempt = int(n)
	v, ok := raw["payload"]
	if !ok {
		return bad(`field "payload" invalid`)
	}
	if err := json.Unmarshal(v, &e.Payload); err != nil || e.Payload == nil {
		return bad(`field "payload" invalid`)
	}
	for k, rv := range raw {
		if isEnvelopeField(k) {
			continue
		}
		var any_ any
		if err := json.Unmarshal(rv, &any_); err != nil {
			return bad("extra field %q is not JSON: %v", k, err)
		}
		if e.Extra == nil {
			e.Extra = map[string]any{}
		}
		e.Extra[k] = any_
	}
	return e, nil
}
