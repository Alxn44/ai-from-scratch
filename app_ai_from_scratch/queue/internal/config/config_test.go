package config

import (
	"strings"
	"testing"
)

// lookup builds an env reader over a map, so no test touches the real
// environment -- and so a machine that happens to have AMQP_URL set cannot make
// these pass or fail for the wrong reason.
func lookup(m map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) {
		v, ok := m[k]
		return v, ok
	}
}

// A secret long enough to pass the floor, the shape scripts/keys.sh produces
// (`openssl rand -base64 32` is 44 characters).
const goodSecret = "3JqNPBjBhBIWMLYPUiZ9m7WK1Vd0kMIQzLzOaXfQ4vI="

func TestOutsideDevelopmentAMissingSecretRefusesToBoot(t *testing.T) {
	// There is deliberately NO fallback constant: a known default is a forgeable
	// caller, and whoever reads the repository could present it.
	_, err := Load(lookup(map[string]string{}))
	if err == nil {
		t.Fatal("a configuration with no QUEUE_SECRETO was accepted")
	}
	if !strings.Contains(err.Error(), "QUEUE_SECRETO") {
		t.Fatalf("the error does not name the variable: %v", err)
	}
	// It must also say what to DO, not only what is wrong.
	if !strings.Contains(err.Error(), "keys.sh") {
		t.Fatalf("the error is not actionable: %v", err)
	}
}

func TestTheProductionRulesApplyWhenAPPENVIsUnsetOrNonsense(t *testing.T) {
	// api/src/auth.ts records a guard that only fired when NODE_ENV was exactly
	// 'production' and therefore never fired, because no deployment file set it.
	// Forgetting the variable must make the rules STRICTER, never looser.
	for _, v := range []string{"", "prod", "staging", "Development", "DEVELOPMENT", "1"} {
		m := map[string]string{}
		if v != "" {
			m["APP_ENV"] = v
		}
		if _, err := Load(lookup(m)); err == nil {
			t.Fatalf("APP_ENV=%q was treated as development and booted with no secret", v)
		}
	}
}

func TestInDevelopmentAnEphemeralSecretIsMintedAndSaidOutLoud(t *testing.T) {
	c, err := Load(lookup(map[string]string{"APP_ENV": "development"}))
	if err != nil {
		t.Fatal(err)
	}
	if !c.SecretIsEphemeral {
		t.Fatal("the minted secret was not flagged as ephemeral, so nothing can report it")
	}
	if len(c.Secret) < MinSecretLen {
		t.Fatalf("the minted secret is %d characters", len(c.Secret))
	}
	// Two loads must not produce the same secret: a stable "random" default is
	// just a hardcoded one with extra steps.
	d, _ := Load(lookup(map[string]string{"APP_ENV": "development"}))
	if c.Secret == d.Secret {
		t.Fatal("two boots minted the same secret")
	}
}

func TestKnownPlaceholderSecretsAreRefused(t *testing.T) {
	// Kept in step with the WEAK set in api/src/auth.ts.
	for _, weak := range []string{"changeme", "secret", "dev-only-change-me", "dev-solo-para-local", "CHANGEME", "Secret"} {
		_, err := Load(lookup(map[string]string{"QUEUE_SECRETO": weak}))
		if err == nil {
			t.Fatalf("the placeholder %q was accepted", weak)
		}
		if !strings.Contains(err.Error(), "placeholder") && !strings.Contains(err.Error(), "characters") {
			t.Fatalf("%q: the error explains nothing: %v", weak, err)
		}
	}
}

