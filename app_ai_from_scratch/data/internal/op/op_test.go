package op

import (
	"os"
	"strings"
	"testing"

	"course/data/internal/guard"
)

// ontology loads the REAL artefact. Not a fixture: the whole point of this
// service is that its guarantees are stated against the ontology the fleet
// actually runs, and a fixture would let the catalogue and the ontology drift
// apart while every test stayed green.
func ontology(t *testing.T) *guard.Ontology {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	path, err := guard.FindForTests(wd)
	if err != nil {
		t.Fatal(err)
	}
	o, err := guard.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	return o
}

func TestTheShippedCatalogueIsValid(t *testing.T) {
	for _, err := range Verify(ontology(t)) {
		t.Errorf("catalogue: %v", err)
	}
}

func TestByNameLosesNothing(t *testing.T) {
	if len(ByName()) != len(Catalog()) {
		t.Fatalf("ByName has %d entries and the catalogue has %d, so a duplicate name is silently "+
			"shadowing an operation", len(ByName()), len(Catalog()))
	}
}

// The refusals. Each case is an operation somebody could plausibly write, and
// each one must fail to START rather than fail at runtime.
func TestTheGateRefuses(t *testing.T) {
	ont := ontology(t)
	cases := []struct {
		name   string
		op     Operation
		expect string
	}{
		{
			name: "a star",
			op: Operation{Name: "bad.star", Table: "lessons", Scope: Public, Audience: Agent,
				Returns: []string{"n"}, Raw: "SELECT * FROM lessons", Why: "x"},
			expect: "star",
		},
		{
			name: "an agent operation returning a jamas column",
			op: Operation{Name: "bad.solution", Table: "labs", Scope: Public, Audience: Agent,
				Returns: []string{"id", "solution"}, From: "labs", Where: "id = $1", Limit: 1,
				Params: []Param{{Name: "id", Kind: Text, Max: 64}}, Why: "x"},
			expect: "jamas",
		},
		{
			name: "a scoped read with no actor",
			op: Operation{Name: "bad.noactor", Table: "attempts", Scope: Own, Audience: Agent,
				Returns: []string{"lab_id"}, From: "attempts", Where: "lab_id = $1",
				Params: []Param{{Name: "lab_id", Kind: Text, Max: 64}}, Why: "x"},
			expect: "no actor parameter",
		},
		{
			// THE ONE THAT MATTERS. It looks scoped, it says `own`, and its
			// filter is bound to a number the caller sent. That is a read of
			// anybody's attempts.
			name: "an identity filter bound to a caller-supplied value",
			op: Operation{Name: "bad.anyone", Table: "attempts", Scope: Own, Audience: Agent,
				Returns: []string{"lab_id", "answer"}, From: "attempts", Where: "user_id = $2 AND lab_id = $1",
				Params: []Param{
					{Name: "lab_id", Kind: Text, Max: 64},
					{Name: "whose", Kind: Int, Max: 1 << 30},
				}, Why: "x"},
			expect: "not the actor parameter",
		},
		{
			name: "a caller-supplied parameter that names a person",
			op: Operation{Name: "bad.userid", Table: "attempts", Scope: Own, Audience: Agent,
				Returns: []string{"lab_id"}, From: "attempts", Where: "lab_id = $2 AND user_id = $1",
				Params: []Param{
					{Name: "actor", Kind: Actor},
					{Name: "user_id", Kind: Int, Max: 100},
				}, Why: "x"},
			expect: "names a person",
		},
		{
			name: "raw whose select list disagrees with Returns",
			op: Operation{Name: "bad.raw", Table: "lessons", Scope: Public, Audience: Agent,
				Returns: []string{"n", "title"},
				Raw:     "SELECT n, title, summary FROM lessons", Why: "x"},
			expect: "Returns declares",
		},
		{
			name: "an unbounded text parameter",
			op: Operation{Name: "bad.unbounded", Table: "labs", Scope: Public, Audience: Agent,
				Returns: []string{"id"}, From: "labs", Where: "id = $1", Limit: 1,
				Params: []Param{{Name: "id", Kind: Text}}, Why: "x"},
			expect: "no Max",
		},
		{
			name: "an enum with no allowed values",
			op: Operation{Name: "bad.enum", Table: "labs", Scope: Public, Audience: Agent,
				Returns: []string{"id"}, From: "labs", Where: "level = $1", Limit: 1,
				Params: []Param{{Name: "level", Kind: Enum}}, Why: "x"},
			expect: "no allowed values",
		},
		{
			name: "an undeclared table",
			op: Operation{Name: "bad.table", Table: "secrets_v2", Scope: Public, Audience: Agent,
				Returns: []string{"x"}, From: "secrets_v2", Why: "x"},
			expect: "not declared in the ontology",
		},
		{
			name: "a parameter declared and never used",
			op: Operation{Name: "bad.unused", Table: "lessons", Scope: Public, Audience: Agent,
				Returns: []string{"n"}, From: "lessons", Limit: 1,
				Params: []Param{{Name: "n", Kind: Int, Max: 99}}, Why: "x"},
			expect: "never used",
		},
		{
			name: "an internal exemption with no justification",
			op: Operation{Name: "bad.unjustified", Table: "labs", Scope: Public, Audience: Internal,
				Returns: []string{"id", "solution"}, From: "labs", Where: "id = $1", Limit: 1,
				Params: []Param{{Name: "id", Kind: Text, Max: 64}}, Why: "x"},
			expect: "no Justify",
		},
		{
			name: "an internal label that exempts nothing",
			op: Operation{Name: "bad.pointless", Table: "lessons", Scope: Public, Audience: Internal,
				Returns: []string{"n"}, From: "lessons", Limit: 1, Why: "x"},
			expect: "only hides",
		},
		{
			name: "an operation with no explanation",
			op: Operation{Name: "bad.silent", Table: "lessons", Scope: Public, Audience: Agent,
				Returns: []string{"n"}, From: "lessons", Limit: 1},
			expect: "no Why",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			errs := c.op.Validate(ont)
			if len(errs) == 0 {
				t.Fatalf("accepted. Statement was: %s", c.op.SQL())
			}
			var all []string
			for _, e := range errs {
				all = append(all, e.Error())
			}
			joined := strings.Join(all, " | ")
			if !strings.Contains(joined, c.expect) {
				t.Errorf("refused for the wrong reason.\n want mention of: %q\n got: %s", c.expect, joined)
			}
		})
	}
}

