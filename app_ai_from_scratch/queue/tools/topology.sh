#!/usr/bin/env bash
# Run queue-topology INSIDE the compose network, which is the only place the
# broker is reachable.
#
#   tools/topology.sh print      what the code says should exist
#   tools/topology.sh declare    create it, idempotently
#   tools/topology.sh verify     check it -- exits non-zero if anything is missing
#   tools/topology.sh queues     depth and consumer count per queue
#
# WHY A CONTAINER FOR THIS. AMQP 5672 is not published to the host (see
# ../docs/ARCHITECTURE.md: only sibling containers speak it, and Docker's DNAT on Linux
# skips the host INPUT chain, so publishing it would bypass a host firewall).
# `docker compose run` puts this on the internal network, where `broker` resolves.
#
# The exit code is the tool's own, passed straight through. Nothing here pipes it
# anywhere: `cmd | tail` reports tail's status, and that mistake has produced a
# confident, wrong "all green" in this repository before.
set -euo pipefail

cd "$(dirname "$0")/../.."   # the compose file lives at app_ai_from_scratch/

if [ $# -eq 0 ]; then
  echo "usage: tools/topology.sh {print|contract|declare|verify|queues}" >&2
  exit 2
fi

if [ -z "${RABBITMQ_PASSWORD:-}" ] && ! grep -qE '^RABBITMQ_PASSWORD=' .env 2>/dev/null; then
  echo "RABBITMQ_PASSWORD is not set and is not in .env, so the broker URL cannot be built." >&2
  echo "Generate the keys first:  scripts/keys.sh" >&2
  exit 1
fi

# --rm so a one-shot tool does not leave a stopped container behind on every run.
# The service definition supplies AMQP_URL and IA_SECRETO from the environment.
exec docker compose run --rm --no-deps \
  --entrypoint /queue-topology \
  queue "$@"
