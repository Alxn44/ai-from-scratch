// Package op is the CLOSED catalogue of everything this service can do.
//
// There is no operation that runs caller-supplied SQL, and there is no way to
// add one without editing this file. That is the whole security model of /data:
// api can ask for `lesson.list`, and if it asks for anything not in the table it
// gets a refusal, not a query.
//
// WHY THE SQL IS ASSEMBLED AND NOT WRITTEN
// An operation declares the columns it returns, and the SELECT list is BUILT
// from that declaration. `SELECT *` is not forbidden by a check somebody could
// forget to run -- it is unreachable, because nothing here ever emits a star.
// The columns that come back are the columns that were declared, and the
// declaration is what the guard verifies against the ontology at startup.
//
// Complex shapes use Raw, and Raw is validated: every select item must end in a
// bare name, and the resulting names must equal Returns exactly, in order. A
// wildcard has no name, so it cannot pass.
package op

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"course/data/internal/guard"
)

// Kind is what a parameter is allowed to be.
type Kind string

const (
	// Actor is the authenticated caller's own id. It is INJECTED by the server
	// from the identity it verified and can never come from the request body.
	// That is what makes "no argument can express another person" true rather
	// than intended: there is no wire format in which a caller states who
	// they are.
	Actor Kind = "actor"
	// Authority is a second verified identity injected by api for the narrow
	// admin case where one actor changes another account. Like Actor, it never
	// comes from the request body.
	Authority Kind = "authority"
	Int       Kind = "int"
	Text      Kind = "text"
	Enum      Kind = "enum"
	Bool      Kind = "bool"
)

// Param is one bound parameter, in $1..$n order.
type Param struct {
	Name string
	Kind Kind
	// Allowed is the closed set for Enum. An Enum with no Allowed is refused at
	// startup: it is a Text wearing a safer label.
	Allowed []string
	// Max bounds an Int's value and a Text's length. Required for both.
	Max int
}

// Audience is who the rows are ultimately for, and it is the distinction that
// keeps this service both safe and usable.
//
// The ontology's `prohibidas` list is exactly its 46 `jamas` columns, and
// `jamas` means "never crosses to the agent". It does NOT mean "never read by
// the service that owns the row": `users.pass_hash` is jamas, and the login path
// has to read it to check a password. A single blanket rule here would have
// broken authentication, and discovering that after the extraction is the moment
// somebody disables the guard.
//
// So: Agent operations may never touch a jamas column -- that is P1, and it is
// the boundary that matters because it is the one a language model sits behind.
// Internal operations may, and each has to say why in Justify. Exemptions() and
// a pinned test make that list impossible to grow quietly.
type Audience string

const (
	// Agent: the rows can reach the agent loop, and through it a model and a
	// student. The full forbidden-column check applies.
	Agent Audience = "agent"
	// Internal: api's own machinery -- login, the job queue, an admin screen.
	// May read jamas columns, must justify each one.
	Internal Audience = "internal"
)

// Muro is who paid to read the rows, and it is the SECOND axis of the ontology.
//
// It exists because the first axis cannot express the paywall. `clase`
// (publico|propio|agregado|jamas) answers whose data a column is; `muro`
// (gratis|de_pago) answers who paid for it. Collapsing them is the bug that
// already happened in this project: with one axis the paywall rule was
// inexpressible, the isolation proof stayed green, and the paid corpus walked
// out. Obligation P4 exists because of that, and until this type existed P4 was
// unexpressible HERE too -- an operation could return a de_pago column and
// nothing in this service would notice.
//
// WHAT THIS DECLARES AND WHAT IT DOES NOT. It declares that an operation's rows
// are paid content, and Validate refuses to start if that declaration is missing
// or wrong. It does NOT enforce the wall, and the boundary matters: whether a
// given person may read a given lesson is product policy -- the first lesson is
// free, staff are exempt, api/src/server.ts owns FREE_LESSONS -- and a data
// service that decided it would be a second copy of a rule that changes. So:
// declared here, proved here, enforced in api. Exactly the shape P4 already has
// over the tools, where `verifica_compra` is a declaration the graph checks
// rather than a check the graph performs.
type Muro string

