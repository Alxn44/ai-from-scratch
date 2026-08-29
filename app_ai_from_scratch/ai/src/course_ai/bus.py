"""Inter-service transport, Python side. Same contract as `api/src/bus.ts`.

WHY THIS IS A LIBRARY AND NOT A SERVICE

docs/ARCHITECTURE.md refuses to build an `orchestrator` container. This file is the
other half of that argument: RabbitMQ is the routing substrate, and the POLICY
(envelope shape, routing keys, idempotency, retry ceiling, backoff) is compiled
into the services that do the work. There is no central router. `api/src/bus.ts`
is the same contract in JavaScript, and the two files must stay readable as one
document because the two runtimes read each other's messages.

WHERE THE BOUNDARY IS

    api/src/trabajos.js   Postgres queue. Work one service both enqueues and
                          runs, next to its own transaction (the Mercado Pago
                          webhook, the persisted spend counters). It stays.
    bus.ts / bus.py       Work that CROSSES a service boundary, or fans out to
                          more than one consumer: batch grading, embeddings, the
                          weekly league close, e-mail, exports, re-indexing.

This service could not use the Postgres queue even if it wanted to: `ai` never
touches the database (see course_ai/__init__.py). That is not an inconvenience the
broker works around, it is the reason the broker exists.

HTTP IS STILL THE CHAT PATH. Nothing here touches `api <-> ai` for a chat turn:
a person is blocked on that request, and a broker round trip would buy a reply
queue, a correlation id and a timeout policy in exchange for latency.

-------------------------------------------------------------------------------
THE ENVELOPE  --  keep identical to the block in api/src/bus.ts

    {
      "id":              "0f9c1e6a-...",             uuid4, the message identity
      "type":            "league.week.close",        what to do / what happened
      "key":             "league.week.close",        routing key it went out with
      "idempotency_key": "league.week.close:2026-08-17",  the unit of "already done"
      "attempt":         1,                          1 on first publish, +1 per retry
      "produced_at":     "2026-08-23T14:05:00.000Z", RFC3339, UTC, milliseconds
      "payload":         {}                          free-form JSON, per type
    }

Rules that make the two runtimes interoperable:
  - snake_case field names, because half the readers are Python.
  - `id` is STABLE across retries: a retry is the same message, later. The AMQP
    `message_id` property carries f"{id}:{attempt}", which IS unique per publish
    attempt, so a confirm or a mandatory-return can be correlated without adding
    a field nobody reads.
  - `produced_at` is the time of the FIRST publish, copied forward by retries.
    That is what makes "this work is 40 minutes old" answerable.
  - `attempt` is an int >= 1. `idempotency_key` is what dedupe keys on, so it
    MUST survive the republish untouched.
  - unknown extra fields are preserved on retry, so a newer producer can add one
    without an older consumer dropping it.
-------------------------------------------------------------------------------
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import time
import uuid
from collections.abc import Awaitable, Callable, Iterable, Mapping, MutableMapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol, runtime_checkable

# The field list, in order. Asserted by the tests on BOTH sides: renaming one
# here without renaming it in api/src/bus.ts breaks the other service silently.
ENVELOPE_FIELDS: tuple[str, ...] = (
    "id", "type", "key", "idempotency_key", "attempt", "produced_at", "payload",
)

# AMQP delivery mode 2 = persist to disk. Not configurable, in either runtime:
# a message the broker forgets on restart is not a message, it is a hope.
PERSISTENT = 2

# ---------------------------------------------------------------------------
# RETRY POLICY. Numbers, not adjectives. Identical to api/src/bus.ts.
#
# delay(attempt) = min(CAP, BASE * FACTOR^(attempt-1))
#   attempt 1 fails -> wait  1s
#   attempt 2 fails -> wait  4s
#   attempt 3 fails -> wait 16s
#   attempt 4 fails -> wait 60s   (256s clipped by the cap)
#   attempt 5 fails -> dead-letter queue, no further retry
#
# Five handler runs over ~81 seconds of deliberate waiting. Past that the failure
# is not transitory and a human has to look at the DLQ.
#
# The wait happens IN THE BROKER, never in the consumer: the message is
# republished to a per-tier delay queue whose only job is to hold it for its TTL
# and dead-letter it back to the main exchange. A nack with requeue=True puts the
# message straight back at the head of the queue and spins at broker speed --
# that is the hot loop this design refuses.
#
# Fixed tiers instead of per-message TTL: one delay queue with per-message expiry
# blocks head-of-line (a 60s message at the head holds up a 1s message behind
# it), which silently breaks the schedule above. The trade-off accepted is that
# tiers carry no jitter, so a batch that fails together retries together.
BASE_DELAY_MS = 1_000
DELAY_FACTOR = 4
DELAY_CAP_MS = 60_000
MAX_ATTEMPTS = 5


def delay_for(attempt: int) -> int:
    """Backoff for a failed attempt, in milliseconds. Same numbers in JS."""
    return min(DELAY_CAP_MS, BASE_DELAY_MS * DELAY_FACTOR ** max(0, int(attempt) - 1))


# The distinct tiers, which is exactly the set of retry queues to declare.
DELAY_TIERS_MS: tuple[int, ...] = tuple(sorted({delay_for(a) for a in range(1, MAX_ATTEMPTS)}))

# Reconnect backoff is a DIFFERENT policy from message retry, kept separate on
# purpose: a broker that is down does not mean a message is bad.
RECONNECT_MS: tuple[int, ...] = (1_000, 2_000, 4_000, 8_000, 16_000, 30_000)


def reconnect_delay(n: int) -> int:
    return RECONNECT_MS[min(n, len(RECONNECT_MS) - 1)]


class BusError(Exception):
    """Anything this module refuses to call success."""


class PublishNotConfirmed(BusError):
    """The broker did not take durable responsibility for the message."""


class MalformedEnvelope(BusError):
    """Bytes that are not a readable envelope. Cannot be retried into readability."""


# ---------------------------------------------------------------------------
# CONFIGURATION. Environment only. No default that points at a real host and no
# embedded credentials: this repository just had a security pass over exactly
# that class of default. An unset AMQP_URL is a SUPPORTED state -- the broker
# container is not in docker-compose yet and `ai` must keep booting without it.
def _pos(raw: str | None, default: float) -> float:
    try:
        n = float(raw) if raw not in (None, "") else 0.0
    except ValueError:
        return default
    return n if n > 0 else default


@dataclass(frozen=True, slots=True)
class Config:
    url: str
    exchange: str
    prefetch: int
    worker: str
    claim_url: str
    claim_secret: str
    claim_lease_s: float
    handler_timeout_s: float
    drain_s: float
    publish_timeout_s: float

    @property
    def enabled(self) -> bool:
        return bool(self.url)


def config(env: Mapping[str, str] | None = None) -> Config:
    e = os.environ if env is None else env
    return Config(
        url=(e.get("AMQP_URL") or "").strip(),
        exchange=(e.get("BUS_EXCHANGE") or "course.events").strip(),
        prefetch=int(_pos(e.get("BUS_PREFETCH"), 8)),
        # Stable across restarts on purpose (a pid would not be): the idempotency
        # lease uses it to let a restarted worker reclaim its OWN half-finished
        # claim without waiting the lease out.
        worker=(e.get("BUS_WORKER_ID") or socket.gethostname() or "ai-worker").strip(),
        claim_url=(e.get("BUS_CLAIM_URL") or "").strip(),
        claim_secret=(e.get("IA_SECRETO") or "").strip(),
        claim_lease_s=_pos(e.get("BUS_CLAIM_LEASE_S"), 300),
        handler_timeout_s=_pos(e.get("BUS_HANDLER_TIMEOUT_MS"), 60_000) / 1000,
        drain_s=_pos(e.get("BUS_DRAIN_MS"), 20_000) / 1000,
        publish_timeout_s=_pos(e.get("BUS_PUBLISH_TIMEOUT_MS"), 10_000) / 1000,
    )


def redact(url: str) -> str:
    """A connection URL with the credentials removed, safe for a log line."""
    if not url:
        return "(unset)"
    try:
        head, _, tail = url.partition("://")
        if "@" in tail:
            return f"{head}://***@{tail.split('@', 1)[1]}"
        return f"{head}://{tail}"
    except (ValueError, IndexError):  # pragma: no cover - partition cannot really fail
        return "(unparseable AMQP_URL)"


_announced = False


def announce(log: Any = None, cfg: Config | None = None) -> bool:
    """Says out loud, ONCE, whether the broker is configured.

    Called at worker boot and by the first publish, so a disabled bus is never a
    silent one. It does not raise: `ai` has to keep serving chat over HTTP while
    somebody else adds the broker container.
    """
    global _announced
    c = cfg or config()
    if _announced:
        return c.enabled
    _announced = True
    if c.enabled:
        _say(log, "info", f"bus: enabled, exchange={c.exchange} broker={redact(c.url)}")
    else:
        _say(log, "warning",
             "bus: DISABLED -- AMQP_URL is not set. Cross-service messages are dropped and "
             "nothing is consumed. This service keeps running on purpose; set AMQP_URL once "
             "the broker container exists.")
    return c.enabled


def reset_announce() -> None:
    """Only for tests: forget that announce() already spoke."""
    global _announced
    _announced = False


def _say(log: Any, level: str, msg: str) -> None:
    """Logs through whatever was handed in: a logging.Logger, or anything with
    info/warning/error. Falls back to print so a missing logger never swallows a
    line that explains why nothing is happening."""
    fn = getattr(log, level, None) if log is not None else None
    if callable(fn):
        fn(msg)
    else:
        print(f"[{level}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# ENVELOPE
def _now_iso() -> str:
    # Milliseconds and a trailing Z, byte-compatible with JS toISOString().
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.now(UTC).microsecond // 1000:03d}Z"


@dataclass(frozen=True, slots=True)
class Envelope:
    id: str
    type: str
    key: str
    idempotency_key: str
    attempt: int
    produced_at: str
    payload: dict[str, Any] = field(default_factory=dict)
    # Fields a NEWER producer added and this consumer does not know. Kept so a
    # retry republished from here does not silently strip them.
    extra: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        d = {
            "id": self.id,
            "type": self.type,
            "key": self.key,
            "idempotency_key": self.idempotency_key,
            "attempt": self.attempt,
            "produced_at": self.produced_at,
            "payload": self.payload,
        }
        d.update(self.extra)
        return d

    def to_json(self) -> str:
        # separators: no incidental whitespace, so two runtimes producing the
        # same envelope produce the same bytes.
        return json.dumps(self.as_dict(), separators=(",", ":"), ensure_ascii=False)

    def next_attempt(self) -> Envelope:
        """The same message, one attempt later. id and produced_at are kept."""
        return Envelope(
            id=self.id, type=self.type, key=self.key,
            idempotency_key=self.idempotency_key, attempt=self.attempt + 1,
            produced_at=self.produced_at, payload=self.payload, extra=dict(self.extra),
        )

    @classmethod
    def parse(cls, raw: bytes | str) -> Envelope:
        """Throws MalformedEnvelope on anything unreadable; the caller dead-letters it."""
        try:
            d = json.loads(raw if isinstance(raw, str) else raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as e:
            raise MalformedEnvelope(f"not JSON: {e}") from e
        if not isinstance(d, dict):
            raise MalformedEnvelope("envelope is not an object")
        for f in ("id", "type", "key", "idempotency_key", "produced_at"):
            if not isinstance(d.get(f), str) or not d[f]:
                raise MalformedEnvelope(f'envelope field "{f}" missing')
        attempt = d.get("attempt")
        if not isinstance(attempt, int) or isinstance(attempt, bool) or attempt < 1:
            raise MalformedEnvelope('envelope field "attempt" invalid')
        payload = d.get("payload")
        if not isinstance(payload, dict):
            raise MalformedEnvelope('envelope field "payload" invalid')
        return cls(
            id=d["id"], type=d["type"], key=d["key"], idempotency_key=d["idempotency_key"],
            attempt=attempt, produced_at=d["produced_at"], payload=payload,
            extra={k: v for k, v in d.items() if k not in ENVELOPE_FIELDS},
        )


def make_envelope(*, type: str, payload: Mapping[str, Any] | None = None,
                  key: str | None = None, idempotency_key: str | None = None,
                  attempt: int = 1, id: str | None = None,
                  produced_at: str | None = None) -> Envelope:
    # `type` and `id` shadow builtins on purpose: these are the ENVELOPE field
    # names, and a parameter called `type_` would be a second name for the same
    # thing in a contract whose whole point is that both runtimes agree.
    if not type or not isinstance(type, str):
        raise BusError("bus: envelope needs a string type")
    mid = id or str(uuid.uuid4())
    return Envelope(
        id=mid, type=type, key=key or type,
        # The safe default is "this publish is its own unit of work": dedupe only
        # collapses two messages when the caller says what "the same work" means.
        idempotency_key=idempotency_key or f"{type}:{mid}",
        attempt=max(1, int(attempt)),
        produced_at=produced_at or _now_iso(),
        payload=dict(payload or {}),
    )


# ---------------------------------------------------------------------------
# TOPOLOGY, as data. Pure function so it can be asserted without a broker, and
# applied idempotently on every connect so a cold start in ANY order converges:
# whoever arrives first declares, the rest re-declare the same thing, and an AMQP
# declaration with identical arguments is a no-op.
#
#   exchange  {ex}                topic    durable   the one everybody binds to
#   exchange  {ex}.dlx            topic    durable   dead letters
#   queue     {ex}.dead           durable            bound to .dlx with '#'
#   exchange  {ex}.retry.{ms}     fanout   durable   one per delay tier
#   queue     {ex}.retry.{ms}     durable            ttl={ms}, dead-letters to {ex}
#   queue     {consumer}          durable            dead-letters to {ex}.dlx
#
# Why fanout for the retry tiers and not one direct exchange: a message
# dead-lettered out of a delay queue keeps the routing key it was PUBLISHED with.
# Publishing to a direct exchange means publishing with the tier name as the key,
# and the message would return to the main exchange with that key and match
# nothing. A fanout ignores the routing key for routing while the message keeps
# its own, so a delayed message re-enters the main exchange exactly as it left.
def retry_exchange(exchange: str, ms: int) -> str:
    return f"{exchange}.retry.{ms}"


def retry_queue(exchange: str, ms: int) -> str:
    return f"{exchange}.retry.{ms}"


def dlx(exchange: str) -> str:
    return f"{exchange}.dlx"


def dlq(exchange: str) -> str:
    return f"{exchange}.dead"


@dataclass(frozen=True, slots=True)
class Topology:
    exchanges: tuple[dict[str, Any], ...]
    queues: tuple[dict[str, Any], ...]
    bindings: tuple[dict[str, Any], ...]


def topology(exchange: str, queue: str | None = None,
             patterns: Iterable[str] = ()) -> Topology:
    pats = tuple(patterns)
    exchanges: list[dict[str, Any]] = [
        {"name": exchange, "type": "topic", "durable": True},
        {"name": dlx(exchange), "type": "topic", "durable": True},
    ]
    queues: list[dict[str, Any]] = [{"name": dlq(exchange), "durable": True, "arguments": {}}]
    bindings: list[dict[str, Any]] = [
        {"queue": dlq(exchange), "exchange": dlx(exchange), "pattern": "#"},
    ]
    for ms in DELAY_TIERS_MS:
        exchanges.append({"name": retry_exchange(exchange, ms), "type": "fanout", "durable": True})
        queues.append({
            "name": retry_queue(exchange, ms),
            "durable": True,
            "arguments": {
                "x-message-ttl": ms,
                # Back to the main exchange, keeping the original routing key.
                "x-dead-letter-exchange": exchange,
            },
        })
        bindings.append({"queue": retry_queue(exchange, ms),
                         "exchange": retry_exchange(exchange, ms), "pattern": ""})
    if queue:
        if not pats:
            # A consumer with no pattern is a queue nothing routes to. That looks
            # like a broker problem and is a wiring problem: say it at declare time.
            raise BusError(f'bus: queue "{queue}" declared with no routing patterns')
        queues.append({"name": queue, "durable": True,
                       "arguments": {"x-dead-letter-exchange": dlx(exchange)}})
        for p in pats:
            bindings.append({"queue": queue, "exchange": exchange, "pattern": p})
    return Topology(tuple(exchanges), tuple(queues), tuple(bindings))


@dataclass(slots=True)
class Declared:
    exchanges: dict[str, Any] = field(default_factory=dict)
    queues: dict[str, Any] = field(default_factory=dict)


async def declare_topology(channel: Any, topo: Topology) -> Declared:
    """Applies a topology to a channel. Idempotent by construction."""
    out = Declared()
    for e in topo.exchanges:
        out.exchanges[e["name"]] = await channel.declare_exchange(
            e["name"], e["type"], durable=e["durable"])
    for q in topo.queues:
        out.queues[q["name"]] = await channel.declare_queue(
            q["name"], durable=q["durable"], arguments=dict(q["arguments"]) or None)
    for b in topo.bindings:
        await out.queues[b["queue"]].bind(out.exchanges[b["exchange"]], routing_key=b["pattern"])
    return out


# ---------------------------------------------------------------------------
# PUBLISH
def message_spec(env: Envelope) -> dict[str, Any]:
    """The AMQP properties every publish uses. delivery_mode 2 is not optional."""
    return {
        "body": env.to_json().encode("utf-8"),
        "content_type": "application/json",
        "delivery_mode": PERSISTENT,
        "message_id": f"{env.id}:{env.attempt}",
        # AMQP timestamps are Unix seconds. Observability and DLQ tooling use
        # this broker property without decoding the application envelope.
        "timestamp": int(time.time()),
        "type": env.type,
        "headers": {"x-bus-attempt": env.attempt,
                    "x-bus-idempotency-key": env.idempotency_key},
    }


def _aio_message(spec: Mapping[str, Any]) -> Any:
    # Imported here, not at module load: aio_pika is only needed by a process
    # that actually has a broker, and a test must be able to import this module
    # without it.
    import aio_pika

    s = dict(spec)
    body = s.pop("body")
    return aio_pika.Message(body, **s)


async def publish_on(exchange: Any, env: Envelope, *, key: str | None = None,
                     timeout_s: float = 10.0, mandatory: bool = True,
                     make_message: Callable[[Mapping[str, Any]], Any] = _aio_message) -> Envelope:
    """Publishes one envelope and waits for the confirm.

    Three ways a publish can fail to be a publish, and all three must report
    failure rather than success:
      1. the broker nacks it,
      2. the broker cannot route it and RETURNS it (mandatory=True) -- which is
         followed by a positive confirm, so waiting on the confirm alone would
         call an unroutable message delivered,
      3. nothing answers at all, which is what the timeout is for.
    aio-pika turns 1 and 2 into DeliveryError and 3 into TimeoutError; every one
    of them comes back out of here as PublishNotConfirmed.
    """
    spec = message_spec(env)
    try:
        confirmation = await exchange.publish(
            make_message(spec), routing_key=key or env.key,
            mandatory=mandatory, timeout=timeout_s)
    except Exception as e:
        raise PublishNotConfirmed(f"{env.type}: {type(e).__name__}: {e}") from e
    # Some driver versions hand back the frame instead of raising on it.
    name = type(confirmation).__name__.lower() if confirmation is not None else "none"
    if "nack" in name or "return" in name:
        raise PublishNotConfirmed(f"{env.type}: broker answered {type(confirmation).__name__}")
    return env


# ---------------------------------------------------------------------------
# IDEMPOTENCY
#
# The pattern is the one already in api/src/trabajos.js: one row per key with
# UNIQUE (tipo, clave), and the race decided by ON CONFLICT DO NOTHING instead of
# by reading first. It is NOT reimplemented here, because this service does not
# touch Postgres -- see course_ai/__init__.py. That isolation is the whole reason `ai`
# cannot leak a user's data, so the claim goes over the same internal bridge the
# agent tools already use: `api` owns the row, `ai` asks.
#
# A CLAIM IS A LEASE, NOT A FLAG (same states as the JS side):
#     no row                                  -> claim it, run the handler
#     running, ours                           -> we crashed holding it; take it
#     running, theirs, fresh                  -> somebody is on it; skip
#     running, theirs, older than the lease   -> they died; take it
#     done                                    -> skip, forever
# A failed handler RELEASES its claim so the scheduled retry is not mistaken for
# a duplicate.
#
# The API route exists at /api/v3/interno/bus/claim and maps these actions to
# closed /data operations. An ai-worker without BUS_CLAIM_URL still uses
# MemoryClaims and says so at boot, loudly.
@runtime_checkable
class Claims(Protocol):
    async def claim(self, key: str) -> bool: ...
    async def complete(self, key: str) -> None: ...
    async def release(self, key: str) -> None: ...


class MemoryClaims:
    """Dedupe inside ONE process life. Enough for tests, not enough for a restart."""

    def __init__(self, log: Any = None, *, quiet: bool = False) -> None:
        self._seen: MutableMapping[str, str] = {}
        if not quiet:
            _say(log, "warning",
                 "bus: idempotency is IN MEMORY (BUS_CLAIM_URL unset). A restart forgets what "
                 "ran, so a redelivery after a crash can run a handler twice. Point "
                 "BUS_CLAIM_URL at the api claim route for the durable version.")

    async def claim(self, key: str) -> bool:
        if self._seen.get(key):
            return False
        self._seen[key] = "running"
        return True

    async def complete(self, key: str) -> None:
        self._seen[key] = "done"

    async def release(self, key: str) -> None:
        self._seen.pop(key, None)


class ApiClaims:
    """The durable claim: one HTTP call to `api`, which owns the row.

    Authenticated with the service secret (`x-ia-secreto`), the same proof-of-
    origin the tool bridge uses. It carries no user identity because a worker has
    no user: an idempotency key is not a person.
    """

    def __init__(self, url: str, secret: str, owner: str, *, lease_s: float = 300.0,
                 client: Any = None, timeout_s: float = 10.0) -> None:
        self.url = url
        self.secret = secret
        self.owner = owner
        self.lease_s = lease_s
        self.timeout_s = timeout_s
        self._client = client

    async def _post(self, action: str, key: str) -> dict[str, Any]:
        import httpx

        client = self._client
        own = client is None
        if own:
            client = httpx.AsyncClient(timeout=self.timeout_s)
        try:
            r = await client.post(
                self.url,
                headers={"content-type": "application/json", "x-ia-secreto": self.secret},
                json={"action": action, "key": key, "owner": self.owner,
                      "lease_s": self.lease_s})
            r.raise_for_status()
            out = r.json()
            return out if isinstance(out, dict) else {}
        finally:
            if own:
                await client.aclose()

    async def claim(self, key: str) -> bool:
        # A claim service that cannot be reached must NOT be read as "go ahead":
        # that would turn a network blip into a double run. The exception
        # propagates, the handler does not run, and the message is retried.
        return bool((await self._post("claim", key)).get("claimed"))

    async def complete(self, key: str) -> None:
        await self._post("complete", key)

    async def release(self, key: str) -> None:
        await self._post("release", key)


def claims_from_env(cfg: Config | None = None, log: Any = None, client: Any = None) -> Claims:
    c = cfg or config()
    if c.claim_url:
        return ApiClaims(c.claim_url, c.claim_secret, c.worker,
                         lease_s=c.claim_lease_s, client=client)
    return MemoryClaims(log)


# ---------------------------------------------------------------------------
# CONSUME
Handler = Callable[[dict[str, Any], Envelope], Awaitable[None] | None]


@dataclass(slots=True)
class Stats:
    taken: int = 0
    done: int = 0
    duplicate: int = 0
    retried: int = 0
    dead: int = 0
    malformed: int = 0
    requeued: int = 0

    def as_dict(self) -> dict[str, int]:
        return {"taken": self.taken, "done": self.done, "duplicate": self.duplicate,
                "retried": self.retried, "dead": self.dead, "malformed": self.malformed,
                "requeued": self.requeued}


class Consumer:
    """One queue's worth of delivery handling: dedupe, run, ack, retry or DLQ.

    Deliberately given the pieces it needs rather than a connection, so a test
    can drive it with a fake message and a fake exchange -- and so the retry path
    publishes on the SAME channel the delivery came from.
    """

    def __init__(self, *, exchange: str, exchanges: Mapping[str, Any],
                 handlers: Mapping[str, Handler], claims: Claims, log: Any = None,
                 handler_timeout_s: float = 60.0, publish_timeout_s: float = 10.0,
                 make_message: Callable[[Mapping[str, Any]], Any] = _aio_message) -> None:
        self.exchange = exchange
        self.exchanges = exchanges
        self.handlers = handlers
        self.claims = claims
        self.log = log
        self.handler_timeout_s = handler_timeout_s
        self.publish_timeout_s = publish_timeout_s
        self.make_message = make_message
        self.stats = Stats()
        self.inflight: set[asyncio.Task[None]] = set()

    async def _dead_letter(self, message: Any, why: str) -> None:
        _say(self.log, "error", f"bus: dead-lettering -- {why}")
        # requeue=False is what sends it to the queue's x-dead-letter-exchange.
        await message.nack(requeue=False)

    async def on_message(self, message: Any) -> None:
        self.stats.taken += 1
        try:
            env = Envelope.parse(message.body)
        except MalformedEnvelope as e:
            # Unreadable bytes cannot be retried into readability. Straight to the
            # DLQ, where they are visible and replayable instead of dropped.
            self.stats.malformed += 1
            await self._dead_letter(message, f"malformed envelope: {e}")
            return

        fn = self.handlers.get(env.type)
        if fn is None:
            # A type nobody here handles means a binding wider than the handler
            # set. trabajos.js can put such a job back to 'pendiente' because
            # another instance may know it; a broker cannot without a requeue
            # loop, so it is parked in the DLQ, counted, and replayable once the
            # handler ships.
            self.stats.dead += 1
            await self._dead_letter(message, f'no handler for type "{env.type}"')
            return

        if not await self.claims.claim(env.idempotency_key):
            self.stats.duplicate += 1
            _say(self.log, "info",
                 f"bus: duplicate {env.type} key={env.idempotency_key} -- already claimed, acking")
            await message.ack()
            return

        try:
            async with asyncio.timeout(self.handler_timeout_s):
                r = fn(env.payload, env)
                if asyncio.iscoroutine(r):
                    await r
        except Exception as e:  # a bad message must not take the worker down
            # Let the retry run: without the release, the scheduled retry would
            # look like a duplicate and be acked away.
            await self.claims.release(env.idempotency_key)
            await self._fail(message, env, e)
            return

        await self.claims.complete(env.idempotency_key)
        await message.ack()
        self.stats.done += 1

    async def _fail(self, message: Any, env: Envelope, err: BaseException) -> None:
        if env.attempt >= MAX_ATTEMPTS:
            self.stats.dead += 1
            await self._dead_letter(
                message, f"{env.type} failed {env.attempt} attempts, last: {err}")
            return
        ms = delay_for(env.attempt)
        target = self.exchanges.get(retry_exchange(self.exchange, ms))
        try:
            if target is None:
                raise PublishNotConfirmed(f"retry exchange for {ms}ms was never declared")
            await publish_on(target, env.next_attempt(), timeout_s=self.publish_timeout_s,
                             make_message=self.make_message)
        except PublishNotConfirmed as pe:
            # The retry could not be handed to the broker. Requeue ONCE: this is
            # the single place a requeue is correct, because the alternative is
            # losing the message -- and it cannot spin, since a delivery that
            # comes back already redelivered goes to the DLQ instead.
            if getattr(message, "redelivered", False):
                self.stats.dead += 1
                await self._dead_letter(message, f"retry publish failed twice for {env.type}: {pe}")
            else:
                self.stats.requeued += 1
                _say(self.log, "error",
                     f"bus: retry publish failed for {env.type}, requeueing once: {pe}")
                await message.nack(requeue=True)
            return
        await message.ack()
        self.stats.retried += 1
        _say(self.log, "warning",
             f"bus: {env.type} attempt {env.attempt} failed, retry in {ms}ms: {err}")

    # The consume callback: aio-pika awaits it per delivery. The task set is what
    # graceful shutdown drains.
    async def dispatch(self, message: Any) -> None:
        task = asyncio.current_task()
        if task is not None:
            self.inflight.add(task)
        try:
            await self.on_message(message)
        except Exception as e:  # never let one delivery kill the consumer
            _say(self.log, "error", f"bus: consumer loop error: {e}")
        finally:
            if task is not None:
                self.inflight.discard(task)

    async def drain(self, timeout_s: float) -> Stats:
        """Waits for in-flight handlers to finish and ack. Called after cancel."""
        if self.inflight:
            done, pending = await asyncio.wait(set(self.inflight), timeout=timeout_s)
            del done
            if pending:
                _say(self.log, "error",
                     f"bus: {len(pending)} message(s) still in flight after {timeout_s}s; "
                     "they will be redelivered")
        return self.stats


# ---------------------------------------------------------------------------
# DRIVER
async def _aio_connect(url: str) -> Any:
    import aio_pika

    return await aio_pika.connect(url)


# ---------------------------------------------------------------------------
# WORKER: one connection, reconnect with backoff, topology re-declared every time
class Worker:
    """Consumes one queue until stop(), surviving broker restarts.

    connect_robust() from aio-pika would recover a connection on its own, and it
    is deliberately NOT used: the reconnect policy, its numbers and the
    re-declaration of the topology are part of this contract and are written once
    per runtime, with the same numbers on both sides. Two recovery mechanisms
    stacked on top of each other is one too many to reason about.
    """

    def __init__(self, *, queue: str, patterns: Iterable[str],
                 handlers: Mapping[str, Handler], claims: Claims | None = None,
                 cfg: Config | None = None, log: Any = None,
                 connect: Callable[[str], Awaitable[Any]] = _aio_connect,
                 make_message: Callable[[Mapping[str, Any]], Any] = _aio_message) -> None:
        self.cfg = cfg or config()
        self.queue = queue
        self.patterns = tuple(patterns)
        self.handlers = dict(handlers)
        self.claims = claims
        self.log = log
        self.connect = connect
        self.make_message = make_message
        self.consumer: Consumer | None = None
        self._stop = asyncio.Event()
        self._connection: Any = None
        self._channel: Any = None
        self._tag: str | None = None
        self._queue_obj: Any = None

    async def run(self) -> None:
        if not announce(self.log, self.cfg):
            # Nothing to consume and nothing to crash about: hold until stopped so
            # the container does not restart-loop over a missing variable.
            await self._stop.wait()
            return
        attempts = 0
        while not self._stop.is_set():
            closed = asyncio.Event()
            try:
                self._connection = await self.connect(self.cfg.url)
                self._channel = await self._connection.channel(publisher_confirms=True)
                await self._channel.set_qos(prefetch_count=self.cfg.prefetch)
                _watch_close(self._connection, closed)
                # Re-declared on EVERY connect, not once at boot: after a broker
                # restart from an empty volume the exchanges are gone, and a
                # consumer that assumes otherwise consumes nothing, silently.
                decl = await declare_topology(
                    self._channel, topology(self.cfg.exchange, self.queue, self.patterns))
                self.consumer = Consumer(
                    exchange=self.cfg.exchange, exchanges=decl.exchanges,
                    handlers=self.handlers,
                    claims=self.claims or claims_from_env(self.cfg, self.log),
                    log=self.log, handler_timeout_s=self.cfg.handler_timeout_s,
                    publish_timeout_s=self.cfg.publish_timeout_s,
                    make_message=self.make_message)
                self._queue_obj = decl.queues[self.queue]
                self._tag = await self._queue_obj.consume(self.consumer.dispatch, no_ack=False)
                # Only NOW is the backoff reset. Resetting it right after connecting
                # made a broker that accepts TCP but rejects the declaration (a
                # half-configured vhost, a missing permission) retry every second
                # forever at the first rung of the ladder.
                attempts = 0
                _say(self.log, "info",
                     f"bus: consuming {self.queue} (prefetch {self.cfg.prefetch}, tag {self._tag})")
                await _first_of(closed.wait(), self._stop.wait())
                if not self._stop.is_set():
                    _say(self.log, "warning", "bus: connection closed, reconnecting")
            except Exception as e:
                if not self._stop.is_set():
                    _say(self.log, "error", f"bus: connect/consume failed: {e}")
                    # Close what was half-opened. Without this, a failure between
                    # "connected" and "consuming" leaks one connection per retry,
                    # and a broker that rejects the declare accumulates them until
                    # it refuses new ones. When stopping, stop() does the closing.
                    await self._close_transport()
            finally:
                if not self._stop.is_set():
                    self.consumer = None
                    self._tag = None
            if self._stop.is_set():
                break
            ms = reconnect_delay(attempts)
            attempts += 1
            _say(self.log, "warning", f"bus: retrying broker in {ms}ms")
            await _first_of(asyncio.sleep(ms / 1000), self._stop.wait())

    async def stop(self) -> dict[str, int]:
        """SIGTERM path, in this order: stop accepting deliveries, finish and ack
        what is in hand, then close. A message still unacked when the socket drops
        is redelivered by the broker, and the idempotency claim is what makes a
        redelivery harmless instead of a second charge."""
        # Captured BEFORE the stop flag: the run loop wakes on that flag, and if it
        # cleared these first there would be nothing left to cancel or drain.
        consumer, tag, queue_obj = self.consumer, self._tag, self._queue_obj
        self._stop.set()
        stats = Stats()
        if tag is not None and queue_obj is not None:
            try:
                await queue_obj.cancel(tag)
            except Exception as e:
                _say(self.log, "warning", f"bus: cancel failed: {e}")
            self._tag = None
        if consumer is not None:
            stats = await consumer.drain(self.cfg.drain_s)
        await self._close_transport()
        return stats.as_dict()

    async def _close_transport(self) -> None:
        for closeable in (self._channel, self._connection):
            try:
                if closeable is not None:
                    await closeable.close()
            except Exception:  # closing a closed connection is not news
                pass
        self._channel = self._connection = None


def _watch_close(connection: Any, event: asyncio.Event) -> None:
    """Sets `event` when the connection goes away, whichever hook the driver has."""
    cbs = getattr(connection, "close_callbacks", None)
    if cbs is not None and hasattr(cbs, "add"):
        cbs.add(lambda *_a: event.set())


async def _first_of(*awaitables: Awaitable[Any]) -> None:
    tasks = [asyncio.ensure_future(a) for a in awaitables]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            if not t.done():
                t.cancel()


# ---------------------------------------------------------------------------
# PUBLISHER for the service process (FastAPI side). One connection, lazily made,
# rebuilt after a failure.
class Publisher:
    """Publishes work nobody is waiting on.

    publish() returns a result instead of raising, and the result MUST be
    checked: a publish that was not confirmed is not a publish. It does not raise
    because the common caller is a request handler serving a person and a broker
    hiccup should not become their 500 -- but it must not look like success
    either, so `ok=False` comes with a reason and an error-level log.
    """

    def __init__(self, cfg: Config | None = None, log: Any = None,
                 connect: Callable[[str], Awaitable[Any]] = _aio_connect,
                 make_message: Callable[[Mapping[str, Any]], Any] = _aio_message) -> None:
        self.cfg = cfg or config()
        self.log = log
        self.connect = connect
        self.make_message = make_message
        self._connection: Any = None
        self._channel: Any = None
        self._exchanges: dict[str, Any] = {}
        self._lock = asyncio.Lock()

    async def _ensure(self) -> Any:
        if self._exchanges.get(self.cfg.exchange) is not None:
            return self._exchanges[self.cfg.exchange]
        async with self._lock:
            if self._exchanges.get(self.cfg.exchange) is not None:
                return self._exchanges[self.cfg.exchange]
            self._connection = await self.connect(self.cfg.url)
            self._channel = await self._connection.channel(publisher_confirms=True)
            decl = await declare_topology(self._channel, topology(self.cfg.exchange))
            self._exchanges = decl.exchanges
            return self._exchanges[self.cfg.exchange]

    async def publish(self, type: str, payload: Mapping[str, Any] | None = None,
                      *, key: str | None = None,
                      idempotency_key: str | None = None) -> dict[str, Any]:
        if not announce(self.log, self.cfg) or not self.cfg.enabled:
            _say(self.log, "error", f"bus: dropped {type} -- no AMQP_URL configured")
            return {"ok": False, "id": None, "reason": "bus_disabled"}
        env = make_envelope(type=type, payload=payload, key=key, idempotency_key=idempotency_key)
        try:
            exchange = await self._ensure()
            await publish_on(exchange, env, timeout_s=self.cfg.publish_timeout_s,
                             make_message=self.make_message)
            return {"ok": True, "id": env.id}
        except Exception as e:
            # Drop the channel: an unconfirmed publish usually means it is gone,
            # and the next call should build a new one instead of reusing a corpse.
            self._exchanges = {}
            _say(self.log, "error", f"bus: publish of {type} NOT confirmed: {e}")
            return {"ok": False, "id": env.id, "reason": str(e)}

    async def close(self) -> None:
        self._exchanges = {}
        for closeable in (self._channel, self._connection):
            try:
                if closeable is not None:
                    await closeable.close()
            except Exception:
                pass
        self._channel = self._connection = None