func TestAShortSecretIsRefusedWithItsLength(t *testing.T) {
	_, err := Load(lookup(map[string]string{"QUEUE_SECRETO": "abcdefghijklmnop"})) // 16
	if err == nil {
		t.Fatal("a 16-character secret was accepted")
	}
	if !strings.Contains(err.Error(), "16") {
		t.Fatalf("the error does not say how short it was: %v", err)
	}
	// And a placeholder that is ALSO long enough must still be refused: length
	// is not the only thing wrong with a published string.
	long := "dev-only-change-me"
	if _, err := Load(lookup(map[string]string{"QUEUE_SECRETO": long + strings.Repeat("x", 40)})); err != nil {
		// This one is genuinely unguessable, so it is allowed. Asserted so the
		// blocklist is understood to be exact-match and not a substring scan --
		// a substring scan would reject legitimate random secrets.
		t.Fatalf("a long random secret containing a placeholder as a prefix was refused: %v", err)
	}
}

func TestThereIsNoDefaultBrokerURLAndNoBrokerIsASupportedState(t *testing.T) {
	c, err := Load(lookup(map[string]string{"QUEUE_SECRETO": goodSecret}))
	if err != nil {
		t.Fatal(err)
	}
	if c.AMQPURL != "" {
		t.Fatalf("AMQP_URL defaulted to %q: a default pointing at a real host is how a service talks to the wrong broker", c.AMQPURL)
	}
	if c.BrokerConfigured() {
		t.Fatal("BrokerConfigured() is true with no URL")
	}
	// It must be a supported state, not an error: the service has to boot so
	// /health can say the broker is missing.
	if c.Exchange != "course.events" {
		t.Fatalf("exchange = %q; the NAME may default, the URL may not", c.Exchange)
	}
}

func TestAMalformedBrokerURLIsRefusedAtBootNotAtTheFirstPublish(t *testing.T) {
	for _, bad := range []string{
		"http://broker:5672/", // wrong scheme, the classic paste
		"broker:5672",         // no scheme
		"amqp://",             // no host
		"amqp://%zz@broker/",  // unparseable
	} {
		if _, err := Load(lookup(map[string]string{"QUEUE_SECRETO": goodSecret, "AMQP_URL": bad})); err == nil {
			t.Fatalf("AMQP_URL=%q was accepted; the failure would surface later as an unexplained reconnect loop", bad)
		}
	}
	good := "amqp://app:pw@broker:5672/"
	c, err := Load(lookup(map[string]string{"QUEUE_SECRETO": goodSecret, "AMQP_URL": good}))
	if err != nil {
		t.Fatalf("a valid AMQP_URL was refused: %v", err)
	}
	if c.AMQPURL != good {
		t.Fatalf("AMQPURL = %q", c.AMQPURL)
	}
}

func TestAMalformedClaimURLIsRefused(t *testing.T) {
	for _, bad := range []string{"amqp://api/claim", "not a url", "api:8787/claim"} {
		if _, err := Load(lookup(map[string]string{"QUEUE_SECRETO": goodSecret, "BUS_CLAIM_URL": bad})); err == nil {
			t.Fatalf("BUS_CLAIM_URL=%q was accepted", bad)
		}
	}
}

func TestTheNumericKnobsRefuseNonsenseInsteadOfSilentlyDefaulting(t *testing.T) {
	// Silently falling back to the default on a typo means an operator who sets
	// BUS_PREFETCH=0 to "pause" the worker gets prefetch 8 and no warning.
	for _, k := range []string{"BUS_PREFETCH", "PORT", "BUS_HANDLER_TIMEOUT_MS", "BUS_DRAIN_MS", "BUS_PUBLISH_TIMEOUT_MS", "BUS_CLAIM_LEASE_S"} {
		for _, v := range []string{"0", "-1", "eight"} {
			m := map[string]string{"QUEUE_SECRETO": goodSecret, k: v}
			if _, err := Load(lookup(m)); err == nil {
				t.Fatalf("%s=%q was accepted", k, v)
			}
		}
	}
	if _, err := Load(lookup(map[string]string{"QUEUE_SECRETO": goodSecret, "PORT": "70000"})); err == nil {
		t.Fatal("PORT=70000 was accepted")
	}
}

