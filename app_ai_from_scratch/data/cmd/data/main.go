// Command data is the data service: the only process in this fleet that holds a
// database credential.
//
//	data verify        the catalogue and the ontology, no database needed
//	data serve         listen
//	data healthcheck   for the container runtime (this image has no shell)
//	data version
//
// `verify` needs no DSN on purpose. It is the check a reviewer runs on a laptop
// and the gate CI runs, and requiring a database would have meant the safety
// invariants were only checkable where the data lives.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"course/data/internal/guard"
	"course/data/internal/httpapi"
	"course/data/internal/op"
	"course/data/internal/store"
)

const usage = `data <command>

  verify        the operation catalogue against the ontology. No database needed.
  smoke         EXECUTE every read operation against the database and report
  serve         listen on $PORT
  healthcheck   probe /health on $PORT
  version

Environment:
  DATABASE_URL    required by serve and smoke. This service is the only holder.
  DATA_SECRETO    required by serve, >= 32 chars. The caller presents it.
  DATA_ONTOLOGY   path to ontologia.json (default /etc/data/ontologia.json)
  PORT            default 8788
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	lg := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	var err error
	switch os.Args[1] {
	case "verify":
		err = verify()
	case "smoke":
		err = smoke(lg)
	case "serve":
		err = serve(lg)
	case "healthcheck":
		err = healthcheck()
	case "version":
		fmt.Println("data 0.1.0")
	default:
		fmt.Fprintf(os.Stderr, "data: unknown command %q\n\n%s", os.Args[1], usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "data: %v\n", err)
		os.Exit(1)
	}
}

// smoke EXECUTES every read operation against the real database.
//
// WHY THIS EXISTS AS A GATE. `verify` proves the catalogue is well formed: no
// star, no jamas column on an agent operation, every scoped read filtered on
// the actor, every operation on one side of the paywall. It proves nothing about
// whether the statements RUN. A misspelled column, a type Postgres will not
// coerce, a GROUP BY that does not cover the select list -- each passes every
// check in internal/op and fails on the first call.
//
// It was written because that gap produced a real bug that all seventeen gates
// missed. Rows were being scrubbed by FORBIDDEN column instead of by DECLARED
// column, so the two internal exemptions came back stripped:
// user.credentials_by_email declares seven columns and returned one, `role`. No
// pass_hash to check a password against, no id for the session. Login through
// this service could not work, every gate was green, and the only thing that
// found it was calling the operations and looking at the keys.
//
// WHAT IT ASSERTS, beyond "no error":
//
//   - every row's key set is EXACTLY what the operation declared. That is the
//     assertion that catches the scrub bug, and a plain smoke test would not.
//   - nothing was scrubbed. A scrub at runtime means the database handed back a
//     column no declaration mentions, which the service already logs as an
//     error; here it fails the gate.
//   - no agent-facing row carries a column the ontology classes jamas. Belt and
//     braces over the startup proof, on real rows.
//
// Writes are NOT executed: this runs against the development database and a gate
// that inserts is a gate that changes what the next gate reads. attempt.record
// is covered by api/test/tools.mts, which owns its own fixtures.
//
// Arguments are chosen from the database itself rather than hardcoded, so the
// gate keeps working when the seed changes. An operation whose arguments cannot
// be satisfied is REPORTED, not skipped -- a smoke test that quietly runs
// nothing is the failure mode this repository has hit three times.
func smoke(lg *slog.Logger) error {
	ont, err := guard.Load(ontologyPath())
	if err != nil {
		return err
	}
	if errs := op.Verify(ont); len(errs) > 0 {
		return fmt.Errorf("the catalogue does not validate, so executing it proves nothing: %v", errs[0])
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return fmt.Errorf("smoke needs DATABASE_URL. A smoke test that cannot reach the database " +
			"has FAILED, not skipped: the whole point is to execute the statements")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	st, err := store.Open(ctx, dsn, ont)
	if err != nil {
		return err
	}
	defer st.Close()

	// A pool of its own for choosing arguments, NOT store's.
	//
	// Store deliberately keeps its pool unexported: an accessor would hand any
	// caller arbitrary SQL, which is precisely the hole this service exists to
	// close, and adding one for a gate's convenience would be the gate weakening
	// the thing it checks. smoke already holds DATABASE_URL, so it opens its own
	// connection and closes it before executing anything.
	args, err := probeArgs(ctx, dsn)
	if err != nil {
		return err
	}

	var failed, ran int
	for _, o := range op.Catalog() {
		if o.Write {
			fmt.Printf("  --    %-32s not executed: it writes\n", o.Name)
			continue
		}
		a, ok := args[o.Name]
		if !ok {
			fmt.Printf("  FAIL  %-32s no arguments known for this operation. Add them to "+
				"probeArgs -- an operation nothing exercises is an operation nobody has run\n", o.Name)
			failed++
			continue
		}
		actor := int64(0)
		if o.ActorIndex() > 0 {
			actor = a.actor
		}
		authority := int64(0)
		if o.AuthorityIndex() > 0 {
			authority = a.authority
		}
		res, err := st.Call(ctx, o.Name, actor, authority, a.args)
		if err != nil {
			fmt.Printf("  FAIL  %-32s %v\n", o.Name, err)
			failed++
			continue
		}
		ran++
		if len(res.Scrubbed) > 0 {
			fmt.Printf("  FAIL  %-32s the guard removed %s at runtime: the database returned a "+
				"column no declaration mentions\n", o.Name, strings.Join(res.Scrubbed, ","))
			failed++
			continue
		}
		if len(res.Rows) == 0 {
			// Not a failure on its own -- achievement.mine for a person with none
			// is legitimately empty -- but it means the key set was not checked,
			// and saying so is the difference between a gate and a green tick.
			fmt.Printf("  ok    %-32s 0 rows (key set NOT checked)\n", o.Name)
			continue
		}
		want := append([]string(nil), o.Returns...)
		sort.Strings(want)
		got := make([]string, 0, len(res.Rows[0]))
		for k := range res.Rows[0] {
			got = append(got, k)
		}
		sort.Strings(got)
		if strings.Join(got, ",") != strings.Join(want, ",") {
			fmt.Printf("  FAIL  %-32s returned [%s] and declares [%s]\n",
				o.Name, strings.Join(got, ","), strings.Join(want, ","))
			failed++
			continue
		}
		if o.Audience == op.Agent {
			var leaked []string
			for _, c := range got {
				if bad, err := ont.IsForbidden(o.Table, c); err == nil && bad {
					leaked = append(leaked, c)
				}
			}
			if len(leaked) > 0 {
				fmt.Printf("  FAIL  %-32s an agent row carries %s, classed jamas\n",
					o.Name, strings.Join(leaked, ","))
				failed++
				continue
			}
		}
		fmt.Printf("  ok    %-32s %d row(s), keys exactly as declared\n", o.Name, len(res.Rows))
	}
	fmt.Printf("\n%d executed, %d failed\n", ran, failed)
	if failed > 0 {
		return fmt.Errorf("%d operation(s) do not run as declared", failed)
	}
	return nil
}

type probe struct {
	args      map[string]any
	actor     int64
	authority int64
}

// probeArgs reads real values out of the database so the gate does not depend on
// a seed that changes. Every operation in the catalogue must get an entry, and
// smoke FAILS on one that does not.
func probeArgs(ctx context.Context, dsn string) (map[string]probe, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("smoke: %w", err)
	}
	defer pool.Close()

	var labID, email, questionID string
	var actor int64
	if err := pool.QueryRow(ctx,
		"SELECT id FROM labs ORDER BY lesson_n, idx LIMIT 1").Scan(&labID); err != nil {
		return nil, fmt.Errorf("smoke: no labs in the database, so nothing can be exercised: %w", err)
	}
	if err := pool.QueryRow(ctx,
		"SELECT id FROM questions ORDER BY pack, idx LIMIT 1").Scan(&questionID); err != nil {
		return nil, fmt.Errorf("smoke: no questions in the database: %w", err)
	}
	if err := pool.QueryRow(ctx,
		"SELECT email FROM users WHERE deleted_at IS NULL ORDER BY id LIMIT 1").Scan(&email); err != nil {
		return nil, fmt.Errorf("smoke: no users in the database: %w", err)
	}
	// The person with the most attempts, so the `own` operations see rows rather
	// than an empty set that checks nothing.
	if err := pool.QueryRow(ctx,
		"SELECT user_id FROM attempts GROUP BY user_id ORDER BY count(*) DESC LIMIT 1").Scan(&actor); err != nil {
		if err := pool.QueryRow(ctx,
			"SELECT id FROM users WHERE deleted_at IS NULL ORDER BY id LIMIT 1").Scan(&actor); err != nil {
			return nil, fmt.Errorf("smoke: no users to act as: %w", err)
		}
	}
	n := map[string]any{"n": float64(3)}
	lesson := map[string]any{"lesson_n": float64(3)}
	byID := map[string]any{"id": labID}
	byLab := map[string]any{"lab_id": labID}
	return map[string]probe{
		"lesson.list":                    {args: map[string]any{}},
		"lesson.get":                     {args: n},
		"lesson.card":                    {args: n},
		"lesson.index_with_text_flag":    {args: map[string]any{}},
		"lesson.search_corpus":           {args: map[string]any{}},
		"lab.index":                      {args: map[string]any{}},
		"lab.list_for_lesson":            {args: lesson},
		"lab.list_for_lesson_locked":     {args: lesson},
		"lab.get":                        {args: byID},
		"lab.prompts":                    {args: map[string]any{}},
		"lab.explanation":                {args: byID},
		"lab.solution_for_grading":       {args: byID},
		"lesson_text.get":                {args: map[string]any{"lesson_n": float64(3), "lang": "es"}},
		"lesson_text.by_lang":            {args: map[string]any{"lang": "es"}},
		"attempt.mine_for_lab":           {args: byLab, actor: actor},
		"attempt.best_by_lab":            {args: map[string]any{}, actor: actor},
		"attempt.count_for_lab":          {args: byLab, actor: actor},
		"achievement.mine":               {args: map[string]any{}, actor: actor},
		"achievement.progress_by_lesson": {args: map[string]any{}, actor: actor},
		"achievement.codes":              {args: map[string]any{}, actor: actor},
		"ranking.table":                  {args: map[string]any{}},
		"ranking.mine":                   {args: map[string]any{}, actor: actor},
		"ranking.alias_clash":            {args: map[string]any{"alias": "smoke-never"}, actor: actor},
		"lab.card_by_id":                 {args: byID},
		"lab.count":                      {args: map[string]any{}},
		"question.list_for_pack":         {args: map[string]any{"pack": "q01"}},
		"question.card_by_id":            {args: map[string]any{"id": questionID}},
		"question.explanation":           {args: map[string]any{"id": questionID}, actor: actor},
		"question.solution_for_grading":  {args: map[string]any{"id": questionID}},
		"question.packs":                 {args: map[string]any{}},
		"qattempt.best_by_question":      {args: map[string]any{}, actor: actor},
		"qattempt.count_mine":            {args: map[string]any{}, actor: actor},
		"attempt.stuck_summary":          {args: map[string]any{}},
		"progress.pending_labs":          {args: map[string]any{}, actor: actor},
		"progress.active_days":           {args: map[string]any{"zone": "America/Bogota"}, actor: actor},
		"progress.inactivity_gap":        {args: map[string]any{"zone": "America/Bogota"}, actor: actor},
		"progress.failed_labs":           {args: map[string]any{}, actor: actor},
		"progress.wrong_attempts":        {args: map[string]any{}, actor: actor},
		"progress.weekly_pace":           {args: map[string]any{"zone": "America/Bogota"}, actor: actor},
		"progress.solved_count":          {args: map[string]any{}, actor: actor},
		"progress.history":               {args: map[string]any{"days": float64(7)}, actor: actor},
		"attempt.count_mine":             {args: map[string]any{}, actor: actor},
		"league.flow":                    {args: map[string]any{"zone": "America/Bogota"}},
		"league.current_week":            {args: map[string]any{"zone": "America/Bogota"}},
		"league.previous":                {args: map[string]any{"zone": "America/Bogota"}, actor: actor},
		"counter.read":                   {args: map[string]any{"key": "smoke-counter-never-used"}},
		"job.state_counts":               {args: map[string]any{}},
		"job.oldest_due":                 {args: map[string]any{}},
		"job.orphans":                    {args: map[string]any{"handled": ""}},
		"tutor.students_all":             {args: map[string]any{}},
		"tutor.students_cohort":          {args: map[string]any{"cohort": "smoke-never"}},
		"tutor.stuck_all":                {args: map[string]any{}},
		"tutor.stuck_cohort":             {args: map[string]any{"cohort": "smoke-never"}},
		"admin.student_timeline":         {args: map[string]any{}, actor: actor, authority: actor},
		"auth.user":                      {args: map[string]any{}, actor: actor},
		"auth.user_by_email":             {args: map[string]any{"login": email}},
		"auth.throttle":                  {args: map[string]any{}, actor: actor},
		"auth.recovery_by_email":         {args: map[string]any{"login": email}},
		"auth.reset_rate":                {args: map[string]any{}, actor: actor},
		"auth.reset_lookup":              {args: map[string]any{"token": "smoke-token-never-used"}},
		"auth.admin_count":               {args: map[string]any{}},
		"auth.admin_users":               {args: map[string]any{}},
		"user.me":                        {args: map[string]any{}, actor: actor},
		"user.credentials_by_email":      {args: map[string]any{"login": email}},
	}, nil
}

func ontologyPath() string {
	if p := os.Getenv("DATA_ONTOLOGY"); p != "" {
		return p
	}
	return "/etc/data/ontologia.json"
}

// verify is the gate. It prints the exemption list even when everything passes,
// because the exemptions are the one place the guarantee is deliberately not
// absolute, and one nobody sees is one nobody re-examines.
func verify() error {
	ont, err := guard.Load(ontologyPath())
	if err != nil {
		return err
	}
	errs := op.Verify(ont)
	for _, e := range errs {
		fmt.Printf("  FAIL  %v\n", e)
	}
	if len(errs) > 0 {
		return fmt.Errorf("%d problem(s) in the operation catalogue", len(errs))
	}

	agent, internal, writes := 0, 0, 0
	for _, o := range op.Catalog() {
		if o.Audience == op.Internal {
			internal++
		} else {
			agent++
		}
		if o.Write {
			writes++
		}
	}
	fmt.Printf("  ok    %d operations: %d agent-facing, %d internal, %d writes\n",
		len(op.Catalog()), agent, internal, writes)
	fmt.Printf("  ok    %d tables declared in the ontology; no agent operation reaches a jamas column\n",
		len(ont.Tables()))
	fmt.Println()
	ex := op.Exemptions(ont)
	if len(ex) == 0 {
		fmt.Println("no internal exemptions: nothing reads a jamas column.")
		return nil
	}
	fmt.Printf("%d internal exemption(s) -- these DO read a column classed jamas:\n", len(ex))
	for _, e := range ex {
		fmt.Printf("  · %s\n", e)
	}
	fmt.Println("\nEach one is pinned by a test, so this list cannot grow without a reviewer.")
	return nil
}

func serve(lg *slog.Logger) error {
	ont, err := guard.Load(ontologyPath())
	if err != nil {
		return err
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("DATABASE_URL is empty. This service exists to be the only holder of it; " +
			"without one it can do nothing and must not pretend to be healthy")
	}
	secret := os.Getenv("DATA_SECRETO")

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	st, err := store.Open(ctx, dsn, ont)
	if err != nil {
		return err
	}
	defer st.Close()

	srv, err := httpapi.New(st, secret, lg)
	if err != nil {
		return err
	}

	addr := ":" + port()
	h := &http.Server{
		Addr:              addr,
		Handler:           srv.Handler(),
		ReadTimeout:       httpapi.ReadTimeouts.Read,
		WriteTimeout:      httpapi.ReadTimeouts.Write,
		IdleTimeout:       httpapi.ReadTimeouts.Idle,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// The DSN is never logged, not even redacted-by-truncation: a truncated DSN
	// still names the host and the database.
	lg.Info("listening", "addr", addr, "operations", len(op.Catalog()),
		"ontology", ontologyPath(), "exemptions", len(op.Exemptions(ont)))

	errc := make(chan error, 1)
	go func() {
		if err := h.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errc <- err
		}
	}()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
		lg.Info("draining")
		shut, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		return h.Shutdown(shut)
	}
}

// healthcheck probes over the loopback. The image is FROM scratch, so there is
// no curl and no shell: a CMD-SHELL healthcheck could never run, and one that
// cannot run is a container that is never reported unhealthy. That exact mistake
// was already made once here against the queue image.
func healthcheck() error {
	c := &http.Client{Timeout: 4 * time.Second}
	url := "http://" + net.JoinHostPort("127.0.0.1", port()) + "/health"
	resp, err := c.Get(url)
	if err != nil {
		return fmt.Errorf("health: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health: %s answered %d", url, resp.StatusCode)
	}
	fmt.Println("ok")
	return nil
}

func port() string {
	p := strings.TrimSpace(os.Getenv("PORT"))
	if p == "" {
		return "8788"
	}
	return p
}
