// Package httpapi is the Fiber surface: enqueueing work, inspecting state, and
// one health endpoint that is allowed to say no.
//
// WHAT IS DELIBERATELY NOT HERE. No route reads a lesson, an attempt, a user or
// a payment, and no route opens a database. This service's whole claim to
// existing is that it owns the transport and nothing else; the moment a handler
// here needs a row, the responsibility it is implementing belongs to `api`.
package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"time"

	"github.com/gofiber/fiber/v3"

	"course/queue/broker"
	"course/queue/bus"
	"course/queue/internal/config"
)

// Deps is what the HTTP layer is allowed to touch. An explicit struct rather
// than package globals, so a test builds a server over fakes and so it is
// visible at a glance that a database is not in the list.
type Deps struct {
	Config config.Config
	// Client publishes and inspects. An interface, so the tests do not need a
	// broker to exercise every branch of every route.
	Client Broker
	// Topology is what this service declares and verifies.
	Topology bus.Topology
	// Stats reports the consumer's counters. Nil when this process does not
	// consume, in which case /health says so instead of reporting zeros.
	Stats func() (bus.Stats, bool)
	// ConsumerHealth reports the consuming connection separately from the
	// publishing one: they are different sockets and either can be down alone.
	ConsumerHealth func() broker.Health
	// DurableClaims reports whether idempotency survives a restart.
	DurableClaims bool
	Log           *slog.Logger
	Started       time.Time
	// Version identifies the build in /health, so an operator can tell which
	// code is answering.
	Version string
}

// Broker is the slice of the broker client this package uses.
type Broker interface {
	Configured() bool
	Health() broker.Health
	EnsureConnected(context.Context) error
	Publish(ctx context.Context, exchange, key string, env bus.Envelope) error
	Declare(ctx context.Context, topo bus.Topology) error
	Verify(ctx context.Context, topo bus.Topology) ([]broker.Missing, error)
	Inspect(ctx context.Context, names []string) ([]broker.QueueState, error)
	ReplayDeadLetters(ctx context.Context, limit int) (broker.Replayed, error)
}

// requestTimeout bounds every broker operation a request can start. A handler
// that never returns is a request that holds a connection forever, and this is
// the ceiling that makes it impossible.
const requestTimeout = 15 * time.Second

// maxBody caps an enqueue payload. A queue is not a blob store, and an
// unbounded body is a memory amplifier: one request becomes prefetch copies in
// every consumer of that routing key.
const maxBody = 256 * 1024

// routingName is what a message type and a routing key are allowed to look like.
// Restrictive on purpose: an unchecked string here becomes an AMQP routing key,
// and `#` or `*` in one would match bindings the caller never intended.
var routingName = regexp.MustCompile(`^[a-z0-9]+(?:[._-][a-z0-9]+)*$`)

const maxNameLen = 200

