package probe

import (
	"strings"
	"testing"

	"course/defense/internal/finding"
)

func rules(fs []finding.Finding) []string {
	out := make([]string, 0, len(fs))
	for _, f := range fs {
		out = append(out, f.Rule)
	}
	return out
}

// Every finding this package can emit must be publishable. A check that produces
// an invalid finding is a check whose output is dropped at the bus, which looks
// exactly like a check that found nothing.
func assertAllValid(t *testing.T, fs []finding.Finding) {
	t.Helper()
	for _, f := range fs {
		if err := f.Validate(); err != nil {
			t.Errorf("emitted an unpublishable finding: %v", err)
		}
	}
}

func TestCapEffIsParsedAsABitmaskNotSearchedAsText(t *testing.T) {
	// 0x0000003fffffffff -- effectively everything, which is what a privileged
	// container looks like.
	fs := Capabilities("Name:\tdefense\nCapEff:\t0000003fffffffff\n")
	assertAllValid(t, fs)
	got := strings.Join(rules(fs), " ")
	for _, want := range []string{"cap_sys_admin", "cap_sys_module", "cap_net_admin"} {
		if !strings.Contains(got, want) {
			t.Errorf("a fully privileged container did not report %s. Got: %s", want, got)
		}
	}
}

func TestADroppedCapabilitySetIsClean(t *testing.T) {
	if fs := Capabilities("CapEff:\t0000000000000000\n"); len(fs) != 0 {
		t.Errorf("cap_drop: [ALL] still reported %v", rules(fs))
	}
}

// A check that cannot run has not passed. An unreadable /proc must be a finding.
func TestAnUnreadableStatusIsAFindingNotSilence(t *testing.T) {
	fs := Capabilities("this is not a status file")
	if len(fs) != 1 || !strings.Contains(fs[0].Rule, "unreadable") {
		t.Fatalf("want one 'unreadable' finding, got %v", rules(fs))
	}
	assertAllValid(t, fs)
}

func TestTheDockerSocketIsCritical(t *testing.T) {
	fs := DockerSocket(true, "/var/run/docker.sock")
	if len(fs) != 1 {
		t.Fatalf("got %d findings", len(fs))
	}
	assertAllValid(t, fs)
	if fs[0].Severity != finding.Critical {
		t.Errorf("severity is %s; a mounted docker socket is root on the host, not a warning",
			fs[0].Severity)
	}
	if len(DockerSocket(false, "")) != 0 {
		t.Error("no socket mounted still produced a finding")
	}
}

// The default-unsafe cases are the ones that matter: a config that never
// mentions PermitRootLogin permits it.
func TestSSHDefaultsAreCheckedByAbsenceNotOnlyByValue(t *testing.T) {
	fs := SSHConfig("# a config that says almost nothing\nPort 22\n")
	assertAllValid(t, fs)
	got := strings.Join(rules(fs), " ")
	for _, want := range []string{"passwordauthentication.unset", "permitrootlogin.unset"} {
		if !strings.Contains(got, want) {
			t.Errorf("an absent %s was not reported. Got: %s", want, got)
		}
	}
}

func TestSSHHardenedConfigIsClean(t *testing.T) {
	hardened := `
PasswordAuthentication no
PermitRootLogin prohibit-password
PermitEmptyPasswords no
X11Forwarding no
KbdInteractiveAuthentication no
`
	if fs := SSHConfig(hardened); len(fs) != 0 {
		t.Errorf("a hardened config reported %v", rules(fs))
	}
}

func TestSSHCommentsAreNotSettings(t *testing.T) {
	// The stock Debian file ships these commented out. Reading a comment as a
	// setting would report the box as safe because the DEFAULT was written down.
	fs := SSHConfig("#PasswordAuthentication no\n#PermitRootLogin prohibit-password\n")
	got := strings.Join(rules(fs), " ")
	if !strings.Contains(got, "unset") {
		t.Errorf("commented-out defaults were read as settings; got %s", got)
	}
}

func TestProcNetTCPIsDecodedLittleEndian(t *testing.T) {
	// 0100007F:0016 is 127.0.0.1:22, 00000000:1F90 is 0.0.0.0:8080, state 0A is
	// LISTEN. The third row is ESTABLISHED and must be ignored.
	content := `  sl  local_address rem_address   st
   0: 0100007F:0016 00000000:0000 0A
   1: 00000000:1F90 00000000:0000 0A
   2: 00000000:0050 0100007F:C1B4 01
`
	ls, err := ParseProcNetTCP(content, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(ls) != 2 {
		t.Fatalf("got %d listeners, want 2 (the third row is ESTABLISHED): %+v", len(ls), ls)
	}
	if ls[0].Addr != "127.0.0.1" || ls[0].Port != 22 {
		t.Errorf("row 0 decoded to %s:%d, want 127.0.0.1:22", ls[0].Addr, ls[0].Port)
	}
	if ls[1].Addr != "0.0.0.0" || ls[1].Port != 8080 {
		t.Errorf("row 1 decoded to %s:%d, want 0.0.0.0:8080", ls[1].Addr, ls[1].Port)
	}
}

func TestOnlyWildcardListenersAreReportedAndMosquittoIsLeftAlone(t *testing.T) {
	fs := WildcardListeners([]Listener{
		{Addr: "127.0.0.1", Port: 5432}, // loopback: fine
		{Addr: "0.0.0.0", Port: 22},     // expected
		{Addr: "0.0.0.0", Port: 1883},   // Mosquitto: NOT ours, must not be flagged
		{Addr: "0.0.0.0", Port: 5432},   // Postgres on the LAN: a finding
	})
	assertAllValid(t, fs)
	if len(fs) != 1 {
		t.Fatalf("got %d findings, want 1: %v", len(fs), rules(fs))
	}
	if fs[0].Target != "5432" {
		t.Errorf("flagged port %s, want 5432", fs[0].Target)
	}
	// The reason matters: on CGNAT the risk is the LAN, not the internet, and a
	// remedy that says "the internet can reach this" would be wrong.
	if !strings.Contains(fs[0].Remedy, "LAN") {
		t.Errorf("the remedy should explain the real exposure: %q", fs[0].Remedy)
	}
}

// The one thing this check must never do is print what it found.
func TestSecretScanReportsNamesAndNeverValues(t *testing.T) {
	env := []string{
		"PATH=/usr/bin",
		"IA_SECRETO=super-secret-value-here",
		"CLOUDFLARE_API_TOKEN=another-secret",
		"DEFENSE_MODE=propose",
	}
	fs := SecretsInEnvironment(env, "neo")
	assertAllValid(t, fs)
	if len(fs) != 1 {
		t.Fatalf("got %d findings", len(fs))
	}
	blob := fs[0].Summary + fs[0].Remedy + strings.Join([]string{fs[0].Evidence["names"]}, "")
	for _, secret := range []string{"super-secret-value-here", "another-secret"} {
		if strings.Contains(blob, secret) {
			t.Errorf("the finding contains a credential VALUE (%q); it would be published on the "+
				"bus and written to the audit log", secret)
		}
	}
	if !strings.Contains(fs[0].Evidence["names"], "IA_SECRETO") {
		t.Errorf("the finding should name the variables: %q", fs[0].Evidence["names"])
	}
}

func TestRunningAsRoot(t *testing.T) {
	if fs := RunningAsRoot(0, "neo"); len(fs) != 1 {
		t.Error("uid 0 was not reported")
	} else {
		assertAllValid(t, fs)
	}
	if fs := RunningAsRoot(10001, "neo"); len(fs) != 0 {
		t.Error("a non-root uid was reported")
	}
}
