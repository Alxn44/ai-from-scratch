// Package policy is the leash.
//
// WHY THIS PACKAGE EXISTS, stated plainly: Neo is the only agent with the power
// to change the running system, and everything Neo reacts to is written by the
// attacker. Request paths, user agents, usernames, log lines, JSON bodies -- all
// of it is text somebody else chose. An agent that reads attacker-controlled
// text and then runs a command is not a defence, it is a remote code execution
// primitive with extra steps.
//
// So the power is bounded by construction, not by good intentions:
//
//  1. NOTHING RUNS THAT IS NOT IN THE TABLE. There is no generic "run this
//     command" action. Every action is a named Kind with a hand-written argv
//     builder, so an attacker who fully controls a finding can at most pick
//     which of these few things happens, to a target that has been validated.
//  2. NO SHELL, EVER. Argv is a []string handed to exec without an interpreter.
//     There is no string to inject into.
//  3. EVERY ACTION EXPIRES. MaxTTL is required to be > 0 for every rule and
//     that is asserted by Verify(). A block with no expiry is a permanent
//     self-inflicted outage waiting for the one time the detection is wrong.
//  4. IRREVERSIBLE MEANS A HUMAN. A rule that cannot be undone must set
//     NeedsHuman, and Verify() refuses the table otherwise.
//  5. RATE LIMITS, PER KIND AND GLOBAL. The global cap is the one that matters:
//     it is what turns "attacker triggers 10,000 detections" into ten actions
//     and then an escalation, instead of ten thousand nftables rules.
//  6. A NEVER-TOUCH SET. Some targets are load-bearing and blocking them is
//     self-DoS. See NeverTouch.
//  7. PROPOSE IS THE DEFAULT. Enforcement is opt-in per deployment. A fortress
//     whose gate closes on its own residents is not a fortress.
package policy