const (
	// Gratis: every column returned is free to read. The default, and the safe
	// one -- an operation that forgets to declare Muro is refused rather than
	// assumed paid, because "assumed paid" would let a de_pago column through on
	// a typo.
	Gratis Muro = "gratis"
	// DePago: at least one column returned is paid content. Every caller must sit
	// behind an access check.
	DePago Muro = "de_pago"
)

// Scope is whose rows an operation reads.
type Scope string

const (
	// Public rows belong to nobody in particular: lessons, labs, rank names.
	Public Scope = "public"
	// Own rows belong to the actor and nobody else. An Own operation MUST
	// filter on the actor, and Validate proves it does.
	Own Scope = "own"
)

// Operation is one thing this service can do.
type Operation struct {
	// Name is dotted lowercase: "lesson.list", "attempt.record".
	Name     string
	Table    string
	Scope    Scope
	Audience Audience
	// Muro declares whether the returned columns are paid content. Required on
	// every operation: see the type's own comment for why the zero value is not
	// allowed to mean "free".
	Muro Muro

	// Returns is the exact column list. A write may leave it empty, or declare
	// direct columns from a RETURNING clause for atomic claim-and-return flows.
	Returns []string

	// The assembled form, used when Raw is empty.
	From  string
	Where string
	Order string
	Limit int

	// Raw is the escape hatch for joins, aggregates and writes.
	Raw string

	// Derived names columns that appear in a Raw select list but whose CONTENT
	// never leaves -- they feed an expression that produces something revealing
	// nothing about them.
	//
	// This is a judgement call, and ai/src/course_ai/ontology/data.py already
	// makes the same one in prose: a column is declared in `returns` when the
	// caller can read its content, whole, truncated or transformed row by row; a
	// column that only feeds a filter, a JOIN condition or an existence bit is
	// not. The example given there is exactly the case this field exists for --
	// `curso_indice` selects `(technical <> '') AS tiene_tecnico`, and one bit
	// saying "this lesson has text written" reconstructs none of the paid prose.
	//
	// Declaring it here is what keeps the call MACHINE-CHECKED instead of
	// implicit. The alternatives were both worse: flagging it would make P4 fire
	// on an operation that leaks nothing, and quietly not scanning select-list
	// expressions is the alias hole this package just closed.
	//
	// Requires Justify, is refused if it names a column the statement does not
	// actually read, and is pinned by a test so the list cannot grow without a
	// reviewer. A filter or a JOIN needs no entry: only the select list is
	// scanned, because filtering on a column is not returning one.
	Derived []string

	// Write marks a mutating operation.
	Write bool

	Params []Param

	// Why documents the operation for a human reading a refusal or an audit
	// line. An operation nobody can explain is an operation nobody can review.
	Why string

	// Justify is required when an Internal operation returns a jamas column. It
	// names the machinery that cannot work without it. "needed" is not a
	// justification; "the login path compares a submitted password against this
	// hash" is.
	Justify string
}

