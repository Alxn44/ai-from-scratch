// Package guard is the ontology, enforced.
//
// WHAT THIS SERVICE IS FOR, in one paragraph, because every design decision
// below follows from it.
//
// Before /data existed, any code in api/ could call `all("SELECT …")` with
// arbitrary SQL and get rows back. Nothing checked those rows: the forbidden
// column guard was a SEPARATE call (`assertNoForbidden`) that the author had to
// remember, the return type was `Record<string, unknown>` so the compiler could
// not help, and no test asserted that every query site called it. It worked --
// coverage was in fact complete -- but it worked by discipline. The proof that
// discipline is not enough is api/src/server.ts:938, `SELECT * FROM payments`
// with no guard call, on a table where the ontology forbids EVERY column. It is
// admin-gated and the table is empty, so nothing leaked. It is still a query
// that would have leaked the whole payments table the day somebody bought
// something, and nothing in the build would have said a word.
//
// So this service exists to move that guarantee from «somebody remembered» to
// «the process refuses to start». The mechanism is three checks, all of them at
// STARTUP, over the closed catalogue of operations:
//
//  1. An operation must declare the columns it returns. No `SELECT *`, ever,
//     because a declared column list cannot be checked against a wildcard.
//  2. Every declared column is checked against the ontology's forbidden list for
//     that table. One match and the service does not start.
//  3. An operation reading another person's rows cannot exist: a scoped
//     operation's filter must bind to the ACTOR, and no caller-supplied
//     parameter may name an identity column. That is the ontology's P3 -- no
//     argument can express another person -- enforced on the SQL text rather
//     than promised in a comment.
//
// The artefact is read, never copied. api/src/ontologia.json is generated from
// ai/src/course_ai/ontology/data.py by `uv run ai-export`, and CI already fails
// when the committed copy is stale. A second hand-maintained table here would be
// the exact "generate from the source of truth, never a copy" failure this
// repository has already paid for twice.
package guard

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Ontology is the part of the artefact this service reads.
//
// `prohibidas`, `clases` and `de_pago` -- the two axes and the derived forbidden
// list. The rest of the artefact describes tools and their scopes, which is api's
// business; reading fields we do not use would make this struct a second,
// partial specification of a document somebody else owns.
type Ontology struct {
	// Forbidden maps a table name to the columns that must never leave.
	Forbidden map[string][]string `json:"prohibidas"`
	// Classes maps "table.column" to publico|propio|agregado|jamas. Flat keys,
	// not nested -- that shape has already been misread once, and the mistake
	// reported all twelve tables as drifted.
	Classes map[string]string `json:"clases"`
	// Paid maps a table name to the columns behind the paywall -- the `muro`
	// axis, `de_pago`.
	//
	// This field was MISSING, and the comment on ClassOf below described the two
	// axes while the struct carried only one. The cost of that was concrete: an
	// operation could return a de_pago column and nothing in this service would
	// notice, which is obligation P4 being unexpressible here exactly as it was
	// unexpressible in v2. The bug it allows is not hypothetical --
	// api/src/server.ts read `SELECT * FROM lessons` and spread every column into
	// the /api/lessons response for all twelve lessons, `locked` being a flag the
	// CLIENT was trusted to honour, while lessons.technical and lessons.analogy
	// are both de_pago. Those two columns happened to be empty, so nothing walked
	// out; the day somebody writes the text they do.
	Paid map[string][]string `json:"de_pago"`
}

// DefaultPath resolves the artefact: DATA_ONTOLOGY if set, otherwise the baked
// image path.
//
// It exists because three callers used to guess independently -- the service read
// an env var, and the tests walked UP the directory tree looking for
// api/src/ontologia.json. That works on a laptop and fails inside the image,
// where the tree is /src/data and the artefact is at /etc/data: the build ran the
// suite, every ontology test failed, and the failure looked like a broken guard
// rather than a wrong path. One resolver, used everywhere.
func DefaultPath() string {
	if p := os.Getenv("DATA_ONTOLOGY"); p != "" {
		return p
	}
	return "/etc/data/ontologia.json"
}

// FindForTests resolves the artefact for a test binary: DATA_ONTOLOGY if set,
// otherwise by walking up from `start` to the repository. Separate from
// DefaultPath because the walk is a development convenience and must never be a
// production fallback -- a service that goes looking for its own security policy
// on the filesystem can find the wrong one.
func FindForTests(start string) (string, error) {
	if p := os.Getenv("DATA_ONTOLOGY"); p != "" {
		return p, nil
	}
	dir, err := filepath.Abs(start)
	if err != nil {
		return "", err
	}
	for {
		p := filepath.Join(dir, "api", "src", "ontologia.json")
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("guard: no api/src/ontologia.json above %s and DATA_ONTOLOGY is "+
				"unset. It is generated by `uv --directory ai run ai-export`", start)
		}
		dir = parent
	}
}

