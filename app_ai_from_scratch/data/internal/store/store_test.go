package store

import (
	"strings"
	"testing"

	"course/data/internal/op"
)

func opWithActor() op.Operation {
	return op.Operation{
		Name: "attempt.mine_for_lab", Table: "attempts", Scope: op.Own, Audience: op.Agent,
		Returns: []string{"lab_id", "answer"},
		From:    "attempts", Where: "user_id = $1 AND lab_id = $2", Limit: 5,
		Params: []op.Param{
			{Name: "actor", Kind: op.Actor},
			{Name: "lab_id", Kind: op.Text, Max: 64},
		},
		Why: "test",
	}
}

// THE RUNTIME HALF OF P3. The catalogue proves no operation DECLARES a
// caller-supplied identity; this proves a caller cannot supply one anyway by
// naming it in the arguments.
func TestACallerCannotSupplyTheActor(t *testing.T) {
	o := opWithActor()
	// An argument named after the actor parameter is refused as undeclared,
	// because Actor parameters are never taken from args.
	_, err := bind(o, 42, 0, map[string]any{"lab_id": "l1", "actor": float64(99)})
	if err == nil {
		t.Fatal("an `actor` argument was accepted. A caller that can name the actor can read " +
			"anybody's rows while the operation still says `own`")
	}
	if !strings.Contains(err.Error(), "not declared") {
		t.Errorf("refused for the wrong reason: %v", err)
	}

	// And the injected actor is what lands in $1.
	params, err := bind(o, 42, 0, map[string]any{"lab_id": "l1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(params) != 2 {
		t.Fatalf("bound %d parameters, want 2", len(params))
	}
	if params[0] != int64(42) {
		t.Errorf("$1 = %v, want the injected actor 42", params[0])
	}
}

// An unauthenticated call to a scoped operation must FAIL, not fall back to 0.
// Binding 0 would produce `WHERE user_id = 0`, which returns no rows -- and "you
// have no attempts" is a much worse answer than "you are not authenticated",
// because nobody investigates it.
func TestAScopedOperationRefusesAnUnauthenticatedCall(t *testing.T) {
	for _, actor := range []int64{0, -1} {
		if _, err := bind(opWithActor(), actor, 0, map[string]any{"lab_id": "l1"}); err == nil {
			t.Errorf("actor %d was accepted for a scoped operation", actor)
		}
	}
}

func TestArgumentsAreBoundedAndTyped(t *testing.T) {
	o := opWithActor()
	cases := map[string]map[string]any{
		"missing":    {},
		"wrong type": {"lab_id": float64(3)},
		"too long":   {"lab_id": strings.Repeat("x", 65)},
		"null":       {"lab_id": nil},
		"extra arg":  {"lab_id": "l1", "limit": float64(1000)},
	}
	for name, args := range cases {
		if _, err := bind(o, 1, 0, args); err == nil {
			t.Errorf("%s: accepted %v", name, args)
		}
	}
	if _, err := bind(o, 1, 0, map[string]any{"lab_id": strings.Repeat("x", 64)}); err != nil {
		t.Errorf("a value exactly at the limit was refused: %v", err)
	}
}

func TestIntegerArgumentsRejectFractionsAndNegatives(t *testing.T) {
	o := op.Operation{
		Name: "lesson.get", Table: "lessons", Scope: op.Public, Audience: op.Agent,
		Returns: []string{"n"}, From: "lessons", Where: "n = $1", Limit: 1,
		Params: []op.Param{{Name: "n", Kind: op.Int, Max: 99}}, Why: "test",
	}
	for name, v := range map[string]any{
		"fraction":  float64(1.5),
		"negative":  float64(-1),
		"too large": float64(1000),
		"a string":  "1",
	} {
		if _, err := bind(o, 0, 0, map[string]any{"n": v}); err == nil {
			t.Errorf("%s: accepted %v", name, v)
		}
	}
	if _, err := bind(o, 0, 0, map[string]any{"n": float64(7)}); err != nil {
		t.Errorf("a valid integer was refused: %v", err)
	}
}
