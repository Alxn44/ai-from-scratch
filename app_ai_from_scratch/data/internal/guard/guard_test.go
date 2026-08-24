package guard

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func realOntology(t *testing.T) *Ontology {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	path, err := FindForTests(wd)
	if err != nil {
		t.Fatal(err)
	}
	o, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	return o
}

// The artefact this service is built against must actually declare things. A
// guard loaded from an empty list approves everything, which is the exact shape
// of the failure this whole package exists to prevent.
func TestTheRealArtefactDeclaresAForbiddenSet(t *testing.T) {
	o := realOntology(t)
	if len(o.Tables()) < 10 {
		t.Fatalf("only %d tables declared: %v", len(o.Tables()), o.Tables())
	}
	total := 0
	for _, cols := range o.Forbidden {
		total += len(cols)
	}
	// 46 today. Asserting a floor rather than the exact number: the count moves
	// when the schema grows, and a test that fails on every legitimate migration
	// gets deleted.
	if total < 40 {
		t.Errorf("%d forbidden columns in total, expected at least 40. Either the export is broken "+
			"or the ontology lost a table", total)
	}
	// The one that would be catastrophic to lose.
	if bad, err := o.IsForbidden("users", "pass_hash"); err != nil || !bad {
		t.Errorf("users.pass_hash is not forbidden (err=%v). Every guarantee in this service assumes "+
			"the password hash is classed jamas", err)
	}
}

// Fail closed on an unknown table. This exact function answered `[]` in the
// TypeScript original, which turned the guard into a silent no-op for three
// tables -- one of them holding password-reset token hashes.
func TestAnUndeclaredTableThrowsRatherThanApproving(t *testing.T) {
	o := realOntology(t)
	_, err := o.ForbiddenColumns("a_table_nobody_declared")
	if err == nil {
		t.Fatal("an undeclared table returned a forbidden list instead of an error. A guard that " +
			"approves what it never inspected is worse than no guard, because the review passes")
	}
	// The error has to be actionable: it must name where to declare it.
	for _, want := range []string{"data.py", "ai-export"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the refusal does not say how to fix it (missing %q): %v", want, err)
		}
	}
	if _, err := o.IsForbidden("a_table_nobody_declared", "x"); err == nil {
		t.Error("IsForbidden approved a column of an undeclared table")
	}
	if _, _, err := o.Scrub("a_table_nobody_declared", map[string]any{"x": 1}); err == nil {
		t.Error("Scrub passed a row of an undeclared table through untouched")
	}
}

// An artefact that parses but declares nothing must be refused at load, not
// accepted and then trusted.
func TestAnEmptyArtefactIsRefused(t *testing.T) {
	dir := t.TempDir()
	for name, body := range map[string]string{
		"empty.json":     `{}`,
		"no-forbidden":   `{"clases":{"users.name":"propio"}}`,
		"null-forbidden": `{"prohibidas":null}`,
	} {
		p := filepath.Join(dir, name+".json")
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(p); err == nil {
			t.Errorf("%s: loaded an artefact with no forbidden columns. Every check downstream would "+
				"pass trivially", name)
		}
	}
	if _, err := Load(filepath.Join(dir, "does-not-exist.json")); err == nil {
		t.Error("a missing artefact loaded successfully")
	}
}

// Scrub is the runtime backstop: the startup check verifies DECLARED columns,
// and this removes anything a migration added that no declaration mentions.
func TestScrubRemovesForbiddenColumnsAndSaysWhich(t *testing.T) {
	o := realOntology(t)
	row := map[string]any{"name": "Ana", "role": "student", "pass_hash": "$2b$...", "id": 7}
	clean, removed, err := o.Scrub("users", row)
	if err != nil {
		t.Fatal(err)
	}
	for _, gone := range []string{"pass_hash", "id"} {
		if _, still := clean[gone]; still {
			t.Errorf("%s survived the scrub", gone)
		}
	}
	if clean["name"] != "Ana" || clean["role"] != "student" {
		t.Errorf("the scrub removed a permitted column: %v", clean)
	}
	if len(removed) != 2 {
		t.Errorf("removed = %v, want the two forbidden columns named so the caller can shout", removed)
	}
	// Sorted, so a log line is stable and diffable across runs.
	if removed[0] != "id" || removed[1] != "pass_hash" {
		t.Errorf("removed = %v, want it sorted", removed)
	}
}