// Load reads the artefact. It fails on anything it does not understand.
func Load(path string) (*Ontology, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("guard: cannot read the ontology artefact at %s: %w. It is generated "+
			"by `uv --directory ai run ai-export`; this service will not start without it, because "+
			"a data service with no forbidden-column list is a data service with no guard", path, err)
	}
	var o Ontology
	dec := json.NewDecoder(strings.NewReader(string(b)))
	if err := dec.Decode(&o); err != nil {
		return nil, fmt.Errorf("guard: %s is not readable as an ontology artefact: %w", path, err)
	}
	if len(o.Forbidden) == 0 {
		// An artefact that parsed but declares nothing forbidden would make
		// every check below pass trivially. That is the "guard that inspected
		// nothing and reported success" shape, so it is refused.
		return nil, fmt.Errorf("guard: %s declares no forbidden columns at all. Either the artefact "+
			"is truncated or the export is broken; a guard with an empty list approves everything", path)
	}
	if len(o.Paid) == 0 {
		// Same argument, second axis. An artefact that parsed but declares
		// nothing de_pago makes every paywall check below pass trivially, and
		// this service would then be certifying an obligation it never tested.
		return nil, fmt.Errorf("guard: %s declares no de_pago columns at all. The paywall axis is "+
			"half the ontology -- `clase` answers whose data this is, `muro` answers who paid to "+
			"read it -- and a service that cannot see the second one cannot check P4", path)
	}
	return &o, nil
}

// Tables lists the declared tables, sorted, for an error message that tells the
// reader what IS declared rather than only what is not.
func (o *Ontology) Tables() []string {
	out := make([]string, 0, len(o.Forbidden))
	for t := range o.Forbidden {
		out = append(out, t)
	}
	sort.Strings(out)
	return out
}

// ForbiddenColumns fails CLOSED on a table the ontology does not declare.
//
// The same decision api/src/ontology.ts makes, and for the same reason: this
// function used to answer `[]` for an unknown name over there, which turned the
// guard into a silent no-op for three tables -- one of them reset_tokens, which
// holds password-reset token hashes. A guard that approves what it never
// inspected is worse than no guard, because the review passes.
func (o *Ontology) ForbiddenColumns(table string) ([]string, error) {
	cols, ok := o.Forbidden[table]
	if !ok {
		return nil, fmt.Errorf("guard: table %q is not declared in the ontology. The guard cannot "+
			"approve what it does not know: declare it in ai/src/course_ai/ontology/data.py and "+
			"regenerate with `uv --directory ai run ai-export`. Declared: %s",
			table, strings.Join(o.Tables(), ", "))
	}
	return cols, nil
}

// PaidColumns fails CLOSED on an undeclared table, the same way
// ForbiddenColumns does and for the same reason: answering "no paid columns" for
// a name nobody declared is how a paywall check becomes a no-op that reports
// success.
func (o *Ontology) PaidColumns(table string) ([]string, error) {
	if len(o.Paid) == 0 {
		return nil, fmt.Errorf("guard: the artefact declares no de_pago columns at all, so the " +
			"paywall axis cannot be checked. Either it is truncated or the export is broken; " +
			"an empty list approves every paid column")
	}
	cols, ok := o.Paid[table]
	if !ok {
		return nil, fmt.Errorf("guard: table %q is not declared on the de_pago axis. Declare it in "+
			"ai/src/course_ai/ontology/data.py and regenerate with `uv --directory ai run ai-export`",
			table)
	}
	return cols, nil
}

// IsPaid reports whether one column sits behind the paywall.
func (o *Ontology) IsPaid(table, column string) (bool, error) {
	cols, err := o.PaidColumns(table)
	if err != nil {
		return false, err
	}
	for _, c := range cols {
		if c == column {
			return true, nil
		}
	}
	return false, nil
}

// IsForbidden reports whether one column of one table must never leave.
func (o *Ontology) IsForbidden(table, column string) (bool, error) {
	cols, err := o.ForbiddenColumns(table)
	if err != nil {
		return false, err
	}
	for _, c := range cols {
		if c == column {
			return true, nil
		}
	}
	return false, nil
}

// ColumnsOf lists every declared column of a table, sorted.
//
// Read out of `clases`, which keys every column of every table as
// "table.column" -- so this is the ontology's own column universe rather than a
// second list that could disagree with it. internal/plan needs it to answer
// "what may a plan name", and answering that from anywhere else would be the
// "generate from the source of truth, never a copy" rule broken.
//
// Fails CLOSED: a table with no declared columns returns nothing, and callers
// treat an empty universe as "nothing may be read here" rather than as
// "everything".
func (o *Ontology) ColumnsOf(table string) []string {
	prefix := table + "."
	var out []string
	for k := range o.Classes {
		if strings.HasPrefix(k, prefix) {
			col := k[len(prefix):]
			// One dot only. A key like "a.b.c" would otherwise hand back "b.c"
			// as a column name, and that string reaching a statement is the one
			// thing this package exists to prevent.
			if !strings.Contains(col, ".") {
				out = append(out, col)
			}
		}
	}
	sort.Strings(out)
	return out
}

