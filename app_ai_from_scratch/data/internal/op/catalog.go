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
// Runtime api and api-worker have completed the cutover. db.ts and seed.ts are
// retained only by the one-shot init image; the runtime boundary gate prevents
// a pool, SQL literal or DATABASE_URL reference from returning to api/src.
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
			{Name: "correct", Kind: Int, Max: 1},
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

	// -------------------------------------------------------- API course state
	// These are page-shaped aggregates. Keeping them here avoids moving a pile of
	// rows to Node merely to count them, while the actor remains an injected
	// header and cannot be selected by request input.
	{
		Name: "achievement.progress_by_lesson", Table: "labs", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw: "SELECT l.lesson_n AS n, COUNT(*)::int AS total, " +
			"SUM(CASE WHEN a.solved = 1 THEN 1 ELSE 0 END)::int AS solved " +
			"FROM labs l LEFT JOIN (SELECT lab_id, MAX(correct) AS solved FROM attempts " +
			"WHERE user_id = $1 GROUP BY lab_id) a ON a.lab_id = l.id " +
			"GROUP BY l.lesson_n ORDER BY l.lesson_n",
		Returns: []string{"n", "total", "solved"},
		Params:  []Param{{Name: "actor", Kind: Actor}},
		Why:     "per-lesson completion for the acting person's progress and achievement calculation",
	},
	{
		Name: "achievement.codes", Table: "achievements", Scope: Own, Audience: Agent, Muro: Gratis,
		Returns: []string{"code"}, From: "achievements", Where: "user_id = $1", Order: "code", Limit: 200,
		Params: []Param{{Name: "actor", Kind: Actor}},
		Why:    "the acting person's earned codes, used to insert only missing achievements",
	},
	{
		Name: "achievement.record", Table: "achievements", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "INSERT INTO achievements (user_id, code, kind, lesson_n) VALUES ($1,$2,$3,$4) " +
			"ON CONFLICT (user_id, code) DO NOTHING",
		Params: []Param{
			{Name: "actor", Kind: Actor},
			{Name: "code", Kind: Text, Max: 80},
			{Name: "kind", Kind: Text, Max: 40},
			{Name: "lesson_n", Kind: Int, Max: 99},
		},
		Why: "persist one achievement calculated for the acting person",
	},
	{
		Name: "ranking.table", Table: "ranking_optin", Scope: Public, Audience: Agent, Muro: Gratis,
		Raw: "SELECT o.alias AS alias, COUNT(DISTINCT hechas.lesson_n)::int AS lecciones, " +
			"COUNT(DISTINCT ok.lab_id)::int AS labs FROM ranking_optin o " +
			"JOIN users us ON us.id = o.user_id AND us.deleted_at IS NULL " +
			"LEFT JOIN (SELECT DISTINCT user_id, lab_id FROM attempts WHERE correct = 1) ok ON ok.user_id = o.user_id " +
			"LEFT JOIN (SELECT a.user_id, l.lesson_n FROM labs l JOIN attempts a ON a.lab_id = l.id AND a.correct = 1 " +
			"GROUP BY a.user_id, l.lesson_n HAVING COUNT(DISTINCT a.lab_id) = " +
			"(SELECT COUNT(*) FROM labs x WHERE x.lesson_n = l.lesson_n)) hechas ON hechas.user_id = o.user_id " +
			"GROUP BY o.alias, o.joined_at ORDER BY lecciones DESC, labs DESC, o.joined_at ASC LIMIT 50",
		Returns: []string{"alias", "lecciones", "labs"},
		Why:     "the public opt-in leaderboard, containing aliases and aggregate course counts only",
	},
	{
		Name: "ranking.mine", Table: "ranking_optin", Scope: Own, Audience: Agent, Muro: Gratis,
		Returns: []string{"alias"}, From: "ranking_optin", Where: "user_id = $1", Limit: 1,
		Params: []Param{{Name: "actor", Kind: Actor}},
		Why:    "the acting person's public leaderboard alias",
	},
	{
		Name: "ranking.alias_clash", Table: "ranking_optin", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw:     "SELECT alias FROM ranking_optin WHERE user_id <> $1 AND alias = $2 LIMIT 1",
		Returns: []string{"alias"},
		Params:  []Param{{Name: "actor", Kind: Actor}, {Name: "alias", Kind: Text, Max: 18}},
		Why:     "check whether an alias belongs to somebody other than the acting person without returning identity",
	},
	{
		Name: "ranking.upsert", Table: "ranking_optin", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "INSERT INTO ranking_optin (user_id, alias) VALUES ($1,$2) " +
			"ON CONFLICT (user_id) DO UPDATE SET alias = EXCLUDED.alias",
		Params: []Param{{Name: "actor", Kind: Actor}, {Name: "alias", Kind: Text, Max: 18}},
		Why:    "opt the acting person into the public leaderboard with their chosen alias",
	},
	{
		Name: "ranking.delete", Table: "ranking_optin", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw:    "DELETE FROM ranking_optin WHERE user_id = $1",
		Params: []Param{{Name: "actor", Kind: Actor}},
		Why:    "remove the acting person's leaderboard opt-in",
	},
	{
		Name: "lab.card_by_id", Table: "labs", Scope: Public, Audience: Agent, Muro: Gratis,
		Returns: []string{"id", "lesson_n", "idx", "level", "kind", "draft"},
		From:    "labs", Where: "id = $1", Limit: 1,
		Params: []Param{{Name: "id", Kind: Text, Max: 64}},
		Why:    "free lab metadata used to decide the paywall before paid prompt or grading data is read",
	},
	{
		Name: "lab.count", Table: "labs", Scope: Public, Audience: Agent, Muro: Gratis,
		Raw: "SELECT COUNT(*)::int AS c FROM labs", Returns: []string{"c"},
		Why: "the public number of labs for health and progress totals",
	},

	// -------------------------------------------------------------- questions
	{
		Name: "question.list_for_pack", Table: "questions", Scope: Public, Audience: Agent, Muro: DePago,
		Returns: []string{"id", "kind", "pack", "idx", "lesson_n", "prompt_es", "prompt_en", "payload"},
		From:    "questions", Where: "pack = $1", Order: "idx", Limit: 50,
		Params: []Param{{Name: "pack", Kind: Text, Max: 8}},
		Why:    "the questions of one quiz or exam pack, without the solution",
	},
	{
		Name: "question.card_by_id", Table: "questions", Scope: Public, Audience: Agent, Muro: Gratis,
		Returns: []string{"id", "kind", "pack", "idx", "lesson_n"},
		From:    "questions", Where: "id = $1", Limit: 1,
		Params: []Param{{Name: "id", Kind: Text, Max: 16}},
		Why:    "free question metadata used to decide the paywall before paid prompt or grading data is read",
	},
	{
		Name: "question.explanation", Table: "questions", Scope: Own, Audience: Agent, Muro: DePago,
		Raw: "SELECT explanation_es AS explanation_es, explanation_en AS explanation_en FROM questions " +
			"WHERE id = $2 AND EXISTS (SELECT 1 FROM question_attempts qa WHERE qa.question_id = questions.id AND qa.user_id = $1) LIMIT 1",
		Returns: []string{"explanation_es", "explanation_en"},
		Params:  []Param{{Name: "actor", Kind: Actor}, {Name: "id", Kind: Text, Max: 16}},
		Why:     "the explanation shown only after the acting person has attempted the question; it is not the solution",
	},
	{
		Name: "question.solution_for_grading", Table: "questions", Scope: Public, Audience: Internal, Muro: Gratis,
		Returns: []string{"id", "solution"},
		From:    "questions", Where: "id = $1", Limit: 1,
		Params: []Param{{Name: "id", Kind: Text, Max: 16}},
		Why:    "grade one submitted quiz or exam answer server-side",
		Justify: "grade() compares the submitted option id against questions.solution inside api and returns " +
			"only a boolean. The solution is never put in a response, and this operation is the " +
			"reason the agent-facing question operations can omit the column entirely",
	},
	{
		Name: "question.packs", Table: "questions", Scope: Public, Audience: Agent, Muro: Gratis,
		Raw: "SELECT pack, kind, MIN(lesson_n)::int AS from_n, MAX(lesson_n)::int AS to_n, " +
			"COUNT(*)::int AS total FROM questions GROUP BY pack, kind ORDER BY pack",
		Returns: []string{"pack", "kind", "from_n", "to_n", "total"},
		Why:     "the quiz and exam packs with their lesson range and question count",
	},
	{
		Name: "qattempt.record", Table: "question_attempts", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "INSERT INTO question_attempts (user_id, question_id, answer, correct) VALUES ($1, $2, $3, $4)",
		Params: []Param{
			{Name: "actor", Kind: Actor},
			{Name: "question_id", Kind: Text, Max: 16},
			{Name: "answer", Kind: Text, Max: 64},
			{Name: "correct", Kind: Int, Max: 1},
		},
		Why: "record one quiz or exam attempt against the acting person",
	},
	{
		Name: "qattempt.best_by_question", Table: "question_attempts", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw: "SELECT question_id, MAX(correct) AS solved, COUNT(*)::int AS attempts " +
			"FROM question_attempts WHERE user_id = $1 GROUP BY question_id",
		Returns: []string{"question_id", "solved", "attempts"},
		Params:  []Param{{Name: "actor", Kind: Actor}},
		Why:     "the asking person's best result and try count per question",
	},
	{
		Name: "qattempt.count_mine", Table: "question_attempts", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw:     "SELECT COUNT(*)::int AS intentos FROM question_attempts WHERE user_id = $1",
		Returns: []string{"intentos"}, Params: []Param{{Name: "actor", Kind: Actor}},
		Why: "the number of quiz and exam attempts stored for the acting person",
	},
	{
		Name: "attempt.stuck_summary", Table: "attempts", Scope: Public, Audience: Agent, Muro: Gratis,
		Raw: "SELECT lab_id, COUNT(*)::int AS tries, SUM(correct)::int AS wins FROM attempts " +
			"GROUP BY lab_id HAVING COUNT(*) >= 3 AND SUM(correct) = 0 ORDER BY tries DESC LIMIT 20",
		Returns: []string{"lab_id", "tries", "wins"},
		Why:     "aggregate labs where the cohort is stuck without returning any person or submitted answer",
	},
	{
		Name: "progress.pending_labs", Table: "labs", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw: "SELECT l.id AS id, l.lesson_n AS lesson_n, l.idx AS idx, l.level AS level, " +
			"l.kind AS kind, l.draft AS draft, s.title AS title FROM labs l " +
			"JOIN lessons s ON s.n = l.lesson_n LEFT JOIN " +
			"(SELECT lab_id, MAX(correct) AS solved FROM attempts WHERE user_id = $1 GROUP BY lab_id) a " +
			"ON a.lab_id = l.id WHERE COALESCE(a.solved, 0) = 0 ORDER BY l.lesson_n, l.idx",
		Returns: []string{"id", "lesson_n", "idx", "level", "kind", "draft", "title"},
		Params:  []Param{{Name: "actor", Kind: Actor}},
		Why:     "course-ordered unsolved lab metadata for the acting person's next-step calculation",
	},
	{
		Name: "progress.active_days", Table: "attempts", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw: "SELECT DISTINCT ((at AT TIME ZONE $2)::date)::text AS dia FROM attempts " +
			"WHERE user_id = $1 ORDER BY dia DESC",
		Returns: []string{"dia"},
		Params: []Param{
			{Name: "actor", Kind: Actor},
			{Name: "zone", Kind: Enum, Allowed: []string{"America/Bogota"}},
		},
		Why: "the acting person's activity dates in the product timezone for streak calculation",
	},
	{
		Name: "progress.inactivity_gap", Table: "attempts", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw: "SELECT ((now() AT TIME ZONE $2)::date - (MAX(at) AT TIME ZONE $2)::date)::int AS dias " +
			"FROM attempts WHERE user_id = $1",
		Returns: []string{"dias"},
		Params: []Param{
			{Name: "actor", Kind: Actor},
			{Name: "zone", Kind: Enum, Allowed: []string{"America/Bogota"}},
		},
		Why: "whole days since the acting person's last attempt, for a deterministic coach nudge",
	},
	{
		Name: "progress.failed_labs", Table: "labs", Scope: Own, Audience: Agent, Muro: DePago,
		Raw: "SELECT a.lab_id AS lab_id, COUNT(*)::int AS intentos, MAX(a.at) AS ultimo, " +
			"l.lesson_n AS lesson_n, l.level AS level, l.kind AS kind, l.prompt AS prompt " +
			"FROM attempts a JOIN labs l ON l.id = a.lab_id WHERE a.user_id = $1 " +
			"GROUP BY a.lab_id, l.lesson_n, l.level, l.kind, l.prompt HAVING MAX(a.correct) = 0 " +
			"ORDER BY MAX(a.at) DESC",
		Returns: []string{"lab_id", "intentos", "ultimo", "lesson_n", "level", "kind", "prompt"},
		Params:  []Param{{Name: "actor", Kind: Actor}},
		Why:     "the acting person's unsolved labs and their paid prompt, after the API paywall gate",
	},
	{
		Name: "progress.wrong_attempts", Table: "attempts", Scope: Own, Audience: Agent, Muro: Gratis,
		Returns: []string{"lab_id", "answer", "at"}, From: "attempts",
		Where: "user_id = $1 AND correct = 0", Order: "at DESC", Limit: 200,
		Params: []Param{{Name: "actor", Kind: Actor}},
		Why:    "recent wrong answers belonging only to the acting person",
	},
	{
		Name: "progress.weekly_pace", Table: "attempts", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw: "SELECT to_char(date_trunc('week', (p.cuando AT TIME ZONE $2)), 'YYYY-MM-DD') AS semana, " +
			"COUNT(*)::int AS labs FROM (SELECT lab_id, MIN(at) AS cuando FROM attempts " +
			"WHERE user_id = $1 AND correct = 1 GROUP BY lab_id) p GROUP BY 1 ORDER BY 1 DESC LIMIT 6",
		Returns: []string{"semana", "labs"},
		Params: []Param{
			{Name: "actor", Kind: Actor},
			{Name: "zone", Kind: Enum, Allowed: []string{"America/Bogota"}},
		},
		Why: "first-time lab solves per week for the acting person's pace projection",
	},
	{
		Name: "progress.solved_count", Table: "attempts", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw:     "SELECT COUNT(DISTINCT lab_id)::int AS c FROM attempts WHERE user_id = $1 AND correct = 1",
		Returns: []string{"c"}, Params: []Param{{Name: "actor", Kind: Actor}},
		Why: "the acting person's distinct solved-lab total",
	},
	{
		Name: "progress.history", Table: "attempts", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw: "SELECT a.lab_id AS lab_id, a.correct AS correct, a.at AS at, l.lesson_n AS lesson_n " +
			"FROM attempts a JOIN labs l ON l.id = a.lab_id WHERE a.user_id = $1 " +
			"AND a.at >= now() - ($2 * interval '1 day') ORDER BY a.at DESC LIMIT 40",
		Returns: []string{"lab_id", "correct", "at", "lesson_n"},
		Params:  []Param{{Name: "actor", Kind: Actor}, {Name: "days", Kind: Int, Max: 30}},
		Why:     "the acting person's recent attempt history bounded to thirty days and forty rows",
	},
	{
		Name: "attempt.count_mine", Table: "attempts", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw:     "SELECT COUNT(*)::int AS intentos FROM attempts WHERE user_id = $1",
		Returns: []string{"intentos"}, Params: []Param{{Name: "actor", Kind: Actor}},
		Why: "the number of attempts stored for the acting person's privacy summary",
	},
	// ------------------------------------------------------------ weekly league
	{
		Name: "league.flow", Table: "ranking_optin", Scope: Public, Audience: Internal, Muro: Gratis,
		Raw: "SELECT o.user_id AS user_id, o.alias AS alias, COUNT(p.lab_id)::int AS caudal, " +
			"COALESCE(t.total, 0) AS total FROM ranking_optin o " +
			"JOIN users us ON us.id = o.user_id AND us.paid = 1 AND us.deleted_at IS NULL " +
			"LEFT JOIN (SELECT user_id, COUNT(*)::int AS total FROM " +
			"(SELECT user_id, lab_id, MIN(at) AS cuando FROM attempts WHERE correct = 1 GROUP BY user_id, lab_id) q " +
			"GROUP BY user_id) t ON t.user_id = o.user_id " +
			"LEFT JOIN (SELECT user_id, lab_id, MIN(at) AS cuando FROM attempts WHERE correct = 1 " +
			"GROUP BY user_id, lab_id) p ON p.user_id = o.user_id " +
			"AND (p.cuando AT TIME ZONE $1) >= date_trunc('week', (now() AT TIME ZONE $1)) " +
			"GROUP BY o.user_id, o.alias, t.total ORDER BY caudal DESC, o.alias ASC",
		Returns: []string{"user_id", "alias", "caudal", "total"},
		Params:  []Param{{Name: "zone", Kind: Enum, Allowed: []string{"America/Bogota"}}},
		Why:     "weekly flow used internally to assign metals before user_id is stripped from every response",
		Justify: "the deterministic league calculation needs user_id only to locate the acting person's own row and persist a weekly close. API removes it before any HTTP or model response",
	},
	{
		Name: "league.current_week", Table: "league_week", Scope: Public, Audience: Agent, Muro: Gratis,
		Raw: "SELECT date_trunc('week', (now() AT TIME ZONE $1))::date AS lunes, " +
			"(date_trunc('week', (now() AT TIME ZONE $1)) + interval '7 days')::date AS cierra FROM (VALUES (1)) AS v(x)",
		Returns: []string{"lunes", "cierra"},
		Params:  []Param{{Name: "zone", Kind: Enum, Allowed: []string{"America/Bogota"}}},
		Why:     "the product week's public start and close dates",
	},
	{
		Name: "league.previous", Table: "league_week", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw: "SELECT metal, week FROM league_week WHERE user_id = $1 AND cerrada = 1 " +
			"AND week < date_trunc('week', (now() AT TIME ZONE $2))::date ORDER BY week DESC LIMIT 1",
		Returns: []string{"metal", "week"},
		Params: []Param{
			{Name: "actor", Kind: Actor},
			{Name: "zone", Kind: Enum, Allowed: []string{"America/Bogota"}},
		},
		Why: "the acting person's last closed league week for promotion comparison",
	},
	{
		Name: "league.record", Table: "league_week", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "INSERT INTO league_week (user_id, week, metal, caudal, puesto, estado, cerrada) " +
			"VALUES ($1,$2,$3,$4,$5,$6,1) ON CONFLICT (user_id, week) DO NOTHING",
		Params: []Param{
			{Name: "actor", Kind: Actor},
			{Name: "week", Kind: Text, Max: 40},
			{Name: "metal", Kind: Enum, Allowed: []string{"bronce", "plata", "oro"}},
			{Name: "flow", Kind: Int, Max: 1000000},
			{Name: "rank", Kind: Int, Max: 1000000},
			{Name: "state", Kind: Enum, Allowed: []string{"activo", "salon"}},
		},
		Why: "idempotently close one weekly league row for the actor selected by the admin calculation",
	},
	// -------------------------------------------------------- durable job queue
	{
		Name: "job.enqueue", Table: "jobs", Scope: Public, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "INSERT INTO jobs (tipo, clave, datos, corre_en) VALUES ($1,$2,$3::jsonb,now()) " +
			"ON CONFLICT (tipo, clave) DO NOTHING",
		Params: []Param{
			{Name: "type", Kind: Text, Max: 100},
			{Name: "key", Kind: Text, Max: 500},
			{Name: "payload", Kind: Text, Max: 200000},
		},
		Why: "idempotently enqueue one bounded JSON job payload",
	},
	{
		Name: "job.take", Table: "jobs", Scope: Public, Audience: Internal, Muro: Gratis, Write: true,
		Raw: "UPDATE jobs SET estado = 'curso', intentos = intentos + 1, tomado_en = now() " +
			"WHERE id IN (SELECT id FROM jobs WHERE estado = 'pendiente' AND corre_en <= now() " +
			"AND tipo = ANY(string_to_array($1, ',')) ORDER BY corre_en LIMIT $2 FOR UPDATE SKIP LOCKED) " +
			"RETURNING id, tipo, clave, datos, intentos",
		Returns: []string{"id", "tipo", "clave", "datos", "intentos"},
		Params: []Param{
			{Name: "types", Kind: Text, Max: 2000},
			{Name: "limit", Kind: Int, Max: 100},
		},
		Why:     "atomically claim due jobs for only the handler types available in this worker",
		Justify: "the queue worker needs the job id, type, idempotency key, JSON payload and attempt count to dispatch and retry work. These fields never enter an HTTP or model response",
	},
	{
		Name: "job.finish", Table: "jobs", Scope: Public, Audience: Agent, Muro: Gratis, Write: true,
		Raw:    "UPDATE jobs SET estado = 'hecho', acabado_en = now(), error = NULL WHERE id = $1",
		Params: []Param{{Name: "job", Kind: Int, Max: 2147483647}},
		Why:    "mark one claimed job complete",
	},
	{
		Name: "job.release", Table: "jobs", Scope: Public, Audience: Agent, Muro: Gratis, Write: true,
		Raw:    "UPDATE jobs SET estado = 'pendiente', intentos = intentos - 1 WHERE id = $1",
		Params: []Param{{Name: "job", Kind: Int, Max: 2147483647}},
		Why:    "return a job whose handler disappeared before dispatch",
	},
	{
		Name: "job.dead", Table: "jobs", Scope: Public, Audience: Agent, Muro: Gratis, Write: true,
		Raw:    "UPDATE jobs SET estado = 'muerto', error = $2, acabado_en = now() WHERE id = $1",
		Params: []Param{{Name: "job", Kind: Int, Max: 2147483647}, {Name: "error", Kind: Text, Max: 500}},
		Why:    "retain a terminally failed job and its bounded diagnostic instead of losing it",
	},
	{
		Name: "job.reschedule", Table: "jobs", Scope: Public, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "UPDATE jobs SET estado = 'pendiente', error = $2, corre_en = now() + ($3 * interval '1 second') WHERE id = $1",
		Params: []Param{
			{Name: "job", Kind: Int, Max: 2147483647},
			{Name: "error", Kind: Text, Max: 500},
			{Name: "seconds", Kind: Int, Max: 86400},
		},
		Why: "reschedule a transiently failed job with bounded exponential backoff",
	},
	{
		Name: "counter.bump", Table: "jobs", Scope: Public, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "INSERT INTO jobs (tipo, clave, datos, estado, acabado_en) " +
			"VALUES ('contador',$1,jsonb_build_object('n',$2::int),'hecho',now()) " +
			"ON CONFLICT (tipo, clave) DO UPDATE SET datos = jsonb_set(jobs.datos, '{n}', " +
			"to_jsonb(COALESCE((jobs.datos->>'n')::int,0) + $2::int))",
		Params: []Param{{Name: "key", Kind: Text, Max: 500}, {Name: "amount", Kind: Int, Max: 1000000}},
		Why:    "atomically increment a persisted spend counter",
	},
	{
		Name: "counter.read", Table: "jobs", Scope: Public, Audience: Internal, Muro: Gratis,
		Raw:     "SELECT (datos->>'n')::int AS n FROM jobs WHERE tipo = 'contador' AND clave = $1 LIMIT 1",
		Returns: []string{"n"}, Params: []Param{{Name: "key", Kind: Text, Max: 500}},
		Why:     "read one persisted spend counter after an atomic increment",
		Justify: "the chat brake needs only the integer inside jobs.datos. The raw job payload and key never leave this operation or reach an HTTP response",
	},
	{
		Name: "counter.prune", Table: "jobs", Scope: Public, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "DELETE FROM jobs WHERE tipo = 'contador' AND creado_en < now() - interval '30 days'",
		Why: "bound persisted daily counter retention to thirty days",
	},
	{
		Name: "job.state_counts", Table: "jobs", Scope: Public, Audience: Internal, Muro: Gratis,
		Raw:     "SELECT estado, COUNT(*)::int AS n FROM jobs WHERE tipo <> 'contador' GROUP BY estado",
		Returns: []string{"estado", "n"},
		Why:     "health census of durable jobs by state",
		Justify: "queue health needs the internal state labels and aggregate counts to expose backlog health; no job id, key, payload or error is returned",
	},
	{
		Name: "job.oldest_due", Table: "jobs", Scope: Public, Audience: Internal, Muro: Gratis,
		Raw:     "SELECT MIN(corre_en) AS oldest FROM jobs WHERE estado = 'pendiente' AND corre_en <= now()",
		Returns: []string{"oldest"},
		Why:     "timestamp of the oldest due job for health age calculation",
		Justify: "queue health needs the oldest jobs.corre_en timestamp to calculate backlog age. No job id, key, payload, error or person is returned",
	},
	{
		Name: "job.orphans", Table: "jobs", Scope: Public, Audience: Internal, Muro: Gratis,
		Raw: "SELECT tipo, COUNT(*)::int AS n FROM jobs WHERE estado = 'pendiente' " +
			"AND ($1 = '' OR NOT (tipo = ANY(string_to_array($1, ',')))) GROUP BY tipo",
		Returns: []string{"tipo", "n"}, Params: []Param{{Name: "handled", Kind: Text, Max: 2000}},
		Why:     "pending job types this process has no handler for",
		Justify: "queue health needs internal job type labels to reveal orphaned work. It returns only a type and count, never a key, payload, error or person",
	},
	{
		Name: "bus.claim", Table: "jobs", Scope: Public, Audience: Internal, Muro: Gratis, Write: true,
		Raw: "INSERT INTO jobs (tipo, clave, datos, estado, acabado_en) " +
			"VALUES ('bus.claim',$1,jsonb_build_object('state','running','owner',$2::text,'at',to_jsonb(now())),'hecho',now()) " +
			"ON CONFLICT (tipo, clave) DO UPDATE SET datos = jsonb_build_object('state','running','owner',$2::text,'at',to_jsonb(now())) " +
			"WHERE jobs.datos->>'state' = 'running' AND (jobs.datos->>'owner' = $2::text " +
			"OR (jobs.datos->>'at')::timestamptz < now() - make_interval(secs => $3::double precision)) RETURNING clave",
		Returns: []string{"clave"},
		Params: []Param{
			{Name: "key", Kind: Text, Max: 500},
			{Name: "worker", Kind: Text, Max: 200},
			{Name: "lease", Kind: Int, Max: 86400},
		},
		Why:     "atomically acquire or reclaim an idempotency lease for one broker message",
		Justify: "the bus consumer needs only confirmation that this internal idempotency key was acquired. The key is compared inside the worker and never reaches an HTTP or model response",
	},
	{
		Name: "bus.complete", Table: "jobs", Scope: Public, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "UPDATE jobs SET datos = jsonb_build_object('state','done','owner',$2::text,'at',to_jsonb(now())), " +
			"acabado_en = now() WHERE tipo = 'bus.claim' AND clave = $1",
		Params: []Param{{Name: "key", Kind: Text, Max: 500}, {Name: "worker", Kind: Text, Max: 200}},
		Why:    "mark an idempotency lease permanently complete after its handler succeeds",
	},
	{
		Name: "bus.release", Table: "jobs", Scope: Public, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "DELETE FROM jobs WHERE tipo = 'bus.claim' AND clave = $1 " +
			"AND datos->>'state' = 'running' AND datos->>'owner' = $2::text",
		Params: []Param{{Name: "key", Kind: Text, Max: 500}, {Name: "worker", Kind: Text, Max: 200}},
		Why:    "release only the current worker's failed lease so a broker retry can claim it",
	},
	{
		Name: "bus.prune", Table: "jobs", Scope: Public, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "DELETE FROM jobs WHERE tipo = 'bus.claim' AND creado_en < now() - interval '30 days'",
		Why: "bound completed broker idempotency leases to thirty days",
	},
	// ----------------------------------------------------------- tutor console
	// The target identity and the viewing authority are both trusted headers.
	// Answers are omitted: staff can support a learning path without receiving
	// the student's free-form work.
	{
		Name: "admin.student_timeline", Table: "attempts", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw: "SELECT a.lab_id AS lab_id, a.correct AS correct, a.at AS at " +
			"FROM attempts a WHERE a.user_id = $1 AND EXISTS (SELECT 1 FROM users operator " +
			"WHERE operator.id = $2 AND operator.role IN ('admin', 'root') AND operator.deleted_at IS NULL) " +
			"ORDER BY a.at ASC LIMIT 500",
		Returns: []string{"lab_id", "correct", "at"},
		Params:  []Param{{Name: "actor", Kind: Actor}, {Name: "authority", Kind: Authority}},
		Why:     "a student's chronological lab-attempt milestones for a verified administrator",
	},
	// This is intentionally a completion register, not a submissions register.
	// Root can supervise which lab was completed and when, but neither answers
	// nor solutions are selected here, so a new rendering route cannot turn into
	// an answer-discovery surface by accident.
	{
		Name: "root.solved_labs", Table: "attempts", Scope: Public, Audience: Internal, Muro: Gratis,
		Raw: "SELECT us.id AS student_id, us.name AS student_name, l.id AS lab_id, " +
			"l.lesson_n AS lesson_n, l.idx AS lab_idx, MIN(a.at) AS solved_at " +
			"FROM attempts a JOIN users us ON us.id = a.user_id AND us.deleted_at IS NULL " +
			"JOIN labs l ON l.id = a.lab_id WHERE a.correct = 1 " +
			"GROUP BY us.id, us.name, l.id, l.lesson_n, l.idx ORDER BY solved_at DESC LIMIT 1000",
		Returns: []string{"student_id", "student_name", "lab_id", "lesson_n", "lab_idx", "solved_at"},
		Why:     "the root-only operations register of each student's first successful lab completion",
		Justify: "the root-only rendering route needs an account id and display name to supervise course completion. It returns completion metadata only, never submitted answers, prompts, explanations or solutions",
	},
	{
		Name: "tutor.students_all", Table: "users", Scope: Public, Audience: Internal, Muro: Gratis,
		Raw: "SELECT us.id AS id, us.name AS name, us.email AS email, COALESCE(a.solved, 0) AS solved, a.last_seen AS last_seen " +
			"FROM users us LEFT JOIN (SELECT user_id, COUNT(DISTINCT lab_id) FILTER (WHERE correct = 1)::int AS solved, " +
			"MAX(at) AS last_seen FROM attempts GROUP BY user_id) a ON a.user_id = us.id " +
			"WHERE us.role = 'student' AND us.deleted_at IS NULL ORDER BY last_seen ASC NULLS LAST",
		Returns: []string{"id", "name", "email", "solved", "last_seen"},
		Why:     "all active students for an administrator's tutoring console",
		Justify: "the tutor console is role-gated before this operation. It needs account id, name and email so authorized staff can identify and support students; these fields never enter the agent tool surface",
	},
	{
		Name: "tutor.students_cohort", Table: "users", Scope: Public, Audience: Internal, Muro: Gratis,
		Raw: "SELECT us.id AS id, us.name AS name, us.email AS email, COALESCE(a.solved, 0) AS solved, a.last_seen AS last_seen " +
			"FROM users us LEFT JOIN (SELECT user_id, COUNT(DISTINCT lab_id) FILTER (WHERE correct = 1)::int AS solved, " +
			"MAX(at) AS last_seen FROM attempts GROUP BY user_id) a ON a.user_id = us.id " +
			"WHERE us.role = 'student' AND us.deleted_at IS NULL AND us.cohort = $1 ORDER BY last_seen ASC NULLS LAST",
		Returns: []string{"id", "name", "email", "solved", "last_seen"},
		Params:  []Param{{Name: "cohort", Kind: Text, Max: 100}},
		Why:     "active students in the authorized tutor's own cohort",
		Justify: "the tutor console is role and cohort gated before this operation. It needs account id, name and email so the assigned tutor can identify and support students; these fields never enter the agent tool surface",
	},
	{
		Name: "tutor.stuck_all", Table: "attempts", Scope: Public, Audience: Agent, Muro: Gratis,
		Raw: "SELECT a.lab_id AS lab_id, COUNT(*)::int AS tries, SUM(a.correct)::int AS wins " +
			"FROM attempts a JOIN users us ON us.id = a.user_id AND us.deleted_at IS NULL " +
			"GROUP BY a.lab_id HAVING COUNT(*) >= 2 ORDER BY tries DESC LIMIT 5",
		Returns: []string{"lab_id", "tries", "wins"},
		Why:     "aggregate lab difficulty across active students for an administrator",
	},
	{
		Name: "tutor.stuck_cohort", Table: "attempts", Scope: Public, Audience: Agent, Muro: Gratis,
		Raw: "SELECT a.lab_id AS lab_id, COUNT(*)::int AS tries, SUM(a.correct)::int AS wins " +
			"FROM attempts a JOIN users us ON us.id = a.user_id AND us.deleted_at IS NULL AND us.cohort = $1 " +
			"GROUP BY a.lab_id HAVING COUNT(*) >= 2 ORDER BY tries DESC LIMIT 5",
		Returns: []string{"lab_id", "tries", "wins"},
		Params:  []Param{{Name: "cohort", Kind: Text, Max: 100}},
		Why:     "aggregate lab difficulty only inside the authorized tutor's cohort",
	},
	// --------------------------------------------------------- identity service
	{
		Name: "auth.user", Table: "users", Scope: Own, Audience: Internal, Muro: Gratis,
		Returns: []string{"id", "email", "name", "pass_hash", "role", "lang", "theme", "paid", "cohort", "created_at", "failed", "locked_until", "deleted_at", "token_version"},
		From:    "users", Where: "id = $1 AND deleted_at IS NULL", Limit: 1,
		Params:  []Param{{Name: "actor", Kind: Actor}},
		Why:     "the complete account record needed by auth session and account lifecycle code",
		Justify: "auth verifies passwords, session versions, lockout and identity fields inside the API process. The record is shaped before HTTP output and is never exposed to the agent",
	},
	{
		Name: "auth.user_by_email", Table: "users", Scope: Public, Audience: Internal, Muro: Gratis,
		Returns: []string{"id", "email", "name", "pass_hash", "role", "lang", "theme", "paid", "cohort", "created_at", "failed", "locked_until", "deleted_at", "token_version"},
		From:    "users", Where: "lower(email) = lower($1) AND deleted_at IS NULL", Limit: 1,
		Params:  []Param{{Name: "login", Kind: Text, Max: 320}},
		Why:     "look up a complete account for login without returning whether it exists to the caller",
		Justify: "auth needs the password hash, lockout fields, session version and profile to verify login and mint a cookie. It returns a generic credential error and never exposes this row",
	},
	{
		Name: "auth.throttle", Table: "auth_throttles", Scope: Own, Audience: Internal, Muro: Gratis,
		Returns: []string{"expires_at"}, From: "auth_throttles", Where: "user_id = $1 AND expires_at > now()", Limit: 1,
		Params:  []Param{{Name: "actor", Kind: Actor}},
		Why:     "enforce a defense throttle on the acting identity",
		Justify: "auth needs the internal expiry timestamp only to compute Retry-After. It returns an integer delay, not the stored throttle record",
	},
	{
		Name: "auth.login_failure", Table: "users", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw:    "UPDATE users SET failed = $2, locked_until = CASE WHEN $3 THEN now() + interval '15 minutes' ELSE NULL END WHERE id = $1",
		Params: []Param{{Name: "actor", Kind: Actor}, {Name: "failed", Kind: Int, Max: 1000}, {Name: "locked", Kind: Bool}},
		Why:    "record one failed login and apply the fixed lockout threshold",
	},
	{
		Name: "auth.login_clear", Table: "users", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw:    "UPDATE users SET failed = 0, locked_until = NULL WHERE id = $1",
		Params: []Param{{Name: "actor", Kind: Actor}},
		Why:    "clear failed-login state after a verified password",
	},
	{
		Name: "auth.set_language", Table: "users", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw:    "UPDATE users SET lang = $2 WHERE id = $1",
		Params: []Param{{Name: "actor", Kind: Actor}, {Name: "lang", Kind: Enum, Allowed: []string{"es", "en", "fr", "pt", "auto"}}},
		Why:    "update the acting account's language preference",
	},
	{
		Name: "auth.set_theme", Table: "users", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw:    "UPDATE users SET theme = $2 WHERE id = $1",
		Params: []Param{{Name: "actor", Kind: Actor}, {Name: "theme", Kind: Enum, Allowed: []string{"dark", "paper", "auto"}}},
		Why:    "update the acting account's theme preference",
	},
	{
		Name: "auth.register", Table: "users", Scope: Public, Audience: Internal, Muro: Gratis, Write: true,
		Raw: "INSERT INTO users (email,name,pass_hash,role,paid,lang,theme) VALUES ($1,$2,$3,'student',0,$4,$5) " +
			"RETURNING id, email, name, pass_hash, role, lang, theme, paid, cohort, created_at, failed, locked_until, deleted_at, token_version",
		Returns: []string{"id", "email", "name", "pass_hash", "role", "lang", "theme", "paid", "cohort", "created_at", "failed", "locked_until", "deleted_at", "token_version"},
		Params: []Param{
			{Name: "login", Kind: Text, Max: 320}, {Name: "name", Kind: Text, Max: 200},
			{Name: "password", Kind: Text, Max: 500},
			{Name: "lang", Kind: Enum, Allowed: []string{"es", "en", "fr", "pt", "auto"}},
			{Name: "theme", Kind: Enum, Allowed: []string{"dark", "paper", "auto"}},
		},
		Why:     "create one student account and return it to auth for cookie issuance",
		Justify: "registration needs the generated id and complete account row to mint the first session. The password hash and internal fields remain inside auth and are removed by shapeUser",
	},
	{
		Name: "auth.recovery_by_email", Table: "users", Scope: Public, Audience: Internal, Muro: Gratis,
		Returns: []string{"id", "name"}, From: "users", Where: "lower(email) = lower($1) AND deleted_at IS NULL", Limit: 1,
		Params:  []Param{{Name: "login", Kind: Text, Max: 320}},
		Why:     "locate the account for a non-enumerating recovery request",
		Justify: "recovery needs the internal account id to scope reset tokens. The HTTP response is identical whether a row exists or not",
	},
	{
		Name: "auth.reset_rate", Table: "reset_tokens", Scope: Own, Audience: Agent, Muro: Gratis,
		Raw:     "SELECT COUNT(*)::int AS c FROM reset_tokens WHERE user_id = $1 AND created_at > now() - interval '1 hour'",
		Returns: []string{"c"}, Params: []Param{{Name: "actor", Kind: Actor}},
		Why: "count the acting account's recovery requests in the last hour",
	},
	{
		Name: "auth.reset_create", Table: "reset_tokens", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw:    "INSERT INTO reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,now() + ($3 * interval '1 minute'))",
		Params: []Param{{Name: "actor", Kind: Actor}, {Name: "token", Kind: Text, Max: 128}, {Name: "minutes", Kind: Int, Max: 1440}},
		Why:    "store a bounded-lived hash for the acting account's recovery link",
	},
	{
		Name: "auth.reset_lookup", Table: "reset_tokens", Scope: Public, Audience: Internal, Muro: Gratis,
		Raw:     "SELECT id, user_id, used_at, expires_at < now() AS expired FROM reset_tokens WHERE token_hash = $1 LIMIT 1",
		Returns: []string{"id", "user_id", "used_at", "expired"},
		Params:  []Param{{Name: "token", Kind: Text, Max: 128}},
		Why:     "verify a submitted recovery token hash and resolve its target account",
		Justify: "password reset needs token id, target account, used timestamp and expiry verdict. These internal fields are converted to generic invalid, used or expired errors",
	},
	{
		Name: "auth.password_reset", Table: "users", Scope: Own, Audience: Internal, Muro: Gratis, Write: true,
		Raw: "UPDATE users SET pass_hash = $2, token_version = token_version + 1, failed = 0, locked_until = NULL " +
			"WHERE id = $1 RETURNING id, email, name, pass_hash, role, lang, theme, paid, cohort, created_at, failed, locked_until, deleted_at, token_version",
		Returns: []string{"id", "email", "name", "pass_hash", "role", "lang", "theme", "paid", "cohort", "created_at", "failed", "locked_until", "deleted_at", "token_version"},
		Params:  []Param{{Name: "actor", Kind: Actor}, {Name: "password", Kind: Text, Max: 500}},
		Why:     "replace the acting account's password hash and revoke previous sessions",
		Justify: "auth needs the updated session version and profile to issue the replacement cookie. The password hash and internal fields are removed before the response",
	},
	{
		Name: "auth.reset_mark_used", Table: "reset_tokens", Scope: Public, Audience: Agent, Muro: Gratis, Write: true,
		Raw:    "UPDATE reset_tokens SET used_at = now() WHERE id = $1",
		Params: []Param{{Name: "token", Kind: Int, Max: 2147483647}},
		Why:    "mark the exact consumed recovery token used",
	},
	{
		Name: "auth.reset_invalidate", Table: "reset_tokens", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw:    "UPDATE reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
		Params: []Param{{Name: "actor", Kind: Actor}},
		Why:    "invalidate every remaining recovery token for the acting account",
	},
	{
		Name: "auth.admin_count", Table: "users", Scope: Public, Audience: Agent, Muro: Gratis,
		// root manda igual que admin, asi que cuenta igual. Sin el IN, degradar al
		// ultimo root pasaba la guarda con c=0 y dejaba la plataforma sin nadie
		// que pudiera cambiar roles.
		Raw:     "SELECT COUNT(*)::int AS c FROM users WHERE role IN ('admin', 'root') AND deleted_at IS NULL",
		Returns: []string{"c"}, Why: "ensure account deletion and role changes cannot remove the last administrator",
	},
	{
		Name: "auth.account_delete", Table: "users", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw:    "UPDATE users SET deleted_at = now(), token_version = token_version + 1, email = $2, name = 'Cuenta borrada' WHERE id = $1",
		Params: []Param{{Name: "actor", Kind: Actor}, {Name: "replacement", Kind: Text, Max: 320}},
		Why:    "anonymize and soft-delete the acting account while invalidating sessions",
	},
	{
		Name: "auth.admin_users", Table: "users", Scope: Public, Audience: Internal, Muro: Gratis,
		Returns: []string{"id", "email", "name", "role", "paid", "cohort", "created_at"},
		From:    "users", Where: "deleted_at IS NULL", Order: "created_at DESC", Limit: 10000,
		Why:     "the role-gated administrator account list",
		Justify: "account administration needs ids and emails to identify users and manage roles. The route is admin-only and these fields never enter the agent tool surface",
	},
	{
		Name: "auth.role_change", Table: "users", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw:    "UPDATE users SET role = $2, token_version = token_version + 1 WHERE id = $1",
		Params: []Param{{Name: "actor", Kind: Actor}, {Name: "role", Kind: Enum, Allowed: []string{"student", "tutor", "admin", "root"}}},
		Why:    "change the target account's role after the admin route authorizes it",
	},
	{
		Name: "auth.role_audit", Table: "role_audit", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "INSERT INTO role_audit (user_id,actor_id,from_role,to_role) VALUES ($1,$2,$3,$4)",
		Params: []Param{
			{Name: "actor", Kind: Actor}, {Name: "authority", Kind: Authority},
			{Name: "from_role", Kind: Enum, Allowed: []string{"student", "tutor", "admin", "root"}},
			{Name: "to_role", Kind: Enum, Allowed: []string{"student", "tutor", "admin", "root"}},
		},
		Why: "audit which verified administrator changed which target account role",
	},
	{
		Name: "auth.entitlement_record", Table: "entitlement_events", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "INSERT INTO entitlement_events (event_key,user_id,active,source,external_id,occurred_at,period_end) " +
			"VALUES ($2,$1,$3,$4,$5,$6,NULLIF($7,'')::timestamptz) ON CONFLICT (event_key) DO NOTHING",
		Params: []Param{
			{Name: "actor", Kind: Actor}, {Name: "event", Kind: Text, Max: 500}, {Name: "active", Kind: Bool},
			{Name: "source", Kind: Text, Max: 100}, {Name: "external", Kind: Text, Max: 500},
			{Name: "occurred", Kind: Text, Max: 64}, {Name: "period", Kind: Text, Max: 64},
		},
		Why: "idempotently record one signed payments entitlement event for the target actor",
	},
	{
		Name: "auth.entitlement_apply", Table: "users", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "UPDATE users SET paid = CASE WHEN EXISTS (SELECT 1 FROM (SELECT DISTINCT ON (source, external_id) active, period_end " +
			"FROM entitlement_events WHERE user_id = $1 ORDER BY source, external_id, occurred_at DESC, id DESC) current_entitlements " +
			"WHERE active = true AND (period_end IS NULL OR period_end > now())) THEN 1 ELSE 0 END WHERE id = $1 RETURNING paid",
		Returns: []string{"paid"}, Params: []Param{{Name: "actor", Kind: Actor}},
		Why: "derive current paid access from the target actor's latest unexpired signed entitlement states",
	},
	{
		// EL BARRIDO DE CADUCIDAD.
		//
		// `auth.entitlement_apply` solo corre cuando llega un webhook, asi que
		// users.paid es una cache: si el proveedor deja de hablar, la fila se
		// queda en 1 aunque el periodo haya terminado. Sin esto, cancelar una
		// suscripcion y que el proveedor no avise = acceso gratis indefinido.
		//
		// Public porque actua sobre MUCHAS filas y no tiene actor: no hay
		// identidad "para quien" se hace, igual que job.take.
		//
		// `agent` y no `internal` a proposito, aunque ninguna herramienta la
		// exponga: el catalogo rechaza marcar internal una operacion que no
		// devuelve ninguna columna prohibida, porque entonces la exencion no
		// protege nada y solo la saca de la revision. Igual que
		// auth.revoke_session, que tambien es `agent` y tampoco tiene
		// herramienta. Lo que el agente puede pedir lo decide el registro de
		// api/src/tools/, no esta etiqueta.
		//
		// Solo baja accesos, nunca los concede: la rama que pone paid = 1
		// sigue siendo exclusiva de un evento firmado.
		Name: "auth.entitlement_sweep", Table: "users", Scope: Public, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "UPDATE users SET paid = 0 WHERE paid = 1 AND NOT EXISTS (" +
			"SELECT 1 FROM (SELECT DISTINCT ON (source, external_id) active, period_end " +
			"FROM entitlement_events WHERE user_id = users.id ORDER BY source, external_id, occurred_at DESC, id DESC) e " +
			"WHERE e.active = true AND (e.period_end IS NULL OR e.period_end > now()))",
		// Sin RETURNING. Solo hace falta CUANTAS filas se cerraron, y eso ya lo
		// da el conteo de la escritura; devolver users.id seria sacar una
		// columna `jamas` de la tabla para no usarla.
		Params: []Param{},
		Why:    "close access for accounts whose newest entitlement has lapsed",
	},
	{
		Name: "auth.revoke_session", Table: "users", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw:    "UPDATE users SET token_version = token_version + 1 WHERE id = $1",
		Params: []Param{{Name: "actor", Kind: Actor}},
		Why:    "invalidate every session for the defense-selected identity",
	},
	{
		Name: "auth.throttle_upsert", Table: "auth_throttles", Scope: Own, Audience: Agent, Muro: Gratis, Write: true,
		Raw: "INSERT INTO auth_throttles (user_id,expires_at,reason,updated_at) " +
			"VALUES ($1,now() + ($2 * interval '1 second'),$3,now()) ON CONFLICT (user_id) DO UPDATE SET " +
			"expires_at=GREATEST(auth_throttles.expires_at,excluded.expires_at), reason=excluded.reason, updated_at=now()",
		Params: []Param{{Name: "actor", Kind: Actor}, {Name: "seconds", Kind: Int, Max: 21600}, {Name: "reason", Kind: Text, Max: 500}},
		Why:    "apply or extend a bounded defense throttle to the selected identity",
	},
}
