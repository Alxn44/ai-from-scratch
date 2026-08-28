// Package store is the ONLY thing in this fleet that holds a database
// credential, and the only place a statement is executed.
//
// That sentence is the point of /data. Before it existed, api held the DSN and
// any code in api could run any SQL. After the migration completes, api holds no
// DSN at all: it can call `lesson.list`, and if it wants something the catalogue
// does not describe, it cannot have it -- not because a reviewer said no, but
// because there is no request that expresses it.
//
// WHAT THIS BUYS, concretely. A remote code execution in api today reads every
// table, including users.pass_hash and the whole payments table. The same bug
// after the migration reads exactly the eleven operations in op.catalog, each
// one scoped to the actor whose session the attacker holds. That is the
// difference between "the database is gone" and "one person's rows are gone".
//
// WHAT IT COSTS, stated plainly: every query becomes a network round trip on the
// docker network. On a Raspberry Pi 4B that is real. The mitigation is that
// operations are coarse -- one call returns the rows a page needs -- and the
// measurement belongs in the README rather than in a guess here.
package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"course/data/internal/guard"
	"course/data/internal/op"
	"course/data/internal/plan"
)

// Store holds the pool and the ontology.
type Store struct {
	pool *pgxpool.Pool
	ont  *guard.Ontology
	ops  map[string]op.Operation
}

// ErrUnknownOperation is a refusal, and it is what makes the catalogue closed.
// It is deliberately NOT wrapped with the caller's input in a way that would
// echo it back into a log at error level: an attacker probing for operation
// names should not be able to fill the disk with their own strings.
var ErrUnknownOperation = errors.New("no such operation")

// Open builds a pool and verifies the catalogue before returning.
//
// Verification happens HERE rather than in the server, so there is no path that
// obtains a working Store without the guarantees having been checked.
func Open(ctx context.Context, dsn string, ont *guard.Ontology) (*Store, error) {
	if errs := op.Verify(ont); len(errs) > 0 {
		var b strings.Builder
		for _, e := range errs {
			fmt.Fprintf(&b, "\n  %v", e)
		}
		return nil, fmt.Errorf("store: the operation catalogue is invalid, refusing to open a "+
			"database connection:%s", b.String())
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("store: DATABASE_URL is not a usable DSN: %w", err)
	}
	// Small. This service exists on a Raspberry Pi alongside eighteen other
	// containers, and a pool larger than the box can schedule turns a traffic
	// spike into memory pressure rather than into queueing.
	cfg.MaxConns = 8
	cfg.MinConns = 1
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("store: cannot create the pool: %w", err)
	}
	return &Store{pool: pool, ont: ont, ops: op.ByName()}, nil
}

// Close releases the pool.
func (s *Store) Close() {
	if s.pool != nil {
		s.pool.Close()
	}
}

// Ping is what the healthcheck uses.
func (s *Store) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return s.pool.Ping(ctx)
}

// Result is what one operation produced.
type Result struct {
	Operation string           `json:"operation"`
	Rows      []map[string]any `json:"rows,omitempty"`
	Affected  int64            `json:"affected"`
	// Scrubbed names any column the guard removed on the way out. It should
	// always be empty: the startup check makes a forbidden column unreachable
	// through a declared operation. If it is ever non-empty, a migration added a
	// column no declaration mentions, and that is worth shouting about rather
	// than quietly dropping.
	Scrubbed []string `json:"scrubbed,omitempty"`
}