// No operation may take a table, a column list or SQL as a parameter. Any of
// those hands the decision about what may be read back to the caller, which is
// the thing being isolated from.
func TestNoOperationLetsTheCallerChooseWhatToRead(t *testing.T) {
	banned := []string{"table", "tabla", "column", "columna", "columns", "sql", "query", "consulta",
		"where", "order_by", "select", "fields"}
	for _, o := range Catalog() {
		for _, p := range o.Params {
			for _, b := range banned {
				if strings.EqualFold(p.Name, b) {
					t.Errorf("op %s takes a parameter named %q. That moves the choice of what may be "+
						"read from the catalogue to the caller", o.Name, p.Name)
				}
			}
		}
	}
}

// Every agent-facing operation, checked directly rather than through Verify, so
// the failure message names P1.
func TestNoAgentOperationCanReachAJamasColumn(t *testing.T) {
	ont := ontology(t)
	for _, o := range Catalog() {
		if o.Audience != Agent {
			continue
		}
		if bad := o.TouchesForbidden(ont); len(bad) > 0 {
			t.Errorf("op %s is agent-facing and returns %s.%s. That is P1: no jamas column reaches "+
				"the agent", o.Name, o.Table, strings.Join(bad, ","))
		}
	}
}

// THE PINNED LIST. Adding an internal exemption must break this test, because an
// exemption is the one place the guarantee is deliberately not absolute and it
// should never be possible to add one without a reviewer seeing it.
func TestTheExemptionListDoesNotGrowQuietly(t *testing.T) {
	want := []string{
		"auth.admin_users -> users.email,id",
		"auth.password_reset -> users.deleted_at,email,failed,id,locked_until,pass_hash,token_version",
		"auth.recovery_by_email -> users.id",
		"auth.register -> users.deleted_at,email,failed,id,locked_until,pass_hash,token_version",
		"auth.reset_lookup -> reset_tokens.expires_at,id,used_at,user_id",
		"auth.throttle -> auth_throttles.expires_at",
		"auth.user -> users.deleted_at,email,failed,id,locked_until,pass_hash,token_version",
		"auth.user_by_email -> users.deleted_at,email,failed,id,locked_until,pass_hash,token_version",
		"bus.claim -> jobs.clave",
		"counter.read -> jobs.datos",
		"job.oldest_due -> jobs.corre_en",
		"job.orphans -> jobs.tipo",
		"job.state_counts -> jobs.estado",
		"job.take -> jobs.clave,datos,id,intentos,tipo",
		"lab.solution_for_grading -> labs.solution",
		"league.flow -> ranking_optin.user_id",
		"question.solution_for_grading -> questions.solution",
		"root.solved_labs -> attempts.id",
		"tutor.students_all -> users.email,id",
		"tutor.students_cohort -> users.email,id",
		"user.credentials_by_email -> users.email,failed,id,locked_until,pass_hash,token_version",
	}
	got := Exemptions(ontology(t))
	if len(got) != len(want) {
		t.Fatalf("there are %d exemptions and this test pins %d.\ngot:\n  %s\n\nIf you added one on "+
			"purpose, add it here too -- that edit is the review.",
			len(got), len(want), strings.Join(got, "\n  "))
	}
	for i := range want {
		if !strings.HasPrefix(got[i], want[i]) {
			t.Errorf("exemption %d changed.\n want prefix: %s\n got:         %s", i, want[i], got[i])
		}
	}
	// An exemption with an empty justification would pass the prefix check.
	for _, g := range got {
		if !strings.Contains(g, " : ") || len(strings.SplitN(g, " : ", 2)[1]) < 40 {
			t.Errorf("exemption %q has no real justification. Name the machinery that cannot work "+
				"without the column", g)
		}
	}
}

