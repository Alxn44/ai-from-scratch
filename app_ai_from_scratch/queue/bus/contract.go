package bus

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// ---------------------------------------------------------------------------
// THE CROSS-RUNTIME CHECK.
//
// This package is the THIRD implementation of one contract. api/src/bus.ts and
// ai/src/course_ai/bus.py already say, in their own headers, that they "must stay
// readable as one document, because the two runtimes read each other's
// messages". Adding a third copy of the numbers without a check would be adding
// a third place for them to drift -- and drift here is silent: a service that
// thinks the ceiling is 5 attempts and one that thinks it is 6 do not disagree
// out loud, they just dead-letter at different moments.
//
// So the numbers are READ back out of the two sibling files and compared.
//
// WHY THIS IS A READER OVER SOURCE, and what that costs. ai/README.md is blunt
// about the failure mode: "The reader it replaced was a regex over source
// formatting and it broke twice... both times it correctly refused to compare,
// and both times the check sat dark until somebody noticed." The lesson taken
// from that is not "never read source", it is "refusing to compare must be a
// FAILURE, not a pass". Every lookup here returns an error naming the constant
// and the file when it cannot find it, and `queue-verify` treats that error the
// same way it treats a mismatch. A check that cannot see anything reports red.
//
// The alternative -- executing node and uv to ask them -- was rejected because
// it makes a Go unit test depend on two other toolchains being installed, and a
// gate that cannot run is a gate that gets skipped.

// SiblingContract is what the two other runtimes say the contract is.
type SiblingContract struct {
	// File is the path the values were read from, so a failure names it.
	File           string
	BaseDelayMS    int
	DelayFactor    int
	DelayCapMS     int
	MaxAttempts    int
	Persistent     int
	EnvelopeFields []string
	ReconnectMS    []int
	Exchange       string
}

