// Package audit is the record of what the agents did, and it is built so that
// deleting a line from it is detectable.
//
// WHY A HASH CHAIN AND NOT A LOG FILE
// The first thing an attacker who reaches the host does is remove the evidence.
// A plain append-only file is trivially edited: drop the three lines about your
// session, and the log reads as a normal day. Chaining each record to the hash
// of the one before it does not PREVENT that -- nothing on the same host can --
// but it makes it loud: `audit verify` reports the exact line where the chain
// breaks, so «the log is clean» and «the log was cleaned» stop looking alike.
//
// This is deliberately not a database. The audit log has to be writable when
// Postgres is the thing that is broken, and readable with `cat` when the tooling
// is what is broken.
package audit

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Genesis is the previous-hash value of the first record. A fixed, documented
// constant so an empty log and a truncated-to-empty log are distinguishable: a
// log whose first record does not chain from Genesis lost its beginning.
const Genesis = "genesis"

// Record is one line of the log. Field order in the struct is the field order in
// the JSON, and the JSON is what gets hashed, so reordering these fields
// invalidates every existing chain. That is intended: the schema is part of what
// is being attested.
type Record struct {
	Seq       int64             `json:"seq"`
	At        string            `json:"at"`
	Agent     string            `json:"agent"`
	Event     string            `json:"event"`
	Verdict   string            `json:"verdict,omitempty"`
	Kind      string            `json:"kind,omitempty"`
	Target    string            `json:"target,omitempty"`
	FindingID string            `json:"finding_id,omitempty"`
	TTLSec    int               `json:"ttl_s,omitempty"`
	Argv      []string          `json:"argv,omitempty"`
	Undo      []string          `json:"undo,omitempty"`
	Why       string            `json:"why,omitempty"`
	Extra     map[string]string `json:"extra,omitempty"`
	Prev      string            `json:"prev"`
	Hash      string            `json:"hash"`
}

// Log is an append-only chained file.
type Log struct {
	mu   sync.Mutex
	path string
	now  func() time.Time
	seq  int64
	prev string
}

// Open reads the tail of an existing log to pick up the chain, or starts a new
// one. It does NOT verify the whole chain -- that is `Verify`, and doing it on
// every start would mean a corrupted log stops the responder from running, which
// is backwards: a broken log is a reason to shout, not a reason to stop
// defending.
func Open(path string, now func() time.Time) (*Log, error) {
	if now == nil {
		now = time.Now
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, fmt.Errorf("audit: cannot create %s: %w", filepath.Dir(path), err)
	}
	l := &Log{path: path, now: now, prev: Genesis}
	recs, err := Read(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if n := len(recs); n > 0 {
		l.seq = recs[n-1].Seq
		l.prev = recs[n-1].Hash
	}
	return l, nil
}

// Append writes one record, chained to the previous one, and fsyncs.
//
// The fsync is not paranoia about performance-free durability: the records worth
// having are the ones written immediately before the machine stopped behaving,
// and those are exactly the ones a buffered write loses.
func (l *Log) Append(r Record) (Record, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.seq++
	r.Seq = l.seq
	r.At = l.now().UTC().Format("2006-01-02T15:04:05.000Z")
	r.Prev = l.prev
	r.Hash = hashOf(r)

	line, err := json.Marshal(r)
	if err != nil {
		l.seq--
		return Record{}, fmt.Errorf("audit: cannot encode record: %w", err)
	}
	f, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o640)
	if err != nil {
		l.seq--
		return Record{}, fmt.Errorf("audit: cannot open %s: %w", l.path, err)
	}
	defer f.Close()
	if _, err := f.Write(append(line, '\n')); err != nil {
		l.seq--
		return Record{}, fmt.Errorf("audit: cannot write to %s: %w", l.path, err)
	}
	if err := f.Sync(); err != nil {
		return Record{}, fmt.Errorf("audit: wrote but could not fsync %s: %w", l.path, err)
	}
	l.prev = r.Hash
	return r, nil
}

// Path reports where the log lives, for the escalation that tells a human where
// to look.
func (l *Log) Path() string { return l.path }

// hashOf is sha256 over the record with Hash blanked. Prev is INSIDE the hashed
// bytes, which is what chains the records: changing an earlier line changes its
// hash, which is the next line's Prev, which changes every hash after it.
func hashOf(r Record) string {
	r.Hash = ""
	b, err := json.Marshal(r)
	if err != nil {
		// Marshal of this struct cannot fail on well-formed input; a panic here
		// would be a silent unhashed record otherwise.
		panic("audit: cannot hash record: " + err.Error())
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// Read parses every record. A malformed line is an error naming its number: a
// parser that skipped it would report a shorter, clean log.
func Read(path string) ([]Record, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []Record
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64<<10), 1<<20)
	n := 0
	for sc.Scan() {
		n++
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var r Record
		if err := json.Unmarshal(line, &r); err != nil {
			return out, fmt.Errorf("audit: %s line %d is not a record: %w", path, n, err)
		}
		out = append(out, r)
	}
	if err := sc.Err(); err != nil && !errors.Is(err, io.EOF) {
		return out, fmt.Errorf("audit: reading %s: %w", path, err)
	}
	return out, nil
}

// Verify walks the chain and reports every break, with the sequence number.
//
// It returns ALL the problems rather than the first: an attacker who edited one
// line and a disk that corrupted a different one look the same if you stop at
// the first mismatch.
func Verify(path string) []error {
	recs, err := Read(path)
	if err != nil {
		return []error{err}
	}
	var errs []error
	prev := Genesis
	var lastSeq int64
	for i, r := range recs {
		if r.Prev != prev {
			errs = append(errs, fmt.Errorf("audit: record %d (seq %d) chains from %q but the previous "+
				"record hashes to %q -- a record between them was changed or removed",
				i+1, r.Seq, short(r.Prev), short(prev)))
		}
		if want := hashOf(r); want != r.Hash {
			errs = append(errs, fmt.Errorf("audit: record %d (seq %d) has hash %q but its contents "+
				"hash to %q -- this record was edited in place", i+1, r.Seq, short(r.Hash), short(want)))
		}
		if r.Seq != lastSeq+1 {
			errs = append(errs, fmt.Errorf("audit: record %d jumps from seq %d to %d -- %d record(s) "+
				"are missing", i+1, lastSeq, r.Seq, r.Seq-lastSeq-1))
		}
		lastSeq = r.Seq
		prev = r.Hash
	}
	return errs
}

func short(h string) string {
	if len(h) <= 12 {
		return h
	}
	return h[:12]
}
