#!/usr/bin/env bash
# Run the queue service on this machine, with hot reload of nothing and a very
# clear story about the broker.
#
# THE THING THAT SURPRISES EVERYONE FIRST: AMQP (5672) IS NOT PUBLISHED TO THE
# HOST. That is deliberate and documented in ../docs/ARCHITECTURE.md -- only sibling
# containers speak it, and the management UI is on loopback because it is a
# credentialed admin console. So a process running on the host CANNOT reach the
# broker, and this script does not pretend otherwise: it starts the service with
# no AMQP_URL, /health answers 503 `no_broker`, and every write route refuses.
#
# That is genuinely useful for working on the HTTP surface. For anything that
# touches the broker, use tools/topology.sh or tools/smoke.sh, which run inside
# the compose network.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${QUEUE_PORT:-8790}"

# Refuse to take a port that is not ours, following scripts/dev.mjs: a launcher
# that clears the ground by killing processes it does not own is not clearing,
# it is breaking the work next door.
if command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -ti "tcp@127.0.0.1:${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "${pids}" ]; then
    echo "Port ${PORT} is already in use by PID(s): ${pids}" >&2
    for pid in ${pids}; do
      echo "  $(ps -o command= -p "${pid}" 2>/dev/null || echo '(unreadable)')" >&2
    done
    echo >&2
    echo "I am not killing it: I cannot tell whether it is mine." >&2
    echo "Either move ours   ->  QUEUE_PORT=$((PORT + 4)) scripts/dev.sh" >&2
    echo "or free the port   ->  kill ${pids}" >&2
    exit 1
  fi
fi

# APP_ENV=development is what allows an ephemeral secret. Without it the service
# refuses to boot with no QUEUE_SECRETO, which is the correct production behaviour.
export APP_ENV=development
export PORT="${PORT}"

# If a real secret exists locally, use it, so a request from `api` works. The
# file is read rather than sourced: sourcing an .env runs whatever is in it.
for env_file in ../api/.env ../.env; do
  if [ -f "${env_file}" ] && [ -z "${QUEUE_SECRETO:-}" ]; then
    value="$(grep -E '^QUEUE_SECRETO=' "${env_file}" 2>/dev/null | head -1 | cut -d= -f2- || true)"
    if [ -n "${value}" ]; then
      export QUEUE_SECRETO="${value}"
      echo "Using QUEUE_SECRETO from ${env_file} (so api can call this service)."
      break
    fi
  fi
done
if [ -z "${QUEUE_SECRETO:-}" ]; then
  echo "No QUEUE_SECRETO found: an ephemeral one will be minted and printed at boot."
  echo "Nothing else can call this service with it. Run ../scripts/keys.sh for a real one."
fi

if [ -n "${AMQP_URL:-}" ]; then
  echo "AMQP_URL is set, so the broker steps will run."
else
  echo
  echo "AMQP_URL is NOT set, so this process cannot reach the broker."
  echo "  /health will answer 503 no_broker, and enqueue/declare/verify will refuse."
  echo "  That is correct: AMQP 5672 is deliberately not published to the host."
  echo "  For broker work:  tools/topology.sh verify   ·   tools/smoke.sh"
  echo
fi

echo "queue -> http://127.0.0.1:${PORT}/health"
exec go run ./cmd/queue
