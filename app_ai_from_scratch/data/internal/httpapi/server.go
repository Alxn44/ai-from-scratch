// Package httpapi is the wire surface: one endpoint that takes an operation
// NAME, and no endpoint that takes SQL.
//
// WHY net/http AND NOT FIBER
// queue/ uses Fiber and that is the right call there. This service holds the
// only database credential in the fleet, so its dependency list is part of its
// threat model: every third-party package here is code with access to the DSN's
// process. net/http is in the standard library, this service serves one route
// with no templating, no websockets and no static files, and the performance
// difference is irrelevant next to a Postgres round trip. Fewer dependencies is
// the feature.
//
// AUTHENTICATION, and its honest limit
// A caller presents a shared secret and an actor id. The secret says "you are
// api"; the actor says "acting for this person". So api is TRUSTED to state who
// the actor is, and this service cannot verify that claim -- it has no session
// table and no cookie.
//
// That is a real limit and it is worth being precise about what isolation
// survives it. It does NOT stop a fully compromised api from asking for any
// single person's rows. It DOES stop it from reading a table nobody declared,
// from reading a jamas column, from reading everybody at once, and from running
// a statement of its own. The blast radius goes from "the database" to "one
// actor at a time, through eleven shapes". Fixing the remaining gap needs api to
// pass something this service can verify independently -- a signed session
// assertion -- and that is written down in README.md as the next step rather
// than pretended away here.
package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"course/data/internal/op"
	"course/data/internal/plan"
	"course/data/internal/store"
)

// Headers. `x-data-secreto` keeps the Spanish spelling on purpose: it joins
// x-ia-secreto and x-ia-sesion as a WIRE VALUE, and CLAUDE.md lists those as a
// deliberate exception to the English rule because renaming one breaks two
// services at once.
const (
	HeaderSecret = "x-data-secreto"
	HeaderActor  = "x-data-actor"
)

// Server is the HTTP surface.
type Server struct {
	st     *store.Store
	secret string
	log    *slog.Logger
}

// New builds the server. It refuses a weak secret rather than starting with one.
func New(st *store.Store, secret string, lg *slog.Logger) (*Server, error) {
	if lg == nil {
		lg = slog.Default()
	}
	// The same rule api/src/auth.ts learned the hard way: this repository
	// shipped a 35-character placeholder that passed a length check and worked
	// as a real signing key while sitting in git.
	if len(secret) < 32 {
		return nil, fmt.Errorf("httpapi: DATA_SECRETO is %d characters; it must be at least 32. "+
			"This is the only thing standing between the network and the database", len(secret))
	}
	for _, weak := range []string{"changeme", "secret", "dev-only-change-me", "cambia-esto"} {
		if strings.Contains(strings.ToLower(secret), weak) {
			return nil, fmt.Errorf("httpapi: DATA_SECRETO contains %q, so it is a placeholder "+
				"somebody has published. Generate one with scripts/keys.sh", weak)
		}
	}
	return &Server{st: st, secret: secret, log: lg}, nil
}

// Handler wires the routes. There are two, and neither accepts SQL.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/op", s.handleOp)
	mux.HandleFunc("POST /v1/query", s.handleQuery)
	mux.HandleFunc("GET /v1/plannable", s.handlePlannable)
	mux.HandleFunc("GET /v1/catalog", s.handleCatalog)
	mux.HandleFunc("GET /health", s.handleHealth)
	return mux
}

type request struct {
	Op   string         `json:"op"`
	Args map[string]any `json:"args"`
}