var (
	// The first segment is a TABLE name, and table names here contain
	// underscores -- lesson_text, league_week, ranking_optin, role_audit,
	// reset_tokens. The old pattern allowed them only after the first dot, so
	// `lesson_text.get` was rejected as malformed while `lesson.text_get` was
	// fine. That is a rule about spelling masquerading as a rule about safety.
	opName   = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`)
	ident    = regexp.MustCompile(`^[a-z_][a-z0-9_]*$`)
	fromPart = regexp.MustCompile(`^[a-z_][a-z0-9_]*( +(left +)?join +[a-z_][a-z0-9_]*( +[a-z_][a-z0-9_]*)? +on +[a-z0-9_. =]+)*$`)
	// Parenthesised groups, removed before looking for a wildcard. COUNT(*) is a
	// function argument, not a select list, and flagging it made every aggregate
	// unexpressible -- which would have pushed the aggregates back into api,
	// where they are the SQL this service exists to remove.
	parenGroup = regexp.MustCompile(`\([^()]*\)`)
	paramRef   = regexp.MustCompile(`\$([0-9]+)`)
)

// identityColumns name a PERSON. A caller-supplied parameter may never be
// compared against one, and Validate enforces it. Without that rule a "scoped"
// operation whose filter is `user_id = $1`, with $1 an Int from the request
// body, reads anybody's rows while its declaration says `own`.
var identityColumns = []string{
	"user_id", "usuario_id", "actor_id", "owner_id", "email", "uid", "account_id",
}

func namesAPerson(s string) bool {
	for _, c := range identityColumns {
		if c == s {
			return true
		}
	}
	return false
}

// HasWildcard reports whether a statement selects with a wildcard.
//
// It strips parenthesised groups first, repeatedly, so that COUNT(*) and
// MAX(NULLIF(x, *)) are read as function arguments rather than as select lists.
// What is left flagged is a bare `*`, a `table.*`, and -- deliberately -- a
// multiplication, because `a * b` in a select list is an expression whose result
// no declared column list describes. Nothing in this catalogue multiplies, and
// failing closed on the day something does is the cheaper mistake.
//
// EXPORTED so the test and Validate share one implementation. They had two: the
// test asked `strings.Contains(SQL(), "*")` and Validate used a regexp, which is
// the "generate from the source of truth, never a copy" rule broken inside a
// single package.
func HasWildcard(sql string) bool {
	prev := ""
	for cur := sql; cur != prev; {
		prev = cur
		cur = parenGroup.ReplaceAllString(cur, "")
		sql = cur
	}
	return strings.Contains(sql, "*")
}

// SQL renders the statement. The only place a statement is produced, and it
// never emits a star.
func (o Operation) SQL() string {
	if o.Raw != "" {
		return o.Raw
	}
	var b strings.Builder
	b.WriteString("SELECT ")
	b.WriteString(strings.Join(o.Returns, ", "))
	b.WriteString(" FROM ")
	b.WriteString(o.From)
	if o.Where != "" {
		b.WriteString(" WHERE ")
		b.WriteString(o.Where)
	}
	if o.Order != "" {
		b.WriteString(" ORDER BY ")
		b.WriteString(o.Order)
	}
	if o.Limit > 0 {
		fmt.Fprintf(&b, " LIMIT %d", o.Limit)
	}
	return b.String()
}

// ActorIndex is the 1-based position of the actor parameter, or 0.
func (o Operation) ActorIndex() int {
	for i, p := range o.Params {
		if p.Kind == Actor {
			return i + 1
		}
	}
	return 0
}

// AuthorityIndex is the 1-based position of the trusted administrative actor.
func (o Operation) AuthorityIndex() int {
	for i, p := range o.Params {
		if p.Kind == Authority {
			return i + 1
		}
	}
	return 0
}

// TouchesForbidden reports the jamas columns this operation returns.
func (o Operation) TouchesForbidden(ont *guard.Ontology) []string {
	var out []string
	for _, c := range o.columnsRead() {
		if bad, err := ont.IsForbidden(o.Table, c); err == nil && bad {
			out = append(out, c)
		}
	}
	sort.Strings(out)
	return out
}

// identToken matches one SQL identifier. Applied to a LOWERCASED expression, so
// no upper-case branch is needed.
var identToken = regexp.MustCompile(`[a-z_][a-z0-9_]*`)

// columnsRead names every column of o.Table the operation actually reads out.
//
// WHY THIS IS NOT JUST `Returns`. For an assembled statement Returns IS the
// select list, so the two are the same. For a Raw statement they are not, and
// the gap was a hole in this package's only non-structural check:
// validateRaw compares Returns against the TRAILING NAME of each select item,
// and trailingName returns the ALIAS. So
//
//	Raw:     "SELECT pass_hash AS x FROM users WHERE id = $1"
//	Returns: []string{"x"}
//
// matched, IsForbidden("users", "x") answered false, and an agent-facing
// operation returned users.pass_hash. Every other guarantee here is structural --
// a star is unreachable because the statement is built from Returns, an actor
// cannot arrive in the request body because no field for it exists -- and this
// one could be got around by typing `AS`.
//
// A WRITE READS NOTHING OUT. An INSERT's Raw is not a select list and its rows
// never come back, so a write contributes nothing here.
//
// WHERE IS DELIBERATELY NOT SCANNED, and it looks like an omission until you
// see why: `Where: "user_id = $1"` references a forbidden column on purpose, and
// obligation P3 REQUIRES it to. Filtering on a column is not returning one.
// validateScope is what checks that clause, and it checks the opposite thing --
// that the filter binds to the actor parameter and not to a caller-supplied id.
func (o Operation) columnsRead() []string {
	if o.Write {
		// Returning writes are deliberately limited by validateReturning to bare
		// column names, so Returns is also the exact list read back.
		return o.Returns
	}
	if o.Raw == "" {
		return o.Returns
	}
	lower := strings.ToLower(o.Raw)
	from := strings.Index(lower, " from ")
	if !strings.HasPrefix(lower, "select ") || from < 0 {
		// Unreadable as a select list. validateRaw reports that separately; here
		// the safe answer is "assume it reads everything the table forbids",
		// because returning nothing would mean an unparseable statement passes
		// the forbidden check.
		return nil
	}
	skip := make(map[string]struct{}, len(o.Derived))
	for _, d := range o.Derived {
		skip[strings.ToLower(d)] = struct{}{}
	}
	seen := map[string]bool{}
	var out []string
	for _, item := range splitTopLevel(o.Raw[len("select "):from]) {
		// Strip the alias: `MAX(correct) AS solved` reads `correct`, not `solved`.
		expr := item
		if f := strings.Fields(item); len(f) >= 2 && strings.EqualFold(f[len(f)-2], "as") {
			expr = strings.Join(f[:len(f)-2], " ")
		}
		for _, tok := range identToken.FindAllString(strings.ToLower(expr), -1) {
			if _, ok := skip[tok]; ok {
				continue
			}
			if !seen[tok] {
				seen[tok] = true
				out = append(out, tok)
			}
		}
	}
	return out
}

// TouchesPaid lists the returned columns the ontology puts behind the paywall.
//
// A write returns nothing, so it touches nothing: the wall is about reading paid
// content, and recording an attempt is not reading one.
func (o Operation) TouchesPaid(ont *guard.Ontology) []string {
	var out []string
	for _, c := range o.columnsRead() {
		if paid, err := ont.IsPaid(o.Table, c); err == nil && paid {
			out = append(out, c)
		}
	}
	sort.Strings(out)
	return out
}

// rawSelectIdentifiers lists every identifier in a Raw select list, ignoring
// Derived. Used to refuse a Derived entry that names a column the statement does
// not read -- a stale exemption is worse than none, because it reads as reviewed.
func (o Operation) rawSelectIdentifiers() map[string]struct{} {
	out := map[string]struct{}{}
	if o.Raw == "" || o.Write {
		return out
	}
	lower := strings.ToLower(o.Raw)
	from := strings.Index(lower, " from ")
	if !strings.HasPrefix(lower, "select ") || from < 0 {
		return out
	}
	for _, item := range splitTopLevel(o.Raw[len("select "):from]) {
		expr := item
		if f := strings.Fields(item); len(f) >= 2 && strings.EqualFold(f[len(f)-2], "as") {
			expr = strings.Join(f[:len(f)-2], " ")
		}
		for _, tok := range identToken.FindAllString(strings.ToLower(expr), -1) {
			out[tok] = struct{}{}
		}
	}
	return out
}

// Validate is the startup gate for one operation. Every error it returns is a
// reason the service must not start.
func (o Operation) Validate(ont *guard.Ontology) []error {
	var errs []error
	add := func(f string, a ...any) { errs = append(errs, fmt.Errorf(f, a...)) }

	if !opName.MatchString(o.Name) {
		add("op %q: the name must be dotted lowercase, e.g. lesson.list", o.Name)
	}
	if strings.TrimSpace(o.Why) == "" {
		add("op %s: no Why. An operation nobody can explain is an operation nobody can review", o.Name)
	}
	if _, err := ont.ForbiddenColumns(o.Table); err != nil {
		add("op %s: %v", o.Name, err)
		// Without a declared table nothing below is checkable, and guessing is
		// the fail-open behaviour this service exists to remove.
		return errs
	}

	sql := o.SQL()
	if HasWildcard(sql) {
		add("op %s: the statement contains a star. A declared column list cannot be verified against "+
			"a wildcard, and that is how api/src/server.ts:938 came to run SELECT * on a table "+
			"where every column is classed jamas", o.Name)
	}

	if !o.Write && len(o.Returns) == 0 {
		add("op %s: a read that declares no columns returns nothing verifiable", o.Name)
	}
	seen := map[string]bool{}
	for _, c := range o.Returns {
		if !ident.MatchString(c) {
			add("op %s: %q is not a column name", o.Name, c)
			continue
		}
		if seen[c] {
			add("op %s: column %q declared twice", o.Name, c)
		}
		seen[c] = true
	}
	// The forbidden check runs over what the statement READS, which for a Raw
	// operation is not the same list as Returns -- see columnsRead.
	for _, c := range o.columnsRead() {
		bad, err := ont.IsForbidden(o.Table, c)
		if err != nil {
			add("op %s: %v", o.Name, err)
			continue
		}
		if bad && o.Audience != Internal {
			add("op %s: reads %s.%s, which the ontology classes jamas. This is the check that makes "+
				"the guarantee structural: the service does not start, rather than leaking the "+
				"column the first time somebody calls this operation", o.Name, o.Table, c)
		}
	}

	switch {
	case o.Write && o.Raw == "":
		add("op %s: a write must supply Raw. Assembling an INSERT from fragments means building a "+
			"statement out of parts, which is the thing this package refuses to do", o.Name)
	case !o.Write && o.Raw == "" && o.From == "":
		add("op %s: no From and no Raw, so there is no statement", o.Name)
	case !o.Write && o.Raw == "" && !fromPart.MatchString(strings.ToLower(o.From)):
		add("op %s: From %q is not a plain table or a simple join. Anything more complex belongs in "+
			"Raw, where the select list is checked explicitly", o.Name, o.From)
	}
	if o.Raw != "" && !o.Write {
		errs = append(errs, o.validateRaw()...)
	}
	if o.Write {
		errs = append(errs, o.validateReturning()...)
	}

	errs = append(errs, o.validateParams(sql)...)
	errs = append(errs, o.validateScope()...)

	// The audience rule. An Internal operation reaching a jamas column is
	// allowed and must say why; one that reaches none should not be Internal,
	// because the label is what exempts it and an unnecessary exemption is one
	// nobody re-examines.
	switch o.Audience {
	case Agent:
		if strings.TrimSpace(o.Justify) != "" && len(o.Derived) == 0 {
			add("op %s: an agent operation carries a Justify and declares no Derived column. Justify "+
				"exempts an Internal operation or explains a Derived read, so this reads as an "+
				"exemption that is not in force", o.Name)
		}
	case Internal:
		touched := o.TouchesForbidden(ont)
		if len(touched) > 0 && strings.TrimSpace(o.Justify) == "" {
			add("op %s: internal, returns %s (classed jamas), and gives no Justify. Name the "+
				"machinery that cannot work without it", o.Name, strings.Join(touched, ", "))
		}
		if len(touched) == 0 {
			add("op %s: marked internal but returns no forbidden column, so the exemption only hides "+
				"this operation from the check. Make it %q", o.Name, Agent)
		}
	default:
		add("op %s: audience %q is not %q or %q", o.Name, o.Audience, Agent, Internal)
	}

	// The paywall rule. Both directions are errors, and the second one matters as
	// much as the first: a declaration that does not match what the operation
	// returns is a declaration nobody can trust, and the next reader either
	// believes it or stops believing all of them.
	// Derived: every entry must be real, and every entry must be explained.
	if len(o.Derived) > 0 {
		if o.Raw == "" {
			add("op %s: declares Derived columns but has no Raw statement. An assembled statement "+
				"returns exactly Returns, so there is no expression for a column to hide in", o.Name)
		}
		if strings.TrimSpace(o.Justify) == "" {
			add("op %s: declares Derived %s and gives no Justify. Say what the expression produces "+
				"and why it reveals nothing of the column", o.Name, strings.Join(o.Derived, ", "))
		}
		present := o.rawSelectIdentifiers()
		for _, d := range o.Derived {
			if _, ok := present[strings.ToLower(d)]; !ok {
				add("op %s: Derived names %q, which the select list does not read. A stale exemption "+
					"is worse than none: it reads as reviewed", o.Name, d)
			}
			// A Derived entry must be for a column that actually carries a
			// restriction. Exempting a free, public column is noise that teaches
			// the next reader the list is decorative.
			bad, _ := ont.IsForbidden(o.Table, d)
			paid, _ := ont.IsPaid(o.Table, d)
			if !bad && !paid {
				add("op %s: Derived names %s.%s, which is neither jamas nor de_pago, so nothing "+
					"needed exempting", o.Name, o.Table, d)
			}
		}
	}

	paid := o.TouchesPaid(ont)
	switch o.Muro {
	case DePago:
		if len(paid) == 0 && !o.Write {
			add("op %s: declared de_pago but returns no paid column. A wall in front of free content "+
				"is a wall somebody eventually removes, taking the real ones with it", o.Name)
		}
	case Gratis:
		if len(paid) > 0 {
			add("op %s: returns %s, which the ontology puts behind the paywall, while declaring "+
				"muro=gratis. This is obligation P4, and it is the check that was missing when "+
				"/api/lessons spread every column of `lessons` -- technical and analogy included -- "+
				"into the response for all twelve lessons with `locked` as a client-side flag",
				o.Name, strings.Join(paid, ", "))
		}
	default:
		add("op %s: muro %q is not %q or %q. There is no default: an operation that forgets to "+
			"declare it would be assumed free, and a de_pago column would ride out on a typo",
			o.Name, o.Muro, Gratis, DePago)
	}
	return errs
}

// validateReturning permits the one write shape that must be atomic and return
// rows (for example UPDATE ... SKIP LOCKED ... RETURNING). Only bare columns are
// accepted: expressions and aliases would reopen the alias-laundering hole that
// raw SELECT validation closes above.
func (o Operation) validateReturning() []error {
	lower := strings.ToLower(o.Raw)
	i := strings.LastIndex(lower, " returning ")
	if i < 0 {
		if len(o.Returns) > 0 {
			return []error{fmt.Errorf("op %s: declares returned columns on a write with no RETURNING clause", o.Name)}
		}
		return nil
	}
	if len(o.Returns) == 0 {
		return []error{fmt.Errorf("op %s: has RETURNING but declares no returned columns", o.Name)}
	}
	items := splitTopLevel(strings.TrimSpace(o.Raw[i+len(" returning "):]))
	if len(items) != len(o.Returns) {
		return []error{fmt.Errorf("op %s: RETURNING has %d columns and Returns declares %d", o.Name, len(items), len(o.Returns))}
	}
	for j, item := range items {
		name := strings.TrimSpace(item)
		if !ident.MatchString(name) || name != o.Returns[j] {
			return []error{fmt.Errorf("op %s: RETURNING item %q must be the bare declared column %q", o.Name, item, o.Returns[j])}
		}
	}
	return nil
}

// validateRaw checks that a hand-written select list names exactly the declared
// columns.
func (o Operation) validateRaw() []error {
	lower := strings.ToLower(o.Raw)
	from := strings.Index(lower, " from ")
	if !strings.HasPrefix(lower, "select ") || from < 0 {
		return []error{fmt.Errorf("op %s: Raw must begin with SELECT and contain FROM so its select "+
			"list can be read and compared with Returns", o.Name)}
	}
	var names []string
	for _, it := range splitTopLevel(o.Raw[len("select "):from]) {
		names = append(names, trailingName(it))
	}
	if strings.Join(names, ",") != strings.Join(o.Returns, ",") {
		return []error{fmt.Errorf("op %s: Raw selects [%s] but Returns declares [%s]. They must match "+
			"exactly and in order, or the guard verifies a different column list from the one the "+
			"database hands back. Write every item as `expr AS name`",
			o.Name, strings.Join(names, ", "), strings.Join(o.Returns, ", "))}
	}
	return nil
}

func (o Operation) validateParams(sql string) []error {
	var errs []error
	add := func(f string, a ...any) { errs = append(errs, fmt.Errorf(f, a...)) }

	used := map[int]bool{}
	for _, m := range paramRef.FindAllStringSubmatch(sql, -1) {
		var n int
		fmt.Sscanf(m[1], "%d", &n)
		used[n] = true
	}
	for i, p := range o.Params {
		n := i + 1
		if !used[n] {
			add("op %s: parameter %d (%s) is declared and never used, so a caller can send a value "+
				"that goes nowhere and believe it was applied", o.Name, n, p.Name)
		}
		if !ident.MatchString(p.Name) {
			add("op %s: parameter %d has the name %q", o.Name, n, p.Name)
		}
		switch p.Kind {
		case Actor, Authority:
			// bounded by definition: not caller-supplied
		case Enum:
			if len(p.Allowed) == 0 {
				add("op %s: parameter %s is an Enum with no allowed values, which is a Text wearing "+
					"a safer label", o.Name, p.Name)
			}
		case Int, Text:
			if p.Max <= 0 {
				add("op %s: parameter %s has no Max. An unbounded Text is how a 40 MB body becomes a "+
					"database problem, and an unbounded Int is how LIMIT becomes a table scan",
					o.Name, p.Name)
			}
		case Bool:
		default:
			add("op %s: parameter %s has kind %q, which is not actor|int|text|enum|bool",
				o.Name, p.Name, p.Kind)
		}
		if p.Kind != Actor && p.Kind != Authority && namesAPerson(p.Name) {
			add("op %s: parameter %s is caller-supplied and names a person. That is P3: no argument "+
				"may express another person, so an identity can only ever be the injected actor",
				o.Name, p.Name)
		}
	}
	for n := range used {
		if n < 1 || n > len(o.Params) {
			add("op %s: the statement references $%d and %d parameter(s) are declared",
				o.Name, n, len(o.Params))
		}
	}
	return errs
}

// validateScope proves an Own operation filters on the actor, and that no
// caller-supplied parameter is compared against an identity column.
func (o Operation) validateScope() []error {
	var errs []error
	add := func(f string, a ...any) { errs = append(errs, fmt.Errorf(f, a...)) }

	sql := strings.ToLower(o.SQL())
	whereSQL := ""
	if i := strings.Index(sql, " where "); i >= 0 {
		whereSQL = sql[i:]
	}
	actor := o.ActorIndex()
	authority := o.AuthorityIndex()

	for _, col := range identityColumns {
		re := regexp.MustCompile(col + ` *= *\$([0-9]+)`)
		for _, m := range re.FindAllStringSubmatch(whereSQL, -1) {
			var n int
			fmt.Sscanf(m[1], "%d", &n)
			if n != actor && n != authority {
				add("op %s: filters %s = $%d, and $%d is not the actor parameter. A predicate on an "+
					"identity column bound to a caller-supplied value reads anybody's rows while "+
					"the declaration says %q", o.Name, col, n, n, o.Scope)
			}
		}
	}

	switch o.Scope {
	case Own:
		if actor == 0 {
			add("op %s: scope is own and there is no actor parameter, so nothing restricts it to one "+
				"person", o.Name)
			return errs
		}
		if !strings.Contains(sql, fmt.Sprintf("$%d", actor)) {
			add("op %s: scope is own, the actor is $%d, and the statement never uses it", o.Name, actor)
		}
		if !o.Write && !strings.Contains(sql, "where") {
			add("op %s: scope is own and the read has no WHERE clause", o.Name)
		}
	case Public:
		if actor != 0 || authority != 0 {
			add("op %s: scope is public but it takes an actor. Either it reads one person's rows and "+
				"the scope is wrong, or the parameter is unused and misleading", o.Name)
		}
	default:
		add("op %s: scope %q is not public or own", o.Name, o.Scope)
	}
	return errs
}

// splitTopLevel splits on commas outside parentheses, so `coalesce(a, b) AS x, y`
// is two items and not three.
func splitTopLevel(s string) []string {
	var out []string
	depth, start := 0, 0
	for i, r := range s {
		switch r {
		case '(':
			depth++
		case ')':
			depth--
		case ',':
			if depth == 0 {
				out = append(out, strings.TrimSpace(s[start:i]))
				start = i + 1
			}
		}
	}
	return append(out, strings.TrimSpace(s[start:]))
}

// trailingName is the name a select item produces: the alias after AS, or the
// bare identifier. Anything else returns "" and fails the comparison, which is
// what makes a star or a bare expression impossible to declare.
func trailingName(item string) string {
	f := strings.Fields(item)
	if len(f) >= 2 && strings.EqualFold(f[len(f)-2], "as") {
		if ident.MatchString(f[len(f)-1]) {
			return f[len(f)-1]
		}
		return ""
	}
	if len(f) == 1 && ident.MatchString(f[0]) {
		return f[0]
	}
	return ""
}

// Catalog returns every operation, and it is the whole surface of this service.
func Catalog() []Operation { return catalog }

// ByName indexes the catalogue. Verify refuses duplicates, so this cannot
// silently drop one.
func ByName() map[string]Operation {
	out := make(map[string]Operation, len(catalog))
	for _, o := range catalog {
		out[o.Name] = o
	}
	return out
}

// Verify validates the whole catalogue: what `data verify` runs, and what the
// server runs before it listens.
func Verify(ont *guard.Ontology) []error {
	var errs []error
	seen := map[string]bool{}
	for _, o := range catalog {
		if seen[o.Name] {
			errs = append(errs, fmt.Errorf("op %s: declared twice; ByName would silently keep one", o.Name))
		}
		seen[o.Name] = true
		errs = append(errs, o.Validate(ont)...)
	}
	if len(catalog) == 0 {
		errs = append(errs, fmt.Errorf("op: the catalogue is empty, so this service can do nothing. "+
			"An empty allowlist is a broken deployment, not a safe default"))
	}
	sort.Slice(errs, func(i, j int) bool { return errs[i].Error() < errs[j].Error() })
	return errs
}

// Exemptions lists every Internal operation that reaches a jamas column, with
// what it reaches and why.
//
// Printed by `data verify` on every run, including a passing one. An exemption
// nobody sees is an exemption nobody re-examines, and this is the one place
// where the guarantee is deliberately not absolute.
func Exemptions(ont *guard.Ontology) []string {
	var out []string
	for _, o := range catalog {
		if o.Audience != Internal {
			continue
		}
		if t := o.TouchesForbidden(ont); len(t) > 0 {
			out = append(out, fmt.Sprintf("%s -> %s.%s : %s",
				o.Name, o.Table, strings.Join(t, ","), o.Justify))
		}
	}
	sort.Strings(out)
	return out
}
