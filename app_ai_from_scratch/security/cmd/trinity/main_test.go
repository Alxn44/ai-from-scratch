package main

import (
	"strings"
	"testing"
)

// The firewall has two jobs and one of them is «do not break what is already
// working». Both cases below are outages, not preferences.
func TestTheRulesetDoesNotBreakMosquittoOrLockUsOut(t *testing.T) {
	r := Ruleset()

	if !strings.Contains(r, "tcp dport 1883 accept") {
		t.Error("no rule accepts 1883. Mosquitto is not part of this project, it serves the ESP32s " +
			"on the LAN, and a default-drop ruleset without this line takes every sensor offline")
	}
	if !strings.Contains(r, "tcp dport 22 accept") {
		t.Error("no rule accepts 22. This box is behind CGNAT in a house; locking ourselves out of " +
			"ssh means a physical trip with a monitor and a keyboard")
	}
	// Without this, every reply to a connection the Pi opened is dropped and the
	// symptom reads as «the network is broken», not «the firewall is wrong».
	if !strings.Contains(r, "ct state established,related accept") {
		t.Error("no conntrack accept rule; outbound connections would get no replies")
	}
	if !strings.Contains(r, "iif lo accept") {
		t.Error("loopback is not accepted; every local health check would fail")
	}
}

func TestTheInputChainDefaultsToDrop(t *testing.T) {
	r := Ruleset()
	if !strings.Contains(r, "hook input priority filter; policy drop") {
		t.Fatal("the input chain does not default to drop, so this is an allowlist that allows " +
			"everything it forgot to mention")
	}
}

// Docker writes its own forwarding rules. A drop policy on the forward chain
// breaks container networking in a way that takes an hour to find.
func TestTheForwardChainDoesNotFightDocker(t *testing.T) {
	r := Ruleset()
	i := strings.Index(r, "chain forward")
	if i < 0 {
		t.Fatal("no forward chain")
	}
	seg := r[i:]
	if j := strings.Index(seg, "}"); j > 0 {
		seg = seg[:j]
	}
	// Comments are stripped first. The chain body EXPLAINS why it does not drop,
	// and an earlier version of this test matched that explanation and reported
	// the rule it was describing.
	var rules []string
	for _, line := range strings.Split(seg, "\n") {
		if t := strings.TrimSpace(line); t != "" && !strings.HasPrefix(t, "#") {
			rules = append(rules, t)
		}
	}
	if strings.Contains(strings.Join(rules, "\n"), "policy drop") {
		t.Error("the forward chain drops. Docker manages forwarding for container networking, and " +
			"dropping here breaks every container's outbound traffic")
	}
}

// Nothing inbound for the application: traffic arrives through an OUTBOUND
// tunnel. A dport for the api or the web means the tunnel is misconfigured, and
// punching a hole is not the fix.
func TestNoApplicationPortIsOpened(t *testing.T) {
	r := Ruleset()
	for _, p := range []string{"dport 8787", "dport 4321", "dport 5432", "dport 5672", "dport 80 ", "dport 443"} {
		if strings.Contains(r, p+" accept") {
			t.Errorf("the ruleset opens %s. Every request arrives through cloudflared, which makes "+
				"an outbound connection and needs no inbound port at all", p)
		}
	}
}

// The ban set is what policy.BanHostIP adds elements to. If the set is missing,
// every ban command fails with «no such set» and the containment silently does
// nothing, which is the worst of both worlds: an audit record saying it acted.
func TestTheBanSetExistsAndExpiresInTheKernel(t *testing.T) {
	r := Ruleset()
	if !strings.Contains(r, "set banned") {
		t.Fatal("no `banned` set; every policy.BanHostIP command would fail with «no such set» " +
			"while the audit log records an action")
	}
	if !strings.Contains(r, "flags timeout") {
		t.Error("the ban set has no timeout flag, so `nft add element … timeout 3600s` is rejected " +
			"and the only expiry left would be a timer inside a process that can die")
	}
	if !strings.Contains(r, "ip saddr @banned drop") {
		t.Error("nothing drops traffic from the banned set, so adding to it does nothing")
	}
}

func TestTheRulesetSaysHowToApplyItAndThatNothingAppliesItAutomatically(t *testing.T) {
	r := Ruleset()
	if !strings.Contains(r, "nft -f /etc/nftables.conf") {
		t.Error("the header does not say how to apply it")
	}
	if !strings.Contains(r, "NOT applied by any agent") {
		t.Error("the header should say plainly that no agent applies this. A firewall applied " +
			"automatically on a box behind CGNAT in a house is one false positive from a keyboard trip")
	}
}