// Every scoped read must actually restrict to one person. Checked over the real
// catalogue so a new operation cannot quietly omit it.
func TestEveryScopedReadFiltersOnTheActor(t *testing.T) {
	for _, o := range Catalog() {
		if o.Scope != Own || o.Write {
			continue
		}
		sql := strings.ToLower(o.SQL())
		idx := o.ActorIndex()
		if idx == 0 {
			t.Errorf("op %s is scoped own and has no actor parameter", o.Name)
			continue
		}
		if !strings.Contains(sql, "where") {
			t.Errorf("op %s is scoped own and has no WHERE clause", o.Name)
		}
	}
}

// The assembled form must never produce a star, whatever it is handed.
func TestTheAssembledStatementNeverContainsAStar(t *testing.T) {
	for _, o := range Catalog() {
		// HasWildcard, not strings.Contains: COUNT(*) is a function argument and
		// this test used to reject it, which made every aggregate unexpressible.
		// One implementation, shared with Validate -- two were how they disagreed.
		if HasWildcard(o.SQL()) {
			t.Errorf("op %s renders a wildcard: %s", o.Name, o.SQL())
		}
	}
}

// ---------------------------------------------------------------------------
// THE PAYWALL AXIS (obligation P4).
//
// These tests exist because the check they cover was MISSING, and its absence
// was not theoretical. api/src/server.ts ran `SELECT * FROM lessons` and spread
// every column into the /api/lessons response for all twelve lessons -- with
// `locked` as a flag the client was trusted to honour -- while lessons.technical
// and lessons.analogy are both de_pago. Nothing walked out only because those
// two columns happened to be empty.
//
// A check with no test proving it FIRES is the shape that has gone dark three
// times in this repository, so each direction is tested against a deliberately
// wrong operation rather than only against the shipped catalogue.