func (s *Server) handleOp(w http.ResponseWriter, r *http.Request) {
	if !s.authorised(r) {
		// No detail. A caller that fails this check learns only that it failed:
		// distinguishing "wrong secret" from "no secret" is a free hint.
		fail(w, http.StatusUnauthorized, "unauthorised", "")
		return
	}
	// A hard body cap. Arguments are short by construction -- the longest
	// declared Text is 8000 bytes -- so anything larger is either a bug or an
	// attempt to make this service allocate.
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)

	var req request
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "bad_request",
			"the body must be {\"op\": \"name\", \"args\": {...}} and nothing else")
		return
	}
	if req.Op == "" {
		fail(w, http.StatusBadRequest, "bad_request", "no operation named")
		return
	}

	actor, err := actorOf(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_actor", err.Error())
		return
	}

	res, err := s.st.Call(r.Context(), req.Op, actor, req.Args)
	switch {
	case errors.Is(err, store.ErrUnknownOperation):
		// The refusal that makes the catalogue closed. It names what IS
		// available, because the caller is api and a typo should be diagnosable.
		fail(w, http.StatusNotFound, "unknown_operation",
			fmt.Sprintf("this service performs only the operations in its catalogue; "+
				"GET /v1/catalog lists the %d it has", len(op.Catalog())))
		return
	case err != nil:
		// Logged in full, returned in summary. The full text can contain column
		// names and constraint names, and that is a map of the schema.
		s.log.Error("operation failed", "op", req.Op, "err", err)
		fail(w, http.StatusBadRequest, "refused", err.Error())
		return
	}

	if len(res.Scrubbed) > 0 {
		// This should be impossible: the startup check makes a forbidden column
		// unreachable through a declared operation. If it happens, a migration
		// added a column no declaration mentions, and the guard caught it on the
		// way out. Shout.
		s.log.Error("the guard removed columns at RUNTIME, which the startup check should have made "+
			"impossible. A migration has added a column that no operation declares",
			"op", req.Op, "removed", strings.Join(res.Scrubbed, ","))
	}
	writeJSON(w, http.StatusOK, res)
}

// handleQuery executes a COMPOSED PLAN.
//
// The second surface of this service. /v1/op runs one of a closed list of named
// statements; this runs a statement ASSEMBLED from a plan the caller composed.
// It is not a SQL endpoint and the distinction is the whole design: the body
// carries a table name, column names and values, every one of which is checked
// against the ontology before a character of SQL exists. internal/plan holds the
// threat model.
//
// The actor comes from the same header as everywhere else, so a plan has no
// field for an identity and P3 is a property of the format.
func (s *Server) handleQuery(w http.ResponseWriter, r *http.Request) {
	if !s.authorised(r) {
		fail(w, http.StatusUnauthorized, "unauthorised", "")
		return
	}
	// Larger than /v1/op's cap because a plan carries an IN list, and smaller
	// than anything that would let a caller make this service allocate.
	r.Body = http.MaxBytesReader(w, r.Body, 128<<10)

	var p plan.Plan
	dec := json.NewDecoder(r.Body)
	// The same refusal /v1/op makes, and it matters more here: an unknown field
	// is a caller reaching for a feature this planner does not have -- a join, a
	// having clause, a raw fragment -- and answering 400 with the field name is
	// how a model learns the surface instead of believing it worked.
	dec.DisallowUnknownFields()
	if err := dec.Decode(&p); err != nil {
		fail(w, http.StatusBadRequest, "bad_request",
			"the body must be a query plan: {\"table\", \"select\", \"where\", \"group\", "+
				"\"aggregate\", \"order\", \"limit\"} and nothing else. "+err.Error())
		return
	}
	actor, err := actorOf(r)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_actor", err.Error())
		return
	}

	res, err := s.st.Query(r.Context(), p, actor)
	if err != nil {
		// The plan's own refusals are returned in full. They name what IS
		// readable, never a forbidden value, and a model that is told
		// "readable: draft, id, idx, kind, lesson_n, level" fixes its plan on the
		// next turn instead of probing.
		s.log.Info("plan refused", "table", p.Table, "err", err)
		fail(w, http.StatusBadRequest, "refused", err.Error())
		return
	}
	if len(res.Scrubbed) > 0 {
		s.log.Error("the guard removed columns from a planned query at RUNTIME, which means the "+
			"database returned a column the plan did not name",
			"table", p.Table, "removed", strings.Join(res.Scrubbed, ","))
	}
	writeJSON(w, http.StatusOK, res)
}