// New builds the Fiber app.
func New(d Deps) *fiber.App {
	if d.Log == nil {
		d.Log = slog.Default()
	}
	if d.Started.IsZero() {
		d.Started = time.Now().UTC()
	}
	app := fiber.New(fiber.Config{
		AppName:   "queue",
		BodyLimit: maxBody,
		// Reading a request must not be able to hang a worker thread: a slow
		// client that opens a connection and sends one byte is otherwise free.
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		ErrorHandler: func(c fiber.Ctx, err error) error {
			var fe *fiber.Error
			code := fiber.StatusInternalServerError
			if errors.As(err, &fe) {
				code = fe.Code
			}
			d.Log.Error("request failed", "path", c.Path(), "status", code, "error", err)
			body := fiber.Map{"error": errorCode(code)}
			// A 4xx is a statement about the REQUEST, so the detail is the
			// caller's own input and telling them is the whole point. A 5xx is a
			// statement about us, and its text -- `dial tcp 10.0.0.7:5672` --
			// would tell a caller where the broker lives. Only the first is
			// echoed.
			if code >= 400 && code < 500 && fe != nil && fe.Message != "" {
				body["detail"] = fe.Message
			}
			return c.Status(code).JSON(body)
		},
	})

	// ---------------------------------------------------------------------
	// HEALTH. No secret, on purpose: a healthcheck that carries a credential
	// puts that credential in a compose file, in a Kubernetes probe and in
	// every process listing. Nothing here is sensitive -- the broker URL is
	// redacted and no counter identifies a person.
	//
	// It can FAIL, which is the entire point. A health endpoint that always
	// answers ok is decoration: it turns a broker outage into a green dashboard.
	app.Get("/health", func(c fiber.Ctx) error {
		// A publisher reconnects lazily on its next write. Probe it here with a
		// short deadline so a broker restart becomes a truthful health result
		// instead of a permanent false negative while the consumer is healthy.
		if d.Client.Configured() && !d.Client.Health().Connected {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			_ = d.Client.EnsureConnected(ctx)
			cancel()
		}
		pub := d.Client.Health()
		body := fiber.Map{
			"service":        "queue",
			"version":        d.Version,
			"uptime_s":       int(time.Since(d.Started).Seconds()),
			"exchange":       d.Config.Exchange,
			"publisher":      pub,
			"durable_claims": d.DurableClaims,
		}
		if d.ConsumerHealth != nil {
			body["consumer"] = d.ConsumerHealth()
		}
		if d.Stats != nil {
			if s, ok := d.Stats(); ok {
				body["stats"] = s
			}
		} else {
			// Not "zero": this process does not consume, and saying zero would
			// read as "consuming, nothing arrived".
			body["stats"] = nil
		}

		switch {
		case !d.Client.Configured():
			// Up, and knowingly useless. 503 rather than 200: an orchestrator
			// must not route work to a queue service with no broker.
			body["status"] = "no_broker"
			body["detail"] = "AMQP_URL is not set: nothing can be published, verified or consumed"
			return c.Status(fiber.StatusServiceUnavailable).JSON(body)
		case !pub.Connected:
			body["status"] = "disconnected"
			body["detail"] = "a broker is configured but this process is not connected to it"
			return c.Status(fiber.StatusServiceUnavailable).JSON(body)
		default:
			body["status"] = "ok"
			// A warning that does not change the status code, because the
			// service does work correctly -- it just forgets across a restart.
			if !d.DurableClaims {
				body["warning"] = "idempotency is IN MEMORY (BUS_CLAIM_URL unset): a redelivery after a restart can run a handler twice"
			}
			return c.JSON(body)
		}
	})

	// Everything below proves it is a sibling service first.
	api := app.Group("/", requireService(d))

	// The topology this service believes in, as data. Answerable with no broker,
	// because "what should exist" is a different question from "what does".
	api.Get("/topology", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{"exchange": d.Config.Exchange, "topology": d.Topology})
	})

	api.Post("/topology/declare", func(c fiber.Ctx) error {
		ctx, cancel := context.WithTimeout(c.Context(), requestTimeout)
		defer cancel()
		if err := d.Client.Declare(ctx, d.Topology); err != nil {
			return brokerFailure(c, "declare", err)
		}
		return c.JSON(fiber.Map{"declared": true,
			"exchanges": len(d.Topology.Exchanges),
			"queues":    len(d.Topology.Queues),
			"bindings":  len(d.Topology.Bindings)})
	})

	// Verification, and it is allowed to fail. An empty answer is never a pass:
	// if the broker cannot be reached, this is a 503 with the reason, not
	// `{"ok": true, "missing": []}`.
	api.Get("/topology/verify", func(c fiber.Ctx) error {
		ctx, cancel := context.WithTimeout(c.Context(), requestTimeout)
		defer cancel()
		missing, err := d.Client.Verify(ctx, d.Topology)
		if err != nil {
			return brokerFailure(c, "verify", err)
		}
		body := fiber.Map{
			"ok":      len(missing) == 0,
			"checked": len(d.Topology.Exchanges) + len(d.Topology.Queues),
			"missing": missing,
			// Said on every answer, not buried in a doc: a reader must not
			// believe more was checked than was.
			"note": "exchanges and queues are checked passively; AMQP has no passive binding query, so bindings are not checked here",
		}
		if len(missing) > 0 {
			return c.Status(fiber.StatusConflict).JSON(body)
		}
		return c.JSON(body)
	})

	// Observability over what is in flight.
	api.Get("/queues", func(c fiber.Ctx) error {
		ctx, cancel := context.WithTimeout(c.Context(), requestTimeout)
		defer cancel()
		names := make([]string, 0, len(d.Topology.Queues))
		for _, q := range d.Topology.Queues {
			names = append(names, q.Name)
		}
		states, err := d.Client.Inspect(ctx, names)
		if err != nil {
			return brokerFailure(c, "inspect", err)
		}
		total, unreadable := 0, 0
		for _, s := range states {
			if s.Error != "" {
				unreadable++
				continue
			}
			total += s.Messages
		}
		body := fiber.Map{
			"queues":      states,
			"waiting":     total,
			"unreadable":  unreadable,
			"dead_letter": bus.DLQ(d.Config.Exchange),
		}
		if unreadable > 0 {
			// A partial answer must not look like a complete one.
			return c.Status(fiber.StatusConflict).JSON(body)
		}
		return c.JSON(body)
	})

	api.Post("/enqueue", func(c fiber.Ctx) error {
		var req struct {
			Type           string         `json:"type"`
			Key            string         `json:"key"`
			IdempotencyKey string         `json:"idempotency_key"`
			Payload        map[string]any `json:"payload"`
		}
		if err := strictJSON(c.Body(), &req); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, err.Error())
		}
		if err := validName("type", req.Type); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, err.Error())
		}
		if req.Key != "" {
			if err := validName("key", req.Key); err != nil {
				return fiber.NewError(fiber.StatusBadRequest, err.Error())
			}
		}
		if len(req.IdempotencyKey) > maxNameLen {
			return fiber.NewError(fiber.StatusBadRequest, "idempotency_key is too long")
		}
		env, err := bus.NewEnvelope(bus.NewEnvelopeOptions{
			Type:           req.Type,
			Key:            req.Key,
			IdempotencyKey: req.IdempotencyKey,
			Payload:        req.Payload,
		})
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, err.Error())
		}
		ctx, cancel := context.WithTimeout(c.Context(), requestTimeout)
		defer cancel()
		if err := d.Client.Publish(ctx, d.Config.Exchange, env.Key, env); err != nil {
			// A publish that was not confirmed is NOT a publish, and this
			// answer must never be mistaken for one. The id is returned anyway
			// so the caller can correlate its own logs with this failure.
			d.Log.Error("enqueue not confirmed", "type", env.Type, "id", env.ID, "error", err)
			status := fiber.StatusBadGateway
			reason := "the broker did not confirm the message"
			if errors.Is(err, broker.ErrNoBroker) {
				status = fiber.StatusServiceUnavailable
				reason = "no broker is configured: the message was dropped"
			}
			return c.Status(status).JSON(fiber.Map{
				"published": false, "id": env.ID, "reason": reason,
			})
		}
		// 202, not 200: the work is accepted and durable, and nobody has run it
		// yet. A 200 would imply it is done.
		return c.Status(fiber.StatusAccepted).JSON(fiber.Map{
			"published":       true,
			"id":              env.ID,
			"type":            env.Type,
			"key":             env.Key,
			"idempotency_key": env.IdempotencyKey,
		})
	})

	api.Post("/dead/replay", func(c fiber.Ctx) error {
		var req struct {
			Limit int `json:"limit"`
		}
		if len(c.Body()) > 0 {
			if err := strictJSON(c.Body(), &req); err != nil {
				return fiber.NewError(fiber.StatusBadRequest, err.Error())
			}
		}
		// No default of "all". Replaying a dead-letter queue is an action with
		// consequences, and the caller has to say how much of it they mean.
		if req.Limit <= 0 || req.Limit > 1000 {
			return fiber.NewError(fiber.StatusBadRequest, "limit must be between 1 and 1000")
		}
		ctx, cancel := context.WithTimeout(c.Context(), requestTimeout)
		defer cancel()
		out, err := d.Client.ReplayDeadLetters(ctx, req.Limit)
		if err != nil {
			return brokerFailure(c, "replay", err)
		}
		if len(out.Faults) > 0 {
			// Some moved, some did not. That is not a success.
			return c.Status(fiber.StatusConflict).JSON(out)
		}
		return c.JSON(out)
	})

	return app
}

