// Command defense is the umbrella tool: the gate, the topology, and the
// container healthcheck.
//
// It also answers `healthcheck` because the images are built FROM scratch and a
// scratch image has no shell, so a compose `CMD-SHELL` healthcheck can never
// run. That is not a theoretical concern -- it already bit the queue service,
// where a shell-form healthcheck was configured against an image with no shell
// and the container reported itself unhealthy forever.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"course/defense/binding"
	"course/defense/internal/audit"
	"course/defense/internal/config"
	"course/defense/internal/policy"
	qbroker "course/queue/broker"
	qbus "course/queue/bus"
)

const usage = `defense <command>

  verify        every structural invariant of this module. Exits non-zero on any.
  topology      print | declare | verify   the defense queues on the broker
  audit         verify [path]              walk the hash chain and report breaks
  healthcheck   for the container healthcheck (this image has no shell)
  version
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "verify":
		err = verify()
	case "topology":
		err = topology(os.Args[2:])
	case "audit":
		err = auditCmd(os.Args[2:])
	case "healthcheck":
		err = healthcheck()
	case "version":
		fmt.Println("defense 0.1.0 (morpheus trinity smith oracle neo)")
	default:
		fmt.Fprintf(os.Stderr, "defense: unknown command %q\n\n%s", os.Args[1], usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "defense: %v\n", err)
		os.Exit(1)
	}
}

// verify is the gate. It asserts what this module promises about itself, and
// every check here is one that would otherwise only be discovered during an
// incident.
func verify() error {
	type group struct {
		name string
		errs []error
	}
	groups := []group{
		{"policy (the action allowlist)", policy.Verify()},
		{"binding (the queues and the one-direction rule)", binding.Verify()},
	}

	// The audit chain, when there is one. An absent log is not a failure here:
	// a fresh box has never written a record. A PRESENT log that does not verify
	// is a failure, and it is the loudest one in this list.
	if path := os.Getenv("DEFENSE_AUDIT"); path != "" {
		if _, err := os.Stat(path); err == nil {
			groups = append(groups, group{"audit (the hash chain)", audit.Verify(path)})
		}
	}

	// The engine must be constructible. NewEngine re-runs policy.Verify, so this
	// also proves the two agree rather than merely both existing.
	if _, err := policy.NewEngine(policy.Propose, nil); err != nil {
		groups = append(groups, group{"engine", []error{err}})
	}

	total := 0
	for _, g := range groups {
		if len(g.errs) == 0 {
			fmt.Printf("  ok    %s\n", g.name)
			continue
		}
		fmt.Printf("  FAIL  %s\n", g.name)
		for _, e := range g.errs {
			fmt.Printf("          %v\n", e)
			total++
		}
	}
	fmt.Println()
	if total > 0 {
		return fmt.Errorf("%d invariant(s) broken", total)
	}
	fmt.Printf("verified: %d actions, all expiring and rate limited; %d agents, exactly one of which "+
		"may act\n", len(policy.Rules()), len(binding.Agents()))
	return nil
}

// defenseTopology is every queue this fleet needs: one per agent plus the three
// inboxes. Built from binding, so adding an agent adds its queue.
func defenseTopology(exchange string) (qbus.Topology, error) {
	all := qbus.Topology{}
	first := true
	add := func(queue string, patterns []string) error {
		t, err := qbus.BuildTopology(exchange, queue, patterns)
		if err != nil {
			return err
		}
		if first {
			all = t
			first = false
			return nil
		}
		// The exchanges and the retry tiers are identical for every call, so
		// only the queue and its bindings are new. Re-declaring an exchange
		// with the same arguments is a no-op in AMQP, but printing it eleven
		// times would make the output unreadable.
		all.Queues = append(all.Queues, t.Queues[len(t.Queues)-1])
		all.Bindings = append(all.Bindings, t.Bindings[len(t.Bindings)-len(patterns):]...)
		return nil
	}
	for _, a := range binding.Agents() {
		if a.Queue == "" {
			continue
		}
		if err := add(a.Queue, a.Patterns); err != nil {
			return qbus.Topology{}, err
		}
	}
	for _, in := range binding.Inboxes() {
		if err := add(in.Queue, in.Patterns); err != nil {
			return qbus.Topology{}, err
		}
	}
	return all, nil
}

func topology(args []string) error {
	sub := "print"
	if len(args) > 0 {
		sub = args[0]
	}
	cfg, err := config.Load("defense")
	if err != nil && sub != "print" {
		return err
	}
	exchange := qbus.DefaultExchange
	if cfg.Exchange != "" {
		exchange = cfg.Exchange
	}
	topo, err := defenseTopology(exchange)
	if err != nil {
		return err
	}

	switch sub {
	case "print":
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(topo)
	case "declare", "verify":
		if cfg.AMQPURL == "" {
			return errors.New("AMQP_URL is empty, so nothing was checked. A gate that cannot run " +
				"has failed, not skipped")
		}
		c := qbroker.New(qbroker.Options{URL: cfg.AMQPURL, Exchange: exchange})
		defer c.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if sub == "declare" {
			if err := c.Declare(ctx, topo); err != nil {
				return err
			}
			fmt.Printf("declared: %d exchange(s), %d queue(s), %d binding(s)\n",
				len(topo.Exchanges), len(topo.Queues), len(topo.Bindings))
			return nil
		}
		missing, err := c.Verify(ctx, topo)
		if err != nil {
			return err
		}
		if len(missing) > 0 {
			for _, m := range missing {
				fmt.Printf("  MISSING %s %s: %s\n", m.Kind, m.Name, m.Reason)
			}
			return fmt.Errorf("%d object(s) missing; run `defense topology declare`", len(missing))
		}
		fmt.Printf("verified %d object(s)\n", len(topo.Exchanges)+len(topo.Queues))
		return nil
	}
	return fmt.Errorf("topology: unknown subcommand %q (print, declare, verify)", sub)
}

func auditCmd(args []string) error {
	if len(args) == 0 || args[0] != "verify" {
		return errors.New("audit: the only subcommand is `verify [path]`")
	}
	path := os.Getenv("DEFENSE_AUDIT")
	if len(args) > 1 {
		path = args[1]
	}
	if path == "" {
		return errors.New("audit verify: no path given and DEFENSE_AUDIT is empty")
	}
	errs := audit.Verify(path)
	if len(errs) == 0 {
		recs, _ := audit.Read(path)
		fmt.Printf("the chain is intact: %d record(s) in %s\n", len(recs), path)
		return nil
	}
	for _, e := range errs {
		fmt.Printf("  %v\n", e)
	}
	return fmt.Errorf("%d break(s) in the audit chain of %s. Treat this as an incident: the log is "+
		"the only record of what this system did to itself", len(errs), path)
}

// healthcheck answers for every agent: the config has to parse and the audit
// directory has to be writable. It deliberately does NOT dial the broker -- an
// agent whose broker is down is still doing its job on stdout and in the log, and
// reporting it unhealthy would make compose restart it in a loop during exactly
// the outage where its logs matter most.
func healthcheck() error {
	cfg, err := config.Load(os.Getenv("DEFENSE_AGENT"))
	if err != nil {
		return err
	}
	if cfg.Mode == policy.Enforce {
		if _, err := audit.Open(cfg.AuditPath, nil); err != nil {
			return fmt.Errorf("enforce mode and the audit log is not writable: %w", err)
		}
	}
	fmt.Println("ok")
	return nil
}
