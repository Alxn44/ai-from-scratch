#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
TEST_SCRIPT=${1:-test:direct}
DATA_TEST_URL=http://127.0.0.1:8788

# The caller may point tests at an isolated database/service. Preserve explicit
# values before loading the developer .env; otherwise sourcing it silently
# rewrites DATABASE_URL back to localhost:5432 and the real HTTP suite tests a
# different database (or never starts the data service at all).
AIFS_DATABASE_URL_SET=${DATABASE_URL+x}; AIFS_DATABASE_URL=${DATABASE_URL-}
AIFS_DATA_URL_SET=${DATA_URL+x}; AIFS_DATA_URL=${DATA_URL-}
AIFS_DATA_SECRET_SET=${DATA_SECRETO+x}; AIFS_DATA_SECRET=${DATA_SECRETO-}
if [ -f "$APP_ROOT/api/.env" ]; then
  set -a
  . "$APP_ROOT/api/.env"
  set +a
fi
if [ "$AIFS_DATABASE_URL_SET" = x ]; then export DATABASE_URL="$AIFS_DATABASE_URL"; fi
if [ "$AIFS_DATA_URL_SET" = x ]; then export DATA_URL="$AIFS_DATA_URL"; fi
if [ "$AIFS_DATA_SECRET_SET" = x ]; then export DATA_SECRETO="$AIFS_DATA_SECRET"; fi

: "${DATABASE_URL:?api tests need DATABASE_URL}"
if [ -z "${DATA_SECRETO:-}" ]; then
  DATA_SECRETO=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
  export DATA_SECRETO
fi

DATA_PID=""
DATA_LOG=$(mktemp "${TMPDIR:-/tmp}/course-data-test.XXXXXX")
DATA_BIN=$(mktemp "${TMPDIR:-/tmp}/course-data-bin.XXXXXX")
cleanup() {
  if [ -n "$DATA_PID" ]; then
    kill "$DATA_PID" 2>/dev/null || true
    wait "$DATA_PID" 2>/dev/null || true
  fi
  rm -f "$DATA_LOG" "$DATA_BIN"
}
trap cleanup EXIT INT TERM

if curl -fsS --max-time 1 "$DATA_TEST_URL/health" >/dev/null 2>&1; then
  # Reusing whatever already answers there. Say so: a `data` from an earlier run
  # can be built from older code, hold a different DATA_SECRETO, and point at a
  # different database, and then these tests are not testing this checkout.
  # Staying quiet about that is how "root.solved_labs: unknown_operation" costs
  # an afternoon.
  echo "note: reusing the data service already answering at $DATA_TEST_URL (not started by this run)" >&2
else
  # BUILD, then run the binary. It used to be `exec go run ./cmd/data serve`, and
  # `go run` compiles to a temp binary and runs it as a CHILD: $! was the `go run`
  # process, not the listener. `kill "$DATA_PID"` in cleanup killed the parent and
  # left the child holding 8788 -- measured: `go run` pid 7265 died, `data` pid
  # 58644 stayed up and kept answering /health.
  #
  # That is not merely a stray process. The branch above reuses anything healthy
  # on 8788, so the leak from one run silently becomes the service under test in
  # the next one. Building first makes $! the process that actually listens, so
  # cleanup kills the thing it means to kill.
  if ! (cd "$APP_ROOT/data" && go build -o "$DATA_BIN" ./cmd/data) >"$DATA_LOG" 2>&1; then
    echo "could not build the data service for api tests" >&2
    sed -n '1,160p' "$DATA_LOG" >&2
    exit 1
  fi
  (
    cd "$APP_ROOT/data"
    DATA_ONTOLOGY="$APP_ROOT/api/src/ontologia.json" PORT=8788 \
      exec "$DATA_BIN" serve
  ) >"$DATA_LOG" 2>&1 &
  DATA_PID=$!
  ready=0
  i=0
  while [ "$i" -lt 40 ]; do
    if curl -fsS --max-time 1 "$DATA_TEST_URL/health" >/dev/null 2>&1; then
      ready=1
      break
    fi
    if ! kill -0 "$DATA_PID" 2>/dev/null; then
      break
    fi
    i=$((i + 1))
    sleep 1
  done
  if [ "$ready" -ne 1 ]; then
    echo "data service did not become healthy for api tests" >&2
    sed -n '1,160p' "$DATA_LOG" >&2
    exit 1
  fi
fi

cd "$APP_ROOT"
DATA_URL="$DATA_TEST_URL" pnpm --dir api "$TEST_SCRIPT"