import (
	"errors"
	"fmt"
	"net"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Kind is one thing Neo may do. There is deliberately no Kind meaning "run a
// command": see the header.
type Kind string

const (
	// RevokeSession invalidates one session server-side. On this deployment it
	// is the MOST effective action available and the least dangerous: the
	// blast radius is one login, and the user recovers by logging in again.
	RevokeSession Kind = "revoke_session"

	// ThrottleIdentity clamps one account's request rate. Reversible, expires,
	// and it degrades an attacker's throughput without locking anyone out.
	ThrottleIdentity Kind = "throttle_identity"

	// BlockEdge asks Cloudflare to block a source AT THE EDGE.
	//
	// This is where IP blocking belongs on this topology and the reason is
	// concrete: the Pi is behind CGNAT, so every request arrives through
	// cloudflared and the source address the application observes is
	// cloudflared's own address on the docker network. A host firewall rule
	// against "the attacker's IP" would either match nothing or match the
	// tunnel and take the whole site down. The edge is the only place that can
	// still see the real client.
	BlockEdge Kind = "block_edge"

	// QuarantineContainer disconnects one container from its network while
	// LEAVING IT RUNNING. Killing a compromised container destroys the memory
	// state that says what happened; disconnecting it stops the bleeding and
	// keeps the evidence.
	QuarantineContainer Kind = "quarantine_container"

	// BanHostIP is an nftables drop on the Pi itself, with a kernel-side
	// timeout. It is only meaningful for a source on the LAN -- something on
	// the home network probing the Pi directly -- because internet traffic
	// never arrives that way. Kept for that case and no other.
	BanHostIP Kind = "ban_host_ip"
)

// Mode decides whether Neo may act at all.
//
// Propose is the default and Enforce is opt-in, per deployment, by an explicit
// environment variable. The reasoning is not timidity: this whole subsystem is
// new, its detections are unproven against real traffic, and the cost asymmetry
// is severe. A missed containment costs one incident handled by a human minutes
// later. A false containment in Enforce mode takes the site down, and it does so
// at exactly the moment somebody is attacking it, which is the worst possible
// time to be debugging your own defences.
type Mode string

const (
	// Propose: evaluate everything, act on nothing, escalate with the exact
	// argv that WOULD have run. That last part is what makes Propose worth
	// running -- an escalation nobody can act on is a log line.
	Propose Mode = "propose"
	// Enforce: act, within every limit in this file.
	Enforce Mode = "enforce"
)

// ParseMode refuses an unknown mode. Defaulting an unrecognised value to
// Enforce would be catastrophic and defaulting it to Propose would silently
// disable a fortress somebody believed they had turned on, so neither.
func ParseMode(s string) (Mode, error) {
	switch Mode(strings.ToLower(strings.TrimSpace(s))) {
	case Propose:
		return Propose, nil
	case Enforce:
		return Enforce, nil
	case "":
		return Propose, nil
	}
	return "", fmt.Errorf("policy: unknown mode %q (want %q or %q)", s, Propose, Enforce)
}

// Rate is a cap: at most Max actions per Window.
type Rate struct {
	Max    int
	Window time.Duration
}

// Rule describes one action completely. Everything Verify() checks is here, so
// adding an action and declaring its limits happen in the same diff.
type Rule struct {
	Kind Kind
	// What it does, for the escalation a human reads.
	What string
	// Reversible: can this be undone by a command, without data loss?
	Reversible bool
	// MaxTTL bounds how long the effect may last. Required > 0 for every rule.
	MaxTTL time.Duration
	// NeedsHuman forces an escalation instead of an action, always.
	NeedsHuman bool
	// Limit is the per-kind rate cap.
	Limit Rate
	// Validate checks the target and returns it normalised, or an error. It is
	// the ONLY place a target from a finding is allowed to become an argument.
	Validate func(target string) (string, error)
	// Argv builds the exact process to run. No shell, no string concatenation
	// into a command line. nil means the action is not executed by Neo at all
	// but handed to another service (see RevokeSession).
	Argv func(target string, ttl time.Duration) ([]string, error)
	// Undo builds the process that reverses it, for the audit trail and for a
	// human copy-pasting a rollback. Required when Reversible is true.
	Undo func(target string) ([]string, error)
}

// GlobalLimit is the cap across ALL kinds together.
//
// This is the single most important number in the package. Per-kind limits stop
// one detection from looping; only a global cap stops an attacker who can
// trigger MANY DIFFERENT detections from using Neo as an amplifier. Ten actions
// in ten minutes is far more than a real incident needs -- a real incident is
// one or two actions and a human -- and small enough that the worst an attacker
// gets out of a fully compromised detection layer is ten reversible, expiring
// changes and a loud escalation.
var GlobalLimit = Rate{Max: 10, Window: 10 * time.Minute}

// Every target pattern below REQUIRES an alphanumeric first character, and that
// is not tidiness. A value beginning with `-` is read by almost every command
// line parser as an OPTION rather than an operand, so a target of
// `--privileged` or `-o ProxyCommand=…` is argument injection even though it
// contains no shell metacharacter and passes every «no semicolons» check. Two of
// these targets do not currently reach an argv at all -- a session is revoked by
// the api -- and the rule is applied to all of them anyway, because «this string
// never becomes an argument» is a property that holds until somebody adds an
// action, and it fails silently when it stops holding.
var containerName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$`)
var sessionID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$`)
var identity = regexp.MustCompile(`^[0-9]{1,19}$`)

