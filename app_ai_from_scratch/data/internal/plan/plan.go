// Package plan compiles a QUERY PLAN into SQL.
//
// ============================================================================
// WHY THIS EXISTS INSTEAD OF A SQL TOOL.
//
// The ask was "give the model tools so it can build its own SQL queries". Raw
// SQL is not survivable here, and the reason is one line of this project's own
// ontology, about labs.solution:
//
//	"LA MAS IMPORTANTE. Si el agente puede leerla, «dime la respuesta del 5.2»
//	 destruye el curso."
//
// Every message the model reads is attacker-authored: a student types it. Hand
// that model a SQL string and the attack is `SELECT solution FROM labs`. The
// same door reaches users.pass_hash, payments.raw and reset_tokens.token_hash.
//
// The deeper cost is not the leak, it is that the PROOFS die. P1 (no jamas
// column leaves), P3 (no argument can express another person) and P4 (paid
// columns need a purchase) are properties of a CLOSED set of statements. Over
// arbitrary SQL they are not merely hard to check, they are undecidable in the
// general case -- so ai-prove-isolation, data-catalog and data-smoke would all
// keep printing green while proving nothing. A gate that certifies an obligation
// it cannot test is worse than no gate, because the review passes.
//
// So the model composes a PLAN and this package emits the SQL. The model gets
// what "agentic" actually meant -- any columns, any filters, aggregates,
// grouping, ordering, in combinations nobody enumerated in advance -- and every
// obligation survives:
//
//   - P1: a jamas column is not in the selectable universe. `solution` is not
//     filtered out of a result, it is absent from the set of things that can be
//     named. There is no plan that mentions it.
//   - P3: the actor filter is INJECTED on every personal table and is always
//     $1. No field of a plan can hold another person's id, so "read another
//     student's attempts" is unspellable rather than refused.
//   - P4: de_pago columns are not selectable either. Paid content stays behind
//     the named operations, which api gates with FREE_LESSONS and the staff
//     exemption -- product policy that must not become a second copy in here.
//
// And the validation surface stays FINITE: a closed set of tables, columns,
// operators and aggregate functions. That is what keeps it testable.
//
// WHAT THE MODEL CAN ACTUALLY ASK, derived from the ontology rather than
// designed: 4 columns of `attempts`, 4 of `achievements`, 6 of `labs`, 6 of
// `lessons`, 5 of `league_week`, 2 of `ranking_optin`, 2 of `lesson_text`, 7 of
// `users`. And nothing at all of `jobs`, `payments`, `reset_tokens` or
// `role_audit` -- every column of those four is jamas, so they arrive with an
// empty selectable set and are refused with no rule written about them. That is
// the ontology doing the work instead of a deny list somebody has to maintain.
//
// WHAT IT CANNOT DO, deliberately: no joins, no subqueries, no expressions, no
// ordering by anything it did not select, no OR at the top level. Each of those
// is a place where a plan stops being checkable by inspection. They are absent
// because absent is provable and "validated" is an argument.
// ============================================================================
package plan

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"course/data/internal/guard"
)

// Limits. Every one of these is a refusal rather than a truncation: a plan that
// silently came back smaller than asked reads as "there is no more data".
const (
	// MaxLimit caps rows. The model is summarising for a student, not exporting.
	MaxLimit = 500
	// DefaultLimit applies when a plan names none.
	DefaultLimit = 100
	// MaxConds bounds the WHERE list. Each one is an AND, so a long list is a
	// narrowing filter and not an attack -- the cap is here to bound planning
	// cost, not to bound risk.
	MaxConds = 8
	// MaxInValues bounds an IN list.
	MaxInValues = 50
	// MaxTextValue bounds a bound string.
	MaxTextValue = 200
	// MaxWildcards bounds `%` in a LIKE pattern. `%a%b%c%...` over a text column
	// is a quadratic scan, and the model has no reason to write one.
	MaxWildcards = 3
)

// identityColumns name a PERSON. Deliberately the same list as
// internal/op.identityColumns, and deliberately WITHOUT bare `id`: labs.id is
// "5.2", a lab, and treating it as a person would make every lab query scoped to
// nobody. `users` is keyed by `id` and is handled as the stated special case.
var identityColumns = []string{
	"user_id", "usuario_id", "actor_id", "owner_id", "email", "uid", "account_id",
}

// Closed sets. A value outside one of these is a refusal, and each set is short
// enough to read in full -- which is the property that makes this reviewable.
var (
	comparisons = map[string]bool{
		"=": true, "<>": true, "<": true, "<=": true, ">": true, ">=": true,
	}
	aggregates = map[string]bool{
		"count": true, "sum": true, "avg": true, "min": true, "max": true,
	}
)

