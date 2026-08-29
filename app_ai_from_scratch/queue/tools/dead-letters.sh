#!/usr/bin/env bash
# The dead-letter queue: look at it, and put work back on the bus.
#
#   tools/dead-letters.sh show           how many are parked
#   tools/dead-letters.sh replay N       move at most N back to the main exchange
#
# WHEN TO REPLAY. bus.ts sends a message here for three reasons: it ran out of
# attempts, its type had no handler, or its bytes were unreadable. The first two
# are usually fixed by shipping code -- and after that ships, the parked work
# should RUN, not be thrown away. The third cannot be fixed by replaying and is
# left in place.
#
# WHY N IS REQUIRED. There is no "replay everything". Moving a dead-letter queue
# back onto a live exchange is an action with consequences, and the operator has
# to say how much of it they mean. The service refuses a missing or zero limit.
#
# The safety property, implemented in the service and worth knowing before you
# run this: a message is acked off the DLQ only AFTER its republish is confirmed.
# A failed republish leaves the DLQ exactly as it was found.
set -euo pipefail

cd "$(dirname "$0")/../.."

fail() { echo "FAILED: $*" >&2; exit 1; }

secret="${QUEUE_SECRETO:-}"
if [ -z "${secret}" ]; then
  secret="$(grep -E '^QUEUE_SECRETO=' .env 2>/dev/null | head -1 | cut -d= -f2- || true)"
fi
[ -n "${secret}" ] || fail "QUEUE_SECRETO is not set and is not in .env. Run scripts/keys.sh"

case "${1:-}" in
  show)
    # Straight from the broker, not from a counter this service keeps: a counter
    # can be stale, a passive queue declare cannot.
    exec docker compose exec -T queue /queue-topology queues
    ;;
  replay)
    limit="${2:-}"
    case "${limit}" in
      ''|*[!0-9]*) fail "replay needs a count: tools/dead-letters.sh replay 25" ;;
    esac
    [ "${limit}" -gt 0 ] || fail "the count must be greater than zero"

    echo "Replaying up to ${limit} dead letter(s) onto the main exchange."
    # A 409 means some moved and some did not, and that is NOT a success. The
    # exit code below reflects it.
    docker compose exec -T api node --input-type=module -e '
const [url, secret, limit] = process.argv.slice(1);
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-queue-secreto": secret },
  body: JSON.stringify({ limit: Number(limit) }),
});
const body = await res.json();
console.log(JSON.stringify(body, null, 2));
if (res.status !== 200) {
  console.error(`the replay did not complete cleanly (status ${res.status})`);
  process.exit(1);
}
' "http://queue:8790/dead/replay" "${secret}" "${limit}" \
      || fail "the replay did not complete cleanly -- read the faults above before re-running"

    echo
    echo "Depth now:"
    docker compose exec -T queue /queue-topology queues
    ;;
  *)
    echo "usage: tools/dead-letters.sh {show|replay N}" >&2
    exit 2
    ;;
esac