// requireService is the service-to-service gate.
//
// The secret is compared in CONSTANT TIME, never with ==. String equality
// short-circuits at the first differing byte, so how long the answer takes leaks
// how many leading bytes of a guess were right, and the secret falls one byte at
// a time over enough requests.
//
// Both sides are hashed first so the comparison always runs over two 32-byte
// buffers. The obvious length guard -- returning early when the lengths differ --
// would put the secret's length back on the wire as a fast path that skips the
// constant-time compare entirely. Hashing removes the length from the comparison
// instead of branching on it.
//
// Queue's HTTP surface uses `x-queue-secreto` and `QUEUE_SECRETO`, distinct from
// the AI bridge identity. The API claim route is the only caller of this secret.
func requireService(d Deps) fiber.Handler {
	want := sha256.Sum256([]byte(d.Config.Secret))
	configured := d.Config.Secret != ""
	return func(c fiber.Ctx) error {
		// A missing secret is our own configuration, not attacker input, so
		// answering early leaks nothing about the request. config.Load refuses
		// to produce this state outside development, so it should be
		// unreachable -- and it still refuses rather than allowing.
		if !configured {
			return c.Status(fiber.StatusServiceUnavailable).
				JSON(fiber.Map{"error": "this service has no QUEUE_SECRETO and cannot authenticate anybody"})
		}
		got := sha256.Sum256([]byte(c.Get("x-queue-secreto")))
		if subtle.ConstantTimeCompare(got[:], want[:]) != 1 {
			// The same answer for absent, malformed and wrong. Distinguishing
			// them tells a prober which half of the problem to work on.
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "no_es_el_servicio"})
		}
		return c.Next()
	}
}