// muroFixture is a valid operation with one field left to the caller.
func muroFixture(returns []string, m Muro) Operation {
	return Operation{
		Name: "lesson.probe", Table: "lessons", Scope: Public, Audience: Agent, Muro: m,
		Returns: returns, From: "lessons", Order: "n", Limit: 10,
		Why: "a fixture for the paywall check",
	}
}

func TestAPaidColumnCannotRideOutDeclaredFree(t *testing.T) {
	ont := ontology(t)
	// lessons.technical is de_pago in the artefact. Asserted here rather than
	// assumed, because if the ontology ever reclassified it this test would
	// otherwise pass while checking nothing.
	if paid, err := ont.IsPaid("lessons", "technical"); err != nil || !paid {
		t.Fatalf("the fixture assumes lessons.technical is de_pago; IsPaid says %v (err %v). "+
			"Pick another paid column rather than deleting the test", paid, err)
	}
	errs := muroFixture([]string{"n", "title", "technical"}, Gratis).Validate(ont)
	if !anyErrorContains(errs, "technical") {
		t.Fatalf("an operation returning a de_pago column while declaring muro=gratis was accepted. "+
			"That is exactly the /api/lessons hole.\ngot: %v", errs)
	}
}

func TestAWallInFrontOfFreeContentIsRefused(t *testing.T) {
	// The other direction, and it matters as much: a declaration that does not
	// match what the operation returns is one nobody can trust, and the next
	// reader either believes it or stops believing all of them.
	errs := muroFixture([]string{"n", "title"}, DePago).Validate(ontology(t))
	if !anyErrorContains(errs, "no paid column") {
		t.Fatalf("an operation declaring de_pago while returning only free columns was accepted.\ngot: %v", errs)
	}
}

func TestAnUndeclaredMuroIsRefusedRatherThanAssumedFree(t *testing.T) {
	errs := muroFixture([]string{"n", "title"}, "").Validate(ontology(t))
	if !anyErrorContains(errs, "muro") {
		t.Fatalf("an operation with no Muro was accepted. The zero value must not mean gratis: "+
			"a de_pago column would then ride out on a typo.\ngot: %v", errs)
	}
	// And a value that is neither.
	errs = muroFixture([]string{"n", "title"}, Muro("libre")).Validate(ontology(t))
	if !anyErrorContains(errs, "muro") {
		t.Fatalf("Muro(%q) was accepted as a third state.\ngot: %v", "libre", errs)
	}
}

// The paid operations are pinned by name, the same way the jamas exemptions are.
// Adding a de_pago column to an operation is a product decision -- it puts that
// operation behind an access check in api -- and this list is where the decision
// is reviewed.
func TestTheSetOfPaidOperationsDoesNotGrowQuietly(t *testing.T) {
	ont := ontology(t)
	want := map[string][]string{
		"lesson.get":             {"analogy", "technical"},
		"lesson.search_corpus":   {"analogy", "technical"},
		"lab.list_for_lesson":    {"payload", "prompt"},
		"lab.get":                {"payload", "prompt"},
		"lab.prompts":            {"prompt"},
		"lab.explanation":        {"explanation"},
		"lesson_text.get":        {"analogy", "examples", "technical"},
		"lesson_text.by_lang":    {"analogy", "technical"},
		"progress.failed_labs":   {"prompt"},
		"question.explanation":   {"explanation_en", "explanation_es"},
		"question.list_for_pack": {"payload", "prompt_en", "prompt_es"},
	}
	got := map[string][]string{}
	for _, o := range Catalog() {
		if paid := o.TouchesPaid(ont); len(paid) > 0 {
			got[o.Name] = paid
		}
		// Every paid operation must SAY so. Validate already enforces this; the
		// point here is that the two lists cannot drift apart.
		if len(o.TouchesPaid(ont)) > 0 && o.Muro != DePago {
			t.Errorf("op %s returns paid columns %v but declares muro=%q",
				o.Name, o.TouchesPaid(ont), o.Muro)
		}
		if o.Muro == DePago && len(o.TouchesPaid(ont)) == 0 && !o.Write {
			t.Errorf("op %s declares muro=de_pago and returns no paid column", o.Name)
		}
	}
	if len(got) != len(want) {
		t.Fatalf("%d operations return paid columns and this test pins %d.\ngot: %v\n\n"+
			"If you added one on purpose, add it here too -- and check that every api call site "+
			"sits behind an access check, because this service declares the wall and does not "+
			"enforce it.", len(got), len(want), got)
	}
	for name, cols := range want {
		g, ok := got[name]
		if !ok {
			t.Errorf("op %s no longer returns paid columns; the pin is stale", name)
			continue
		}
		if strings.Join(g, ",") != strings.Join(cols, ",") {
			t.Errorf("op %s paid columns changed: want %v, got %v", name, cols, g)
		}
	}
}

