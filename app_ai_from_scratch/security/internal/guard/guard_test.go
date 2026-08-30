package guard

import (
	"context"
	"errors"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"course/security/internal/policy"
)

// THE INVARIANT THIS WHOLE PACKAGE EXISTS FOR.
//
// If any other package can start a process, then every promise policy makes
// about allowlists and validated targets is advisory. This test is the
// enforcement: it parses every file in the module and fails on an os/exec import
// anywhere but here.
//
// It walks the source rather than reading a list of approved files, because a
// list is a second thing to keep in sync and this failure has to be impossible
// to introduce, not merely against the rules.
func TestOnlyThisPackageCanStartAProcess(t *testing.T) {
	root := moduleRoot(t)
	fset := token.NewFileSet()
	offenders := map[string][]string{}
	walked := 0

	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if name := d.Name(); name == ".git" || name == "testdata" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		walked++
		f, err := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		if filepath.Dir(rel) == filepath.Join("internal", "guard") {
			return nil
		}
		for _, imp := range f.Imports {
			if strings.Trim(imp.Path.Value, `"`) == "os/exec" {
				offenders[rel] = append(offenders[rel], "os/exec")
			}
		}
		// `syscall` is NOT banned outright, and that is a deliberate narrowing
		// rather than a loophole. Every daemon here needs syscall.SIGTERM --
		// `docker stop` sends it and there is no os-level constant for it -- so
		// banning the import would have meant banning graceful shutdown. What
		// actually starts a process is a specific handful of calls, so those are
		// what this looks for.
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, call := range []string{"syscall.Exec", "syscall.ForkExec", "syscall.StartProcess", "os.StartProcess"} {
			if strings.Contains(string(src), call) {
				offenders[rel] = append(offenders[rel], call)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walking %s: %v", root, err)
	}
	// A test that inspected nothing is a test that passed for the wrong reason.
	// This module has more than a handful of files; if the walk found almost
	// none, the root discovery is wrong and this guard is dark.
	if walked < 8 {
		t.Fatalf("only %d Go files were inspected under %s; the walk is not finding the module, "+
			"so this invariant is not actually being checked", walked, root)
	}
	for file, imps := range offenders {
		t.Errorf("%s imports %v. Only internal/guard may start a process: everything policy "+
			"promises about allowlisted actions and validated targets depends on there being "+
			"exactly one place that execs", file, imps)
	}
}

func moduleRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("no go.mod above the test's working directory")
		}
		dir = parent
	}
}

// Run takes a Decision, not a command, so «could something make this run X» has
// a type-checked answer. These two tests pin the check itself.
func TestRunRefusesAnythingButAct(t *testing.T) {
	for _, v := range []policy.Verdict{policy.Escalate, policy.Refuse, policy.Verdict("")} {
		d := policy.Decision{Verdict: v, Argv: []string{"/bin/echo", "hello"}}
		if _, err := (Real{}).Run(context.Background(), d); !errors.Is(err, ErrNotPermitted) {
			t.Errorf("Real.Run with verdict %q returned %v, want ErrNotPermitted", v, err)
		}
		dr := &DryRun{}
		if _, err := dr.Run(context.Background(), d); !errors.Is(err, ErrNotPermitted) {
			t.Errorf("DryRun.Run with verdict %q returned %v, want ErrNotPermitted", v, err)
		}
		if len(dr.Calls) != 0 {
			t.Errorf("DryRun recorded a call for verdict %q", v)
		}
	}
}

// A decision with no argv is normal, not an error: a session is revoked by the
// api and an edge block is an API call. Returning an error here would make every
// one of those look like a failed containment.
func TestAnActWithNoArgvIsNotAnError(t *testing.T) {
	res, err := (Real{}).Run(context.Background(), policy.Decision{Verdict: policy.Act})
	if err != nil {
		t.Fatalf("an Act with no argv should be a no-op, got %v", err)
	}
	if res.Argv != nil {
		t.Errorf("argv = %v, want nil", res.Argv)
	}
}

// No shell means a target full of metacharacters is ONE argument. This runs a
// real process to prove it, using a target that would be catastrophic if any
// interpreter were involved.
func TestThereIsNoShellToInjectInto(t *testing.T) {
	if _, err := os.Stat("/bin/echo"); err != nil {
		t.Skip("no /bin/echo on this platform")
	}
	nasty := "; rm -rf / #"
	d := policy.Decision{Verdict: policy.Act, Argv: []string{"/bin/echo", nasty}}
	res, err := (Real{}).Run(context.Background(), d)
	if err != nil {
		t.Fatalf("echo failed: %v (%s)", err, res.Output)
	}
	if res.Output != nasty {
		t.Fatalf("output = %q, want the literal argument %q. Anything else means the string was "+
			"interpreted rather than passed", res.Output, nasty)
	}
}

// A credential handed to a subprocess is a credential one argument-parsing bug
// away from disclosure. The environment is replaced, not extended.
func TestTheSubprocessDoesNotInheritOurSecrets(t *testing.T) {
	if _, err := os.Stat("/usr/bin/env"); err != nil {
		t.Skip("no /usr/bin/env on this platform")
	}
	t.Setenv("IA_SECRETO", "this-must-not-reach-a-child")
	t.Setenv("CLOUDFLARE_API_TOKEN", "neither-must-this")
	d := policy.Decision{Verdict: policy.Act, Argv: []string{"/usr/bin/env"}}
	res, err := (Real{}).Run(context.Background(), d)
	if err != nil {
		t.Fatalf("env failed: %v", err)
	}
	for _, leaked := range []string{"this-must-not-reach-a-child", "neither-must-this", "IA_SECRETO"} {
		if strings.Contains(res.Output, leaked) {
			t.Errorf("the child process saw %q. Its environment is:\n%s", leaked, res.Output)
		}
	}
}

func TestAHangBecomesAFailureAndSaysSo(t *testing.T) {
	if _, err := os.Stat("/bin/sleep"); err != nil {
		t.Skip("no /bin/sleep on this platform")
	}
	// Cancel from the caller side rather than waiting out MaxRuntime, so the
	// test is fast; the deadline path is the same code.
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	d := policy.Decision{Verdict: policy.Act, Argv: []string{"/bin/sleep", "30"}}
	start := time.Now()
	_, err := (Real{}).Run(ctx, d)
	if err == nil {
		t.Fatal("a killed process reported success")
	}
	if time.Since(start) > 5*time.Second {
		t.Errorf("took %s; the timeout is not being applied", time.Since(start))
	}
}
