// Command smith is line 3: it attacks us.
//
// Smith answers one question and it is deliberately narrow: IF SOMEBODY IS
// ALREADY INSIDE THIS CONTAINER, what do they get? Not "are there CVEs in the
// dependency tree" -- that is a build-time question and CI already owns it -- but
// what the blast radius of a foothold actually is on the box as it runs.
//
// Everything here is a check on the process's OWN container, so Smith needs no
// credentials, no host mounts and no network. That is the point: the agent that
// looks for holes is the one you least want to give power to.
package main

import (
	"context"
	"os"

	"course/security/internal/agent"
	"course/security/internal/finding"
	"course/security/internal/probe"
)

func main() { os.Exit(agent.Run("smith", scan)) }

func scan(_ context.Context) []finding.Finding {
	var out []finding.Finding

	// Capabilities. Read from /proc rather than inferred from the compose file,
	// because the compose file is what somebody INTENDED and /proc is what the
	// kernel actually granted.
	status, miss := agent.ReadOrReport("/proc/self/status", "container.capabilities",
		finding.Adversary, "smith")
	if miss != nil {
		out = append(out, *miss)
	} else {
		out = append(out, probe.Capabilities(status)...)
	}

	// The docker socket. One check, and it outranks everything else here.
	sock := "/var/run/docker.sock"
	_, err := os.Stat(sock)
	out = append(out, probe.DockerSocket(err == nil, sock)...)

	out = append(out, probe.RunningAsRoot(os.Getuid(), "smith")...)
	out = append(out, probe.SecretsInEnvironment(os.Environ(), "smith")...)

	// A shell in the image. The defense images are built FROM scratch, so
	// finding an interpreter here means the build changed and every "there is
	// nothing to exec" argument in internal/guard just got weaker.
	for _, sh := range []string{"/bin/sh", "/bin/bash", "/bin/busybox", "/usr/bin/env"} {
		if _, err := os.Stat(sh); err == nil {
			out = append(out, finding.Finding{
				Rule: "container.shell.present", Line: finding.Adversary, Source: "smith",
				Severity: finding.Medium, Target: sh,
				Summary: "this image contains an interpreter at " + sh,
				Remedy: "the defense images are built FROM scratch precisely so that a foothold has " +
					"nothing to exec. If this appeared, the Dockerfile changed: check that the " +
					"final stage is still `FROM scratch` and copies only the binary",
				Evidence: map[string]string{"path": sh},
			})
		}
	}

	// A writable root filesystem. `read_only: true` in compose is what turns a
	// path-traversal write into an error instead of a persistent backdoor.
	if f, err := os.CreateTemp("/", ".defense-writable-probe-"); err == nil {
		name := f.Name()
		f.Close()
		os.Remove(name)
		out = append(out, finding.Finding{
			Rule: "container.rootfs.writable", Line: finding.Adversary, Source: "smith",
			Severity: finding.Medium, Target: "/",
			Summary: "the root filesystem of this container is writable",
			Remedy: "set `read_only: true` on the service and give it a tmpfs for the paths it " +
				"genuinely writes. A writable rootfs is what turns a single file-write bug into " +
				"something that survives a restart",
			Evidence: map[string]string{"probe": "created and removed a file at /"},
		})
	}
	return out
}
