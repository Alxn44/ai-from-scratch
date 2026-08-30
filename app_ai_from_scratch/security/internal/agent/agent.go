// Package agent is the shell every one of the five shares: read the config,
// build the reporter, run a pass, honour a stop signal, and decide the exit
// code.
//
// It exists so that the five commands contain their CHECKS and nothing else. A
// per-agent copy of the signal handling and the exit-code logic is five places
// for "it exited 0 while finding a critical" to be true.
package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"course/security/internal/config"
	"course/security/internal/finding"
	"course/security/internal/report"
)

// Pass is one sweep of an agent's checks. It returns what it found; reporting is
// this package's job, so a check cannot forget to report.
type Pass func(ctx context.Context) []finding.Finding

// Run wires everything and runs `pass` once, or on a timer.
//
// `--once` is the CI shape: one pass, then an exit code derived from the worst
// severity found. Without it the agent stays up and sweeps every
// DEFENSE_SCAN_EVERY, which is the deployed shape.
func Run(name string, pass Pass) int {
	lg := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load(name)
	if err != nil {
		lg.Error("configuration refused", "err", err)
		return 2
	}
	once := hasFlag("--once")
	failAt, err := failThreshold()
	if err != nil {
		lg.Error("configuration refused", "err", err)
		return 2
	}

	rep, err := report.New(cfg, os.Stdout, lg)
	if err != nil {
		lg.Error("could not build the reporter", "err", err)
		return 2
	}
	defer rep.Close()

	lg.Info("starting", "agent", name, "config", cfg.Redacted(), "once", once, "fail_at", failAt.String())

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	worst := func() finding.Severity {
		found := pass(ctx)
		w := finding.Severity(-1)
		for _, f := range found {
			if err := rep.Finding(ctx, f); err != nil {
				// An invalid finding is a bug in a check. It is reported as an
				// error rather than swallowed, because the alternative is a
				// check that silently produces nothing.
				lg.Error("a check produced an unpublishable finding", "err", err)
				continue
			}
			if f.Severity > w {
				w = f.Severity
			}
		}
		if w < 0 {
			lg.Info("pass complete: nothing found", "agent", name)
			return finding.Info
		}
		lg.Info("pass complete", "agent", name, "findings", len(found), "worst", w.String())
		return w
	}

	if once {
		if w := worst(); w >= failAt {
			// Non-zero so CI and a cron wrapper can act on it. The message says
			// which threshold, because "exit 1" with no explanation is what
			// makes people add `|| true`.
			fmt.Fprintf(os.Stderr, "%s: worst finding is %s, at or above DEFENSE_FAIL_AT=%s\n",
				name, w, failAt)
			return 1
		}
		return 0
	}

	if cfg.ScanEvery <= 0 {
		lg.Error("DEFENSE_SCAN_EVERY is 0 and --once was not given, so this agent would run its " +
			"checks exactly never. Refusing to sit there looking healthy")
		return 2
	}
	// One pass immediately: an agent whose first sweep is an hour away is an
	// agent that reports nothing about the state it was started into.
	worst()
	t := time.NewTicker(cfg.ScanEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			lg.Info("stopping", "agent", name)
			return 0
		case <-t.C:
			worst()
		}
	}
}

func hasFlag(f string) bool {
	for _, a := range os.Args[1:] {
		if a == f {
			return true
		}
	}
	return false
}

func failThreshold() (finding.Severity, error) {
	v := os.Getenv("DEFENSE_FAIL_AT")
	if v == "" {
		// Critical, not High. A one-shot pass that exits non-zero on a High
		// would fail on the day a Medium becomes a High, and the response to a
		// noisy gate is always to disable it.
		return finding.Critical, nil
	}
	s, err := finding.ParseSeverity(v)
	if err != nil {
		return 0, fmt.Errorf("DEFENSE_FAIL_AT: %w", err)
	}
	return s, nil
}

// ReadOrReport reads a file, or returns the finding that says it could not.
//
// This is the shape that keeps "a check that cannot run has failed" true: every
// caller either gets the bytes or gets a publishable finding, and there is no
// third path where a missing file becomes a clean result.
func ReadOrReport(path, rule string, line finding.Line, source string) (string, *finding.Finding) {
	b, err := os.ReadFile(path)
	if err == nil {
		return string(b), nil
	}
	sev := finding.Low
	if errors.Is(err, os.ErrPermission) {
		sev = finding.Medium
	}
	return "", &finding.Finding{
		Rule: rule + ".unreadable", Line: line, Source: source, Severity: sev, Target: path,
		Summary: fmt.Sprintf("could not read %s", path),
		Remedy: fmt.Sprintf("mount %s into this container read-only, or run this check on the host. "+
			"Until then this check reports nothing, and a check that cannot run has not passed", path),
		Evidence: map[string]string{"error": err.Error()},
	}
}
