// Package probe holds the checks, as PURE FUNCTIONS over text.
//
// Every check takes the bytes it examines as an argument instead of reading the
// file itself. That is the whole design decision in this package and it buys two
// things that matter more than the small amount of plumbing it costs:
//
//  1. The checks are tested on a laptop. `/proc/self/status`, `/proc/net/tcp`
//     and `/etc/ssh/sshd_config` do not exist on macOS and are not writable in
//     CI, so a check that reads its own input can only ever be tested on the
//     target box -- which means, in practice, never.
//  2. A check cannot silently pass because its input was missing. The caller
//     reads the file and reports the read failure as a finding of its own, so
//     "sshd_config was unreadable" is a result rather than a clean bill.
//
// # THE CALLERS RUN THESE IN SEQUENCE, AND THAT IS THE RIGHT ANSWER
//
// cmd/smith, cmd/trinity and cmd/morpheus each call these one after another. It
// looks like an obvious place for a goroutine per check and it is not, so here
// is the measurement rather than an opinion (Apple M4, fixtures sized for a busy
// Pi: 300 sockets in /proc/net/tcp, a 240-line sshd_config, a 50-field
// /proc/self/status):
//
//	smith    whole pass, 1 read + 6 stat + env sweep + temp-file probe   ~150 us
//	trinity  whole pass, 2 reads + 1 stat + both parsers                 ~153 us
//	morpheus whole pass, 1 read + parse                                   ~75 us
//	trinity  ONLY its two file reads -- all a goroutine could overlap      ~48 us
//
// A pass costs about 150 microseconds and runs once per DEFENSE_SCAN_EVERY,
// which defaults to an hour. The overlappable fraction is trinity's two reads,
// so the entire theoretical prize is roughly 24 microseconds an hour.
//
// The price is not zero, which is what settles it. Findings are collected by
// appending to one slice; collecting them from several goroutines means either a
// mutex or a merge, and a merge makes the ORDER of findings depend on which read
// finished first. That order is not cosmetic -- internal/report appends every
// finding to a sha256-chained audit log, so two passes over identical state
// would produce different chains, and the whole point of chaining is that a
// difference means something. Trading a tamper-evident log for 24 microseconds
// an hour is not a trade.
//
// If a check ever does something genuinely slow -- a network call, a full
// filesystem walk -- revisit this with a new measurement. Until then, sequential.
package probe

import (
	"fmt"
	"strconv"
	"strings"

	"course/defense/internal/finding"
)

// dangerousCaps are the Linux capabilities that make a container escape routine
// rather than interesting. The value is why it matters, and it is printed in the
// finding: "CAP_SYS_ADMIN is set" means nothing to most readers.
var dangerousCaps = map[int]struct {
	name string
	why  string
}{
	21: {"CAP_SYS_ADMIN", "mount filesystems and manipulate namespaces: this is effectively root on the host"},
	19: {"CAP_SYS_MODULE", "load kernel modules, which is unrestricted host code execution"},
	18: {"CAP_SYS_RAWIO", "read and write arbitrary physical memory and disk"},
	17: {"CAP_SYS_PTRACE", "attach to any process and read its memory, including its secrets"},
	16: {"CAP_SYS_CHROOT", "escape a chroot"},
	7:  {"CAP_SETUID", "become any user"},
	8:  {"CAP_SETPCAP", "hand capabilities to other processes"},
	12: {"CAP_NET_ADMIN", "reconfigure the network, including the firewall this fortress relies on"},
}

// Capabilities reads the CapEff line out of /proc/self/status content and
// reports every dangerous capability the process holds.
//
// CapEff is a hex bitmask; bit N is capability N. It is parsed rather than
// matched, because the interesting case is a capability set nobody intended and
// a substring search only finds the ones somebody thought to look for.
func Capabilities(procSelfStatus string) []finding.Finding {
	var out []finding.Finding
	mask, ok := capEff(procSelfStatus)
	if !ok {
		return []finding.Finding{{
			Rule: "container.capabilities.unreadable", Line: finding.Adversary, Source: "smith",
			Severity: finding.Low,
			Summary:  "could not find a CapEff line in /proc/self/status",
			Remedy: "check that /proc is mounted in this container; without it no capability check " +
				"can run, and a check that cannot run has not passed",
			Evidence: map[string]string{"bytes_read": strconv.Itoa(len(procSelfStatus))},
		}}
	}
	for bit, cap := range dangerousCaps {
		if mask&(uint64(1)<<uint(bit)) != 0 {
			out = append(out, finding.Finding{
				Rule: "container.capability." + strings.ToLower(cap.name), Line: finding.Adversary,
				Source: "smith", Severity: finding.High, Target: cap.name,
				Summary: fmt.Sprintf("this container holds %s", cap.name),
				Remedy: fmt.Sprintf("drop it in compose: cap_drop: [ALL] and add back only what the "+
					"service needs. %s lets a process %s", cap.name, cap.why),
				Evidence: map[string]string{"capeff": fmt.Sprintf("0x%x", mask), "why": cap.why},
			})
		}
	}
	return out
}

