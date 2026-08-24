package bus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// IDEMPOTENCY.
//
// A CLAIM IS A LEASE, NOT A FLAG. Marking "done" before running loses work when
// the process dies mid-handler; marking it only after running lets a redelivery
// run the handler twice. So the record says running|done plus who and when:
//
//	no row                                 -> claim it, run the handler
//	running, ours                          -> we crashed holding it; take it again
//	running, theirs, fresh                 -> somebody is on it; skip
//	running, theirs, older than the lease  -> they died; take it
//	done                                   -> skip, forever
//
// A failed handler RELEASES its claim, so the scheduled retry is not mistaken
// for a duplicate.
//
// WHERE THE ROW LIVES, and why not here. api/src/bus.ts owns it in Postgres
// (`jobs`, UNIQUE (tipo, clave), the race decided by ON CONFLICT). This service
// deliberately has no database: the moment it opens one it becomes a second
// writer to api's tables, which is argument 4 against an orchestrator in
// docs/ARCHITECTURE.md. So the durable claim goes over HTTP to api, exactly as
// ai/src/course_ai/bus.py does it, with the same `x-ia-secreto` proof-of-origin.
//
// STATE OF THE WIRING, stated plainly and unchanged from the note in bus.py: the
// route APIClaims posts to (BUS_CLAIM_URL, e.g.
// http://api:8787/api/v3/interno/bus/claim) DOES NOT EXIST YET. Until it does,
// a queue service started without BUS_CLAIM_URL uses MemoryClaims and says so
// loudly at boot and in /health.

// Claims is the idempotency lease.
type Claims interface {
	// Claim reports whether this process may run the work for key. An error
	// means "unknown", and unknown must never be read as "go ahead".
	Claim(ctx context.Context, key string) (bool, error)
	Complete(ctx context.Context, key string) error
	Release(ctx context.Context, key string) error
}

// MemoryClaims dedupes inside ONE process life. Enough for tests, not enough for
// a restart: a redelivery after a crash can run a handler twice.
type MemoryClaims struct {
	mu   sync.Mutex
	seen map[string]string
}

// NewMemoryClaims returns claims that only this process remembers.
func NewMemoryClaims() *MemoryClaims {
	return &MemoryClaims{seen: map[string]string{}}
}

// Durable reports whether a restart would remember. Surfaced by /health so that
// "idempotency is in memory" is visible rather than assumed.
func (m *MemoryClaims) Durable() bool { return false }

func (m *MemoryClaims) Claim(_ context.Context, key string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.seen[key] != "" {
		return false, nil
	}
	m.seen[key] = "running"
	return true, nil
}

func (m *MemoryClaims) Complete(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.seen[key] = "done"
	return nil
}

func (m *MemoryClaims) Release(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.seen, key)
	return nil
}

// APIClaims is the durable claim: one HTTP call to api, which owns the row.
//
// Authenticated with the service secret (`x-ia-secreto`), the same
// proof-of-origin the tool bridge uses. It carries no user identity because a
// worker has no user: an idempotency key is not a person.
type APIClaims struct {
	URL     string
	Secret  string
	Owner   string
	LeaseS  float64
	Timeout time.Duration
	// Client, when set, is used as-is. Left nil -- which is what
	// cmd/queue/main.go does -- one pooled client is built on first use. See
	// httpClient.
	Client *http.Client

	once   sync.Once
	shared *http.Client
}

// maxIdleClaimConns is how many idle connections to api the claim path keeps.
//
// The claim path runs once per delivery per outcome, so its concurrency is the
// consumer's prefetch: BUS_PREFETCH defaults to 8 and defense's oracle runs 16.
// 64 is four times the highest setting in this tree, which leaves room for a
// prefetch somebody raises without having to remember this constant. The cost of
// an idle connection is one file descriptor until IdleConnTimeout drops it; the
// cost of too FEW is measured in httpClient below.
const maxIdleClaimConns = 64

