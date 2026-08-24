# ---------------------------------------------------------------------------
# build: NATIVE to the builder, CROSS-COMPILED to the target.
#
# `--platform=$BUILDPLATFORM` pins this stage to the machine building (amd64 on a
# GitHub runner) and `GOARCH=$TARGETARCH` picks the machine that will run it
# (arm64 on a Raspberry Pi 4B). Without it, buildx produces the arm64 image by
# running the arm64 Go toolchain under QEMU, which for a Go build buys nothing at
# all and costs tens of minutes.
#
# The consequence, stated: a cross-compiled test binary cannot execute here, so
# `go test` runs in its own stage on the builder's architecture. Everything under
# test in this service is a parser, a validator or a policy table -- nothing
# architecture-dependent -- so testing on amd64 and shipping arm64 is sound. If
# something here ever becomes arch-dependent it has to be tested where it can
# run, and this comment is where that promise is recorded.
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build

ARG TARGETOS
ARG TARGETARCH
ENV CGO_ENABLED=0

# The build context is app_ai_from_scratch/, NOT data/, because this image needs
# api/src/ontologia.json and Docker cannot COPY from outside its context. Same
# arrangement as defense/Dockerfile; the root .dockerignore is an allowlist that
# keeps the context to the directories actually involved.
WORKDIR /src/data
COPY data/go.mod data/go.sum ./
RUN go mod download

COPY data/internal ./internal
COPY data/cmd ./cmd

# The ontology artefact is COPIED IN, not fetched and not re-derived.
#
# It is generated from ai/src/course_ai/ontology/data.py by `ai-export`, and CI
# already fails when the committed copy is stale. Baking it into the image means
# the running service and the image that passed the gate are checking against
# the same bytes -- a service that read it from a mounted volume could be started
# against yesterday's declaration while the build proved today's.
#
COPY api/src/ontologia.json /etc/data/ontologia.json

# ---------------------------------------------------------------------------
# test + verify. `data verify` is the one that matters: it asserts that no
# agent-facing operation returns a column the ontology classes jamas, that every
# parameter is bounded, that every scoped read filters on the actor, and that no
# caller-supplied parameter names a person. An image that violates any of those
# is not built.
#
# It needs no database, which is the point: the safety invariants are checkable
# in a build container, not only where the data lives.
# ---------------------------------------------------------------------------
FROM build AS test
# The artefact's path is given to the WHOLE stage, not just to `data verify`. The
# ontology tests resolve it through guard.FindForTests, which honours this
# variable first and only falls back to walking the source tree -- and inside this
# image there is no source tree above /src/data to walk. Without this line every
# ontology test failed here while passing on a laptop, and the failure read as a
# broken guard rather than as a wrong path.
ENV DATA_ONTOLOGY=/etc/data/ontologia.json
RUN go vet ./... \
 && go test ./... -count=1 \
 && go run ./cmd/data verify

# `--from=test` is an ORDERING, not a copy: it makes the test stage a dependency
# of the binary, so buildx cannot skip it and still produce an image.
FROM test AS compile
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
RUN GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-arm64} \
    go build -trimpath -ldflags "-w -s -X main.version=${VERSION}" -o /out/data ./cmd/data

# ---------------------------------------------------------------------------
# runtime: scratch.
#
# This is the process that holds the only database credential in the fleet, so
# the argument for an empty filesystem is stronger here than anywhere else: an
# RCE in this container lands somewhere with no shell, no package manager, no
# interpreter and no way to reach the network except the pool it already has.
#
# The cost, plainly: `docker exec` into this container gets you nothing.
# Debugging is `docker logs` and GET /v1/catalog.
# ---------------------------------------------------------------------------
FROM scratch

# Postgres over TLS needs a trust store. Copied rather than omitted because
# discovering its absence looks like a network fault.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /etc/data/ontologia.json /etc/data/ontologia.json
COPY --from=compile /out/data /data-service

USER 10001:10001

ENV PORT=8788 \
    DATA_ONTOLOGY=/etc/data/ontologia.json

EXPOSE 8788

# The binary probes itself over the loopback: a scratch image has no curl, no
# wget and no shell, so a CMD-SHELL healthcheck could never run -- and a
# healthcheck that cannot run is a container that is never reported unhealthy.
# /health pings the database, so a Postgres outage shows as unhealthy here
# instead of as a green container serving errors.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/data-service", "healthcheck"]

ENTRYPOINT ["/data-service"]
CMD ["serve"]
