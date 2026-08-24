package bus

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// WHERE THE REAL COMPARISON LIVES, and why it is not a test in this file.
//
// Comparing against the ACTUAL api/src/bus.ts and ai/src/course_ai/bus.py needs
// the whole repository. A `go test` inside the Docker build does not have it --
// the build context is cmd/, internal/, go.mod and go.sum on purpose, because a
// service image must not need its siblings' source to build. A test here that
// read the real files would therefore have to either fail in the image (breaking
// a build for a reason unrelated to the image) or skip when they are absent, and
// a skip is indistinguishable from a pass.
//
// So the real comparison is `queue-topology contract`, which FAILS when it cannot
// locate or read the siblings, and which `queue-verify` runs as a mandatory step
// that has no skip path. The tests below verify the CHECKER itself, hermetically,
// over fixtures -- so the thing that guards the contract is guarded everywhere,
// including inside the image build.

// fixture writes a pair of sibling files whose constants are the ones this
// package holds, optionally with one line replaced to simulate drift.
func fixture(t *testing.T, replaceInTS [2]string) string {
	t.Helper()
	dir := t.TempDir()
	ts := `
export const ENVELOPE_FIELDS = ['id', 'type', 'key', 'idempotency_key', 'attempt', 'produced_at', 'payload'];
export const PERSISTENT = 2;
export const BASE_DELAY_MS = 1_000;
export const DELAY_FACTOR = 4;
export const DELAY_CAP_MS = 60_000;
export const MAX_ATTEMPTS = 5;
export const RECONNECT_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
exchange: (env.BUS_EXCHANGE || 'course.events').trim(),
`
	if replaceInTS[0] != "" {
		if !strings.Contains(ts, replaceInTS[0]) {
			t.Fatalf("the fixture does not contain %q, so this test would prove nothing", replaceInTS[0])
		}
		ts = strings.Replace(ts, replaceInTS[0], replaceInTS[1], 1)
	}
	py := `
ENVELOPE_FIELDS: tuple[str, ...] = (
    "id", "type", "key", "idempotency_key", "attempt", "produced_at", "payload",
)
PERSISTENT = 2
BASE_DELAY_MS = 1_000
DELAY_FACTOR = 4
DELAY_CAP_MS = 60_000
MAX_ATTEMPTS = 5
RECONNECT_MS: tuple[int, ...] = (1_000, 2_000, 4_000, 8_000, 16_000, 30_000)
exchange=(e.get("BUS_EXCHANGE") or "course.events").strip(),
`
	for rel, body := range map[string]string{
		"api/src/bus.ts":          ts,
		"ai/src/course_ai/bus.py": py,
	} {
		p := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestSiblingsThatAgreeProduceNoFaults(t *testing.T) {
	// This is the half that proves the reader is READING. If it matched nothing,
	// every value would compare as zero against this package's real constants and
	// the faults below would be full, not empty.
	faults, err := VerifyContract(fixture(t, [2]string{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(faults) != 0 {
		t.Fatalf("fixtures that match this package reported drift: %v", faults)
	}
}

func TestEveryConstantInTheContractIsActuallyCompared(t *testing.T) {
	// A checker that reads six values and compares five is the silent gap this
	// whole file exists to prevent. Each case changes ONE thing and expects the
	// fault to name it.
	cases := []struct {
		what    string
		from    string
		to      string
		expects string
	}{
		{"the attempt ceiling", "MAX_ATTEMPTS = 5", "MAX_ATTEMPTS = 6", "MAX_ATTEMPTS"},
		{"the first backoff", "BASE_DELAY_MS = 1_000", "BASE_DELAY_MS = 2_000", "BASE_DELAY_MS"},
		{"the growth factor", "DELAY_FACTOR = 4", "DELAY_FACTOR = 3", "DELAY_FACTOR"},
		{"the backoff cap", "DELAY_CAP_MS = 60_000", "DELAY_CAP_MS = 30_000", "DELAY_CAP_MS"},
		{"the delivery mode", "PERSISTENT = 2", "PERSISTENT = 1", "PERSISTENT"},
		{"an envelope field name", "'idempotency_key'", "'idempotencyKey'", "ENVELOPE_FIELDS"},
		{"the reconnect ladder", "[1_000, 2_000, 4_000, 8_000, 16_000, 30_000]", "[1_000, 2_000]", "RECONNECT_MS"},
		// A different exchange name breaks nothing loudly: it silently splits the
		// fleet in two, and every publish still looks confirmed.
		{"the default exchange", "'course.events'", "'curso.eventos'", "BUS_EXCHANGE"},
	}
	for _, tc := range cases {
		t.Run(tc.what, func(t *testing.T) {
			faults, err := VerifyContract(fixture(t, [2]string{tc.from, tc.to}))
			if err != nil {
				t.Fatal(err)
			}
			if len(faults) == 0 {
				t.Fatalf("changing %s went undetected", tc.what)
			}
			named := false
			for _, f := range faults {
				if strings.Contains(f, tc.expects) {
					named = true
				}
			}
			if !named {
				t.Fatalf("the fault does not name %s: %v", tc.expects, faults)
			}
		})
	}
}

func TestAnUnreadableConstantIsAnErrorAndNeverAPass(t *testing.T) {
	dir := t.TempDir()
	for _, rel := range []string{"api/src/bus.ts", "ai/src/course_ai/bus.py"} {
		p := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		// A file that exists and says nothing: the shape a rename produces.
		if err := os.WriteFile(p, []byte("// moved elsewhere\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	_, err := VerifyContract(dir)
	if err == nil {
		t.Fatal("a file with no recognisable constants was reported as verified")
	}
	// The error has to name the constant it could not find, or the person reading
	// it has to go looking for which of seven things moved.
	if !strings.Contains(err.Error(), "cannot find") {
		t.Fatalf("the error does not say what was missing: %v", err)
	}
}

func TestAMissingSiblingFileIsAnErrorNotAnEmptyPass(t *testing.T) {
	if _, err := VerifyContract(t.TempDir()); err == nil {
		t.Fatal("an empty directory was reported as a verified contract")
	}
}

func TestOnlyOneSiblingPresentIsAnErrorNotABestGuess(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "api/src/bus.ts")
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Walking up must not silently climb PAST a half-present pair and then
	// "verify" against some unrelated directory higher up -- which, on a
	// developer machine, would be the real repository and would pass.
	if _, err := FindSiblingRoot(p); err == nil {
		t.Fatal("a directory with one of the two siblings was accepted")
	}
}

func TestFindSiblingRootLocatesTheRepositoryFromInsideThePackage(t *testing.T) {
	// Not a comparison -- just proof that the locator works on the real tree, so
	// `queue-topology contract` cannot fail for a path reason nobody noticed.
	// Skipped ONLY when the siblings are genuinely absent (the Docker build),
	// and the skip says so rather than passing quietly.
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	root, err := FindSiblingRoot(wd)
	if err != nil {
		t.Skipf("the sibling tree is not present here, so the locator was NOT exercised: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "docker-compose.yml")); err != nil {
		t.Fatalf("located %s, which does not look like the repository root: %v", root, err)
	}
}