// Cond is one AND-ed filter.
//
// There is no OR and no nesting. A boolean tree is where "validated" starts
// meaning "we looked at the parts", and the model can express a disjunction as
// two plans, which costs a round trip and keeps this readable.
type Cond struct {
	Column string `json:"column"`
	// Op: = <> < <= > >= in like is_null is_not_null
	Op    string `json:"op"`
	Value any    `json:"value,omitempty"`
	// Values is for `in`.
	Values []any `json:"values,omitempty"`
}

// Agg is one aggregate. Column empty means COUNT(*).
type Agg struct {
	Fn     string `json:"fn"`
	Column string `json:"column,omitempty"`
	As     string `json:"as"`
}

// Sort is one ORDER BY item. Column must be something the plan already selects
// or aggregates: ordering by a column you cannot read is a comparison oracle,
// and it would let a plan rank rows by a forbidden value without returning it.
type Sort struct {
	Column string `json:"column"`
	Dir    string `json:"dir"`
}

// Plan is what the model composes.
type Plan struct {
	Table     string   `json:"table"`
	Select    []string `json:"select,omitempty"`
	Where     []Cond   `json:"where,omitempty"`
	Group     []string `json:"group,omitempty"`
	Aggregate []Agg    `json:"aggregate,omitempty"`
	Order     []Sort   `json:"order,omitempty"`
	Limit     int      `json:"limit,omitempty"`
}

// Compiled is the result: a statement, its parameters, and what it will return.
type Compiled struct {
	SQL    string
	Params []any
	// Columns is the exact key set of every row, in order. The caller checks the
	// rows against it, the way store checks a named operation against Returns.
	Columns []string
	// Scoped records that an actor filter was injected. Reported so a caller
	// cannot mistake a public read for a scoped one.
	Scoped bool
}

// Selectable lists the columns of a table a plan may name: declared, not jamas,
// not de_pago.
//
// Fails CLOSED on an undeclared table, and on a table whose whole column set is
// forbidden -- the second case is what makes jobs, payments, reset_tokens and
// role_audit unreachable without a rule naming them.
func Selectable(ont *guard.Ontology, table string) ([]string, error) {
	forbidden, err := ont.ForbiddenColumns(table)
	if err != nil {
		return nil, err
	}
	paid, err := ont.PaidColumns(table)
	if err != nil {
		return nil, err
	}
	block := make(map[string]struct{}, len(forbidden)+len(paid))
	for _, c := range forbidden {
		block[c] = struct{}{}
	}
	for _, c := range paid {
		block[c] = struct{}{}
	}
	var out []string
	for _, c := range ont.ColumnsOf(table) {
		if _, bad := block[c]; !bad {
			out = append(out, c)
		}
	}
	sort.Strings(out)
	if len(out) == 0 {
		return nil, fmt.Errorf("plan: every column of %q is either classed jamas or behind the "+
			"paywall, so there is nothing a plan may read. This is not a special case for this "+
			"table -- it falls out of the ontology, which is why it needs no deny list", table)
	}
	return out, nil
}

// ScopeColumn returns the column a plan on this table must be filtered by, or ""
// when the table is public content.
//
// `users` is the stated special case: its person-naming column is `email`, which
// is jamas, and its key is `id`. Every other personal table carries `user_id`.
func ScopeColumn(ont *guard.Ontology, table string) string {
	if table == "users" {
		return "id"
	}
	for _, c := range identityColumns {
		if _, ok := ont.ClassOf(table, c); ok {
			return c
		}
	}
	return ""
}