// Rules is the table. Ordered by how safe the action is, safest first, which is
// also the order a responder should prefer.
func Rules() []Rule {
	return []Rule{
		{
			Kind:       RevokeSession,
			What:       "invalidate one session server-side; the person logs in again",
			Reversible: true,
			MaxTTL:     24 * time.Hour,
			Limit:      Rate{Max: 20, Window: 10 * time.Minute},
			Validate:   validateSession,
			// No Argv: Neo does not reach into the database. It publishes the
			// request on the bus and the api applies it with its own
			// credentials. Two reasons, both concrete: the defense containers
			// have no DATABASE_URL and must not get one, and the api already
			// owns session invalidation, so a second implementation would be a
			// second thing to keep correct.
			Argv: nil,
			Undo: nil, // a revoked session is re-created by logging in
		},
		{
			Kind:       ThrottleIdentity,
			What:       "clamp one account's request rate",
			Reversible: true,
			MaxTTL:     6 * time.Hour,
			Limit:      Rate{Max: 20, Window: 10 * time.Minute},
			Validate:   validateIdentity,
			Argv:       nil, // applied by the api, same reasoning as above
			Undo:       nil,
		},
		{
			Kind:       BlockEdge,
			What:       "block a source at the Cloudflare edge, where the real client IP is still visible",
			Reversible: true,
			MaxTTL:     12 * time.Hour,
			Limit:      Rate{Max: 6, Window: 10 * time.Minute},
			Validate:   validatePublicIP,
			Argv:       nil, // an API call, made by Neo's edge client, not a process
			Undo:       nil,
		},
		{
			Kind:       QuarantineContainer,
			What:       "disconnect a container from the network, leaving it running so the evidence survives",
			Reversible: true,
			MaxTTL:     2 * time.Hour,
			Limit:      Rate{Max: 2, Window: 10 * time.Minute},
			Validate:   validateContainer,
			Argv: func(target string, _ time.Duration) ([]string, error) {
				return []string{"docker", "network", "disconnect", "-f", "app_default", target}, nil
			},
			Undo: func(target string) ([]string, error) {
				return []string{"docker", "network", "connect", "app_default", target}, nil
			},
		},
		{
			Kind:       BanHostIP,
			What:       "drop traffic from one LAN address at the Pi's own firewall, with a kernel-side timeout",
			Reversible: true,
			MaxTTL:     1 * time.Hour,
			Limit:      Rate{Max: 4, Window: 10 * time.Minute},
			Validate:   validateBannableHostIP,
			Argv: func(target string, ttl time.Duration) ([]string, error) {
				// A kernel timeout, not a timer in this process. If Neo is
				// killed between adding the rule and removing it, an in-process
				// timer dies with it and the ban becomes permanent -- which is
				// the exact failure mode rule 3 in the header exists to stop.
				return []string{
					"nft", "add", "element", "inet", "defense", "banned",
					fmt.Sprintf("{ %s timeout %ds }", target, int(ttl.Seconds())),
				}, nil
			},
			Undo: func(target string) ([]string, error) {
				return []string{"nft", "delete", "element", "inet", "defense", "banned",
					fmt.Sprintf("{ %s }", target)}, nil
			},
		},
	}
}

// ByKind indexes the table.
func ByKind() map[Kind]Rule {
	out := make(map[Kind]Rule)
	for _, r := range Rules() {
		out[r.Kind] = r
	}
	return out
}

// ---------------------------------------------------------------------------
// NEVER TOUCH
//
// Every entry here is a concrete outage this list prevents, not a category.

// neverTouchNets are addresses no action may target.
var neverTouchNets = func() []*net.IPNet {
	cidrs := []string{
		"127.0.0.0/8", "::1/128", // ourselves
		"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", // the LAN and every docker bridge
		"100.64.0.0/10", // CGNAT: the Pi's own upstream address lives here
		"169.254.0.0/16", "fe80::/10",
	}
	out := make([]*net.IPNet, 0, len(cidrs))
	for _, c := range cidrs {
		_, n, err := net.ParseCIDR(c)
		if err != nil {
			panic("policy: bad never-touch CIDR " + c) // a typo here is a security hole
		}
		out = append(out, n)
	}
	return out
}()