// FindSiblingRoot walks up from start looking for the directory that holds both
// sibling bus implementations.
//
// It returns an error rather than a best guess: a caller that got a wrong
// directory would report "contract verified" over files that are not the ones
// the fleet runs.
func FindSiblingRoot(start string) (string, error) {
	dir, err := filepath.Abs(start)
	if err != nil {
		return "", err
	}
	for {
		ts := filepath.Join(dir, "api", "src", "bus.ts")
		py := filepath.Join(dir, "ai", "src", "course_ai", "bus.py")
		tsOK := fileExists(ts)
		pyOK := fileExists(py)
		if tsOK && pyOK {
			return dir, nil
		}
		if tsOK != pyOK {
			// One of the two moved. That is exactly the situation where a
			// silent "not found, carry on" would hide a real rename.
			missing := ts
			if tsOK {
				missing = py
			}
			return "", fmt.Errorf("found one sibling bus but not the other under %s: %s is missing", dir, missing)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("no directory above %s contains both api/src/bus.ts and ai/src/course_ai/bus.py", start)
		}
		dir = parent
	}
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

// ReadSiblings reads both sibling contracts from a repository root.
func ReadSiblings(root string) ([]SiblingContract, error) {
	paths := []string{
		filepath.Join(root, "api", "src", "bus.ts"),
		filepath.Join(root, "ai", "src", "course_ai", "bus.py"),
	}
	out := make([]SiblingContract, 0, len(paths))
	for _, p := range paths {
		c, err := readSibling(p)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

func readSibling(path string) (SiblingContract, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return SiblingContract{}, fmt.Errorf("cannot read the sibling contract %s: %w", path, err)
	}
	src := string(raw)
	c := SiblingContract{File: path}

	for _, f := range []struct {
		name string
		dst  *int
	}{
		{"BASE_DELAY_MS", &c.BaseDelayMS},
		{"DELAY_FACTOR", &c.DelayFactor},
		{"DELAY_CAP_MS", &c.DelayCapMS},
		{"MAX_ATTEMPTS", &c.MaxAttempts},
		{"PERSISTENT", &c.Persistent},
	} {
		v, err := readIntConst(src, f.name)
		if err != nil {
			return SiblingContract{}, fmt.Errorf("%s: %w", path, err)
		}
		*f.dst = v
	}

	if c.EnvelopeFields, err = readStringList(src, "ENVELOPE_FIELDS"); err != nil {
		return SiblingContract{}, fmt.Errorf("%s: %w", path, err)
	}
	if c.ReconnectMS, err = readIntList(src, "RECONNECT_MS"); err != nil {
		return SiblingContract{}, fmt.Errorf("%s: %w", path, err)
	}
	// The default exchange name. A mismatch here does not error anywhere: it
	// silently splits the fleet across two exchanges, and every publish looks
	// confirmed while nothing consumes it.
	ex := regexp.MustCompile(`BUS_EXCHANGE[^\n]*?["']([A-Za-z0-9._-]+)["']`).FindStringSubmatch(src)
	if ex == nil {
		return SiblingContract{}, fmt.Errorf("%s: cannot find the BUS_EXCHANGE default", path)
	}
	c.Exchange = ex[1]
	return c, nil
}

// readIntConst finds `NAME = 1_000` in either runtime's syntax: with or without
// `export const`, with or without a type annotation, with or without numeric
// underscores.
func readIntConst(src, name string) (int, error) {
	re := regexp.MustCompile(`(?m)^(?:export\s+)?(?:const\s+)?` + regexp.QuoteMeta(name) +
		`(?:\s*:\s*[^=\n]+?)?\s*=\s*([0-9_]+)`)
	m := re.FindStringSubmatch(src)
	if m == nil {
		return 0, fmt.Errorf("cannot find the constant %s -- refusing to report a verified contract", name)
	}
	n, err := strconv.Atoi(strings.ReplaceAll(m[1], "_", ""))
	if err != nil {
		return 0, fmt.Errorf("%s is not an integer: %q", name, m[1])
	}
	return n, nil
}

// bracketed returns the text between the first bracket after `NAME =` and its
// match, handling both `[...]` and `(...)`.
func bracketed(src, name string) (string, error) {
	re := regexp.MustCompile(`(?m)^(?:export\s+)?(?:const\s+)?` + regexp.QuoteMeta(name) +
		`(?:\s*:\s*[^=\n]+?)?\s*=\s*([\[(])`)
	m := re.FindStringSubmatchIndex(src)
	if m == nil {
		return "", fmt.Errorf("cannot find %s -- refusing to report a verified contract", name)
	}
	open := src[m[2]]
	closing := byte(']')
	if open == '(' {
		closing = ')'
	}
	start := m[2] + 1
	depth := 1
	for i := start; i < len(src); i++ {
		switch src[i] {
		case open:
			depth++
		case closing:
			depth--
			if depth == 0 {
				return src[start:i], nil
			}
		}
	}
	return "", fmt.Errorf("%s is never closed", name)
}

func readStringList(src, name string) ([]string, error) {
	body, err := bracketed(src, name)
	if err != nil {
		return nil, err
	}
	found := regexp.MustCompile(`["']([^"']+)["']`).FindAllStringSubmatch(body, -1)
	if len(found) == 0 {
		return nil, fmt.Errorf("%s holds no strings", name)
	}
	out := make([]string, 0, len(found))
	for _, f := range found {
		out = append(out, f[1])
	}
	return out, nil
}

func readIntList(src, name string) ([]int, error) {
	body, err := bracketed(src, name)
	if err != nil {
		return nil, err
	}
	found := regexp.MustCompile(`[0-9][0-9_]*`).FindAllString(body, -1)
	if len(found) == 0 {
		return nil, fmt.Errorf("%s holds no numbers", name)
	}
	out := make([]int, 0, len(found))
	for _, f := range found {
		n, err := strconv.Atoi(strings.ReplaceAll(f, "_", ""))
		if err != nil {
			return nil, fmt.Errorf("%s holds %q, which is not an integer", name, f)
		}
		out = append(out, n)
	}
	return out, nil
}

// VerifyContract compares this package's constants against both siblings and
// returns one line per disagreement. An empty slice means they agree.
//
// It takes the repository root rather than finding it, so the caller decides
// what "cannot even locate the siblings" means -- and every caller in this
// service decides it means failure.
func VerifyContract(root string) ([]string, error) {
	siblings, err := ReadSiblings(root)
	if err != nil {
		return nil, err
	}
	var faults []string
	for _, s := range siblings {
		where := filepath.Base(filepath.Dir(s.File))
		cmp := func(what string, mine, theirs any) {
			if fmt.Sprint(mine) != fmt.Sprint(theirs) {
				faults = append(faults, fmt.Sprintf("%s: %s is %v here and %v in %s",
					where, what, mine, theirs, s.File))
			}
		}
		cmp("BASE_DELAY_MS", BaseDelayMS, s.BaseDelayMS)
		cmp("DELAY_FACTOR", DelayFactor, s.DelayFactor)
		cmp("DELAY_CAP_MS", DelayCapMS, s.DelayCapMS)
		cmp("MAX_ATTEMPTS", MaxAttempts, s.MaxAttempts)
		cmp("PERSISTENT", PersistentDeliveryMode, s.Persistent)
		cmp("ENVELOPE_FIELDS", strings.Join(EnvelopeFields, ","), strings.Join(s.EnvelopeFields, ","))
		cmp("BUS_EXCHANGE default", DefaultExchange, s.Exchange)

		mine := make([]int, 0, len(ReconnectMS))
		for _, d := range ReconnectMS {
			mine = append(mine, int(d.Milliseconds()))
		}
		cmp("RECONNECT_MS", fmt.Sprint(mine), fmt.Sprint(s.ReconnectMS))
	}
	return faults, nil
}

// DefaultExchange is the topic exchange the whole fleet binds to. It has a
// default because it is a NAME, not a credential -- and because all three
// runtimes must agree on it even when nobody sets the variable.
const DefaultExchange = "course.events"