// Compile validates a plan and assembles its statement.
//
// `actor` is the authenticated caller's own id, supplied by the SERVER from the
// identity it verified. It is a Go argument and not a field of Plan, which is
// the same decision the wire format makes for named operations: there is no
// place in a plan for a caller to write an id, so P3 is a property of the type
// rather than of a validator.
func Compile(ont *guard.Ontology, p Plan, actor int64) (*Compiled, error) {
	sel, err := Selectable(ont, p.Table)
	if err != nil {
		return nil, err
	}
	allowed := make(map[string]struct{}, len(sel))
	for _, c := range sel {
		allowed[c] = struct{}{}
	}
	named := func(c string) error {
		if _, ok := allowed[c]; !ok {
			return fmt.Errorf("plan: %q is not readable on %s. Readable: %s",
				c, p.Table, strings.Join(sel, ", "))
		}
		return nil
	}

	if len(p.Select) == 0 && len(p.Aggregate) == 0 {
		return nil, fmt.Errorf("plan: nothing selected and nothing aggregated, so there is no query")
	}

	// ---- the select list ---------------------------------------------------
	var items, columns []string
	seen := map[string]bool{}
	for _, c := range p.Select {
		if err := named(c); err != nil {
			return nil, err
		}
		if seen[c] {
			return nil, fmt.Errorf("plan: column %q selected twice", c)
		}
		seen[c] = true
		items = append(items, c)
		columns = append(columns, c)
	}
	for _, a := range p.Aggregate {
		if !aggregates[strings.ToLower(a.Fn)] {
			return nil, fmt.Errorf("plan: %q is not an aggregate. Allowed: avg, count, max, min, sum", a.Fn)
		}
		if !isIdent(a.As) {
			return nil, fmt.Errorf("plan: %q is not a usable name for an aggregate result", a.As)
		}
		if seen[a.As] {
			return nil, fmt.Errorf("plan: %q is already the name of a selected column", a.As)
		}
		// An alias must not shadow ANY column of the table, readable or not.
		// `COUNT(*) AS solution` leaks nothing -- the value is a count -- but it
		// hands the model a row key called `solution`, and a model that reads its
		// own tool output has just been told the answer exists under that name.
		// Cheap to forbid, and it keeps the row keys meaning what they say.
		if _, declared := ont.ClassOf(p.Table, a.As); declared {
			return nil, fmt.Errorf("plan: %q is a column of %s, so it cannot also name an aggregate "+
				"result. Pick a name that is not a column", a.As, p.Table)
		}
		seen[a.As] = true
		fn := strings.ToUpper(strings.ToLower(a.Fn))
		if a.Column == "" {
			if strings.ToLower(a.Fn) != "count" {
				return nil, fmt.Errorf("plan: %s needs a column; only count may omit one", a.Fn)
			}
			items = append(items, "COUNT(*)::int AS "+a.As)
		} else {
			if err := named(a.Column); err != nil {
				return nil, err
			}
			items = append(items, fn+"("+a.Column+") AS "+a.As)
		}
		columns = append(columns, a.As)
	}

	// ---- GROUP BY ---------------------------------------------------------
	// Postgres would reject a non-grouped column, but its message is about SQL
	// and the reader here is a language model composing a plan. Refuse it in
	// terms of the plan instead.
	if len(p.Aggregate) > 0 && len(p.Select) > 0 {
		grp := map[string]bool{}
		for _, g := range p.Group {
			grp[g] = true
		}
		for _, c := range p.Select {
			if !grp[c] {
				return nil, fmt.Errorf("plan: %q is selected alongside an aggregate but is not in "+
					"group, so there is no single value for it per row. Add it to group, or drop it "+
					"from select", c)
			}
		}
	}
	for _, g := range p.Group {
		if err := named(g); err != nil {
			return nil, err
		}
		if !seen[g] {
			return nil, fmt.Errorf("plan: grouping by %q, which the plan does not select. The result "+
				"would have rows nothing in it distinguishes", g)
		}
	}

	// ---- WHERE ------------------------------------------------------------
	var params []any
	var conds []string

	// The actor filter goes FIRST and is therefore always $1. Injected, never
	// accepted: this is P3.
	scope := ScopeColumn(ont, p.Table)
	if scope != "" {
		if actor <= 0 {
			return nil, fmt.Errorf("plan: %s holds rows that belong to a person and the request "+
				"carried no authenticated actor. This is the value a caller is never allowed to "+
				"supply, so an unauthenticated plan cannot be served by substituting one", p.Table)
		}
		params = append(params, actor)
		conds = append(conds, scope+" = $1")
	}

	if len(p.Where) > MaxConds {
		return nil, fmt.Errorf("plan: %d filters, the limit is %d", len(p.Where), MaxConds)
	}
	for _, c := range p.Where {
		if err := named(c.Column); err != nil {
			return nil, err
		}
		// A filter on a column the plan may read is a filter over data the caller
		// could have read anyway. That is why `named` is the whole check here:
		// filtering on an unreadable column would be a comparison oracle -- a way
		// to learn pass_hash one prefix at a time without ever returning it.
		sqlCond, err := compileCond(c, &params)
		if err != nil {
			return nil, err
		}
		conds = append(conds, sqlCond)
	}

	// ---- ORDER BY ---------------------------------------------------------
	var orders []string
	for _, o := range p.Order {
		if !seen[o.Column] {
			return nil, fmt.Errorf("plan: ordering by %q, which the plan does not return. Ranking "+
				"rows by a value the caller cannot read is a way to learn it without reading it",
				o.Column)
		}
		dir := strings.ToUpper(strings.TrimSpace(o.Dir))
		if dir == "" {
			dir = "ASC"
		}
		if dir != "ASC" && dir != "DESC" {
			return nil, fmt.Errorf("plan: %q is not a direction; use asc or desc", o.Dir)
		}
		orders = append(orders, o.Column+" "+dir)
	}

	// ---- LIMIT ------------------------------------------------------------
	limit := p.Limit
	if limit == 0 {
		limit = DefaultLimit
	}
	if limit < 0 || limit > MaxLimit {
		return nil, fmt.Errorf("plan: limit %d is outside 1..%d", limit, MaxLimit)
	}

	// ---- assemble ---------------------------------------------------------
	// Every identifier below came out of `allowed`, which came out of the
	// ontology. Nothing here is a string the caller wrote: values are bound
	// parameters and names are whitelist members. That is the property that
	// makes this package's output safe rather than escaped.
	var b strings.Builder
	b.WriteString("SELECT ")
	b.WriteString(strings.Join(items, ", "))
	b.WriteString(" FROM ")
	b.WriteString(p.Table)
	if len(conds) > 0 {
		b.WriteString(" WHERE ")
		b.WriteString(strings.Join(conds, " AND "))
	}
	if len(p.Group) > 0 {
		b.WriteString(" GROUP BY ")
		b.WriteString(strings.Join(p.Group, ", "))
	}
	if len(orders) > 0 {
		b.WriteString(" ORDER BY ")
		b.WriteString(strings.Join(orders, ", "))
	}
	b.WriteString(" LIMIT ")
	b.WriteString(strconv.Itoa(limit))

	return &Compiled{SQL: b.String(), Params: params, Columns: columns, Scoped: scope != ""}, nil
}