// ClassOf returns the privacy class of one column, and whether it was declared.
//
// The two axes are ORTHOGONAL and collapsing them is the bug that already
// happened here: `clase` (publico|propio|agregado|jamas) answers whose data this
// is, and `muro` (gratis|de_pago) answers who paid to read it. With one axis the
// paywall rule was inexpressible, so the proof stayed green while the paid
// corpus walked out. This function reads the privacy axis only; IsPaid reads
// the other one.
func (o *Ontology) ClassOf(table, column string) (string, bool) {
	c, ok := o.Classes[table+"."+column]
	return c, ok
}

// ScrubToDeclared is the last line: it removes any key the operation did not
// declare, and reports what it removed.
//
// WHY THE DECLARED LIST AND NOT THE FORBIDDEN ONE. This function used to remove
// every forbidden column from every row, ignoring which operation had asked. It
// was WRONG in both directions, and the second one was severe:
//
//   - For an agent operation it did nothing. Validate already proves such an
//     operation declares no jamas column, so there was never one in the row.
//   - For an internal operation it undid the exemption the whole audience split
//     exists for. Measured against the real database:
//     user.credentials_by_email declares
//     [id email pass_hash role failed locked_until token_version] and came back
//     with ["role"], the other six stripped. Login compares a submitted password
//     against pass_hash and puts id in the session, so login through this
//     service was IMPOSSIBLE -- and the failure would have read as "the
//     migration broke auth", sending the reader to api/src/auth.ts.
//     lab.solution_for_grading lost `solution` the same way, which is grading.
//
// The declared list is the right rule because it keeps the belt-and-braces value
// and honours the exemption at once: a column no declaration mentions is removed
// whatever it is called, and a column the operation declared survives because
// Validate has already proved -- at startup, for the whole catalogue -- that an
// agent operation cannot declare a forbidden one.
//
// The reason it is needed at all is unchanged: the startup check verifies
// DECLARED columns, and the row that comes back from Postgres is whatever the
// driver produced. A migration that renames a column, a view that gains one, a
// `RETURNING *` somebody adds later -- each puts a key in the row that no
// declaration mentioned. So `removed` now means "the database handed back
// something this operation never asked for", which is exactly the alarming case
// the caller logs loudly.
func (o *Ontology) ScrubToDeclared(table string, row map[string]any, declared []string) (map[string]any, []string, error) {
	// The table must still be declared: a row from a table the ontology does not
	// know is not something to pass through because the column names looked fine.
	if _, err := o.ForbiddenColumns(table); err != nil {
		return nil, nil, err
	}
	if len(declared) == 0 {
		// A write returns no rows, so there is nothing to scrub; a read with no
		// declared columns is refused at startup. Reaching here with neither
		// means the caller passed the wrong list, and dropping every column
		// silently would look like an empty table.
		return nil, nil, fmt.Errorf("guard: nothing declared for a row from %q, so every column "+
			"would be removed. A read with no declared columns cannot pass Validate, so this is "+
			"the caller passing the wrong list", table)
	}
	keep := make(map[string]struct{}, len(declared))
	for _, c := range declared {
		keep[c] = struct{}{}
	}
	var removed []string
	out := make(map[string]any, len(row))
	for k, v := range row {
		if _, ok := keep[k]; !ok {
			removed = append(removed, k)
			continue
		}
		out[k] = v
	}
	sort.Strings(removed)
	return out, removed, nil
}

// Scrub removes every forbidden column from a row, ignoring any operation.
//
// Kept for the case ScrubToDeclared cannot serve: a row from somewhere with no
// declaration to check against. Nothing in this service is in that position
// today, and it must NOT be used on an operation's rows -- see
// ScrubToDeclared's comment for what that cost.
func (o *Ontology) Scrub(table string, row map[string]any) (map[string]any, []string, error) {
	forbidden, err := o.ForbiddenColumns(table)
	if err != nil {
		return nil, nil, err
	}
	index := make(map[string]struct{}, len(forbidden))
	for _, c := range forbidden {
		index[c] = struct{}{}
	}
	var removed []string
	out := make(map[string]any, len(row))
	for k, v := range row {
		if _, bad := index[k]; bad {
			removed = append(removed, k)
			continue
		}
		out[k] = v
	}
	sort.Strings(removed)
	return out, removed, nil
}