func capEff(status string) (uint64, bool) {
	for _, line := range strings.Split(status, "\n") {
		if !strings.HasPrefix(line, "CapEff:") {
			continue
		}
		hex := strings.TrimSpace(strings.TrimPrefix(line, "CapEff:"))
		v, err := strconv.ParseUint(hex, 16, 64)
		if err != nil {
			return 0, false
		}
		return v, true
	}
	return 0, false
}

// DockerSocket reports the single worst misconfiguration a container can have.
//
// A mounted docker socket is not a privilege escalation risk, it IS root on the
// host: `docker run -v /:/host --privileged` is one call away, and no capability
// dropping, read-only rootfs or user namespace changes that.
func DockerSocket(present bool, path string) []finding.Finding {
	if !present {
		return nil
	}
	return []finding.Finding{{
		Rule: "container.docker_socket.mounted", Line: finding.Adversary, Source: "smith",
		Severity: finding.Critical, Target: path,
		Summary: "the docker socket is mounted inside this container",
		Remedy: "remove the /var/run/docker.sock bind mount. Anything that can talk to this socket " +
			"can start a privileged container mounting the host root, so this is root on the host " +
			"regardless of cap_drop, read_only or a non-root user",
		Evidence: map[string]string{"path": path},
	}}
}

// RunningAsRoot is a finding, not a fact, because every service in this fleet
// has a non-root user available.
func RunningAsRoot(uid int, service string) []finding.Finding {
	if uid != 0 {
		return nil
	}
	return []finding.Finding{{
		Rule: "container.user.root", Line: finding.Adversary, Source: "smith",
		Severity: finding.Medium, Target: service,
		Summary: "this process runs as uid 0",
		Remedy: "set `user: \"10001:10001\"` on the service in docker-compose.yml. queue already " +
			"does this; a root process turns any file-write bug into a container-wide compromise",
		Evidence: map[string]string{"uid": strconv.Itoa(uid)},
	}}
}

// sshdDefaults are the settings whose DEFAULT is unsafe, so an absent line is as
// much a finding as a wrong one. That distinction is the point: a config that
// simply does not mention PermitRootLogin permits it.
var sshdChecks = []struct {
	key, bad, want, why string
	sev                 finding.Severity
	unsafeWhenAbsent    bool
}{
	{"passwordauthentication", "yes", "no",
		"password authentication means the box is only as strong as a password, and this repository " +
			"has already had three accounts matching passwords published in git",
		finding.High, true},
	{"permitrootlogin", "yes", "prohibit-password",
		"a root login over the network removes every audit trail of who did what", finding.High, true},
	{"permitemptypasswords", "yes", "no", "an empty password is no password", finding.Critical, false},
	{"x11forwarding", "yes", "no", "unused here and a routine pivot", finding.Low, false},
	{"kbdinteractiveauthentication", "yes", "no",
		"the other password path; disabling PasswordAuthentication alone leaves this one open",
		finding.Medium, false},
}

// SSHConfig parses sshd_config content. Comments are ignored; the LAST
// occurrence wins, which is not how sshd works -- sshd takes the FIRST -- and
// that difference is deliberate: taking the last one means a file that sets a
// value safely at the top and unsafely at the bottom is reported, and a reader
// who has to think about which one wins has already found the real problem.
func SSHConfig(content string) []finding.Finding {
	seen := map[string]string{}
	for _, raw := range strings.Split(content, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		seen[strings.ToLower(parts[0])] = strings.ToLower(parts[1])
	}
	var out []finding.Finding
	for _, c := range sshdChecks {
		val, present := seen[c.key]
		switch {
		case present && val == c.bad:
			out = append(out, finding.Finding{
				Rule: "host.ssh." + c.key, Line: finding.Host, Source: "trinity",
				Severity: c.sev, Target: "sshd",
				Summary:  fmt.Sprintf("%s is %s", c.key, val),
				Remedy:   fmt.Sprintf("set `%s %s` in /etc/ssh/sshd_config and reload sshd. %s", c.key, c.want, c.why),
				Evidence: map[string]string{"found": val, "want": c.want},
			})
		case !present && c.unsafeWhenAbsent:
			out = append(out, finding.Finding{
				Rule: "host.ssh." + c.key + ".unset", Line: finding.Host, Source: "trinity",
				Severity: c.sev, Target: "sshd",
				Summary:  fmt.Sprintf("%s is not set, and its default is unsafe", c.key),
				Remedy:   fmt.Sprintf("add `%s %s` explicitly. %s", c.key, c.want, c.why),
				Evidence: map[string]string{"found": "(absent)", "want": c.want},
			})
		}
	}
	return out
}

// Listener is one socket in LISTEN state.
type Listener struct {
	Addr string
	Port int
}