func TestTheDefaultsAreTheOnesTheOtherRuntimesUse(t *testing.T) {
	c, err := Load(lookup(map[string]string{"QUEUE_SECRETO": goodSecret}))
	if err != nil {
		t.Fatal(err)
	}
	if c.Prefetch != 8 {
		t.Fatalf("prefetch = %d; want 8, the same as bus.ts and bus.py", c.Prefetch)
	}
	if c.HandlerTimeout.Milliseconds() != 60_000 {
		t.Fatalf("handler timeout = %v; want 60s", c.HandlerTimeout)
	}
	if c.DrainTimeout.Milliseconds() != 20_000 {
		t.Fatalf("drain = %v; want 20s", c.DrainTimeout)
	}
	if c.PublishTimeout.Milliseconds() != 10_000 {
		t.Fatalf("publish timeout = %v; want 10s", c.PublishTimeout)
	}
	if c.ClaimLease.Seconds() != 300 {
		t.Fatalf("claim lease = %v; want 300s", c.ClaimLease)
	}
	if c.WorkerID == "" {
		t.Fatal("the worker id is empty: the idempotency lease needs a stable owner")
	}
}

func TestDescribeNeverPrintsACredential(t *testing.T) {
	c, err := Load(lookup(map[string]string{
		"QUEUE_SECRETO": goodSecret,
		"AMQP_URL":      "amqp://app:sup3rs3cret@broker:5672/",
	}))
	if err != nil {
		t.Fatal(err)
	}
	got := c.Describe()
	if strings.Contains(got, "sup3rs3cret") {
		t.Fatalf("the broker password is in the boot line: %s", got)
	}
	if strings.Contains(got, goodSecret) {
		t.Fatalf("the service secret is in the boot line: %s", got)
	}
	if !strings.Contains(got, "broker:5672") {
		t.Fatalf("the host was redacted away too, leaving nothing useful: %s", got)
	}
}

func TestRedactKeepsTheHostAndDropsTheCredentials(t *testing.T) {
	cases := map[string]string{
		"":                                   "(unset)",
		"amqp://app:pw@broker:5672/":         "amqp://***@broker:5672/",
		"amqp://broker:5672/":                "amqp://broker:5672/",
		"amqps://user:pw@rabbit.internal/vh": "amqps://***@rabbit.internal/vh",
	}
	for in, want := range cases {
		if got := Redact(in); got != want {
			t.Fatalf("Redact(%q) = %q; want %q", in, got, want)
		}
	}
}

func TestLoadForToolDoesNotDemandASecretItNeverUses(t *testing.T) {
	// A tool listens on nothing and authenticates nobody. Demanding QUEUE_SECRETO
	// would be ceremony, and ceremony gets worked around with a fake value --
	// which is how a placeholder ends up in a real environment.
	c, err := LoadForTool(lookup(map[string]string{"AMQP_URL": "amqp://app:pw@broker:5672/"}))
	if err != nil {
		t.Fatalf("LoadForTool refused a tool configuration: %v", err)
	}
	if c.Exchange != "course.events" {
		t.Fatalf("exchange = %q", c.Exchange)
	}
	// The service entry point must still refuse the same environment.
	if _, err := Load(lookup(map[string]string{"AMQP_URL": "amqp://app:pw@broker:5672/"})); err == nil {
		t.Fatal("Load accepted a configuration with no secret: only the tool path may relax that")
	}
}

func TestLoadForToolStillRejectsAPlaceholderThatIsPresent(t *testing.T) {
	// The relaxation is "not required", never "not checked": a placeholder in the
	// environment must be caught by every entry point, not only by the one that
	// happens to look.
	if _, err := LoadForTool(lookup(map[string]string{"QUEUE_SECRETO": "changeme"})); err == nil {
		t.Fatal("the tool path accepted a known placeholder")
	}
	if _, err := LoadForTool(lookup(map[string]string{"QUEUE_SECRETO": "short"})); err == nil {
		t.Fatal("the tool path accepted a too-short secret")
	}
}