// neverTouchContainers are containers whose removal from the network takes the
// site down harder than most attacks would.
//
//	cloudflared  the ONLY ingress. Quarantining it is a total outage.
//	db           quarantining Postgres fails every request in flight.
//	broker       quarantining RabbitMQ silently converts every async job into a
//	             dropped message, which looks like data loss, not an outage.
//	mosquitto    not ours. It serves the ESP32s on the LAN and the standing
//	             instruction on this machine is to leave it alone.
var neverTouchContainers = map[string]string{
	"cloudflared": "the only ingress; quarantining it is a total outage",
	"db":          "Postgres; every in-flight request fails",
	"broker":      "RabbitMQ; async work is dropped, which reads as data loss",
	"mosquitto":   "not part of this project -- it serves the ESP32s on the LAN",
	"init":        "the migration job; interrupting it can leave a partial schema",
}

// ErrNeverTouch is a refusal, not a failure. It is reported as a decision so the
// escalation says «I would have done X and I am not allowed to», which is the
// sentence that tells a human the detection fired.
var ErrNeverTouch = errors.New("target is on the never-touch list")

func validatePublicIP(target string) (string, error) {
	ip := net.ParseIP(strings.TrimSpace(target))
	if ip == nil {
		return "", fmt.Errorf("policy: %q is not an IP address", target)
	}
	for _, n := range neverTouchNets {
		if n.Contains(ip) {
			return "", fmt.Errorf("%w: %s is inside %s, and on this deployment every request "+
				"arrives through cloudflared, so a private source address is the TUNNEL, "+
				"not an attacker", ErrNeverTouch, ip, n)
		}
	}
	return ip.String(), nil
}

func validateBannableHostIP(target string) (string, error) {
	ip := net.ParseIP(strings.TrimSpace(target))
	if ip == nil {
		return "", fmt.Errorf("policy: %q is not an IP address", target)
	}
	if ip.IsLoopback() || ip.IsUnspecified() {
		return "", fmt.Errorf("%w: %s is ourselves", ErrNeverTouch, ip)
	}
	// The inverse of validatePublicIP on purpose: this action exists ONLY for
	// LAN sources, because internet traffic never reaches the host directly.
	if !ip.IsPrivate() && !ip.IsLinkLocalUnicast() {
		return "", fmt.Errorf("policy: %s is a public address; block it at the edge "+
			"(%s) -- a host rule cannot see it, because traffic arrives through the tunnel",
			ip, BlockEdge)
	}
	return ip.String(), nil
}

func validateContainer(target string) (string, error) {
	t := strings.TrimSpace(target)
	if !containerName.MatchString(t) {
		return "", fmt.Errorf("policy: %q is not a container name", target)
	}
	if why, bad := neverTouchContainers[t]; bad {
		return "", fmt.Errorf("%w: %s -- %s", ErrNeverTouch, t, why)
	}
	return t, nil
}

func validateSession(target string) (string, error) {
	t := strings.TrimSpace(target)
	if !sessionID.MatchString(t) {
		return "", fmt.Errorf("policy: %q is not a session id", target)
	}
	return t, nil
}

func validateIdentity(target string) (string, error) {
	t := strings.TrimSpace(target)
	if !identity.MatchString(t) {
		return "", fmt.Errorf("policy: %q is not a numeric user id", target)
	}
	return t, nil
}

// ---------------------------------------------------------------------------
// VERIFY: the table's own invariants, asserted rather than documented.

