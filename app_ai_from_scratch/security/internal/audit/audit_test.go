package audit

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newLog(t *testing.T) (*Log, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "sub", "audit.jsonl")
	n := time.Unix(1_700_000_000, 0)
	l, err := Open(path, func() time.Time { n = n.Add(time.Second); return n })
	if err != nil {
		t.Fatal(err)
	}
	return l, path
}

func write(t *testing.T, l *Log, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		if _, err := l.Append(Record{Agent: "neo", Event: "decision", Kind: "ban_host_ip",
			Target: "192.168.1.50", Why: "brute force"}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestACleanChainVerifies(t *testing.T) {
	l, path := newLog(t)
	write(t, l, 5)
	if errs := Verify(path); len(errs) > 0 {
		t.Fatalf("a log this process just wrote does not verify: %v", errs)
	}
	recs, err := Read(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 5 {
		t.Fatalf("read %d records, wrote 5", len(recs))
	}
	if recs[0].Prev != Genesis {
		t.Errorf("the first record chains from %q, want %q -- otherwise a log whose beginning was "+
			"removed looks complete", recs[0].Prev, Genesis)
	}
}

// The point of the chain: editing a line in place is detectable. This is the
// first thing somebody does after reaching the host.
func TestAnEditedRecordIsCaught(t *testing.T) {
	l, path := newLog(t)
	write(t, l, 5)

	recs, _ := Read(path)
	recs[2].Target = "10.9.9.9" // "it wasn't me"
	rewrite(t, path, recs)

	errs := Verify(path)
	if len(errs) == 0 {
		t.Fatal("an edited record verified clean; the chain is not doing anything")
	}
	joined := joinErrs(errs)
	if !strings.Contains(joined, "edited in place") {
		t.Errorf("the report should name the tampering: %s", joined)
	}
	if !strings.Contains(joined, "seq 3") {
		t.Errorf("the report should name WHICH record: %s", joined)
	}
}

// And removing a line entirely, which is the more likely cleanup.
func TestARemovedRecordIsCaught(t *testing.T) {
	l, path := newLog(t)
	write(t, l, 5)

	recs, _ := Read(path)
	kept := append(recs[:2:2], recs[3:]...) // drop record 3
	rewrite(t, path, kept)

	errs := Verify(path)
	if len(errs) == 0 {
		t.Fatal("a log with a record removed verified clean")
	}
	joined := joinErrs(errs)
	if !strings.Contains(joined, "missing") {
		t.Errorf("the report should say a record is missing: %s", joined)
	}
}

// Truncating the FRONT of the log is the cheapest attack of all: no record is
// edited, and every remaining hash is still correct with respect to its
// neighbour. Only the Genesis anchor and the sequence numbers catch it.
func TestTruncatingTheBeginningIsCaught(t *testing.T) {
	l, path := newLog(t)
	write(t, l, 5)
	recs, _ := Read(path)
	rewrite(t, path, recs[2:])

	errs := Verify(path)
	if len(errs) == 0 {
		t.Fatal("a log missing its first records verified clean; the Genesis anchor is not working")
	}
}

func TestReopeningContinuesTheChain(t *testing.T) {
	l, path := newLog(t)
	write(t, l, 3)

	// A restart. If Open did not pick up the tail, the next record would chain
	// from Genesis and every later record would verify against nothing.
	n := time.Unix(1_800_000_000, 0)
	l2, err := Open(path, func() time.Time { n = n.Add(time.Second); return n })
	if err != nil {
		t.Fatal(err)
	}
	write(t, l2, 2)

	if errs := Verify(path); len(errs) > 0 {
		t.Fatalf("the chain broke across a restart: %v", errs)
	}
	recs, _ := Read(path)
	if len(recs) != 5 {
		t.Fatalf("got %d records, want 5", len(recs))
	}
	if recs[4].Seq != 5 {
		t.Errorf("sequence restarted after reopening: last seq is %d", recs[4].Seq)
	}
}

func TestAMalformedLineIsReportedNotSkipped(t *testing.T) {
	l, path := newLog(t)
	write(t, l, 2)
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o640)
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString("{not json\n")
	f.Close()

	if _, err := Read(path); err == nil {
		t.Fatal("a malformed line was skipped. A parser that skips reports a shorter, clean log")
	}
	if errs := Verify(path); len(errs) == 0 {
		t.Fatal("Verify passed over a malformed line")
	}
}

func rewrite(t *testing.T, path string, recs []Record) {
	t.Helper()
	var b strings.Builder
	for _, r := range recs {
		line, err := json.Marshal(r)
		if err != nil {
			t.Fatal(err)
		}
		b.Write(line)
		b.WriteByte('\n')
	}
	if err := os.WriteFile(path, []byte(b.String()), 0o640); err != nil {
		t.Fatal(err)
	}
}

func joinErrs(errs []error) string {
	parts := make([]string, 0, len(errs))
	for _, e := range errs {
		parts = append(parts, e.Error())
	}
	return strings.Join(parts, " | ")
}
