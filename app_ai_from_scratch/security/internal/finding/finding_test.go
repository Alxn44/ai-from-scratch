package finding

import (
	"strings"
	"testing"
	"time"
)

func ok() Finding {
	return Finding{
		Rule: "host.ssh.password_auth", Line: Host, Source: "trinity", Severity: High,
		Target: "sshd", Summary: "password authentication is enabled",
		Remedy: "set PasswordAuthentication no and reload sshd", FirstSeen: time.Unix(1_700_000_000, 0),
	}
}

func TestValidateRefusesAFindingNobodyCanActnOn(t *testing.T) {
	cases := map[string]func(*Finding){
		"no rule":         func(f *Finding) { f.Rule = "" },
		"rule with space": func(f *Finding) { f.Rule = "host ssh" },
		"upper case rule": func(f *Finding) { f.Rule = "Host.SSH" },
		"no summary":      func(f *Finding) { f.Summary = "" },
		"no remedy":       func(f *Finding) { f.Remedy = "" },
		"no source":       func(f *Finding) { f.Source = "" },
		"bogus line":      func(f *Finding) { f.Line = Line(9) },
	}
	for name, break_ := range cases {
		f := ok()
		break_(&f)
		if err := f.Validate(); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if err := ok().Validate(); err != nil {
		t.Errorf("a well-formed finding was rejected: %v", err)
	}
}

// The dedupe key must NOT move when the severity moves. Oracle raises a score as
// an attack develops, and if that minted a new id every escalation would look
// like a brand new finding and walk straight past the rate limit.
func TestTheIDIgnoresSeverity(t *testing.T) {
	a := ok()
	b := ok()
	b.Severity = Critical
	b.Summary = "still the same hole, worse now"
	if a.ID() != b.ID() {
		t.Fatalf("raising the severity changed the id (%s -> %s); every escalation would count as a "+
			"new finding", a.ID(), b.ID())
	}
	c := ok()
	c.Target = "something-else"
	if a.ID() == c.ID() {
		t.Fatal("two different targets share an id; one would mask the other")
	}
}

func TestTheRoutingKeyCarriesTheSeverity(t *testing.T) {
	f := ok()
	f.Severity = Critical
	if got := f.Key(); got != "defense.finding.critical" {
		t.Fatalf("key = %q; a consumer cannot bind to criticals alone", got)
	}
}

// The payload has to be a JSON OBJECT. api/src/bus.ts rejects a non-object and
// ai/src/course_ai/bus.py asks isinstance(payload, dict), so anything else is a
// dead letter in two runtimes out of three.
func TestThePayloadIsAnObjectWithTheFieldsAHumanNeeds(t *testing.T) {
	p := ok().Payload()
	for _, k := range []string{"id", "rule", "line", "agent", "source", "severity", "summary", "remedy", "first_seen"} {
		if _, has := p[k]; !has {
			t.Errorf("payload is missing %q", k)
		}
	}
	if p["severity"] != "high" {
		t.Errorf("severity crosses the wire as %v; it must be a NAME, or reordering the constants "+
			"reinterprets every stored finding", p["severity"])
	}
	if p["agent"] != "trinity" {
		t.Errorf("agent = %v, want trinity", p["agent"])
	}
}

func TestIdempotencyKeyCollapsesRepeatsWithinTheHour(t *testing.T) {
	a := ok()
	b := ok()
	b.FirstSeen = a.FirstSeen.Add(30 * time.Minute)
	if a.IdempotencyKey() != b.IdempotencyKey() {
		t.Errorf("the same hole re-found 30 minutes later got a new idempotency key; it would page twice")
	}
	c := ok()
	c.FirstSeen = a.FirstSeen.Add(3 * time.Hour)
	if a.IdempotencyKey() == c.IdempotencyKey() {
		t.Error("a re-found finding hours later can never speak again")
	}
}

func TestParseSeverityRefusesATypo(t *testing.T) {
	if _, err := ParseSeverity("hihg"); err == nil {
		t.Fatal("a typo parsed; a threshold that silently means «report everything» makes the " +
			"channel noise nobody reads")
	}
	if s, err := ParseSeverity(" CRITICAL "); err != nil || s != Critical {
		t.Errorf("got %v %v", s, err)
	}
	if !strings.Contains(Severity(99).String(), "99") {
		t.Error("an out-of-range severity should print its number, not a wrong name")
	}
}
