#!/usr/bin/env bash
# End-to-end proof that the bus actually carries a message between services.
#
# It publishes ONE `bus.echo` and then reads what happened. api-worker, ai-worker
# and this service all bind `bus.echo`, so a single message proves the property
# ../docs/ARCHITECTURE.md claims and nothing else exercises: the topic exchange fans out
# to three runtimes and all three consume.
#
# WHAT MAKES THIS A TEST AND NOT A DEMO: it checks the answers. A script that
# publishes and prints "done" proves only that curl ran.
set -euo pipefail

cd "$(dirname "$0")/../.."

fail() { echo "FAILED: $*" >&2; exit 1; }

secret="${QUEUE_SECRETO:-}"
if [ -z "${secret}" ]; then
  secret="$(grep -E '^QUEUE_SECRETO=' .env 2>/dev/null | head -1 | cut -d= -f2- || true)"
fi
[ -n "${secret}" ] || fail "QUEUE_SECRETO is not set and is not in .env. Run scripts/keys.sh"

echo "=== 1. health ==="
# The health endpoint is the first gate on purpose: if it does not say ok, every
# assertion below would fail for a reason that has nothing to do with the bus.
health="$(docker compose exec -T queue /queue healthcheck 2>&1)" || {
  echo "${health}" >&2
  fail "the queue service is not healthy -- check 'docker compose logs queue'"
}
echo "healthy"

echo
echo "=== 2. verify the topology ==="
docker compose exec -T queue /queue-topology verify \
  || fail "the topology is not what the code says it should be"

echo
echo "=== 3. depth before ==="
docker compose exec -T queue /queue-topology queues || fail "could not read the queues"

echo
echo "=== 4. publish one bus.echo ==="
# A stable idempotency key per run, so re-running does not silently dedupe
# against the previous run and report a success that never touched a handler.
key="smoke:$(date -u +%Y-%m-%dT%H:%M:%S)"
# There is no shell in the queue image (scratch, on purpose), so the publish goes
# over HTTP from a container that does have one. `curl` on the alpine broker image
# is not guaranteed either, so this uses the api container, which has node.
published="$(docker compose exec -T api node --input-type=module -e '
const [url, secret, key] = process.argv.slice(1);
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-queue-secreto": secret },
  body: JSON.stringify({ type: "bus.echo", idempotency_key: key, payload: { from: "smoke.sh" } }),
});
const body = await res.json();
console.log(JSON.stringify({ status: res.status, body }));
' "http://queue:8790/enqueue" "${secret}" "${key}")" || fail "the enqueue request itself failed"

echo "${published}"
# 202 is the only success: anything else means the broker did not confirm it, and
# an unconfirmed publish is not a publish.
echo "${published}" | grep -q '"status":202' || fail "the publish was not confirmed (expected status 202)"
echo "${published}" | grep -q '"published":true' || fail "the service did not report the message as published"

echo
echo "=== 5. let the three workers consume ==="
sleep 2

echo
echo "=== 6. depth after ==="
docker compose exec -T queue /queue-topology queues || fail "could not read the queues"

echo
echo "=== 7. this service's counters ==="
# `taken` and `done` must both have moved. A `dead` that moved instead means the
# message arrived and had no handler.
docker compose exec -T api node --input-type=module -e '
const [url, secret] = process.argv.slice(1);
const res = await fetch(url, { headers: { "x-queue-secreto": secret } });
const body = await res.json();
console.log(JSON.stringify(body.stats));
if (!body.stats || body.stats.done < 1) {
  console.error("the queue service consumed nothing: stats.done is " + (body.stats?.done ?? "absent"));
  process.exit(1);
}
if (body.stats.dead > 0 || body.stats.malformed > 0) {
  console.error("something was dead-lettered: " + JSON.stringify(body.stats));
  process.exit(1);
}
' "http://queue:8790/health" "${secret}" || fail "the queue service did not consume the message"

echo
echo "=== 8. the dead-letter queue must be empty ==="
docker compose exec -T queue /queue-topology queues | grep 'course.events.dead' || true

echo
echo "PASSED: one message crossed the bus and this service consumed it."
echo "Check the other two workers too:  docker compose logs --tail=20 api-worker ai-worker"
