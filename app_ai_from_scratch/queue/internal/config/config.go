// Package config resolves this service's configuration from the environment,
// and refuses to hand back a configuration that would be unsafe to run.
//
// Environment only. No default that points at a real host, no embedded
// credential, no fallback secret. This repository has already had a security
// pass over exactly that class of default -- see the DATABASE_URL note in
// api/src/db.ts and the sessionKey() argument in api/src/auth.ts -- and the
// rule it produced is followed here: a known placeholder or a short secret
// THROWS with an actionable message instead of booting something forgeable.
package config

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"course/queue/bus"
)

// Weak is the placeholder blocklist, kept in step with the WEAK set in
// api/src/auth.ts. A secret that appears in the repository is not a secret: any
// reader can present it and be believed.
var Weak = map[string]bool{
	"dev-only-change-me":  true,
	"dev-solo-para-local": true,
	"changeme":            true,
	"secret":              true,
	"password":            true,
	"test":                true,
}

// MinSecretLen matches the floor api/src/auth.ts puts on JWT_SECRET. Comfortably
// under what scripts/keys.sh generates for IA_SECRETO (`openssl rand -base64 32`
// is 44 characters), so a correctly generated environment always passes.
const MinSecretLen = 32

// Config is the resolved configuration. It holds credentials, so it is never
// logged whole -- Describe() is what a boot line prints.
type Config struct {
	// Env is "development" or anything else. Anything else is treated as
	// production, which is the fail-closed direction: forgetting to set it
	// makes the rules STRICTER, never looser.
	Env string

	// AMQPURL is empty when no broker is configured. That is a SUPPORTED state
	// and not a crash: this service must be able to boot, serve an honest
	// /health that says "not connected", and be fixed by setting one variable --
	// rather than crash-loop and read as a bug in this code.
	AMQPURL  string
	Exchange string
	Prefetch int

	// Queue and Patterns are NOT configurable, and that is deliberate: the
	// bindings are a contract with every publisher, not an operational knob.
	// They live in cmd/queue next to the handlers they belong to, so widening a
	// pattern and adding a handler happen in the same diff.

	WorkerID string

	// Secret is the shared service secret. The name on the wire stays Spanish
	// (IA_SECRETO, header x-ia-secreto) because api and ai already send it and
	// renaming it breaks both.
	Secret string
	// SecretIsEphemeral is true when the secret was minted for this process
	// because none was set in development. Reported by /health so that "nobody
	// else can call me" is visible rather than mysterious.
	SecretIsEphemeral bool

	ClaimURL   string
	ClaimLease time.Duration

	HandlerTimeout time.Duration
	DrainTimeout   time.Duration
	PublishTimeout time.Duration

	Port int
}

// Load resolves the configuration for the SERVICE: a process that listens, and
// therefore has to be able to tell a sibling service from anybody else. A
// missing secret is fatal here.
func Load(look func(string) (string, bool)) (Config, error) {
	return load(look, true)
}

// LoadForTool resolves the configuration for a command-line tool.
//
// The difference from Load is one thing only: IA_SECRETO is not required. A tool
// opens no listening socket and authenticates nobody -- it proves who it is to
// the broker with the credentials inside AMQP_URL -- so demanding the service
// secret would be ceremony, and ceremony gets worked around with a fake value.
//
// What does NOT relax: a secret that IS set is still validated, so a placeholder
// in the environment is caught by every entry point rather than only by the one
// that happens to check.
func LoadForTool(look func(string) (string, bool)) (Config, error) {
	return load(look, false)
}