func compileCond(c Cond, params *[]any) (string, error) {
	next := func(v any) string {
		*params = append(*params, v)
		return "$" + strconv.Itoa(len(*params))
	}
	op := strings.ToLower(strings.TrimSpace(c.Op))
	switch {
	case comparisons[op]:
		v, err := scalar(c.Value)
		if err != nil {
			return "", err
		}
		return c.Column + " " + op + " " + next(v), nil

	case op == "is_null":
		return c.Column + " IS NULL", nil
	case op == "is_not_null":
		return c.Column + " IS NOT NULL", nil

	case op == "like":
		s, ok := c.Value.(string)
		if !ok {
			return "", fmt.Errorf("plan: like needs a string pattern")
		}
		if len(s) > MaxTextValue {
			return "", fmt.Errorf("plan: pattern is %d bytes, the limit is %d", len(s), MaxTextValue)
		}
		if n := strings.Count(s, "%"); n > MaxWildcards {
			return "", fmt.Errorf("plan: %d wildcards in one pattern, the limit is %d. `%%a%%b%%c%%` "+
				"over a text column is a quadratic scan", n, MaxWildcards)
		}
		return c.Column + " LIKE " + next(s), nil

	case op == "in":
		if len(c.Values) == 0 {
			return "", fmt.Errorf("plan: in with no values matches nothing, which reads as an empty " +
				"table rather than as an empty filter")
		}
		if len(c.Values) > MaxInValues {
			return "", fmt.Errorf("plan: %d values in one in, the limit is %d", len(c.Values), MaxInValues)
		}
		var refs []string
		for _, raw := range c.Values {
			v, err := scalar(raw)
			if err != nil {
				return "", err
			}
			refs = append(refs, next(v))
		}
		return c.Column + " IN (" + strings.Join(refs, ", ") + ")", nil
	}
	return "", fmt.Errorf("plan: %q is not an operator. Allowed: =, <>, <, <=, >, >=, in, like, "+
		"is_null, is_not_null", c.Op)
}

// scalar accepts the three JSON scalars that can be a bound parameter and
// refuses everything else. An object or an array here would be a caller trying
// to reach a type this package has not thought about.
func scalar(v any) (any, error) {
	switch t := v.(type) {
	case string:
		if len(t) > MaxTextValue {
			return nil, fmt.Errorf("plan: a value is %d bytes, the limit is %d", len(t), MaxTextValue)
		}
		return t, nil
	case float64:
		return t, nil
	case bool:
		return t, nil
	case nil:
		return nil, fmt.Errorf("plan: null as a value; use is_null, because `= NULL` matches nothing " +
			"and reads as \"no rows\" instead of as a broken filter")
	}
	return nil, fmt.Errorf("plan: %T is not a value a filter can bind", v)
}

func isIdent(s string) bool {
	if s == "" || len(s) > 40 {
		return false
	}
	for i, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
		case r == '_':
		case r >= '0' && r <= '9' && i > 0:
		default:
			return false
		}
	}
	return true
}
