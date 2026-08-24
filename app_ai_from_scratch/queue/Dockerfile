# ---------------------------------------------------------------------------
# build: the Go toolchain lives HERE and only here.
#
# Same reasoning as api/Dockerfile: the runtime image must not carry a compiler.
# A compiler in a production image turns any code-execution bug into a build
# environment, and it is dead weight in every pull.
#
# The dependency layer is separated from the source layer so that editing a .go
# file does not re-download the module graph.
# ---------------------------------------------------------------------------
FROM golang:1.26-alpine AS build

WORKDIR /src

# CGO off is what makes the binary static, and static is what makes the runtime
# stage able to be `scratch`. It also removes the libc of the build image from
# the set of things that can differ between build and run.
ENV CGO_ENABLED=0 GOOS=linux

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal
# bus/ and broker/ are NOT under internal/, and that is load-bearing: Go's
# internal rule is directory-scoped, so course/defense could not import them
# from there. Moving them out is what lets the defense fleet reuse this
# envelope instead of writing a fourth copy of the wire format.
COPY bus ./bus
COPY broker ./broker

# The gate runs at BUILD TIME, the way ai/Dockerfile runs ai-prove-isolation:
# if the contract with api/src/bus.ts and ai/src/course_ai/bus.py has drifted, or
# a test fails, the image is not built. Failing here is cheaper than failing in
# production.
#
# NOT included: `queue-topology contract`. It reads ../api and ../ai, which are
# outside this build context on purpose -- a service image must not need its
# siblings' source to build. That check runs in `queue-verify` on a developer
# machine and in CI, where the whole repository is present. Saying so here so
# nobody later believes the image proves something it cannot.
RUN go vet ./... && go test ./... -count=1

ARG VERSION=dev
# -w -s strip the DWARF tables and the symbol table: a smaller binary, and one
# less thing to hand a reader of the image.
RUN go build -trimpath -ldflags "-w -s -X main.version=${VERSION}" -o /out/queue ./cmd/queue \
 && go build -trimpath -ldflags "-w -s" -o /out/queue-topology ./cmd/queue-topology

# ---------------------------------------------------------------------------
# runtime: scratch.
#
# No shell, no package manager, no compiler, no libc. There is nothing in this
# image but two static binaries and a CA bundle, so an RCE lands in a filesystem
# with nothing to run and nothing to write -- the same argument api/Dockerfile
# makes by keeping /app root-owned, taken as far as it goes.
#
# The cost, stated: `docker exec` into this container gets you nothing, because
# there is no /bin/sh. Debugging is `docker logs` and the HTTP surface. That is a
# deliberate trade and the reason `queue healthcheck` exists as a subcommand of
# the binary itself -- a scratch image has no curl and no wget, so a shell-based
# HEALTHCHECK could never run, and a healthcheck that cannot run is a container
# that is never reported unhealthy.
# ---------------------------------------------------------------------------
FROM scratch

# Needed only if BUS_CLAIM_URL is ever https. Copied rather than omitted because
# discovering its absence would look like a network fault.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

COPY --from=build /out/queue /queue
COPY --from=build /out/queue-topology /queue-topology

# Drop root. A numeric uid:gid needs no /etc/passwd entry -- the kernel enforces
# ownership by number, and nothing in this binary looks a user name up. 10001 is
# the same fixed uid ai/Dockerfile pins, for the same reason: stable ownership if
# a volume is ever mounted here.
USER 10001:10001

ENV PORT=8790
EXPOSE 8790

# The binary probes itself. Exits non-zero unless /health answers 200, which it
# only does when the broker connection is actually up -- so a broker outage shows
# as an unhealthy container instead of a green one.
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD ["/queue", "healthcheck"]

ENTRYPOINT ["/queue"]
