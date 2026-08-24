package op

// catalog is the whole surface of /data.
//
// HOW TO ADD ONE
// Declare it here, run `data verify`, and read what it says. The gate refuses a
// star, an undeclared table, a jamas column on an agent operation, an unbounded
// parameter, a scoped read with no actor filter, and a caller-supplied parameter
// that names a person. If it passes all of that, the operation is safe in the
// ways this service can check; the parts it cannot check are whether the query
// is correct and whether it is fast.
//
// WHAT IS DELIBERATELY MISSING
// There is no `sql.run`, no `table.select`, no operation taking a table name or
// a column list as a parameter. Every one of those would move the decision about
// what may be read from this file to the caller, and the caller is the thing
// being isolated from.
//
// This is a FIRST SLICE, not the finished migration. api still holds its own
// pool while its 37 tools move across one family at a time; the two coexist on
// purpose, because a big-bang cutover of every query at once would be
// unreviewable. data/README.md carries the order they move in.
var catalog = []Operation{
	// ---------------------------------------------------------------- lessons
	// `lessons` has no jamas column at all, so the whole row is agent-safe.
	// Even so the columns are listed rather than starred: the list is what the
	// guard checks, and a migration that adds `lessons.internal_notes`
	// tomorrow must not start flowing to a model because nobody updated a
	// wildcard.
	{
		Name: "lesson.list", Table: "lessons", Scope: Public, Audience: Agent, Muro: Gratis,
		Returns: []string{"n", "eyebrow", "title", "summary", "math", "math_cap"},
		From:    "lessons", Order: "n", Limit: 100,
		Why: "the lesson index, for the sidebar and for the agent's course map",
	},
	{
		Name: "lesson.get", Table: "lessons", Scope: Public, Audience: Agent, Muro: DePago,
		Returns: []string{"n", "eyebrow", "title", "summary", "math", "math_cap", "technical", "analogy"},
		From:    "lessons", Where: "n = $1", Limit: 1,
		Params: []Param{{Name: "n", Kind: Int, Max: 99}},
		Why:    "one lesson in full, including the technical text and the analogy",
	},

	// ------------------------------------------------------------------- labs
	// `labs.solution` is jamas. Listing the columns is what makes leaking it
	// impossible: it is not in Returns, so it is not in the SELECT, so no row
	// ever carries it. The old `SELECT * FROM labs` depended on a separate
	// `publicLab()` shaping step remembering to strip it.
	{
		Name: "lab.list_for_lesson", Table: "labs", Scope: Public, Audience: Agent, Muro: DePago,
		Returns: []string{"id", "lesson_n", "idx", "level", "kind", "prompt", "payload", "draft"},
		From:    "labs", Where: "lesson_n = $1", Order: "idx", Limit: 50,
		Params: []Param{{Name: "lesson_n", Kind: Int, Max: 99}},
		Why:    "the labs of one lesson, without the solution",
	},
	{
		Name: "lab.explanation", Table: "labs", Scope: Public, Audience: Agent, Muro: DePago,
		Returns: []string{"explanation"},
		From:    "labs", Where: "id = $1", Limit: 1,
		Params: []Param{{Name: "id", Kind: Text, Max: 64}},
		Why:    "the explanation shown after an attempt; it is not the solution",
	},
	// The grader needs the solution, and the grader is api's own machinery: the
	// answer is compared server-side and the solution never leaves. Internal,
	// and justified, because this is the exact operation that would be a leak if
	// it were ever reachable from the agent loop.
	{
		Name: "lab.solution_for_grading", Table: "labs", Scope: Public, Audience: Internal, Muro: Gratis,
		Returns: []string{"id", "kind", "solution"},
		From:    "labs", Where: "id = $1", Limit: 1,
		Params: []Param{{Name: "id", Kind: Text, Max: 64}},
		Why:    "grade one submitted answer server-side",
		Justify: "grade() compares the submitted answer against labs.solution inside api and returns " +
			"only a boolean. The solution is never put in a response, and this operation is the " +
			"reason the agent-facing lab operations can omit the column entirely",
	},

	// --------------------------------------------------------------- attempts
	// `attempts.id` and `attempts.user_id` are both jamas, so an agent-facing
	// read of this table can return the answer, the verdict and the time, and
	// nothing that identifies whose attempt it was. Scope `own` plus the actor
	// filter is what makes that safe rather than merely anonymous.
	{
		Name: "attempt.mine_for_lab", Table: "attempts", Scope: Own, Audience: Agent, Muro: Gratis,
		Returns: []string{"lab_id", "answer", "correct", "at"},
		From:    "attempts", Where: "user_id = $1 AND lab_id = $2", Order: "at DESC", Limit: 20,
		Params: []Param{
			{Name: "actor", Kind: Actor},
			{Name: "lab_id", Kind: Text, Max: 64},
		},
		Why: "the asking person's own attempts at one lab, most recent first",
	},
	{
		Name: "attempt.record", Table: "attempts", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "INSERT INTO attempts (user_id, lab_id, answer, correct) VALUES ($1, $2, $3, $4)",
		Params: []Param{
			{Name: "actor", Kind: Actor},
			{Name: "lab_id", Kind: Text, Max: 64},
			{Name: "answer", Kind: Text, Max: 8000},
			{Name: "correct", Kind: Bool},
		},
		Why: "record one attempt against the acting person, never against an id they supplied",
	},

	// ----------------------------------------------------------- achievements
	{
		Name: "achievement.mine", Table: "achievements", Scope: Own, Audience: Agent, Muro: Gratis,
		Returns: []string{"code", "kind", "lesson_n", "earned_at"},
		From:    "achievements", Where: "user_id = $1", Order: "earned_at DESC", Limit: 200,
		Params: []Param{{Name: "actor", Kind: Actor}},
		Why:    "the asking person's own achievements",
	},

	// ------------------------------------------------------------------ users
	// Almost every column of `users` is jamas -- id, email, pass_hash, failed,
	// locked_until, deleted_at, token_version. What is left is what a person may
	// see about themselves.
	{
		Name: "user.me", Table: "users", Scope: Own, Audience: Agent, Muro: Gratis,
		Returns: []string{"name", "role", "lang", "theme", "paid", "cohort", "created_at"},
		From:    "users", Where: "id = $1 AND deleted_at IS NULL", Limit: 1,
		Params: []Param{{Name: "actor", Kind: Actor}},
		Why:    "the asking person's own profile, without anything that identifies the account",
	},
	// Login. This is the operation that made the audience split necessary:
	// pass_hash is jamas and the login path cannot work without reading it.
	{
		Name: "user.credentials_by_email", Table: "users", Scope: Public, Audience: Internal, Muro: Gratis,
		Returns: []string{"id", "email", "pass_hash", "role", "failed", "locked_until", "token_version"},
		From:    "users", Where: "lower(email) = lower($1) AND deleted_at IS NULL", Limit: 1,
		Params: []Param{{Name: "login", Kind: Text, Max: 320}},
		Why:    "the login path: verify a password and apply the lockout counter",
		Justify: "verifyPassword compares the submitted password against users.pass_hash inside api. " +
			"failed and locked_until drive the lockout, and token_version invalidates sessions. " +
			"None of these ever appear in a response; the login handler returns a cookie",
	},
	// ------------------------------------------------- content, second wave
	// Added as api/src stopped sending SQL. Each one replaces a named statement
	// that used to live in a handler; the shapes are deliberately the ones the
	// call sites already ask for, so the migration is a call change and not a
	// behaviour change. The single exception is stated where it happens:
	// /api/lessons used to spread every column of `lessons`, technical and
	// analogy included, and lesson.list does not return them. That is the fix,
	// not a regression.
	{
		Name: "lesson.card", Table: "lessons", Scope: Public, Audience: Agent, Muro: Gratis,
		Returns: []string{"n", "eyebrow", "title", "summary", "math", "math_cap"},
		From:    "lessons", Where: "n = $1", Limit: 1,
		Params: []Param{{Name: "n", Kind: Int, Max: 99}},
		Why: "one lesson's free card: the shop window behind a 402, and the header of " +
			"the previous/next links. Everything here is muro=gratis, which is why a " +
			"locked lesson can be shown at all",
	},
	// The index that feeds the sidebar's per-lesson counts. No prompt, no
	// payload, no explanation -- all three are de_pago, and this list is read by
	// a free account on every page.
	{
		Name: "lab.index", Table: "labs", Scope: Public, Audience: Agent, Muro: Gratis,
		Returns: []string{"id", "lesson_n", "idx", "level", "kind", "draft"},
		From:    "labs", Order: "lesson_n, idx", Limit: 500,
		Why: "every lab's position and difficulty, with nothing paid in it",
	},
	// The 402's lab list: enough to show what is behind the wall, not enough to
	// be behind it.
	{
		Name: "lab.list_for_lesson_locked", Table: "labs", Scope: Public, Audience: Agent, Muro: Gratis,
		Returns: []string{"id", "idx", "level"},
		From:    "labs", Where: "lesson_n = $1", Order: "idx", Limit: 50,
		Params: []Param{{Name: "lesson_n", Kind: Int, Max: 99}},
		Why:    "the titles behind the paywall, so a locked page is a shop window and not a dead end",
	},
	{
		Name: "lab.get", Table: "labs", Scope: Public, Audience: Agent, Muro: DePago,
		Returns: []string{"id", "lesson_n", "idx", "level", "kind", "prompt", "payload", "draft"},
		From:    "labs", Where: "id = $1", Limit: 1,
		Params: []Param{{Name: "id", Kind: Text, Max: 64}},
		Why:    "one lab as the student sees it. prompt and payload are de_pago; solution is absent",
	},
	{
		Name: "lab.prompts", Table: "labs", Scope: Public, Audience: Agent, Muro: DePago,
		Returns: []string{"id", "lesson_n", "prompt"},
		From:    "labs", Order: "lesson_n, idx", Limit: 500,
		Why: "the corpus the in-course search matches against; the caller filters by readable lesson",
	},

	// ----------------------------------------------------------- lesson_text
	// The per-language prose. All three columns are de_pago, so every operation
	// on this table is behind the wall by construction.
	{
		Name: "lesson_text.get", Table: "lesson_text", Scope: Public, Audience: Agent, Muro: DePago,
		Returns: []string{"technical", "analogy", "examples"},
		From:    "lesson_text", Where: "lesson_n = $1 AND lang = $2", Limit: 1,
		Params: []Param{
			{Name: "lesson_n", Kind: Int, Max: 99},
			// An Enum and not a Text: the caller picks from a closed set, so a
			// language nobody wrote content for is a refusal here instead of an
			// empty answer that reads as "this lesson has no text".
			{Name: "lang", Kind: Enum, Allowed: []string{"es", "en", "fr", "pt"}},
		},
		Why: "one lesson's technical text, analogy and examples in one language",
	},
	{
		Name: "lesson_text.by_lang", Table: "lesson_text", Scope: Public, Audience: Agent, Muro: DePago,
		Returns: []string{"lesson_n", "technical", "analogy"},
		From:    "lesson_text", Where: "lang = $1", Order: "lesson_n", Limit: 100,
		Params: []Param{
			{Name: "lang", Kind: Enum, Allowed: []string{"es", "en", "fr", "pt"}},
		},
		Why: "the whole prose corpus in one language, for search; the caller filters by readable lesson",
	},

	// -------------------------------------------- lessons, the derived case
	// One bit per lesson saying whether its technical text has been written.
	//
	// This is the operation the Derived field exists for. `technical` is de_pago
	// and it IS read here -- but only by `<> ''`, and a boolean saying "there is
	// text" reconstructs none of the prose. ai/src/course_ai/ontology/data.py
	// makes the same call in prose for the tool this serves; declaring it de_pago
	// would put a wall in front of a free index, and not declaring it at all is
	// the alias hole. So: declared, justified, and pinned by a test.
	{
		Name: "lesson.index_with_text_flag", Table: "lessons", Scope: Public, Audience: Agent, Muro: Gratis,
		Raw: "SELECT n, eyebrow, title, summary, math, math_cap, " +
			"(technical <> '') AS tiene_tecnico FROM lessons ORDER BY n",
		Returns: []string{"n", "eyebrow", "title", "summary", "math", "math_cap", "tiene_tecnico"},
		Derived: []string{"technical"},
		Why:     "the twelve lessons for the agent's course map, with a flag for written text",
		Justify: "technical is de_pago and is read only by `<> ''`. The value that leaves is one " +
			"boolean per lesson saying whether the text has been written at all, which " +
			"reconstructs none of the paid prose. The same judgement is recorded in " +
			"ai/src/course_ai/ontology/data.py, where this column is in `reads` and not in `returns`",
	},
	{
		Name: "lesson.search_corpus", Table: "lessons", Scope: Public, Audience: Agent, Muro: DePago,
		Returns: []string{"n", "eyebrow", "title", "summary", "math_cap", "technical", "analogy"},
		From:    "lessons", Order: "n", Limit: 100,
		Why: "the lesson corpus the in-course search matches against; the caller filters by readable lesson",
	},

	// -------------------------------------------------- attempts, aggregated
	// Both of these are Raw because they aggregate, and both are `own`: the
	// actor filter is the only reason an aggregate over a table whose id and
	// user_id are both jamas can be answered at all.
	{
		Name: "attempt.best_by_lab", Table: "attempts", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw: "SELECT lab_id, MAX(correct) AS solved, COUNT(*)::int AS attempts " +
			"FROM attempts WHERE user_id = $1 GROUP BY lab_id",
		Returns: []string{"lab_id", "solved", "attempts"},
		Params:  []Param{{Name: "actor", Kind: Actor}},
		Why:     "the asking person's best result and try count per lab, for the padlocks and the ticks",
	},
	{
		Name: "attempt.count_for_lab", Table: "attempts", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw: "SELECT COUNT(*)::int AS intentos, MAX(correct)::int AS mejor " +
			"FROM attempts WHERE user_id = $1 AND lab_id = $2",
		Returns: []string{"intentos", "mejor"},
		Params: []Param{
			{Name: "actor", Kind: Actor},
			{Name: "lab_id", Kind: Text, Max: 64},
		},
		Why: "how many times the asking person has tried one lab and whether they solved it",
	},
}
