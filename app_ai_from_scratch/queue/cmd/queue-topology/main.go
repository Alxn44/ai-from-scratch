// Command queue-topology is the topology tool: print it, declare it, or verify
// it against a live broker.
//
//	queue-topology print               what this code says should exist (no broker needed)
//	queue-topology declare             create it, idempotently
//	queue-topology verify              check it against the broker
//	queue-topology contract            check the numbers against api/ and ai/
//
// EXIT CODES ARE THE INTERFACE. 0 only when the thing asked for was actually
// done or actually checked. Anything else -- no broker, unreachable broker,
// unreadable sibling file -- is a non-zero exit with the reason on stderr.
//
// This is not defensive pedantry. A tool that cannot verify and exits 0 with an
// empty result has bitten this repository three times: the guard sits dark, the
// pipeline stays green, and the drift it was built to catch ships. `print` is the
// only subcommand that works without a broker, and it never claims otherwise.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"course/queue/broker"
	"course/queue/bus"
	"course/queue/internal/binding"
	"course/queue/internal/config"
)

const timeout = 20 * time.Second

func main() {
	if len(os.Args) < 2 {
		usage("a subcommand is required")
	}
	cmd := os.Args[1]

	// LoadForTool, not Load: this binary listens on nothing and authenticates
	// nobody, so QUEUE_SECRETO is not required. It still loads the rest of the
	// configuration -- printing a topology for the wrong exchange is worse than
	// refusing to print one -- and it still rejects a placeholder secret that is
	// present.
	cfg, err := config.LoadForTool(os.LookupEnv)
	if err != nil {
		die("%v", err)
	}
	topo, err := bus.BuildTopology(cfg.Exchange, binding.Queue, binding.Patterns())
	if err != nil {
		die("%v", err)
	}

	switch cmd {
	case "print":
		out, err := json.MarshalIndent(map[string]any{
			"exchange": cfg.Exchange,
			"queue":    binding.Queue,
			"patterns": binding.Patterns(),
			"retry_ms": bus.DelayTiersMS(),
			"ceiling":  bus.MaxAttempts,
			"topology": topo,
		}, "", "  ")
		if err != nil {
			die("%v", err)
		}
		fmt.Println(string(out))

	case "contract":
		os.Exit(contract())

	case "declare":
		client, ctx, cancel := connect(cfg)
		defer cancel()
		defer func() { _ = client.Close() }()
		if err := client.Declare(ctx, topo); err != nil {
			die("declare failed, so NOTHING was declared: %v", err)
		}
		fmt.Printf("declared on %s: %d exchange(s), %d queue(s), %d binding(s)\n",
			config.Redact(cfg.AMQPURL), len(topo.Exchanges), len(topo.Queues), len(topo.Bindings))

	case "verify":
		client, ctx, cancel := connect(cfg)
		defer cancel()
		defer func() { _ = client.Close() }()
		missing, err := client.Verify(ctx, topo)
		if err != nil {
			// The difference that matters: this is "I could not look", not
			// "nothing is missing".
			die("verify could not run, so nothing was checked: %v", err)
		}
		checked := len(topo.Exchanges) + len(topo.Queues)
		if len(missing) > 0 {
			fmt.Fprintf(os.Stderr, "%d of %d object(s) are missing or mismatched:\n", len(missing), checked)
			for _, m := range missing {
				fmt.Fprintf(os.Stderr, "  %-8s %-28s %s\n", m.Kind, m.Name, m.Reason)
			}
			os.Exit(1)
		}
		fmt.Printf("verified %d object(s) on %s: %d exchange(s), %d queue(s)\n",
			checked, config.Redact(cfg.AMQPURL), len(topo.Exchanges), len(topo.Queues))
		// Said every time, because a reader must not believe more was checked
		// than was: AMQP has no passive binding query.
		fmt.Printf("NOT checked: the %d binding(s) -- AMQP 0-9-1 cannot query a binding passively\n",
			len(topo.Bindings))

	case "queues":
		client, ctx, cancel := connect(cfg)
		defer cancel()
		defer func() { _ = client.Close() }()
		names := make([]string, 0, len(topo.Queues))
		for _, q := range topo.Queues {
			names = append(names, q.Name)
		}
		states, err := client.Inspect(ctx, names)
		if err != nil {
			die("could not read the queues, so nothing is reported: %v", err)
		}
		bad := 0
		for _, s := range states {
			if s.Error != "" {
				bad++
				fmt.Printf("%-28s  UNREADABLE  %s\n", s.Name, s.Error)
				continue
			}
			fmt.Printf("%-28s  %6d waiting  %3d consumer(s)\n", s.Name, s.Messages, s.Consumers)
		}
		if bad > 0 {
			// A partial report exits non-zero: half an answer that looks whole
			// is the failure mode this whole file is written against.
			fmt.Fprintf(os.Stderr, "\n%d queue(s) could not be read\n", bad)
			os.Exit(1)
		}

	default:
		usage(fmt.Sprintf("unknown subcommand %q", cmd))
	}
}

