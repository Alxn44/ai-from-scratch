// Command queue-verify is the gate: one command that runs everything in this
// service, the way `uv run ai-verify` does for ai/.
//
// It exists so that "it is green" is a single thing that can be typed from
// memory instead of five commands somebody half-remembers.
//
// TWO RULES IT DOES NOT BEND.
//
//  1. A step that CANNOT RUN is not a step that passed. The broker steps need a
//     reachable broker, and AMQP is deliberately not published to the host, so
//     on a developer machine they usually cannot run. They are then reported as
//     SKIPPED, by name, in a summary that says so out loud -- and
//     `--require-broker` (or QUEUE_VERIFY_REQUIRE_BROKER=1) turns every skip
//     into a failure, which is what CI should use.
//
//  2. Exit codes are read directly, never through a pipe. `go test ./... | tail`
//     reports tail's status, and that mistake has produced a confident, wrong
//     "all green" in this repository before. Every step below runs with its
//     output inherited and its own ExitCode() checked.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"slices"
	"strings"
	"time"
)

// raceAvailable reports whether the race detector can actually run here.
//
// It needs cgo and a C compiler, and the platforms it supports are a fixed list.
// Asked only to turn a cryptic child-process error into a sentence that says what
// to install -- never to decide whether to run the step. Dropping -race is not an
// option this tool offers.
func raceAvailable() bool {
	supported := map[string]bool{
		"linux/amd64": true, "linux/arm64": true, "linux/ppc64le": true, "linux/s390x": true,
		"darwin/amd64": true, "darwin/arm64": true,
		"freebsd/amd64": true, "netbsd/amd64": true, "openbsd/amd64": true, "windows/amd64": true,
	}
	if !supported[runtime.GOOS+"/"+runtime.GOARCH] {
		return false
	}
	// `go env CGO_ENABLED` reflects the toolchain's own view, which is what
	// `go test -race` will consult.
	out, err := exec.Command("go", "env", "CGO_ENABLED").Output()
	return err == nil && strings.TrimSpace(string(out)) == "1"
}

type step struct {
	name string
	args []string
	// needsBroker marks the steps that cannot run without a reachable broker.
	needsBroker bool
	// why is printed when the step is skipped, so a skip is never mysterious.
	why string
}