func TestClassOfReadsThePrivacyAxisOnly(t *testing.T) {
	o := realOntology(t)
	// The two axes are orthogonal, and collapsing them is the bug that already
	// happened: with one axis the paywall rule was inexpressible.
	if c, ok := o.ClassOf("users", "pass_hash"); !ok || c != "jamas" {
		t.Errorf("users.pass_hash class = %q ok=%v, want jamas", c, ok)
	}
	if c, ok := o.ClassOf("lessons", "title"); !ok || c != "publico" {
		t.Errorf("lessons.title class = %q ok=%v, want publico", c, ok)
	}
	if _, ok := o.ClassOf("users", "a_column_nobody_declared"); ok {
		t.Error("an undeclared column reported a class")
	}
}

// ---------------------------------------------------------------------------
// SCRUBBING BY THE DECLARED LIST.
//
// These pin a bug that was found by RUNNING the catalogue against the real
// database, not by reading it: every declaration validated, every gate was
// green, and two operations came back unusable.
//
// Scrub removed forbidden columns from every row regardless of which operation
// asked, so the internal exemptions -- the entire reason the Audience split
// exists -- were undone at runtime. Measured: user.credentials_by_email declares
// seven columns and returned one, `role`. No pass_hash to compare a password
// against and no id to put in the session, so login could not work; the symptom
// would have arrived as "the migration broke auth".

func TestAnInternalOperationKeepsTheColumnsItDeclared(t *testing.T) {
	o := realOntology(t)
	// The login row, as Postgres hands it back.
	row := map[string]any{
		"id": 7, "email": "a@b.c", "pass_hash": "argon2id$...", "role": "student",
		"failed": 0, "locked_until": nil, "token_version": 1,
	}
	declared := []string{"id", "email", "pass_hash", "role", "failed", "locked_until", "token_version"}
	clean, removed, err := o.ScrubToDeclared("users", row, declared)
	if err != nil {
		t.Fatalf("ScrubToDeclared: %v", err)
	}
	if len(removed) != 0 {
		t.Errorf("removed %v from an operation that declared every one of them", removed)
	}
	for _, c := range []string{"pass_hash", "id"} {
		if _, ok := clean[c]; !ok {
			t.Errorf("%s was removed. Login compares a password against pass_hash and puts id in "+
				"the session, so this is login not working", c)
		}
	}
}

func TestAColumnNobodyDeclaredIsRemovedAndReported(t *testing.T) {
	o := realOntology(t)
	// What a migration adding a column looks like from here: the driver hands
	// back a key no declaration mentions.
	row := map[string]any{"name": "Ada", "role": "student", "recovery_email": "leak@example.com"}
	clean, removed, err := o.ScrubToDeclared("users", row, []string{"name", "role"})
	if err != nil {
		t.Fatalf("ScrubToDeclared: %v", err)
	}
	if _, ok := clean["recovery_email"]; ok {
		t.Fatal("an undeclared column survived. That is the whole point of this function")
	}
	if len(removed) != 1 || removed[0] != "recovery_email" {
		t.Errorf("removed = %v, want [recovery_email]. The caller logs this loudly, so it has to "+
			"name what actually happened", removed)
	}
}

func TestScrubbingWithNothingDeclaredIsAnErrorNotAnEmptyRow(t *testing.T) {
	// Dropping every column silently is indistinguishable from an empty table,
	// and that is how a caller passing the wrong list looks like a data problem.
	if _, _, err := realOntology(t).ScrubToDeclared("users", map[string]any{"name": "Ada"}, nil); err == nil {
		t.Fatal("an empty declared list returned a row instead of refusing")
	}
}

func TestScrubbingStillRefusesAnUndeclaredTable(t *testing.T) {
	if _, _, err := realOntology(t).ScrubToDeclared(
		"tabla_que_nadie_declaro", map[string]any{"x": 1}, []string{"x"}); err == nil {
		t.Fatal("a row from an undeclared table passed because its column names looked fine")
	}
}
