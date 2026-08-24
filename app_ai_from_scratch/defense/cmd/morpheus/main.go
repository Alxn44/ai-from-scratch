// Command morpheus is line 1: the door.
//
// One question: is there any way in that we did not choose? On this deployment
// the answer should be "exactly one, and it is an outbound tunnel". The Pi is
// behind CGNAT, so no inbound port from the internet is even possible -- which
// means every exposure Morpheus can find is a LAN exposure, and the LAN contains
// whichever IoT device gets compromised first.
//
// Morpheus needs the HOST network namespace to see the host's sockets
// (`network_mode: host`, read-only). Without it, it sees its own namespace and
// says so rather than reporting a clean door it never looked at.
package main

import (
	"context"
	"os"
	"strings"

	"course/defense/internal/agent"
	"course/defense/internal/finding"
	"course/defense/internal/probe"
)

func main() { os.Exit(agent.Run("morpheus", scan)) }

func scan(_ context.Context) []finding.Finding {
	var out []finding.Finding

	tcp, miss := agent.ReadOrReport("/proc/net/tcp", "perimeter.listeners", finding.Perimeter, "morpheus")
	if miss != nil {
		out = append(out, *miss)
		return out
	}
	ls, err := probe.ParseProcNetTCP(tcp, false)
	if err != nil {
		return append(out, finding.Finding{
			Rule: "perimeter.listeners.unparsed", Line: finding.Perimeter, Source: "morpheus",
			Severity: finding.Low, Target: "/proc/net/tcp",
			Summary:  "could not parse /proc/net/tcp",
			Remedy:   "fix probe.ParseProcNetTCP; until then the door is not being checked",
			Evidence: map[string]string{"error": err.Error()},
		})
	}
	out = append(out, probe.WildcardListeners(ls)...)

	// Am I even looking at the host? In its own namespace a container sees only
	// its own sockets, and reporting "no unexpected listeners" from there is the
	// exact shape of failure this repository keeps stamping out: a check that
	// inspected nothing and reported success.
	if !strings.Contains(tcp, ":0016") && len(ls) < 2 {
		out = append(out, finding.Finding{
			Rule: "perimeter.namespace.not_host", Line: finding.Perimeter, Source: "morpheus",
			Severity: finding.Medium, Target: "netns",
			Summary: "this looks like a container's own network namespace, not the host's",
			Remedy: "give morpheus `network_mode: host` (read-only, no capabilities). From inside " +
				"its own namespace it can only see its own sockets, so a clean result here would " +
				"mean nothing at all",
			Evidence: map[string]string{"listeners_seen": itoa(len(ls))},
		})
	}
	return out
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
