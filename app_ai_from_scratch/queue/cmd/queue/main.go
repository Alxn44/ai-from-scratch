// Command queue is the transport service: it owns the RabbitMQ topology, the
// retry and dead-letter policy, and the answer to "what is in flight".
//
// WHAT THIS PROCESS IS NOT, said first because the temptation is real:
//
//   - It is NOT the orchestrator docs/ARCHITECTURE.md refused to build. It is not on
//     any path a person waits on, it decides no workflow, and nothing routes
//     THROUGH it: every service still declares the topology on connect and
//     publishes straight to the exchange. Stop this container and grading, chat
//     and the league close all keep working -- which is exactly the property a
//     central router would destroy.
//   - It is NOT a second job system. api/src/jobs.ts is the Postgres queue for
//     work one service both enqueues and runs, and it stays. RabbitMQ carries
//     work BETWEEN services. Two mechanisms, one rule each.
//   - It holds NO course logic and NO database handle. If a handler here ever
//     needs a lesson, an attempt or a user, the work belongs in `api`.
//
// SAME BINARY, TWO ROLES. `queue` serves HTTP and consumes; `queue healthcheck`
// probes its own /health and exits non-zero when it is not ok. The second exists
// because the runtime image has no shell and no curl, and a container whose
// healthcheck cannot run is a container that is never reported unhealthy.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v3"

	"course/queue/broker"
	"course/queue/bus"
	"course/queue/internal/binding"
	"course/queue/internal/config"
	"course/queue/internal/httpapi"
)

// version is stamped by the build (-ldflags "-X main.version=..."). It defaults
// to "dev" rather than to a plausible-looking number: a wrong version in /health
// is worse than an honest "I do not know".
var version = "dev"

// The queue and the routing patterns live in internal/binding, so this service
// and queue-topology cannot disagree about what they are.

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "healthcheck":
			os.Exit(healthcheck())
		case "version":
			fmt.Println(version)
			return
		default:
			fmt.Fprintf(os.Stderr, "queue: unknown argument %q (expected `healthcheck` or `version`)\n", os.Args[1])
			os.Exit(2)
		}
	}
	if err := run(); err != nil {
		// One line, on stderr, then a non-zero exit. A service that cannot come
		// up correctly must not come up at all.
		fmt.Fprintf(os.Stderr, "queue: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(log)

	cfg, err := config.Load(os.LookupEnv)
	if err != nil {
		return err
	}
	log.Info("starting", "config", cfg.Describe(), "version", version)
	if cfg.SecretIsEphemeral {
		log.Warn("QUEUE_SECRETO was unset and APP_ENV=development, so an ephemeral secret was minted. " +
			"Nothing else can call this service until it is told the new value, and every restart changes it")
	}
	if !cfg.BrokerConfigured() {
		// Loud, and not fatal: /health answers 503 and every write route
		// refuses, so nothing can mistake this for a working service.
		log.Error("AMQP_URL is not set. Nothing will be published, verified or consumed. " +
			"The HTTP surface stays up so /health can say so")
	}

	pats := binding.Patterns()
	topo, err := bus.BuildTopology(cfg.Exchange, binding.Queue, pats)
	if err != nil {
		return err
	}

	client := broker.New(broker.Options{
		URL:            cfg.AMQPURL,
		Exchange:       cfg.Exchange,
		Log:            log,
		PublishTimeout: cfg.PublishTimeout,
	})
	defer func() { _ = client.Close() }()

	claims, durable := claimStore(cfg, log)

	dispatcher := &bus.Dispatcher{
		Exchange:       cfg.Exchange,
		Queue:          binding.Queue,
		Handlers:       handlers(log, client, topo),
		Claims:         claims,
		HandlerTimeout: cfg.HandlerTimeout,
		PublishTimeout: cfg.PublishTimeout,
		Log:            log,
	}

	consumer := broker.NewConsumer(&broker.Consumer{
		URL:        cfg.AMQPURL,
		Exchange:   cfg.Exchange,
		Queue:      binding.Queue,
		Patterns:   pats,
		Prefetch:   cfg.Prefetch,
		Dispatcher: dispatcher,
		Drain:      cfg.DrainTimeout,
		Log:        log,
	})

	app := httpapi.New(httpapi.Deps{
		Config:         cfg,
		Client:         client,
		Topology:       topo,
		Stats:          func() (bus.Stats, bool) { return dispatcher.Snapshot(), true },
		ConsumerHealth: consumer.Health,
		DurableClaims:  durable,
		Log:            log,
		Started:        time.Now().UTC(),
		Version:        version,
	})

	// SIGTERM is how a container is asked to stop. Everything below hangs off
	// this one context so that a signal reaches the consumer, the HTTP server
	// and every in-flight broker call at once.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	// The topology is declared at boot, once, as a courtesy -- and its failure is
	// NOT fatal. Every service re-declares on connect, so a broker that is down
	// right now is a broker this service will declare into when it comes back.
	// Exiting here would make a slow broker start look like a bug in this code.
	if cfg.BrokerConfigured() {
		dctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		if err := client.Declare(dctx, topo); err != nil {
			log.Error("could not declare the topology at boot; it will be declared on the next connect", "error", err)
		} else {
			log.Info("topology declared",
				"exchanges", len(topo.Exchanges), "queues", len(topo.Queues), "bindings", len(topo.Bindings))
		}
		cancel()
	}

	consumerDone := make(chan struct{})
	go func() {
		defer close(consumerDone)
		if err := consumer.Run(ctx); err != nil {
			log.Error("consumer stopped", "error", err)
		}
	}()

	serveErr := make(chan error, 1)
	go func() {
		addr := net.JoinHostPort("0.0.0.0", strconv.Itoa(cfg.Port))
		log.Info("listening", "addr", addr, "queue", binding.Queue, "patterns", pats)
		serveErr <- app.Listen(addr, fiber.ListenConfig{DisableStartupMessage: true})
	}()

	select {
	case err := <-serveErr:
		if err != nil {
			return fmt.Errorf("http server: %w", err)
		}
		return nil
	case <-ctx.Done():
	}

	// SHUTDOWN ORDER, and each step is here for a reason:
	//  1. stop accepting HTTP, so no new enqueue starts work we are about to
	//     stop waiting for,
	//  2. cancel the consumer and DRAIN: finish and ack what is in hand. A
	//     message still unacked when the socket drops is redelivered, so nothing
	//     is lost -- it is only done twice, and the idempotency claim is what
	//     makes twice harmless,
	//  3. close the publisher connection.
	log.Warn("signal received, draining")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.DrainTimeout+5*time.Second)
	defer cancel()

	if err := app.ShutdownWithContext(shutdownCtx); err != nil {
		log.Error("http shutdown was not clean", "error", err)
	}
	stats := consumer.Stop(shutdownCtx)
	<-consumerDone
	log.Info("drained", "stats", fmt.Sprintf("%+v", stats))
	return nil
}