func load(look func(string) (string, bool), secretRequired bool) (Config, error) {
	get := func(name, def string) string {
		if v, ok := look(name); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
		return def
	}

	c := Config{
		Env: get("APP_ENV", "production"),
		// No default URL. A default pointing at a real host is how a service
		// ends up talking to the wrong broker while looking healthy.
		AMQPURL:  get("AMQP_URL", ""),
		Exchange: get("BUS_EXCHANGE", bus.DefaultExchange),
		// Stable across restarts on purpose (a pid would not be): the
		// idempotency lease uses it to let a restarted worker reclaim its OWN
		// half-finished claim without waiting the lease out.
		WorkerID: get("BUS_WORKER_ID", hostnameOr("queue")),
		ClaimURL: get("BUS_CLAIM_URL", ""),
	}

	var err error
	if c.Prefetch, err = positiveInt(get("BUS_PREFETCH", "8")); err != nil {
		return Config{}, fmt.Errorf("BUS_PREFETCH: %w", err)
	}
	if c.Port, err = positiveInt(get("PORT", "8790")); err != nil {
		return Config{}, fmt.Errorf("PORT: %w", err)
	}
	if c.Port > 65535 {
		return Config{}, fmt.Errorf("PORT: %d is not a port", c.Port)
	}
	for _, d := range []struct {
		name string
		def  string
		dst  *time.Duration
		unit time.Duration
	}{
		{"BUS_HANDLER_TIMEOUT_MS", "60000", &c.HandlerTimeout, time.Millisecond},
		{"BUS_DRAIN_MS", "20000", &c.DrainTimeout, time.Millisecond},
		{"BUS_PUBLISH_TIMEOUT_MS", "10000", &c.PublishTimeout, time.Millisecond},
		{"BUS_CLAIM_LEASE_S", "300", &c.ClaimLease, time.Second},
	} {
		n, err := positiveInt(get(d.name, d.def))
		if err != nil {
			return Config{}, fmt.Errorf("%s: %w", d.name, err)
		}
		*d.dst = time.Duration(n) * d.unit
	}

	// An AMQP_URL that is set must be parseable and must name the AMQP scheme.
	// Without this a typo becomes a reconnect loop whose log line says only
	// "dial failed", and the reason -- someone pasted an http:// URL -- is
	// invisible.
	if c.AMQPURL != "" {
		u, perr := url.Parse(c.AMQPURL)
		if perr != nil {
			return Config{}, fmt.Errorf("AMQP_URL is not a URL: %w", perr)
		}
		if u.Scheme != "amqp" && u.Scheme != "amqps" {
			return Config{}, fmt.Errorf("AMQP_URL scheme is %q; expected amqp or amqps", u.Scheme)
		}
		if u.Host == "" {
			return Config{}, errors.New("AMQP_URL has no host")
		}
	}

	if c.ClaimURL != "" {
		u, perr := url.Parse(c.ClaimURL)
		if perr != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return Config{}, fmt.Errorf("BUS_CLAIM_URL must be an http(s) URL, got %q", c.ClaimURL)
		}
	}

	secret, ephemeral, err := resolveSecret(look, c.Development() || !secretRequired)
	if err != nil {
		return Config{}, err
	}
	c.Secret = secret
	c.SecretIsEphemeral = ephemeral
	return c, nil
}

// Development reports whether the loosened development rules apply. The
// comparison is exact and against one value: api/src/auth.ts records that a
// guard which fired only when NODE_ENV was exactly 'production' never fired at
// all, because no deployment file set it. Requiring the DEVELOPMENT value to be
// stated inverts that failure into a safe one.
func (c Config) Development() bool { return c.Env == "development" }

// BrokerConfigured reports whether a broker was named at all. Distinct from
// "connected", which only the broker client can answer.
func (c Config) BrokerConfigured() bool { return c.AMQPURL != "" }

// Describe is the boot line: everything that matters, no credentials.
func (c Config) Describe() string {
	broker := "DISABLED (AMQP_URL unset)"
	if c.BrokerConfigured() {
		broker = Redact(c.AMQPURL)
	}
	claims := "in-memory (BUS_CLAIM_URL unset)"
	if c.ClaimURL != "" {
		claims = "durable via " + c.ClaimURL
	}
	return fmt.Sprintf("env=%s port=%d exchange=%s prefetch=%d broker=%s claims=%s worker=%s",
		c.Env, c.Port, c.Exchange, c.Prefetch, broker, claims, c.WorkerID)
}

// Redact is a connection URL with the credentials removed, safe for a log line.
// Same shape as redact() in api/src/bus.ts and bus.py, so three services print
// the same thing about the same broker.
func Redact(raw string) string {
	if raw == "" {
		return "(unset)"
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "(unparseable AMQP_URL)"
	}
	creds := ""
	if u.User != nil {
		creds = "***@"
	}
	return fmt.Sprintf("%s://%s%s%s", u.Scheme, creds, u.Host, u.Path)
}

// resolveSecret is the port of sessionKey() in api/src/auth.ts, and the argument
// is identical: there is deliberately NO fallback constant, because a known
// default is a forgeable caller -- whoever reads the repository can present it
// and be treated as a sibling service.
//
// Outside development the variable is mandatory and the process refuses to boot
// without it. In development a random secret is minted per boot, so nothing
// guessable exists anywhere in the tree; the price is that a caller has to be
// told the new value after every restart, and that price is named out loud.
func resolveSecret(look func(string) (string, bool), dev bool) (string, bool, error) {
	given, _ := look("IA_SECRETO")
	given = strings.TrimSpace(given)
	if given != "" {
		if Weak[strings.ToLower(given)] {
			return "", false, fmt.Errorf(
				"IA_SECRETO is a known placeholder (%q). Any reader of this repository could call this service with it. Run scripts/keys.sh", given)
		}
		if len(given) < MinSecretLen {
			return "", false, fmt.Errorf(
				"IA_SECRETO is %d characters; %d or more required. Run scripts/keys.sh", len(given), MinSecretLen)
		}
		return given, false, nil
	}
	if !dev {
		return "", false, errors.New(
			"IA_SECRETO is required: without it no caller can be told apart from an attacker. " +
				"Set APP_ENV=development for an ephemeral secret, or run scripts/keys.sh")
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		// Failing closed: a secret nobody can generate is not a reason to run
		// without one.
		return "", false, fmt.Errorf("cannot mint a development secret: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), true, nil
}

func positiveInt(raw string) (int, error) {
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%q is not a number", raw)
	}
	if n <= 0 {
		return 0, fmt.Errorf("%d is not positive", n)
	}
	return n, nil
}

func hostnameOr(def string) string {
	if h, err := os.Hostname(); err == nil && h != "" {
		return h
	}
	return def
}