// httpClient returns the client to post with, building the shared one once.
//
// ONE client, ONE transport, for the life of the process. That is not tidiness,
// it is the difference between a claim path that scales with prefetch and one
// that cannot.
//
// post() used to build `&http.Client{Timeout: timeout}` on every call. That
// looks free, because a zero Transport falls back to http.DefaultTransport,
// which does pool connections. The problem is what it pools to:
// DefaultTransport.MaxIdleConnsPerHost is 2. Every delivery makes two claim
// calls -- Claim, then Complete or Release -- so a consumer at the default
// BUS_PREFETCH=8 has up to 16 in flight against a ceiling of 2 reusable
// connections, and the other 14 open a fresh TCP connection and throw it away.
//
// Measured against a local httptest server, 100 batches per figure:
//
//	prefetch 8    per call site   us/batch   NEW TCP connections per batch
//	              as shipped           649                             8.6
//	              pooled               259                            0.08
//	prefetch 16   as shipped          1166                            19.6
//	              pooled               375                            0.17
//
// 2.3x and 3.1x. The socket count matters more than the microseconds: at
// prefetch 16 the shipped version opened and discarded a connection for very
// nearly every claim, and the benchmark process died with "can't assign
// requested address" -- the host ran out of ephemeral ports. A worker under
// sustained load does that to api, and it presents as api refusing connections
// rather than as a queue bug, which is the worst way for this to show up.
func (a *APIClaims) httpClient(timeout time.Duration) *http.Client {
	if a.Client != nil {
		return a.Client
	}
	a.once.Do(func() {
		// Clone rather than build from scratch, to keep DefaultTransport's dial
		// timeouts, proxy handling and HTTP/2 attempt. Guarded, because
		// DefaultTransport is a package variable anything could have replaced,
		// and a panic here would take down a worker over a connection pool.
		tr := &http.Transport{}
		if def, ok := http.DefaultTransport.(*http.Transport); ok {
			tr = def.Clone()
		}
		tr.MaxIdleConnsPerHost = maxIdleClaimConns
		tr.MaxIdleConns = maxIdleClaimConns
		// Timeout as well as the per-request context deadline in post(). Two
		// belts: the context bounds the call, this bounds a client that somehow
		// gets used without one.
		a.shared = &http.Client{Transport: tr, Timeout: timeout}
	})
	return a.shared
}

// Durable reports whether a restart would remember. It would: the row is api's.
func (a *APIClaims) Durable() bool { return true }

func (a *APIClaims) post(ctx context.Context, action, key string) (map[string]any, error) {
	timeout := a.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	// A deadline on every call, always. Without it a claim service that accepts
	// the connection and never answers holds a prefetch slot until the process
	// is killed, which is the failure mode this whole package is built to avoid.
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// The field names are the wire contract with api/src/bus.ts's pgClaims and
	// with bus.py's ApiClaims. They are not ours to rename.
	body, err := json.Marshal(map[string]any{
		"action": action, "key": key, "owner": a.Owner, "lease_s": a.LeaseS,
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.URL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-ia-secreto", a.Secret)
	res, err := a.httpClient(timeout).Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, fmt.Errorf("claim %s: api answered %d", action, res.StatusCode)
	}
	var out map[string]any
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("claim %s: unreadable answer: %w", action, err)
	}
	return out, nil
}

// Claim asks api for the lease.
//
// A claim service that cannot be reached must NOT be read as "go ahead": that
// would turn a network blip into a double run. The error propagates, the handler
// does not run, and the message is retried.
func (a *APIClaims) Claim(ctx context.Context, key string) (bool, error) {
	out, err := a.post(ctx, "claim", key)
	if err != nil {
		return false, err
	}
	claimed, _ := out["claimed"].(bool)
	return claimed, nil
}

func (a *APIClaims) Complete(ctx context.Context, key string) error {
	_, err := a.post(ctx, "complete", key)
	return err
}

func (a *APIClaims) Release(ctx context.Context, key string) error {
	_, err := a.post(ctx, "release", key)
	return err
}

// ErrNoClaims is returned when neither a durable nor an explicit in-memory claim
// store was configured. It exists so that "no idempotency at all" cannot be a
// silent default.
var ErrNoClaims = errors.New("bus: no idempotency store configured")