// Verify checks every rule against the promises in this file's header. It is
// wired into `defense verify` and into the test suite, so a new action cannot be
// added without declaring its limits.
func Verify() []error {
	var errs []error
	seen := map[Kind]bool{}
	for _, r := range Rules() {
		if r.Kind == "" {
			errs = append(errs, errors.New("policy: a rule with no Kind"))
			continue
		}
		if seen[r.Kind] {
			errs = append(errs, fmt.Errorf("policy: %s declared twice; ByKind() would silently keep one", r.Kind))
		}
		seen[r.Kind] = true
		if r.MaxTTL <= 0 {
			errs = append(errs, fmt.Errorf("policy: %s has no MaxTTL. Every action must expire: "+
				"an effect that outlives the process that created it becomes permanent the first "+
				"time the detection is wrong", r.Kind))
		}
		if !r.Reversible && !r.NeedsHuman {
			errs = append(errs, fmt.Errorf("policy: %s is irreversible and does not require a human", r.Kind))
		}
		if r.Reversible && r.Argv != nil && r.Undo == nil {
			errs = append(errs, fmt.Errorf("policy: %s claims to be reversible and runs a command, "+
				"but declares no Undo. «Reversible» with no rollback is a hope", r.Kind))
		}
		if r.Limit.Max <= 0 || r.Limit.Window <= 0 {
			errs = append(errs, fmt.Errorf("policy: %s has no rate limit", r.Kind))
		}
		if r.Limit.Max > GlobalLimit.Max*4 {
			errs = append(errs, fmt.Errorf("policy: %s allows %d per %s, which is far above the "+
				"global cap of %d per %s and makes the per-kind limit decorative",
				r.Kind, r.Limit.Max, r.Limit.Window, GlobalLimit.Max, GlobalLimit.Window))
		}
		if r.Validate == nil {
			errs = append(errs, fmt.Errorf("policy: %s has no target validation, so a target from "+
				"an attacker-authored finding would reach an argument list unchecked", r.Kind))
		}
		if strings.TrimSpace(r.What) == "" {
			errs = append(errs, fmt.Errorf("policy: %s has no description for the escalation a human reads", r.Kind))
		}
		if err := verifyArgvIsNotAShell(r); err != nil {
			errs = append(errs, err)
		}
	}
	if GlobalLimit.Max <= 0 || GlobalLimit.Window <= 0 {
		errs = append(errs, errors.New("policy: GlobalLimit is not set; nothing bounds an action storm"))
	}
	return errs
}

// shellNames are interpreters. An argv whose program is one of these means the
// rest of the argv is a PROGRAM, and everything this package promises about
// injection stops being true.
var shellNames = map[string]bool{
	"sh": true, "bash": true, "zsh": true, "dash": true, "ash": true, "ksh": true,
	"env": true, "eval": true, "python": true, "python3": true, "perl": true,
	"ruby": true, "node": true, "docker-entrypoint.sh": true, "xargs": true,
}

// verifyArgvIsNotAShell runs each builder with a benign target and checks that
// the program is not an interpreter.
//
// It is a real call rather than a code inspection because a builder can choose
// its program at runtime, and the thing worth asserting is what comes out.
func verifyArgvIsNotAShell(r Rule) error {
	if r.Argv == nil {
		return nil
	}
	for _, probe := range []string{"probe", "10.0.0.1"} {
		argv, err := r.Argv(probe, time.Minute)
		if err != nil {
			continue
		}
		if len(argv) == 0 {
			return fmt.Errorf("policy: %s built an empty argv", r.Kind)
		}
		prog := argv[0]
		if i := strings.LastIndexByte(prog, '/'); i >= 0 {
			prog = prog[i+1:]
		}
		if shellNames[prog] {
			return fmt.Errorf("policy: %s runs %q, which is an interpreter. Every promise this "+
				"package makes about injection depends on argv NOT being a program", r.Kind, argv[0])
		}
		if strings.ContainsAny(prog, ";|&$`><\n") {
			return fmt.Errorf("policy: %s program %q contains shell metacharacters", r.Kind, argv[0])
		}
	}
	return nil
}

// Kinds lists the action names, sorted, for help text and for the escalation
// payload.
func Kinds() []string {
	out := make([]string, 0, len(Rules()))
	for _, r := range Rules() {
		out = append(out, string(r.Kind))
	}
	sort.Strings(out)
	return out
}
