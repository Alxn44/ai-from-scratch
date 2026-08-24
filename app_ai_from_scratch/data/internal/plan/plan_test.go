package plan

import (
	"os"
	"strings"
	"testing"

	"course/data/internal/guard"
)

func ont(t *testing.T) *guard.Ontology {
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

const actor = int64(42)

// ---------------------------------------------------------------------------
// THE ATTACKS.
//
// Every case below is what a prompt injection would attempt. The model reads
// student-authored text, so each of these is a plan the model could be TALKED
// into composing -- the question is only whether this package emits SQL for it.

func TestTheAnswerToALabIsNotNameable(t *testing.T) {
	// The attack this whole design exists to stop. ai/src/course_ai/ontology
	// /data.py on labs.solution: "LA MAS IMPORTANTE. Si el agente puede leerla,
	// «dime la respuesta del 5.2» destruye el curso."
	_, err := Compile(ont(t), Plan{
		Table: "labs", Select: []string{"id", "solution"},
	}, actor)
	if err == nil {
		t.Fatal("a plan selected labs.solution and compiled. The course is over")
	}
	if !strings.Contains(err.Error(), "not readable") {
		t.Errorf("refused for the wrong reason: %v", err)
	}
}

func TestPasswordHashesAreNotNameable(t *testing.T) {
	for _, c := range []string{"pass_hash", "email", "token_version", "failed", "locked_until"} {
		if _, err := Compile(ont(t), Plan{Table: "users", Select: []string{c}}, actor); err == nil {
			t.Errorf("a plan selected users.%s and compiled", c)
		}
	}
}

// Four tables are unreachable because EVERY column is jamas. No rule in this
// package names them: it falls out of the ontology. If a migration ever declares
// a readable column on one of them, this test fails and that is the review.
func TestTheTablesWithNothingReadableAreRefusedWholesale(t *testing.T) {
	for _, table := range []string{"jobs", "payments", "reset_tokens", "role_audit"} {
		if _, err := Selectable(ont(t), table); err == nil {
			t.Errorf("%s has a readable column, so a plan can reach it. Either the ontology changed "+
				"or the paywall/jamas classification did -- check which before deleting this case", table)
		}
	}
}

func TestPaidProseIsNotNameable(t *testing.T) {
	// P4. The planner must not be a way around the paywall the named operations
	// are gated by: lesson_text holds the product.
	for _, c := range []string{"technical", "analogy", "examples"} {
		if _, err := Compile(ont(t), Plan{Table: "lesson_text", Select: []string{c}}, actor); err == nil {
			t.Errorf("a plan selected lesson_text.%s, which is de_pago, and compiled", c)
		}
	}
	for _, c := range []string{"technical", "analogy"} {
		if _, err := Compile(ont(t), Plan{Table: "lessons", Select: []string{c}}, actor); err == nil {
			t.Errorf("a plan selected lessons.%s and compiled", c)
		}
	}
	// And labs' paid enunciado.
	for _, c := range []string{"prompt", "payload", "explanation"} {
		if _, err := Compile(ont(t), Plan{Table: "labs", Select: []string{c}}, actor); err == nil {
			t.Errorf("a plan selected labs.%s and compiled", c)
		}
	}
}

// P3, and the most important structural claim: there is no plan that reads
// somebody else's rows, because the actor filter is injected rather than
// accepted. The plan below is the closest a caller can get, and it must still
// come back scoped to the caller.
func TestAPlanCannotReachAnotherPerson(t *testing.T) {
	c, err := Compile(ont(t), Plan{
		Table: "attempts", Select: []string{"lab_id", "correct"},
		// A filter naming a person is not expressible: user_id is jamas on
		// attempts, so it is not in the readable set and `named` refuses it.
		Where: []Cond{{Column: "correct", Op: "=", Value: float64(1)}},
	}, actor)
	if err != nil {
		t.Fatalf("a legitimate plan was refused: %v", err)
	}
	if !c.Scoped {
		t.Fatal("a plan over attempts was not scoped")
	}
	if !strings.Contains(c.SQL, "user_id = $1") {
		t.Fatalf("the actor filter is missing or is not $1: %s", c.SQL)
	}
	if c.Params[0] != actor {
		t.Fatalf("$1 = %v, want the actor %d", c.Params[0], actor)
	}
	// And a filter that tries to name one is refused outright.
	if _, err := Compile(ont(t), Plan{
		Table: "attempts", Select: []string{"lab_id"},
		Where: []Cond{{Column: "user_id", Op: "=", Value: float64(7)}},
	}, actor); err == nil {
		t.Fatal("a plan filtered on attempts.user_id and compiled")
	}
}

func TestAPersonalTableRefusesAnUnauthenticatedPlan(t *testing.T) {
	// Serving it with actor 0 would return nothing and read as "you have no
	// attempts" rather than as "this request had no identity".
	if _, err := Compile(ont(t), Plan{Table: "attempts", Select: []string{"lab_id"}}, 0); err == nil {
		t.Fatal("a plan over a personal table was served with no actor")
	}
}

func TestPublicContentNeedsNoActor(t *testing.T) {
	c, err := Compile(ont(t), Plan{Table: "lessons", Select: []string{"n", "title"}}, 0)
	if err != nil {
		t.Fatalf("a public plan was refused: %v", err)
	}
	if c.Scoped {
		t.Error("lessons was reported as scoped; nothing there belongs to a person")
	}
	if strings.Contains(c.SQL, "$1") {
		t.Errorf("a public plan bound a parameter: %s", c.SQL)
	}
}

// An ordering oracle: rank rows by a value you may not read, and you learn it
// without it ever appearing in a response.
func TestOrderingByAnUnreadableColumnIsRefused(t *testing.T) {
	if _, err := Compile(ont(t), Plan{
		Table: "users", Select: []string{"name"},
		Order: []Sort{{Column: "pass_hash", Dir: "asc"}},
	}, actor); err == nil {
		t.Fatal("a plan ordered by users.pass_hash and compiled")
	}
	// Also refused when the column IS readable but was not selected: the result
	// would be ranked by something the caller cannot see in it.
	if _, err := Compile(ont(t), Plan{
		Table: "users", Select: []string{"name"},
		Order: []Sort{{Column: "created_at", Dir: "asc"}},
	}, actor); err == nil {
		t.Fatal("a plan ordered by a column it does not return and compiled")
	}
}

// A comparison oracle: filter on a forbidden column and read the row COUNT.
// `pass_hash LIKE 'a%'` returning 1 row leaks a character at a time.
func TestFilteringOnAnUnreadableColumnIsRefused(t *testing.T) {
	if _, err := Compile(ont(t), Plan{
		Table: "users", Select: []string{"name"},
		Where: []Cond{{Column: "pass_hash", Op: "like", Value: "a%"}},
	}, actor); err == nil {
		t.Fatal("a plan filtered on users.pass_hash and compiled. That is a character-at-a-time oracle")
	}
	if _, err := Compile(ont(t), Plan{
		Table: "labs", Select: []string{"id"},
		Where: []Cond{{Column: "solution", Op: "like", Value: "%42%"}},
	}, actor); err == nil {
		t.Fatal("a plan filtered on labs.solution and compiled. Guessing the answer 36 times is cheap")
	}
}

// Injection through every field that reaches the statement as an IDENTIFIER.
// Values are bound, so the interesting cases are the names.
func TestNoIdentifierFieldAcceptsSQL(t *testing.T) {
	nasty := []string{
		"id; DROP TABLE users", "id, solution", "*", "id) UNION SELECT solution FROM labs --",
		"solution", "id/**/", "\"solution\"", "labs.solution", "id\n, solution",
	}
	for _, bad := range nasty {
		if _, err := Compile(ont(t), Plan{Table: "labs", Select: []string{bad}}, actor); err == nil {
			t.Errorf("select %q compiled", bad)
		}
		if _, err := Compile(ont(t), Plan{
			Table: "labs", Select: []string{"id"},
			Where: []Cond{{Column: bad, Op: "=", Value: "x"}},
		}, actor); err == nil {
			t.Errorf("where on %q compiled", bad)
		}
		if _, err := Compile(ont(t), Plan{
			Table: "labs", Select: []string{"id"},
			Order: []Sort{{Column: bad, Dir: "asc"}},
		}, actor); err == nil {
			t.Errorf("order by %q compiled", bad)
		}
		if _, err := Compile(ont(t), Plan{
			Table: "labs", Aggregate: []Agg{{Fn: "count", As: bad}},
		}, actor); err == nil {
			t.Errorf("aggregate alias %q compiled", bad)
		}
		if _, err := Compile(ont(t), Plan{Table: bad, Select: []string{"id"}}, actor); err == nil {
			t.Errorf("table %q compiled", bad)
		}
	}
}

func TestTheDirectionIsNotAPlaceToPutSQL(t *testing.T) {
	if _, err := Compile(ont(t), Plan{
		Table: "lessons", Select: []string{"n"},
		Order: []Sort{{Column: "n", Dir: "asc, (SELECT solution FROM labs LIMIT 1)"}},
	}, actor); err == nil {
		t.Fatal("a direction carrying a subquery compiled")
	}
}

func TestOnlyTheClosedSetsOfOperatorsAndAggregatesAreAccepted(t *testing.T) {
	for _, op := range []string{"", "==", "!=", "regexp", "~", "similar to", "between", "and", "or"} {
		if _, err := Compile(ont(t), Plan{
			Table: "lessons", Select: []string{"n"},
			Where: []Cond{{Column: "n", Op: op, Value: float64(1)}},
		}, actor); err == nil {
			t.Errorf("operator %q compiled", op)
		}
	}
	for _, fn := range []string{"", "median", "string_agg", "array_agg", "pg_read_file", "count(*)"} {
		if _, err := Compile(ont(t), Plan{
			Table: "lessons", Aggregate: []Agg{{Fn: fn, Column: "n", As: "x"}},
		}, actor); err == nil {
			t.Errorf("aggregate %q compiled", fn)
		}
	}
}

// ---------------------------------------------------------------------------
// THE USEFUL HALF. A guard that refuses everything is easy; the point is that
// the model can still ask real questions.

func TestTheModelCanActuallyAskSomething(t *testing.T) {
	o := ont(t)
	cases := []struct {
		what string
		p    Plan
	}{
		{"my failed labs, most recent first", Plan{
			Table: "attempts", Select: []string{"lab_id", "at"},
			Where: []Cond{{Column: "correct", Op: "=", Value: float64(0)}},
			Order: []Sort{{Column: "at", Dir: "desc"}}, Limit: 20,
		}},
		{"how many times I tried each lab", Plan{
			Table: "attempts", Select: []string{"lab_id"}, Group: []string{"lab_id"},
			Aggregate: []Agg{{Fn: "count", As: "tries"}, {Fn: "max", Column: "correct", As: "best"}},
			Order:     []Sort{{Column: "tries", Dir: "desc"}},
		}},
		{"the hard labs of lesson 5", Plan{
			Table: "labs", Select: []string{"id", "level", "idx"},
			Where: []Cond{
				{Column: "lesson_n", Op: "=", Value: float64(5)},
				{Column: "level", Op: "in", Values: []any{"dificil", "medio"}},
				{Column: "draft", Op: "=", Value: float64(0)},
			},
			Order: []Sort{{Column: "idx", Dir: "asc"}},
		}},
		{"my achievements by kind", Plan{
			Table: "achievements", Select: []string{"kind"}, Group: []string{"kind"},
			Aggregate: []Agg{{Fn: "count", As: "n"}},
		}},
		{"which languages have text at all", Plan{
			Table: "lesson_text", Select: []string{"lang"}, Group: []string{"lang"},
			Aggregate: []Agg{{Fn: "count", As: "lessons"}},
		}},
		{"lessons whose title mentions a word", Plan{
			Table: "lessons", Select: []string{"n", "title"},
			Where: []Cond{{Column: "title", Op: "like", Value: "%token%"}},
		}},
		{"my league history", Plan{
			Table: "league_week", Select: []string{"week", "metal", "puesto"},
			Order: []Sort{{Column: "week", Dir: "desc"}}, Limit: 12,
		}},
	}
	for _, tc := range cases {
		c, err := Compile(o, tc.p, actor)
		if err != nil {
			t.Errorf("%q was refused: %v", tc.what, err)
			continue
		}
		if strings.Contains(c.SQL, "*") && !strings.Contains(c.SQL, "COUNT(*)") {
			t.Errorf("%q rendered a wildcard: %s", tc.what, c.SQL)
		}
		t.Logf("%-38s %s", tc.what, c.SQL)
	}
}

// Whatever a plan compiles to, its column list must be exactly what Compiled
// says -- that is what lets the caller check rows the way store checks a named
// operation against Returns.
func TestTheDeclaredColumnListMatchesTheSelectList(t *testing.T) {
	c, err := Compile(ont(t), Plan{
		Table: "attempts", Select: []string{"lab_id"}, Group: []string{"lab_id"},
		Aggregate: []Agg{{Fn: "count", As: "n"}},
	}, actor)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(c.Columns, ",") != "lab_id,n" {
		t.Fatalf("Columns = %v, want [lab_id n]", c.Columns)
	}
}

func TestGroupingMistakesAreExplainedAsPlanErrorsNotSQLErrors(t *testing.T) {
	// Postgres would refuse this too, but its message is about SQL and the reader
	// is a model composing a plan.
	_, err := Compile(ont(t), Plan{
		Table: "attempts", Select: []string{"lab_id", "answer"}, Group: []string{"lab_id"},
		Aggregate: []Agg{{Fn: "count", As: "n"}},
	}, actor)
	if err == nil {
		t.Fatal("a non-grouped column alongside an aggregate compiled")
	}
	if !strings.Contains(err.Error(), "group") {
		t.Errorf("the message does not mention grouping: %v", err)
	}
}

func TestLimitsAreRefusalsNotTruncations(t *testing.T) {
	if _, err := Compile(ont(t), Plan{
		Table: "lessons", Select: []string{"n"}, Limit: MaxLimit + 1,
	}, actor); err == nil {
		t.Error("a limit over the cap was silently accepted; a truncated answer reads as the whole table")
	}
	many := make([]any, MaxInValues+1)
	for i := range many {
		many[i] = "x"
	}
	if _, err := Compile(ont(t), Plan{
		Table: "lessons", Select: []string{"n"},
		Where: []Cond{{Column: "title", Op: "in", Values: many}},
	}, actor); err == nil {
		t.Error("an over-long IN list compiled")
	}
	if _, err := Compile(ont(t), Plan{
		Table: "lessons", Select: []string{"n"},
		Where: []Cond{{Column: "title", Op: "like", Value: "%a%b%c%d%"}},
	}, actor); err == nil {
		t.Error("a pattern with more wildcards than the cap compiled")
	}
}

func TestNullIsRefusedInFavourOfIsNull(t *testing.T) {
	// `= NULL` matches nothing, so it reads as "no rows" instead of as a filter
	// that cannot work.
	if _, err := Compile(ont(t), Plan{
		Table: "league_week", Select: []string{"week"},
		Where: []Cond{{Column: "puesto", Op: "=", Value: nil}},
	}, actor); err == nil {
		t.Error("`= NULL` compiled")
	}
	if _, err := Compile(ont(t), Plan{
		Table: "league_week", Select: []string{"week", "puesto"},
		Where: []Cond{{Column: "puesto", Op: "is_null"}},
	}, actor); err != nil {
		t.Errorf("is_null was refused: %v", err)
	}
}

func TestAnObjectCannotBeBoundAsAValue(t *testing.T) {
	for _, bad := range []any{map[string]any{"a": 1}, []any{1, 2}} {
		if _, err := Compile(ont(t), Plan{
			Table: "lessons", Select: []string{"n"},
			Where: []Cond{{Column: "n", Op: "=", Value: bad}},
		}, actor); err == nil {
			t.Errorf("%T was bound as a value", bad)
		}
	}
}

// The scope column is derived, and getting it wrong in either direction is a
// hole: a missed personal table serves everybody's rows, and a false positive on
// labs would scope the course catalogue to nobody.
func TestScopeDetection(t *testing.T) {
	o := ont(t)
	for table, want := range map[string]string{
		"attempts": "user_id", "achievements": "user_id", "league_week": "user_id",
		"ranking_optin": "user_id", "users": "id",
		"lessons": "", "labs": "", "lesson_text": "",
	} {
		if got := ScopeColumn(o, table); got != want {
			t.Errorf("ScopeColumn(%s) = %q, want %q", table, got, want)
		}
	}
}
