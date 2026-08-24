"""The inter-service transport (course_ai/bus.py). No broker, no network, no aio_pika.

WHY A DOUBLE AND NOT A REAL RABBITMQ. There is no broker in docker-compose yet,
so an integration test would be a test that never runs -- and a test that never
runs is worse than none, because it makes the untested parts look tested. What a
fake channel CAN prove is everything that is a decision of this codebase rather
than of the broker: the topology declared, the persistence flag, that an
unconfirmed publish is never reported as success, the exact backoff numbers,
which exchange a retry goes to, and every path that ends in the DLQ.

What it cannot prove is listed at the bottom of this file, on purpose.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from course_ai import bus
from course_ai.bus import (
    DELAY_TIERS_MS,
    ENVELOPE_FIELDS,
    MAX_ATTEMPTS,
    PERSISTENT,
    RECONNECT_MS,
    ApiClaims,
    Config,
    Consumer,
    Envelope,
    MalformedEnvelope,
    MemoryClaims,
    PublishNotConfirmed,
    Worker,
    announce,
    config,
    declare_topology,
    delay_for,
    dlq,
    dlx,
    make_envelope,
    message_spec,
    publish_on,
    redact,
    reset_announce,
    retry_exchange,
    retry_queue,
    topology,
)

EX = "course.events"
HERE = Path(__file__).resolve().parents[2]   # repository root


# ---------------------------------------------------------------------------
# THE DOUBLES. They record; they do not pretend to be a broker.
class FakeReturned:
    """Stands in for the confirmation frame a broker sends for an unroutable message."""


class FakeDeliveryError(Exception):
    """What aio-pika raises for a nack or a basic.return."""


class FakeExchange:
    def __init__(self, name: str, behaviour: str = "ack") -> None:
        self.name = name
        self.behaviour = behaviour
        self.published: list[dict[str, Any]] = []

    async def publish(self, message: Any, routing_key: str, mandatory: bool = False,
                      timeout: float | None = None) -> Any:
        self.published.append({"message": message, "routing_key": routing_key,
                               "mandatory": mandatory, "timeout": timeout})
        if self.behaviour == "nack":
            raise FakeDeliveryError("broker said no")
        if self.behaviour == "timeout":
            raise TimeoutError("nobody answered")
        if self.behaviour == "returned_frame":
            return FakeReturned()
        return None


class FakeQueue:
    def __init__(self, name: str, durable: bool, arguments: dict[str, Any] | None) -> None:
        self.name = name
        self.durable = durable
        self.arguments = arguments
        self.binds: list[tuple[str, str]] = []
        self.consumes: list[dict[str, Any]] = []
        self.cancels: list[str] = []

    async def bind(self, exchange: Any, routing_key: str = "") -> None:
        self.binds.append((exchange.name, routing_key))

    async def consume(self, callback: Any, no_ack: bool = True) -> str:
        self.consumes.append({"callback": callback, "no_ack": no_ack})
        return "tag-1"

    async def cancel(self, tag: str) -> None:
        self.cancels.append(tag)


class FakeChannel:
    def __init__(self, publish_behaviour: str = "ack") -> None:
        self.publish_behaviour = publish_behaviour
        self.exchanges: list[dict[str, Any]] = []
        self.queues: list[dict[str, Any]] = []
        self.qos: int | None = None
        self.closed = False

    # `type` shadows the builtin because that is what aio-pika calls the argument.
    async def declare_exchange(self, name: str, type: str, durable: bool = False) -> FakeExchange:
        self.exchanges.append({"name": name, "type": type, "durable": durable})
        return FakeExchange(name, self.publish_behaviour)

    async def declare_queue(self, name: str, durable: bool = False,
                            arguments: dict[str, Any] | None = None) -> FakeQueue:
        self.queues.append({"name": name, "durable": durable, "arguments": arguments})
        return FakeQueue(name, durable, arguments)

    async def set_qos(self, prefetch_count: int) -> None:
        self.qos = prefetch_count

    async def close(self) -> None:
        self.closed = True


class FakeMessage:
    def __init__(self, body: Any, redelivered: bool = False) -> None:
        self.body = body if isinstance(body, bytes) else str(body).encode()
        self.redelivered = redelivered
        self.acked = 0
        self.nacks: list[bool] = []

    async def ack(self) -> None:
        self.acked += 1

    async def nack(self, requeue: bool = True) -> None:
        self.nacks.append(requeue)


def identity(spec: Any) -> Any:
    """A message factory that hands the spec straight through, so the recorded
    publish IS the spec and the persistence flag can be asserted."""
    return spec


def work(attempt: int = 1) -> Envelope:
    return make_envelope(type="work.do", payload={"n": 1}, idempotency_key="w-1",
                         attempt=attempt)


def msg_for(env: Envelope, **kw: Any) -> FakeMessage:
    return FakeMessage(env.to_json().encode(), **kw)


def consumer(handler: Any = None, *, behaviour: str = "ack",
             claims: Any = None, handler_timeout_s: float = 0.2) -> Consumer:
    exchanges = {EX: FakeExchange(EX, behaviour)}
    for ms in DELAY_TIERS_MS:
        exchanges[retry_exchange(EX, ms)] = FakeExchange(retry_exchange(EX, ms), behaviour)
    handlers = {"work.do": handler} if handler else {}
    return Consumer(exchange=EX, exchanges=exchanges, handlers=handlers,
                    claims=claims or MemoryClaims(quiet=True), log=None,
                    handler_timeout_s=handler_timeout_s, publish_timeout_s=0.1,
                    make_message=identity)


# ---------------------------------------------------------------------------
# 1) The envelope is the contract
def test_envelope_fields_are_frozen() -> None:
    assert ENVELOPE_FIELDS == (
        "id", "type", "key", "idempotency_key", "attempt", "produced_at", "payload")


def test_fresh_envelope_defaults() -> None:
    e = make_envelope(type="league.week.close", payload={"reason": "cron"},
                      idempotency_key="league:2026-08-17")
    assert set(e.as_dict()) == set(ENVELOPE_FIELDS)
    assert e.key == "league.week.close"        # the routing key defaults to the type
    assert e.attempt == 1
    assert e.produced_at.endswith("Z") and len(e.produced_at) == 24


def test_default_idempotency_key_is_per_message() -> None:
    # A shared default would make two unrelated publishes of the same type look
    # like one, and the second would be acked without ever running.
    assert make_envelope(type="t").idempotency_key != make_envelope(type="t").idempotency_key


def test_parse_round_trip_and_extras() -> None:
    e = work()
    assert Envelope.parse(e.to_json()) == e
    wide = Envelope.parse(json.dumps({**e.as_dict(), "trace_id": "abc"}))
    assert wide.extra == {"trace_id": "abc"}
    # An extra a newer producer added survives the republish.
    assert "trace_id" in wide.next_attempt().as_dict()


def test_next_attempt_keeps_identity() -> None:
    e = work()
    n = e.next_attempt()
    assert (n.id, n.idempotency_key, n.produced_at, n.key) == (
        e.id, e.idempotency_key, e.produced_at, e.key)
    assert n.attempt == 2


@pytest.mark.parametrize("why,raw", [
    ("not JSON", "not json at all"),
    ("not an object", "[]"),
    ("no id", json.dumps({**work().as_dict(), "id": ""})),
    ("no type", json.dumps({k: v for k, v in work().as_dict().items() if k != "type"})),
    ("attempt 0", json.dumps({**work().as_dict(), "attempt": 0})),
    ("attempt is a bool", json.dumps({**work().as_dict(), "attempt": True})),
    ("payload not an object", json.dumps({**work().as_dict(), "payload": "x"})),
])
def test_parse_refuses_garbage(why: str, raw: str) -> None:
    with pytest.raises(MalformedEnvelope):
        Envelope.parse(raw)
    assert why  # the id of the case, kept in the failure output


# ---------------------------------------------------------------------------
# 2) The backoff schedule is the one written in the comment
def test_backoff_schedule() -> None:
    assert [delay_for(a) for a in (1, 2, 3, 4, 5, 9)] == [1_000, 4_000, 16_000, 60_000,
                                                          60_000, 60_000]
    assert DELAY_TIERS_MS == (1_000, 4_000, 16_000, 60_000)
    assert MAX_ATTEMPTS == 5
    assert sum(DELAY_TIERS_MS) == 81_000     # ~81s of deliberate waiting, then the DLQ


def test_reconnect_ladder_is_its_own_policy() -> None:
    assert RECONNECT_MS == (1_000, 2_000, 4_000, 8_000, 16_000, 30_000)
    assert bus.reconnect_delay(0) == 1_000
    assert bus.reconnect_delay(99) == 30_000  # capped, never unbounded


# ---------------------------------------------------------------------------
# 3) The topology, declared and re-declarable
async def test_topology_shape() -> None:
    ch = FakeChannel()
    topo = topology(EX, "ai.work", ["ai.#", "bus.echo"])
    await declare_topology(ch, topo)
    await declare_topology(ch, topo)          # a second connect must be able to redo it

    def ex(name: str) -> list[dict[str, Any]]:
        return [e for e in ch.exchanges if e["name"] == name]

    def q(name: str) -> list[dict[str, Any]]:
        return [x for x in ch.queues if x["name"] == name]

    assert ex(EX)[0]["type"] == "topic" and ex(EX)[0]["durable"] is True
    assert ex(dlx(EX))[0]["type"] == "topic"
    assert q(dlq(EX))
    assert {"queue": dlq(EX), "exchange": dlx(EX), "pattern": "#"} in [
        dict(b) for b in topo.bindings]
    for ms in DELAY_TIERS_MS:
        assert ex(retry_exchange(EX, ms))[0]["type"] == "fanout"
        args = q(retry_queue(EX, ms))[0]["arguments"]
        assert args["x-message-ttl"] == ms
        # Back to the MAIN exchange, so the delay is the only thing the tier does.
        assert args["x-dead-letter-exchange"] == EX
    assert q("ai.work")[0]["arguments"]["x-dead-letter-exchange"] == dlx(EX)
    # Declaring twice declares the same things in the same order.
    half = len(ch.exchanges) // 2
    assert ch.exchanges[:half] == ch.exchanges[half:]


def test_publisher_only_topology_still_has_the_plumbing() -> None:
    pub = topology(EX)
    assert len(pub.queues) == 1 + len(DELAY_TIERS_MS)
    assert all(b["queue"] != "ai.work" for b in pub.bindings)


def test_queue_without_pattern_is_refused() -> None:
    with pytest.raises(bus.BusError, match="no routing patterns"):
        topology(EX, "orphan", [])


# ---------------------------------------------------------------------------
# 4) Publishing is persistent, mandatory, and only successful when confirmed
def test_message_spec_is_persistent() -> None:
    e = work()
    spec = message_spec(e)
    assert spec["delivery_mode"] == PERSISTENT == 2
    assert spec["message_id"] == f"{e.id}:1"          # unique per ATTEMPT
    assert message_spec(e.next_attempt())["message_id"] == f"{e.id}:2"
    assert spec["content_type"] == "application/json"
    assert spec["headers"]["x-bus-idempotency-key"] == "w-1"
    assert json.loads(spec["body"])["type"] == "work.do"


async def test_publish_confirmed() -> None:
    ex = FakeExchange(EX)
    e = work()
    await publish_on(ex, e, timeout_s=1.0, make_message=identity)
    assert len(ex.published) == 1
    assert ex.published[0]["routing_key"] == "work.do"
    # mandatory is on: an unroutable message must come back, not vanish.
    assert ex.published[0]["mandatory"] is True
    assert ex.published[0]["timeout"] == 1.0
    assert ex.published[0]["message"]["delivery_mode"] == 2


@pytest.mark.parametrize("behaviour", ["nack", "timeout", "returned_frame"])
async def test_publish_not_confirmed_is_never_success(behaviour: str) -> None:
    ex = FakeExchange(EX, behaviour)
    with pytest.raises(PublishNotConfirmed):
        await publish_on(ex, work(), timeout_s=0.1, make_message=identity)


# ---------------------------------------------------------------------------
# 5) Consuming: manual ack, dedupe
async def test_happy_path_acks_by_hand() -> None:
    ran = []
    c = consumer(lambda payload, env: ran.append(payload))
    m = msg_for(work())
    await c.on_message(m)
    assert ran == [{"n": 1}]
    assert (m.acked, m.nacks) == (1, [])
    assert c.stats.done == 1


async def test_same_idempotency_key_runs_once() -> None:
    ran = []

    async def h(payload: dict[str, Any], env: Envelope) -> None:
        ran.append(env.id)

    c = consumer(h)
    a, b = msg_for(work()), msg_for(work())
    await c.on_message(a)
    await c.on_message(b)
    assert len(ran) == 1
    # The duplicate is ACKED: leaving it unacked would redeliver it forever.
    assert (b.acked, b.nacks) == (1, [])
    assert c.stats.duplicate == 1


async def test_malformed_goes_straight_to_the_dlq() -> None:
    c = consumer(lambda p, e: None)
    m = FakeMessage(b"{ not json")
    await c.on_message(m)
    assert m.nacks == [False]      # requeue=False is what reaches the DLX
    assert c.stats.malformed == 1


async def test_unknown_type_is_parked_not_requeued() -> None:
    c = consumer(lambda p, e: None)
    m = msg_for(make_envelope(type="nobody.handles.this"))
    await c.on_message(m)
    assert m.nacks == [False]
    assert c.stats.dead == 1


# ---------------------------------------------------------------------------
# 6) Failure: backoff through the broker, then the DLQ
async def test_failed_attempt_is_republished_to_its_tier() -> None:
    released: list[str] = []

    class SpyClaims(MemoryClaims):
        async def release(self, key: str) -> None:
            released.append(key)
            await super().release(key)

    async def boom(payload: dict[str, Any], env: Envelope) -> None:
        raise RuntimeError("the model is down")

    c = consumer(boom, claims=SpyClaims(quiet=True))
    m = msg_for(work(1))
    await c.on_message(m)

    target = c.exchanges[retry_exchange(EX, 1_000)]
    assert len(target.published) == 1
    sent = json.loads(target.published[0]["message"]["body"])
    assert sent["attempt"] == 2
    assert sent["idempotency_key"] == "w-1"
    assert sent["key"] == "work.do"
    # A delayed message must survive a broker restart too.
    assert target.published[0]["message"]["delivery_mode"] == 2
    # The original is acked, never requeued: requeue is the hot loop.
    assert (m.acked, m.nacks) == (1, [])
    assert c.stats.retried == 1
    # And the claim is released, or the retry would look like a duplicate.
    assert released == ["w-1"]


@pytest.mark.parametrize("attempt,ms", [(1, 1_000), (2, 4_000), (3, 16_000), (4, 60_000)])
async def test_each_attempt_uses_the_next_tier(attempt: int, ms: int) -> None:
    async def boom(payload: dict[str, Any], env: Envelope) -> None:
        raise RuntimeError("still down")

    c = consumer(boom)
    await c.on_message(msg_for(work(attempt)))
    assert len(c.exchanges[retry_exchange(EX, ms)].published) == 1
    other = [x for k, x in c.exchanges.items() if k != retry_exchange(EX, ms)]
    assert all(not o.published for o in other)


async def test_ceiling_dead_letters() -> None:
    async def boom(payload: dict[str, Any], env: Envelope) -> None:
        raise RuntimeError("gave up")

    c = consumer(boom)
    m = msg_for(work(MAX_ATTEMPTS))
    await c.on_message(m)
    assert all(not x.published for x in c.exchanges.values())   # no further retry
    assert m.nacks == [False]
    assert c.stats.dead == 1


async def test_retry_publish_failure_requeues_once_then_dead_letters() -> None:
    async def boom(payload: dict[str, Any], env: Envelope) -> None:
        raise RuntimeError("boom")

    c = consumer(boom, behaviour="nack")
    first = msg_for(work(1))
    await c.on_message(first)
    # The single case where requeue is right: the alternative is losing it.
    assert first.nacks == [True]
    assert c.stats.requeued == 1

    again = msg_for(work(1), redelivered=True)
    await c.on_message(again)
    # It cannot spin: already redelivered means the DLQ.
    assert again.nacks == [False]
    assert c.stats.dead == 1


async def test_handler_that_never_returns_is_a_failure() -> None:
    async def hang(payload: dict[str, Any], env: Envelope) -> None:
        await asyncio.sleep(30)

    c = consumer(hang, handler_timeout_s=0.05)
    m = msg_for(work(1))
    await c.on_message(m)
    assert c.stats.retried == 1
    assert m.acked == 1


# ---------------------------------------------------------------------------
# 7) Graceful shutdown
async def test_drain_waits_for_in_flight_work() -> None:
    gate = asyncio.Event()

    async def slow(payload: dict[str, Any], env: Envelope) -> None:
        await gate.wait()

    c = consumer(slow, handler_timeout_s=5)
    m = msg_for(work())
    task = asyncio.create_task(c.dispatch(m))
    await asyncio.sleep(0)               # let it reach the handler
    assert m.acked == 0                  # nothing acked while the work is unfinished
    gate.set()
    stats = await c.drain(timeout_s=1.0)
    assert task.done()
    assert m.acked == 1                  # finished AND acked before drain returned
    assert stats.done == 1


async def test_drain_reports_work_it_could_not_finish() -> None:
    async def never(payload: dict[str, Any], env: Envelope) -> None:
        await asyncio.sleep(5)

    c = consumer(never, handler_timeout_s=5)
    m = msg_for(work())
    task = asyncio.create_task(c.dispatch(m))
    await asyncio.sleep(0)
    stats = await c.drain(timeout_s=0.05)
    assert stats.done == 0
    assert m.acked == 0                  # unacked, so the broker will redeliver it
    task.cancel()


# ---------------------------------------------------------------------------
# 8) No broker configured: loud, harmless, honest
def test_unset_amqp_url_is_a_disabled_bus_not_a_crash() -> None:
    c = config({})
    assert c.enabled is False
    assert c.url == ""
    assert c.exchange == "course.events"     # a name is not a host
    assert c.prefetch == 8


def test_no_host_default_and_no_credentials_in_the_source() -> None:
    src = (HERE / "ai" / "src" / "course_ai" / "bus.py").read_text()
    # A URL literal in this file would be exactly the class of default the
    # security pass removed from db.js and auth.js.
    assert "amqp://" not in src.replace('f"{head}://', "")


def test_announce_says_it_once() -> None:
    reset_announce()
    said: list[str] = []

    class L:
        def warning(self, m: str) -> None:
            said.append(m)

        def info(self, m: str) -> None:
            said.append(m)

    cfg = config({})
    assert announce(L(), cfg) is False
    assert "DISABLED" in said[0]
    announce(L(), cfg)
    assert len(said) == 1
    reset_announce()


async def test_publisher_with_no_broker_reports_failure() -> None:
    reset_announce()
    p = bus.Publisher(cfg=config({}), log=None)
    r = await p.publish("league.week.close", {})
    assert r["ok"] is False and r["reason"] == "bus_disabled"
    reset_announce()


async def test_worker_with_no_broker_parks_instead_of_exiting() -> None:
    reset_announce()
    w = Worker(queue="ai.work", patterns=("ai.#",), handlers={}, cfg=config({}))
    task = asyncio.create_task(w.run())
    await asyncio.sleep(0.01)
    assert not task.done()               # it idles; a crash-loop would read as a bug
    await w.stop()
    await asyncio.wait_for(task, timeout=1)
    reset_announce()


def test_redact_never_shows_a_password() -> None:
    assert redact("amqp://user:s3cret@broker:5672/vhost") == "amqp://***@broker:5672/vhost"
    assert redact("") == "(unset)"


# ---------------------------------------------------------------------------
# 9) Idempotency
async def test_memory_claims_semantics() -> None:
    c = MemoryClaims(quiet=True)
    assert await c.claim("k") is True
    assert await c.claim("k") is False        # somebody is on it
    await c.release("k")
    assert await c.claim("k") is True         # a failed handler frees it for the retry
    await c.complete("k")
    assert await c.claim("k") is False        # done is forever


class FakeResponse:
    def __init__(self, body: dict[str, Any]) -> None:
        self._body = body

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self._body


class FakeHttp:
    def __init__(self, body: dict[str, Any] | None = None, boom: bool = False) -> None:
        self.body = body or {}
        self.boom = boom
        self.calls: list[dict[str, Any]] = []

    async def post(self, url: str, headers: dict[str, str] | None = None,
                   json: dict[str, Any] | None = None) -> FakeResponse:
        self.calls.append({"url": url, "headers": headers or {}, "json": json or {}})
        if self.boom:
            raise RuntimeError("claim service unreachable")
        return FakeResponse(self.body)


async def test_api_claims_goes_through_the_bridge_with_the_service_secret() -> None:
    http = FakeHttp({"claimed": True})
    c = ApiClaims("http://api:8787/api/v3/interno/bus/claim", "sekret", "ai-worker-1",
                  lease_s=300, client=http)
    assert await c.claim("k") is True
    call = http.calls[0]
    assert call["headers"]["x-ia-secreto"] == "sekret"
    assert call["json"] == {"action": "claim", "key": "k", "owner": "ai-worker-1",
                            "lease_s": 300}
    # No user identity travels with it: an idempotency key is not a person, and
    # this service never sees a user id (see course_ai/__init__.py).
    assert not any(k.lower().startswith("x-ia-sesion") for k in call["headers"])


async def test_api_claims_refusal_is_a_refusal() -> None:
    c = ApiClaims("http://api/claim", "s", "w", client=FakeHttp({"claimed": False}))
    assert await c.claim("k") is False


async def test_unreachable_claim_service_does_not_mean_go_ahead() -> None:
    # Reading a network failure as "yes, run it" would turn a blip into a double
    # run. The exception propagates and the message is retried instead.
    c = ApiClaims("http://api/claim", "s", "w", client=FakeHttp(boom=True))
    with pytest.raises(RuntimeError):
        await c.claim("k")


def test_claims_from_env_picks_durable_when_told_to() -> None:
    cfg = Config(url="amqp://x", exchange=EX, prefetch=1, worker="w",
                 claim_url="http://api/claim", claim_secret="s", claim_lease_s=1,
                 handler_timeout_s=1, drain_s=1, publish_timeout_s=1)
    assert isinstance(bus.claims_from_env(cfg), ApiClaims)
    assert isinstance(bus.claims_from_env(replace(cfg, claim_url="")), MemoryClaims)


# ---------------------------------------------------------------------------
# 10) Connection loss is survivable
async def test_worker_reconnects_and_redeclares(monkeypatch: pytest.MonkeyPatch) -> None:
    # The real ladder starts at one second and is asserted in its own test; here
    # it is shortened so this stays a unit test.
    monkeypatch.setattr(bus, "RECONNECT_MS", (10, 20))
    reset_announce()
    tries = {"n": 0}
    seen: dict[str, Any] = {}

    class FakeConnection:
        def __init__(self) -> None:
            self.channel_obj = FakeChannel()
            self.closed = False

        async def channel(self, publisher_confirms: bool = False) -> FakeChannel:
            assert publisher_confirms is True     # confirms are not optional
            return self.channel_obj

        async def close(self) -> None:
            self.closed = True

    async def connect(url: str) -> FakeConnection:
        tries["n"] += 1
        conn = FakeConnection()
        if tries["n"] == 1:
            # Connected, and then the broker refuses the declaration: a
            # half-configured vhost or a missing permission. A refused TCP
            # connect takes the same path.
            async def refuse(*_a: Any, **_k: Any) -> None:
                raise PermissionError("ACCESS_REFUSED (pretend)")

            conn.channel_obj.declare_exchange = refuse   # type: ignore[method-assign]
            seen["refused"] = conn
            return conn
        seen["conn"] = conn
        return conn

    cfg = config({"AMQP_URL": "amqp://fake-host-never-contacted"})
    w = Worker(queue="ai.work", patterns=("ai.#",), handlers={"work.do": lambda p, e: None},
               claims=MemoryClaims(quiet=True), cfg=cfg, connect=connect,
               make_message=identity)
    task = asyncio.create_task(w.run())
    for _ in range(200):
        await asyncio.sleep(0.005)
        if w.consumer is not None:
            break
    assert tries["n"] >= 2, "a refused first connection must be retried, not given up on"
    # One leaked connection per retry is how a broker outage becomes a broker
    # refusing every new connection.
    assert seen["refused"].closed, "the half-opened connection must be closed"
    ch = seen["conn"].channel_obj
    assert any(e["name"] == EX for e in ch.exchanges), "topology re-declared on reconnect"
    assert ch.qos == cfg.prefetch, "prefetch is bounded on every new channel"
    await w.stop()
    await asyncio.wait_for(task, timeout=1)
    assert seen["conn"].closed and ch.closed
    reset_announce()


# ---------------------------------------------------------------------------
# 11) The two runtimes still agree (grep, not faith)
def test_js_side_declares_the_same_contract() -> None:
    js = (HERE / "api" / "src" / "bus.ts").read_text()
    assert ("export const ENVELOPE_FIELDS = ['id', 'type', 'key', 'idempotency_key', "
            "'attempt', 'produced_at', 'payload'];") in js
    for line in ("export const BASE_DELAY_MS = 1_000;", "export const DELAY_FACTOR = 4;",
                 "export const DELAY_CAP_MS = 60_000;", "export const MAX_ATTEMPTS = 5;",
                 "export const PERSISTENT = 2;",
                 "export const RECONNECT_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];"):
        assert line in js, f"api/src/bus.ts drifted: {line}"
    for name in ("`${ex}.retry.${ms}`", "`${ex}.dlx`", "`${ex}.dead`"):
        assert name in js, f"api/src/bus.ts names drifted: {name}"


# ---------------------------------------------------------------------------
# NOT PROVEN HERE, and nothing above should be read as proving it:
#   - that RabbitMQ honours x-message-ttl + x-dead-letter-exchange the way the
#     retry ladder assumes (a tier re-entering the main exchange with the
#     ORIGINAL routing key),
#   - that aio-pika raises DeliveryError for a nack and for a mandatory return,
#     and that its confirmation frame looks like the doubles here,
#   - that the durable claim works end to end: the api route ApiClaims posts to
#     does not exist yet, so only the request it sends is covered,
#   - that a real SIGTERM inside a container drains before the runtime kills it,
#   - that api and ai can read each other's BYTES -- only that the two files
#     still declare the same names and numbers.