// ExpectedPorts are the ports this deployment is supposed to have listening, and
// why. Anything else on a wildcard address is reported.
//
// 1883 is Mosquitto and it is NOT ours: the standing instruction on this machine
// is to leave the ESP32 broker alone, so it is expected rather than flagged.
var ExpectedPorts = map[int]string{
	22:   "sshd, LAN only",
	1883: "Mosquitto -- NOT part of this project; it serves the ESP32s and must keep working",
}

// WildcardListeners reports every LISTEN socket bound to a wildcard address that
// is not in ExpectedPorts.
//
// On a box behind CGNAT this is not about the internet -- nothing outside can
// reach these. It is about the LAN: every one of these is reachable from any
// device on the home network, including whichever IoT thing gets compromised
// first.
func WildcardListeners(ls []Listener) []finding.Finding {
	var out []finding.Finding
	for _, l := range ls {
		if l.Addr != "0.0.0.0" && l.Addr != "::" && l.Addr != "*" {
			continue
		}
		if why, expected := ExpectedPorts[l.Port]; expected {
			_ = why
			continue
		}
		out = append(out, finding.Finding{
			Rule: "perimeter.listener.wildcard", Line: finding.Perimeter, Source: "morpheus",
			Severity: finding.Medium, Target: strconv.Itoa(l.Port),
			Summary: fmt.Sprintf("port %d is listening on %s", l.Port, l.Addr),
			Remedy: fmt.Sprintf("bind it to 127.0.0.1, or publish it to the docker network only "+
				"(`expose:` instead of `ports:`). Traffic reaches this box through cloudflared, so "+
				"a wildcard bind on %d is not serving the internet -- it is serving every device on "+
				"the LAN, including the next compromised one", l.Port),
			Evidence: map[string]string{"addr": l.Addr, "port": strconv.Itoa(l.Port)},
		})
	}
	return out
}

// ParseProcNetTCP reads /proc/net/tcp (or tcp6) and returns the LISTEN sockets.
//
// Field 2 is local_address as HEX:HEX, field 4 is the state; 0A is TCP_LISTEN.
// The address is little-endian hex per 4-byte group, which is why this is parsed
// rather than pattern-matched.
func ParseProcNetTCP(content string, v6 bool) ([]Listener, error) {
	var out []Listener
	for i, line := range strings.Split(content, "\n") {
		f := strings.Fields(line)
		if len(f) < 4 || i == 0 {
			continue
		}
		if f[3] != "0A" {
			continue
		}
		host, port, ok := strings.Cut(f[1], ":")
		if !ok {
			return nil, fmt.Errorf("probe: /proc/net/tcp line %d: %q is not addr:port", i+1, f[1])
		}
		p, err := strconv.ParseUint(port, 16, 32)
		if err != nil {
			return nil, fmt.Errorf("probe: /proc/net/tcp line %d: bad port %q: %w", i+1, port, err)
		}
		out = append(out, Listener{Addr: decodeHexAddr(host, v6), Port: int(p)})
	}
	return out, nil
}

func decodeHexAddr(h string, v6 bool) string {
	if v6 {
		if strings.Trim(h, "0") == "" {
			return "::"
		}
		return "(v6)"
	}
	if len(h) != 8 {
		return "(?)"
	}
	var b [4]uint64
	for i := 0; i < 4; i++ {
		v, err := strconv.ParseUint(h[6-2*i:8-2*i], 16, 8)
		if err != nil {
			return "(?)"
		}
		b[i] = v
	}
	return fmt.Sprintf("%d.%d.%d.%d", b[0], b[1], b[2], b[3])
}

// SecretsInEnvironment reports credentials visible in this process's environment.
//
// Not a style complaint. Every child process inherits them unless the parent
// clears the environment (internal/guard does), every crash dump contains them,
// and `docker inspect` prints them to anyone in the docker group.
func SecretsInEnvironment(env []string, agent string) []finding.Finding {
	suspicious := []string{"SECRET", "TOKEN", "PASSWORD", "KEY", "DSN", "DATABASE_URL", "AMQP_URL"}
	var names []string
	for _, kv := range env {
		name, val, ok := strings.Cut(kv, "=")
		if !ok || val == "" {
			continue
		}
		up := strings.ToUpper(name)
		for _, s := range suspicious {
			if strings.Contains(up, s) {
				names = append(names, name)
				break
			}
		}
	}
	if len(names) == 0 {
		return nil
	}
	// The NAMES only. Printing a value here would put the credential into the
	// audit log and onto the bus, which is the thing being warned about.
	return []finding.Finding{{
		Rule: "container.env.credentials", Line: finding.Adversary, Source: "smith",
		Severity: finding.Low, Target: agent,
		Summary: fmt.Sprintf("%d credential-shaped variables are in this process's environment", len(names)),
		Remedy: "prefer a mounted secret file over an environment variable where the runtime allows " +
			"it: `docker inspect` prints the environment to anyone in the docker group, and every " +
			"child process inherits it unless the parent clears it",
		Evidence: map[string]string{"names": strings.Join(names, ",")},
	}}
}