// Call runs one named operation. `actor` is the authenticated caller's own id,
// established by the server from a verified identity -- never from the request
// body.
func (s *Store) Call(ctx context.Context, name string, actor, authority int64, args map[string]any) (*Result, error) {
	o, ok := s.ops[name]
	if !ok {
		return nil, ErrUnknownOperation
	}
	params, err := bind(o, actor, authority, args)
	if err != nil {
		return nil, err
	}

	// One statement, one deadline. Without it a lock wait holds the connection
	// and the caller's request for as long as Postgres is willing to wait, and
	// the symptom presents as "the site is slow" rather than as one bad query.
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	sql := o.SQL()
	if o.Write && len(o.Returns) == 0 {
		tag, err := s.pool.Exec(ctx, sql, params...)
		if err != nil {
			return nil, fmt.Errorf("operation %s failed: %w", name, err)
		}
		return &Result{Operation: name, Affected: tag.RowsAffected()}, nil
	}

	rows, err := s.pool.Query(ctx, sql, params...)
	if err != nil {
		return nil, fmt.Errorf("operation %s failed: %w", name, err)
	}
	defer rows.Close()

	out := &Result{Operation: name}
	scrubbed := map[string]struct{}{}
	fields := rows.FieldDescriptions()
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, fmt.Errorf("operation %s: reading a row: %w", name, err)
		}
		row := make(map[string]any, len(vals))
		for i, f := range fields {
			if i < len(vals) {
				row[string(f.Name)] = vals[i]
			}
		}
		// The DECLARED list, not the forbidden one. Scrubbing by forbidden column
		// stripped the very columns the internal exemptions exist to read:
		// user.credentials_by_email came back with ["role"] alone, so login could
		// not compare a password or set a session. See guard.ScrubToDeclared.
		clean, removed, err := s.ont.ScrubToDeclared(o.Table, row, o.Returns)
		if err != nil {
			return nil, fmt.Errorf("operation %s: %w", name, err)
		}
		for _, r := range removed {
			scrubbed[r] = struct{}{}
		}
		out.Rows = append(out.Rows, clean)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("operation %s: %w", name, err)
	}
	for c := range scrubbed {
		out.Scrubbed = append(out.Scrubbed, c)
	}
	out.Affected = int64(len(out.Rows))
	return out, nil
}

// Query executes a COMPOSED PLAN.
//
// The second entry point of this service, and the one that answers the "make it
// agentic" requirement without handing a language model a SQL string. See
// internal/plan for the threat model; the short version is that the model
// composes a plan, Go emits the statement, and every identifier in it came out
// of the ontology.
//
// The difference from Call is only WHERE the column list comes from: a named
// operation declares Returns, a plan produces Compiled.Columns. Everything after
// that is identical, deliberately -- the same deadline, the same scrub against
// the declared list, the same loud report when the database hands back a column
// nobody asked for.
func (s *Store) Query(ctx context.Context, p plan.Plan, actor int64) (*Result, error) {
	c, err := plan.Compile(s.ont, p, actor)
	if err != nil {
		// Returned to the caller verbatim, and that is deliberate: the caller is
		// a model composing a plan, and "level is not readable on labs, readable:
		// draft, id, idx, kind, lesson_n, level" is what lets it fix its own
		// mistake on the next turn. A generic refusal turns an agent into a
		// guessing loop. None of these messages names a forbidden column's
		// VALUE -- they name what IS readable, which is public by construction.
		return nil, err
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	rows, err := s.pool.Query(ctx, c.SQL, c.Params...)
	if err != nil {
		// The statement is NOT returned. It is assembled from the schema, and a
		// schema is a map; the plan the caller sent is enough to debug with.
		return nil, fmt.Errorf("the plan is valid but the query failed: %w", err)
	}
	defer rows.Close()

	out := &Result{Operation: "query:" + p.Table}
	scrubbed := map[string]struct{}{}
	fields := rows.FieldDescriptions()
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, fmt.Errorf("query on %s: reading a row: %w", p.Table, err)
		}
		row := make(map[string]any, len(vals))
		for i, f := range fields {
			if i < len(vals) {
				row[string(f.Name)] = vals[i]
			}
		}
		clean, removed, err := s.ont.ScrubToDeclared(p.Table, row, c.Columns)
		if err != nil {
			return nil, fmt.Errorf("query on %s: %w", p.Table, err)
		}
		for _, r := range removed {
			scrubbed[r] = struct{}{}
		}
		out.Rows = append(out.Rows, clean)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("query on %s: %w", p.Table, err)
	}
	for c := range scrubbed {
		out.Scrubbed = append(out.Scrubbed, c)
	}
	out.Affected = int64(len(out.Rows))
	return out, nil
}

// Selectable is what a plan may name on one table. Exposed so the tool can tell
// the model what it can ask for instead of letting it guess -- an agent that
// discovers its own surface needs fewer turns than one that probes for it.
func (s *Store) Selectable(table string) ([]string, error) {
	return plan.Selectable(s.ont, table)
}