// handlePlannable tells the caller what a plan may read.
//
// Exists so a model does not have to probe. An agent that discovers its surface
// costs one request; an agent that guesses costs a refusal per guess, and each
// refusal is a turn of a language model. Nothing here is secret: it is the list
// of columns that are neither jamas nor de_pago, which is the definition of
// readable.
func (s *Server) handlePlannable(w http.ResponseWriter, r *http.Request) {
	if !s.authorised(r) {
		fail(w, http.StatusUnauthorized, "unauthorised", "")
		return
	}
	type table struct {
		Columns []string `json:"columns"`
		// Scope names the column this service will filter by, or is empty for
		// public content. Reported so the caller knows a result is its own rows
		// and not everybody's.
		Scope string `json:"scope,omitempty"`
	}
	out := map[string]table{}
	for name, scope := range s.st.PlannableTables() {
		cols, err := s.st.Selectable(name)
		if err != nil {
			continue
		}
		out[name] = table{Columns: cols, Scope: scope}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"tables":     out,
		"operators":  []string{"=", "<>", "<", "<=", ">", ">=", "in", "like", "is_null", "is_not_null"},
		"aggregates": []string{"count", "sum", "avg", "min", "max"},
		"limits": map[string]int{
			"max_rows": plan.MaxLimit, "default_rows": plan.DefaultLimit,
			"max_filters": plan.MaxConds, "max_in_values": plan.MaxInValues,
		},
	})
}

// handleCatalog lists what this service can do. Safe to expose to an
// authenticated caller: the names and the parameter shapes are not secrets, and
// api needs them to fail fast on a typo. The SQL is NOT included -- it is a map
// of the schema, and nothing legitimate needs it over the wire.
func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request) {
	if !s.authorised(r) {
		fail(w, http.StatusUnauthorized, "unauthorised", "")
		return
	}
	type param struct {
		Name string `json:"name"`
		Kind string `json:"kind"`
	}
	type entry struct {
		Name     string `json:"name"`
		Table    string `json:"table"`
		Scope    string `json:"scope"`
		Audience string `json:"audience"`
		// Muro is exposed because this service DECLARES the paywall and does not
		// enforce it: whether a given person may read a given lesson is product
		// policy that lives in api. api asserting "every call site of a de_pago
		// operation sits behind an access check" needs to know which operations
		// those are, and reading it from here means there is no second list to
		// drift.
		Muro    string   `json:"muro"`
		Write   bool     `json:"write"`
		Returns []string `json:"returns,omitempty"`
		Params  []param  `json:"params,omitempty"`
		Why     string   `json:"why"`
	}
	out := make([]entry, 0, len(op.Catalog()))
	for _, o := range op.Catalog() {
		e := entry{Name: o.Name, Table: o.Table, Scope: string(o.Scope),
			Audience: string(o.Audience), Muro: string(o.Muro),
			Write: o.Write, Returns: o.Returns, Why: o.Why}
		for _, p := range o.Params {
			e.Params = append(e.Params, param{Name: p.Name, Kind: string(p.Kind)})
		}
		out = append(out, e)
	}
	writeJSON(w, http.StatusOK, map[string]any{"count": len(out), "operations": out})
}

// handleHealth is unauthenticated and says almost nothing: it is read by the
// container runtime, and a health endpoint that reports version numbers and
// connection counts is a reconnaissance endpoint.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := s.st.Ping(r.Context()); err != nil {
		s.log.Error("health: the database is not answering", "err", err)
		fail(w, http.StatusServiceUnavailable, "unavailable", "")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// authorised compares the secret in CONSTANT TIME. A byte-by-byte compare that
// returns early leaks the secret one byte at a time to anybody who can measure a
// few thousand requests, and this secret is the whole of the authentication.
func (s *Server) authorised(r *http.Request) bool {
	given := r.Header.Get(HeaderSecret)
	if given == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(given), []byte(s.secret)) == 1
}

// actorOf reads the acting person's id from the header, and ONLY from the
// header. It is never read from the body: a body field named `actor` would be a
// value a caller sets, and the whole scope model depends on that being
// impossible.
func actorOf(r *http.Request) (int64, error) {
	raw := r.Header.Get(HeaderActor)
	if raw == "" {
		// Not an error: public operations take no actor, and requiring one would
		// mean inventing an identity for a request about the lesson list.
		return 0, nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", HeaderActor)
	}
	return n, nil
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.Header().Set("x-content-type-options", "nosniff")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, errCode, detail string) {
	body := map[string]any{"error": errCode}
	if detail != "" {
		body["detail"] = detail
	}
	writeJSON(w, code, body)
}

// ReadTimeouts are deliberately short. This service answers one Postgres query
// per request; a slow request is a stuck one.
var ReadTimeouts = struct{ Read, Write, Idle time.Duration }{
	Read: 10 * time.Second, Write: 20 * time.Second, Idle: 60 * time.Second,
}