// contract compares this runtime's constants with api/src/bus.ts and
// ai/src/course_ai/bus.py.
func contract() int {
	wd, err := os.Getwd()
	if err != nil {
		fmt.Fprintf(os.Stderr, "cannot read the working directory: %v\n", err)
		return 1
	}
	root, err := bus.FindSiblingRoot(wd)
	if err != nil {
		// Not being able to find the siblings is a FAILURE, not a skip. This is
		// the exact shape of the bug ai/README.md records: a reader that
		// correctly refused to compare, and sat dark because refusing was silent.
		fmt.Fprintf(os.Stderr, "cannot locate the sibling contracts, so nothing was compared: %v\n", err)
		return 1
	}
	faults, err := bus.VerifyContract(root)
	if err != nil {
		fmt.Fprintf(os.Stderr, "cannot read the sibling contracts, so nothing was compared: %v\n", err)
		return 1
	}
	if len(faults) > 0 {
		fmt.Fprintf(os.Stderr, "the three runtimes disagree:\n")
		for _, f := range faults {
			fmt.Fprintf(os.Stderr, "  %s\n", f)
		}
		return 1
	}
	fmt.Printf("contract agrees with api/src/bus.ts and ai/src/course_ai/bus.py "+
		"(envelope fields, retry ladder, ceiling, delivery mode, exchange name) under %s\n", root)
	return 0
}

func connect(cfg config.Config) (*broker.Client, context.Context, context.CancelFunc) {
	if !cfg.BrokerConfigured() {
		// The most important refusal in this file. AMQP is deliberately not
		// published to the host, so the usual cause is running this on the host
		// instead of inside the compose network.
		die("AMQP_URL is not set, so nothing can be declared or verified.\n" +
			"  AMQP is deliberately not published to the host: run this inside the compose network, e.g.\n" +
			// --entrypoint is required. The image's ENTRYPOINT is /queue, which
			// accepts only `healthcheck` and `version`, so the obvious spelling
			// `docker compose run --rm queue queue-topology verify` fails with
			// `unknown argument "queue-topology"`. Verified against the built image.
			"    docker compose run --rm --entrypoint /queue-topology queue verify")
	}
	client := broker.New(broker.Options{URL: cfg.AMQPURL, Exchange: cfg.Exchange, PublishTimeout: cfg.PublishTimeout})
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	return client, ctx, cancel
}

func die(format string, a ...any) {
	fmt.Fprintf(os.Stderr, "queue-topology: "+format+"\n", a...)
	os.Exit(1)
}

func usage(why string) {
	fmt.Fprintf(os.Stderr, `queue-topology: %s

  print      the topology this code says should exist (no broker needed)
  contract   compare the numbers with api/src/bus.ts and ai/src/course_ai/bus.py
  declare    create it on the broker, idempotently
  verify     check it against the broker (exits 1 if anything is missing)
  queues     depth and consumer count per queue

Exits 0 only when the work was actually done or actually checked.
`, why)
	os.Exit(2)
}
