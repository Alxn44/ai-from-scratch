// Package config reads the environment once, validates it, and refuses to start
// on a value it does not understand.
//
// No forgeable defaults, which is a house rule with a history: this repository
// shipped a JWT placeholder that was 35 characters long, so it passed a
// length check and worked as a signing key while sitting in git. So: a secret
// has no default, and a mode that is not one of the two known words is an error
// rather than a fallback.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	qbus "course/queue/bus"
	"course/security/internal/policy"
)

// Config is the whole configuration of any defense agent.
type Config struct {
	Env      string
	AMQPURL  string
	Exchange string
	Agent    string

	Mode      policy.Mode
	AuditPath string
	StatePath string
	Port      int

	// ScanEvery is how often Smith attacks us unprompted. Zero disables the
	// timer and leaves Smith purely on-demand.
	ScanEvery time.Duration
	// WatchWindow is Oracle's scoring window.
	WatchWindow time.Duration

	// EdgeToken and EdgeZone enable policy.BlockEdge. Absent is a supported
	// state, not an error: without them Neo escalates an edge block instead of
	// performing it, and says why.
	EdgeToken string
	EdgeZone  string
}

func get(k, def string) string {
	if v, ok := os.LookupEnv(k); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return def
}

// Load reads the environment for one named agent.
func Load(agent string) (Config, error) {
	c := Config{
		Agent:     agent,
		Env:       get("APP_ENV", "production"),
		AMQPURL:   get("AMQP_URL", ""),
		Exchange:  get("BUS_EXCHANGE", qbus.DefaultExchange),
		AuditPath: get("DEFENSE_AUDIT", "/var/lib/defense/audit.jsonl"),
		StatePath: get("DEFENSE_STATE", "/var/lib/defense"),
		EdgeToken: get("CLOUDFLARE_API_TOKEN", ""),
		EdgeZone:  get("CLOUDFLARE_ZONE_ID", ""),
	}

	mode, err := policy.ParseMode(get("DEFENSE_MODE", string(policy.Propose)))
	if err != nil {
		return Config{}, err
	}
	c.Mode = mode

	if c.Port, err = positiveInt(get("PORT", "8795")); err != nil {
		return Config{}, err
	}
	if c.ScanEvery, err = duration(get("DEFENSE_SCAN_EVERY", "1h"), true); err != nil {
		return Config{}, err
	}
	if c.WatchWindow, err = duration(get("DEFENSE_WATCH_WINDOW", "5m"), false); err != nil {
		return Config{}, err
	}

	// The AMQP URL is required for the agents that speak on the bus, and every
	// one of them does. An agent with no broker is a process that starts, logs
	// nothing useful and looks healthy, which is worse than a refusal.
	if c.AMQPURL == "" && c.Env == "production" {
		return Config{}, errors.New("config: AMQP_URL is empty. Every agent reports on the bus; " +
			"one that cannot connect looks healthy and defends nothing")
	}

	// Enforce mode with no audit log is refused. Acting without a record is the
	// one combination that is strictly worse than not acting: after an incident
	// nobody can tell what the system did to itself.
	if c.Mode == policy.Enforce && strings.TrimSpace(c.AuditPath) == "" {
		return Config{}, errors.New("config: DEFENSE_MODE=enforce with an empty DEFENSE_AUDIT. " +
			"Acting with no record means an incident review cannot separate what the attacker did " +
			"from what the defence did")
	}
	return c, nil
}

// EdgeReady reports whether policy.BlockEdge can actually be carried out.
func (c Config) EdgeReady() bool {
	return c.EdgeToken != "" && c.EdgeZone != ""
}

// Redacted renders the config for a startup log with the secret replaced. It
// prints the LENGTH of the token, because "is the variable even set" is the
// question a startup log has to answer and the value must never appear.
func (c Config) Redacted() string {
	edge := "absent (an edge block will escalate instead)"
	if c.EdgeReady() {
		edge = fmt.Sprintf("ready (token %d chars, zone %s)", len(c.EdgeToken), c.EdgeZone)
	}
	return fmt.Sprintf("agent=%s env=%s mode=%s exchange=%s port=%d audit=%s scan_every=%s window=%s edge=%s",
		c.Agent, c.Env, c.Mode, c.Exchange, c.Port, c.AuditPath, c.ScanEvery, c.WatchWindow, edge)
}

func positiveInt(s string) (int, error) {
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("config: %q is not a positive integer", s)
	}
	return n, nil
}

// duration parses a Go duration. `allowZero` exists because zero means
// "disabled" for the scan timer and means "misconfigured" for the watch window,
// and treating those alike would silently turn Oracle off.
func duration(s string, allowZero bool) (time.Duration, error) {
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0, fmt.Errorf("config: %q is not a duration (e.g. 30s, 5m, 1h): %w", s, err)
	}
	if d < 0 || (d == 0 && !allowZero) {
		return 0, fmt.Errorf("config: %q must be positive", s)
	}
	return d, nil
}
