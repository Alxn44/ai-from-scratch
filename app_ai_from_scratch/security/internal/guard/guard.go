// Package guard is the only place in this service that starts a process.
//
// THE STRUCTURAL GUARANTEE
// Run() takes a policy.Decision, not a command. There is no exported way to
// execute an arbitrary argv from anywhere in this codebase, which means the
// question «could an attacker get Neo to run something» has a type-checked
// answer: only if they can get policy.Engine.Decide to return Act for an action
// that is already in the allowlist, with a target that already passed that
// rule's validator. That is a much smaller surface than «only if nobody made a
// mistake in a string».
//
// A test asserts that no other package in this module imports os/exec.
package guard

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"course/security/internal/policy"
)

// ErrNotPermitted is returned for a decision that is not an Act. It is a
// programming error, not an operational one: the caller was supposed to look at
// the verdict.
var ErrNotPermitted = errors.New("guard: refusing to run a decision that is not an Act")

// MaxRuntime bounds any action. An action that hangs holds a slot in the
// responder and the real containment queues behind it, so a hang has to become a
// failure quickly.
const MaxRuntime = 20 * time.Second

// Result is what happened. Output is captured and truncated: an action's stderr
// goes into the audit log, and an unbounded capture from a misbehaving tool
// would put megabytes into a line-oriented file.
type Result struct {
	Argv     []string
	Code     int
	Output   string
	Duration time.Duration
	Err      error
}

const maxCapture = 4 << 10

// Runner executes a decision. Real is the one that starts processes; DryRun
// records without executing and is what the test suite and Propose mode use.
type Runner interface {
	Run(ctx context.Context, d policy.Decision) (Result, error)
}

// Real starts processes. There is exactly one of these in the binary.
type Real struct{}

// Run executes the decision's argv with no shell and no interpolation.
//
// exec.CommandContext takes the program and the arguments SEPARATELY, so there
// is no command line for a target to be injected into: a target containing
// «; rm -rf /» is one argument that the program will reject as a bad argument,
// not two commands.
func (Real) Run(ctx context.Context, d policy.Decision) (Result, error) {
	if d.Verdict != policy.Act {
		return Result{}, fmt.Errorf("%w: verdict was %q", ErrNotPermitted, d.Verdict)
	}
	if len(d.Argv) == 0 {
		// Not an error: several actions are applied by the service that owns
		// them (a session is revoked by the api, an edge block is an API call),
		// and those decisions legitimately carry no argv.
		return Result{Argv: nil}, nil
	}
	ctx, cancel := context.WithTimeout(ctx, MaxRuntime)
	defer cancel()

	started := time.Now()
	cmd := exec.CommandContext(ctx, d.Argv[0], d.Argv[1:]...)
	// An empty environment except PATH. A defence process inherits whatever the
	// container was started with, and that includes IA_SECRETO and any other
	// credential in the compose file. Handing those to a subprocess is how a
	// bug in `nft` argument parsing turns into a credential disclosure.
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin"}
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()

	res := Result{Argv: d.Argv, Duration: time.Since(started), Output: truncate(buf.String())}
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			res.Code = ee.ExitCode()
		} else {
			res.Code = -1
		}
		res.Err = err
		// The context deadline is reported explicitly. «signal: killed» with no
		// explanation is the least useful line an incident log can contain.
		if ctx.Err() != nil {
			res.Err = fmt.Errorf("%v after %s (guard.MaxRuntime)", err, MaxRuntime)
		}
		return res, res.Err
	}
	return res, nil
}

// DryRun records what would have run and returns success without running it.
type DryRun struct{ Calls [][]string }

// Run records the argv. It still enforces the Act check, so a test cannot
// accidentally assert that an Escalate decision "ran".
func (d *DryRun) Run(_ context.Context, dec policy.Decision) (Result, error) {
	if dec.Verdict != policy.Act {
		return Result{}, fmt.Errorf("%w: verdict was %q", ErrNotPermitted, dec.Verdict)
	}
	d.Calls = append(d.Calls, dec.Argv)
	return Result{Argv: dec.Argv, Output: "(dry run: not executed)"}, nil
}

func truncate(s string) string {
	s = strings.TrimSpace(s)
	if len(s) <= maxCapture {
		return s
	}
	return s[:maxCapture] + fmt.Sprintf("… (%d bytes truncated)", len(s)-maxCapture)
}