// claimStore picks the idempotency store and says which one it picked.
//
// The durable one is an HTTP call to api, which owns the row -- this service has
// no database and must not grow one. An unset BUS_CLAIM_URL is supported for
// local development only and is reported loudly rather than assumed away.
func claimStore(cfg config.Config, log *slog.Logger) (bus.Claims, bool) {
	if cfg.ClaimURL != "" {
		return &bus.APIClaims{
			URL:     cfg.ClaimURL,
			Secret:  cfg.Secret,
			Owner:   cfg.WorkerID,
			LeaseS:  cfg.ClaimLease.Seconds(),
			Timeout: cfg.PublishTimeout,
		}, true
	}
	log.Warn("idempotency is IN MEMORY (BUS_CLAIM_URL unset). A restart forgets what ran, " +
		"so a redelivery after a crash can run a handler twice. Point BUS_CLAIM_URL at api's claim route " +
		"for the durable version")
	return bus.NewMemoryClaims(), false
}

// ---------------------------------------------------------------------------
// HANDLERS. Only work that actually exists is registered: a handler that
// pretends to do something is worse than a routing key nobody publishes.
//
// Everything in this map is about the TRANSPORT. There is no course logic here
// and there must never be -- the routing keys for that (`ai.grading.batch.
// requested`, `ai.embeddings.requested`) belong to the services that own the
// data, and are neither bound nor handled here.
func handlers(log *slog.Logger, client *broker.Client, topo bus.Topology) map[string]bus.Handler {
	return map[string]bus.Handler{
		// The smoke-test type. api-worker and ai-worker both bind `bus.echo`, so
		// one published message proves the topic exchange fans out to three
		// services and that all three consume -- the property docs/ARCHITECTURE.md
		// claims and nothing else exercises end to end.
		"bus.echo": func(_ context.Context, payload map[string]any, env bus.Envelope) error {
			log.Info("echo", "id", env.ID, "attempt", env.Attempt, "payload", payload)
			return nil
		},

		// A message that asks this service to re-declare the topology.
		//
		// It is a message and not only an HTTP route because a deploy hook has a
		// broker connection more often than it has this service's secret, and
		// because the answer matters when it is asked by a machine at 03:00
		// rather than by a person with curl.
		//
		// The exchange is NOT taken from the payload. Letting a message name it
		// would let any publisher make this service declare a topology in a
		// place it does not consume from -- queues nobody drains, which look
		// like a broker fault and are a message.
		"queue.topology.declare": func(ctx context.Context, _ map[string]any, env bus.Envelope) error {
			if err := client.Declare(ctx, topo); err != nil {
				// Returned, not swallowed: a declaration that failed because the
				// broker was mid-restart is exactly what the retry ladder is for.
				return fmt.Errorf("re-declare on request: %w", err)
			}
			log.Info("topology re-declared on request", "asked_by", env.ID)
			return nil
		},
	}
}

// healthcheck is the container HEALTHCHECK: probe our own /health and exit
// non-zero unless it says ok.
//
// It reads the status code AND the body's status field. A 200 with
// `"status":"disconnected"` cannot happen today, but a check that trusts only
// the code would not notice if it ever did.
func healthcheck() int {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8790"
	}
	url := "http://127.0.0.1:" + port + "/health"
	client := &http.Client{Timeout: 5 * time.Second}
	res, err := client.Get(url)
	if err != nil {
		fmt.Fprintf(os.Stderr, "healthcheck: %v\n", err)
		return 1
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "healthcheck: %s answered %d\n", url, res.StatusCode)
		return 1
	}
	return 0
}