func main() {
	requireBroker := os.Getenv("QUEUE_VERIFY_REQUIRE_BROKER") == "1"
	for _, a := range os.Args[1:] {
		switch a {
		case "--require-broker":
			requireBroker = true
		case "-h", "--help":
			fmt.Println("queue-verify [--require-broker]\n\n" +
				"  Runs build, vet, gofmt, tests and the cross-runtime contract check.\n" +
				"  With a reachable broker it also declares and verifies the topology.\n" +
				"  --require-broker makes a skipped broker step a failure (use this in CI).")
			return
		default:
			fmt.Fprintf(os.Stderr, "queue-verify: unknown flag %q\n", a)
			os.Exit(2)
		}
	}

	steps := []step{
		{name: "build", args: []string{"go", "build", "./..."}},
		{name: "vet", args: []string{"go", "vet", "./..."}},
		// gofmt is checked by asserting it has nothing to say. `gofmt -l` exits 0
		// whether or not it lists files, so the LIST is the verdict, not the code
		// -- handled as a special case below.
		{name: "gofmt", args: []string{"gofmt", "-l", "."}},
		// -race, always. Every counter in this service is touched by one
		// goroutine per in-flight delivery, and a data race there is exactly the
		// class of bug that only shows up under load in production.
		{name: "test", args: []string{"go", "test", "./...", "-race", "-count=1"}},
		{name: "contract", args: []string{"go", "run", "./cmd/queue-topology", "contract"}},
		{
			name: "topology-declare", args: []string{"go", "run", "./cmd/queue-topology", "declare"},
			needsBroker: true,
			why:         "AMQP_URL is not set (AMQP is not published to the host on purpose)",
		},
		{
			name: "topology-verify", args: []string{"go", "run", "./cmd/queue-topology", "verify"},
			needsBroker: true,
			why:         "AMQP_URL is not set (AMQP is not published to the host on purpose)",
		},
	}

	brokerConfigured := strings.TrimSpace(os.Getenv("AMQP_URL")) != ""
	var failed, skipped []string
	start := time.Now()

	for _, s := range steps {
		if s.needsBroker && !brokerConfigured {
			fmt.Printf("\n=== %s === SKIPPED: %s\n", s.name, s.why)
			skipped = append(skipped, s.name)
			continue
		}
		fmt.Printf("\n=== %s ===\n", s.name)
		// Output is inherited, so the child writes straight to this terminal and
		// nothing is buffered out of order.
		cmd := exec.Command(s.args[0], s.args[1:]...)
		cmd.Stdin = os.Stdin
		cmd.Stderr = os.Stderr
		if s.name == "gofmt" {
			// The one step whose verdict is its OUTPUT and not its exit code.
			out, err := cmd.Output()
			if err != nil {
				fmt.Fprintf(os.Stderr, "gofmt could not run: %v\n", err)
				failed = append(failed, s.name)
				continue
			}
			listed := strings.TrimSpace(string(out))
			if listed != "" {
				fmt.Printf("these files are not gofmt-clean:\n%s\n", listed)
				failed = append(failed, s.name)
			}
			continue
		}
		cmd.Stdout = os.Stdout
		if err := cmd.Run(); err != nil {
			// ExitCode is read from the process, not inferred from text.
			fmt.Fprintf(os.Stderr, "%s failed: %v\n", s.name, err)
			failed = append(failed, s.name)
		}
	}

	fmt.Printf("\n--- %s ---\n", time.Since(start).Round(time.Millisecond))
	if len(skipped) > 0 {
		// Named, every time. A suite that prints "skipped" quietly is
		// indistinguishable from a pass.
		fmt.Printf("SKIPPED (nothing was checked here): %s\n", strings.Join(skipped, ", "))
		fmt.Println("  to run them, point AMQP_URL at a reachable broker:")
		// Two different commands, because this binary and the image are not
		// interchangeable. queue-verify shells out to `go run`, `go vet` and
		// `go test`, so it needs the Go toolchain AND this source tree: it runs on
		// a developer machine or in CI, never inside the scratch image, which has
		// no shell and no compiler. Only /queue-topology ships in the image.
		fmt.Println("    where the repo and Go are present (CI):")
		fmt.Println("      docker compose up -d --wait broker && AMQP_URL=... go run ./cmd/queue-verify --require-broker")
		fmt.Println("    against a deployed broker, from inside the network:")
		fmt.Println("      docker compose run --rm --entrypoint /queue-topology queue verify")
	}
	if len(failed) > 0 {
		fmt.Printf("FAILED: %s\n", strings.Join(failed, ", "))
		// One specific failure is worth translating, because its cause is the
		// environment and not the code: -race needs cgo, and a slim container
		// (golang:*-alpine, most CI base images) ships no C compiler. Dropping
		// -race to make it pass is NOT the fix -- every counter in this service
		// is touched by one goroutine per in-flight delivery, which is exactly
		// what the race detector is for.
		if slices.Contains(failed, "test") && !raceAvailable() {
			fmt.Println()
			fmt.Println("The test step needs the race detector, which needs cgo and a C compiler.")
			fmt.Println("  on alpine:  apk add --no-cache gcc musl-dev")
			fmt.Println("  on debian:  apt-get install -y gcc")
			fmt.Println("Do not remove -race to get past this.")
		}
		os.Exit(1)
	}
	if len(skipped) > 0 && requireBroker {
		fmt.Printf("FAILED: --require-broker was given and %d step(s) could not run\n", len(skipped))
		os.Exit(1)
	}
	if len(skipped) > 0 {
		fmt.Println("green, EXCEPT the skipped steps above. This is not a full pass.")
		return
	}
	fmt.Println("all green: build, vet, gofmt, tests, cross-runtime contract, and the live topology")
}