// brokerFailure turns a broker error into an answer that cannot be read as
// success. Every one of these paths used to be the place a tool printed an empty
// result and exited zero.
func brokerFailure(c fiber.Ctx, what string, err error) error {
	status := fiber.StatusBadGateway
	reason := fmt.Sprintf("%s failed: the broker could not be reached", what)
	if errors.Is(err, broker.ErrNoBroker) {
		status = fiber.StatusServiceUnavailable
		reason = fmt.Sprintf("%s is impossible: AMQP_URL is not set, so nothing was checked", what)
	}
	return c.Status(status).JSON(fiber.Map{"ok": false, "reason": reason})
}

// strictJSON rejects unknown fields, the same stance as the
// `additionalProperties: false` schemas in api/src/server.ts: a field nobody
// reads must not arrive silently, because a caller who misspells `idempotency_key`
// would otherwise get a message with no dedupe and no warning.
func strictJSON(body []byte, into any) error {
	if len(body) == 0 {
		return errors.New("a JSON body is required")
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		return fmt.Errorf("unreadable JSON body: %w", err)
	}
	return nil
}

func validName(field, v string) error {
	if v == "" {
		return fmt.Errorf("%s is required", field)
	}
	if len(v) > maxNameLen {
		return fmt.Errorf("%s is longer than %d characters", field, maxNameLen)
	}
	if !routingName.MatchString(v) {
		return fmt.Errorf("%s must be lowercase words joined by . _ or - (got %q)", field, v)
	}
	return nil
}

func errorCode(code int) string {
	switch code {
	case fiber.StatusBadRequest:
		return "bad_request"
	case fiber.StatusUnauthorized:
		return "no_es_el_servicio"
	case fiber.StatusNotFound:
		return "not_found"
	case fiber.StatusRequestEntityTooLarge:
		return "body_too_large"
	default:
		return "internal_error"
	}
}