// The guard must fail CLOSED on the paid axis too. ForbiddenColumns already
// does; PaidColumns answering "none" for a table nobody declared would make
// every paywall check below it a no-op that reports success.
func TestThePaidAxisFailsClosedOnAnUndeclaredTable(t *testing.T) {
	if _, err := ontology(t).PaidColumns("tabla_que_nadie_declaro"); err == nil {
		t.Fatal("PaidColumns answered for an undeclared table instead of refusing")
	}
}

func anyErrorContains(errs []error, sub string) bool {
	for _, e := range errs {
		if e != nil && strings.Contains(e.Error(), sub) {
			return true
		}
	}
	return false
}

// An ALIAS must not launder a forbidden column.
//
// Every other check in this package is structural: a star is unreachable because
// the statement is assembled from Returns, an actor cannot come from the request
// body because there is no field for it. This one was not. The forbidden check
// reads Returns, validateRaw compares Returns against the TRAILING NAME of each
// select item, and trailingName returns the alias -- so
//
//	Raw:     "SELECT pass_hash AS x FROM users WHERE id = $1"
//	Returns: []string{"x"}
//
// matched, IsForbidden("users", "x") answered false, and an agent-facing
// operation returned users.pass_hash. Reaching it needs an edit to catalog.go,
// which is exactly the threat this package exists for: the guard's job is to be
// impossible to get wrong, not merely to be got right today.
func TestAnAliasCannotLaunderAForbiddenColumn(t *testing.T) {
	ont := ontology(t)
	if bad, err := ont.IsForbidden("users", "pass_hash"); err != nil || !bad {
		t.Fatalf("the fixture assumes users.pass_hash is jamas; IsForbidden says %v (err %v)", bad, err)
	}
	o := Operation{
		Name: "user.probe", Table: "users", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw:     "SELECT pass_hash AS x FROM users WHERE id = $1",
		Returns: []string{"x"},
		Params:  []Param{{Name: "actor", Kind: Actor}},
		Why:     "a fixture proving an alias cannot hide a forbidden column",
	}
	errs := o.Validate(ont)
	if !anyErrorContains(errs, "pass_hash") {
		t.Fatalf("an agent operation returned users.pass_hash under the alias \"x\" and was accepted. "+
			"The forbidden check must read the EXPRESSION, not the alias.\ngot: %v", errs)
	}
}

func TestAnAliasCannotLaunderAPaidColumn(t *testing.T) {
	o := Operation{
		Name: "lesson.probe", Table: "lessons", Scope: Public, Audience: Agent, Muro: Gratis,
		Raw:     "SELECT technical AS t FROM lessons WHERE n = $1",
		Returns: []string{"t"},
		Params:  []Param{{Name: "n", Kind: Int, Max: 99}},
		Why:     "a fixture proving an alias cannot hide a paid column",
	}
	if !anyErrorContains(o.Validate(ontology(t)), "technical") {
		t.Fatalf("lessons.technical was returned as \"t\" under muro=gratis and accepted")
	}
}