// PlannableTables lists the tables a plan can read at all, with their scope
// column. A table whose every column is jamas or de_pago is absent, and that is
// the ontology deciding rather than a deny list.
func (s *Store) PlannableTables() map[string]string {
	out := map[string]string{}
	for _, t := range s.ont.Tables() {
		if _, err := plan.Selectable(s.ont, t); err == nil {
			out[t] = plan.ScopeColumn(s.ont, t)
		}
	}
	return out
}

// bind turns the request's arguments into positional parameters, in declaration
// order, refusing anything that does not fit.
//
// Every branch here fails CLOSED. A missing argument is an error, not a NULL: a
// NULL silently changes what a WHERE clause matches, and `WHERE lab_id = NULL`
// matches nothing, which reads as "you have no attempts" rather than as "the
// caller sent a broken request".
func bind(o op.Operation, actor, authority int64, args map[string]any) ([]any, error) {
	out := make([]any, 0, len(o.Params))
	for i, p := range o.Params {
		n := i + 1
		switch p.Kind {
		case op.Actor:
			if actor <= 0 {
				return nil, fmt.Errorf("operation %s needs an authenticated actor and the request "+
					"carried none. This is the parameter a caller is never allowed to supply, so an "+
					"unauthenticated call cannot be served by substituting a value", o.Name)
			}
			out = append(out, actor)
			continue
		case op.Authority:
			if authority <= 0 {
				return nil, fmt.Errorf("operation %s needs an authenticated authority and the request carried none", o.Name)
			}
			out = append(out, authority)
			continue
		}
		raw, present := args[p.Name]
		if !present {
			return nil, fmt.Errorf("operation %s: argument %q ($%d) is missing", o.Name, p.Name, n)
		}
		switch p.Kind {
		case op.Int:
			f, ok := raw.(float64) // JSON numbers arrive as float64
			if !ok {
				return nil, fmt.Errorf("operation %s: argument %q must be a number", o.Name, p.Name)
			}
			v := int64(f)
			if float64(v) != f {
				return nil, fmt.Errorf("operation %s: argument %q must be a whole number", o.Name, p.Name)
			}
			if v < 0 || v > int64(p.Max) {
				return nil, fmt.Errorf("operation %s: argument %q is %d, outside 0..%d",
					o.Name, p.Name, v, p.Max)
			}
			out = append(out, v)
		case op.Text:
			s, ok := raw.(string)
			if !ok {
				return nil, fmt.Errorf("operation %s: argument %q must be a string", o.Name, p.Name)
			}
			if len(s) > p.Max {
				return nil, fmt.Errorf("operation %s: argument %q is %d bytes, the limit is %d",
					o.Name, p.Name, len(s), p.Max)
			}
			out = append(out, s)
		case op.Enum:
			s, ok := raw.(string)
			if !ok {
				return nil, fmt.Errorf("operation %s: argument %q must be a string", o.Name, p.Name)
			}
			allowed := false
			for _, a := range p.Allowed {
				if a == s {
					allowed = true
					break
				}
			}
			if !allowed {
				// The allowed set is echoed, the received value is not: it is
				// caller-controlled text and this string reaches a log.
				return nil, fmt.Errorf("operation %s: argument %q is not one of %s",
					o.Name, p.Name, strings.Join(p.Allowed, ", "))
			}
			out = append(out, s)
		case op.Bool:
			b, ok := raw.(bool)
			if !ok {
				return nil, fmt.Errorf("operation %s: argument %q must be true or false", o.Name, p.Name)
			}
			out = append(out, b)
		default:
			return nil, fmt.Errorf("operation %s: parameter %q has an unknown kind %q",
				o.Name, p.Name, p.Kind)
		}
	}
	// An argument nobody declared is a caller believing something happened that
	// did not. Refusing it is how a renamed parameter becomes an error instead
	// of a silently ignored filter -- which would widen a result set.
	for k := range args {
		found := false
		for _, p := range o.Params {
			if p.Name == k && p.Kind != op.Actor && p.Kind != op.Authority {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("operation %s: argument %q is not declared. An ignored argument is "+
				"a filter the caller believes is applied", o.Name, k)
		}
	}
	return out, nil
}
