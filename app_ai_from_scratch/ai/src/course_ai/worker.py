"""ai-worker: the consumer entrypoint of the `ai` image.

    docker compose: image ./ai, command `python -m course_ai.worker`  (or `ai-worker`)

SAME IMAGE, DIFFERENT COMMAND, and that is the point (docs/ARCHITECTURE.md, the
container table): a worker built from different code than the service has an idea
of a tool that can drift from the service's, and nothing detects the drift until
a job produces a wrong answer. Sharing the image makes the divergence impossible
to express -- this file imports the very same ontology graph the FastAPI app does.

WHAT THIS PROCESS IS NOT

  - It is not an orchestrator. It starts nothing on anybody's behalf: it consumes
    the routing keys its queue is bound to and runs the handler. The policy lives
    in bus.py, which is a library compiled into both services.
  - It is not a second job system. `api/src/trabajos.js` is the Postgres queue and
    it stays; the broker carries cross-service work. The boundary is written down
    at the top of bus.py.
  - It is not on any path a human waits on. The chat turn stays on HTTP.
  - It still does not touch Postgres. Nothing here opens a database connection;
    the idempotency claim goes over the internal bridge to `api`, which owns the
    row. The isolation guarantee in course_ai/__init__.py is unchanged.

WITHOUT A BROKER. If AMQP_URL is unset this process says so loudly and then idles
instead of exiting: a container with a restart policy would otherwise crash-loop,
and a crash-loop reads as a bug in this file rather than as a missing variable.
"""

from __future__ import annotations

import asyncio
import logging
import signal
from typing import Any

from .bus import Worker, announce, config
from .ontology.graph import GRAPH

log = logging.getLogger("ai-worker")

# ---------------------------------------------------------------------------
# QUEUE AND BINDINGS
#
# One queue for this consumer, bound by routing key to the topic exchange. The
# patterns are the contract with every publisher: widen them only together with a
# handler, because a delivery this process cannot handle goes to the DLQ.
QUEUE = "ai.work"
PATTERNS = ("ai.#", "bus.echo")


# ---------------------------------------------------------------------------
# HANDLERS. Only work that actually exists is registered. A handler that pretends
# to do something is worse than a routing key nobody publishes.
async def ontology_verify(payload: dict[str, Any], envelope: Any) -> None:
    """Re-runs the isolation proof over the ontology graph.

    Belongs on the broker and not on an HTTP route: nobody waits for it, it is
    pure CPU over a graph, and the answer matters even when it is asked by a
    deploy hook rather than by a person. The build already runs it once
    (`ai-prove-isolation` in the Dockerfile); this is the same check available
    to anything that can publish a message.
    """
    faults = GRAPH.prove_isolation()
    if faults:
        # Loud, and NOT an exception: retrying will not change a graph. The
        # violation is the result, so it is reported and the message is acked.
        log.error("ontology isolation FAILED with %d violation(s): %s",
                  len(faults), ", ".join(f"{v.tool}:{v.rule}" for v in faults))
    else:
        log.info("ontology isolation clean (asked by %s, msg %s)",
                 payload.get("reason", "unknown"), envelope.id)


async def echo(payload: dict[str, Any], envelope: Any) -> None:
    """The smoke-test type.

    Both workers bind `bus.echo`, so one published message proves the topic
    exchange fans out to two services and that both of them consume -- which is
    the property docs/ARCHITECTURE.md claims and nothing else exercises.
    """
    log.info("echo id=%s attempt=%d payload=%s", envelope.id, envelope.attempt, payload)


HANDLERS = {
    "ai.ontology.verify": ontology_verify,
    "bus.echo": echo,
}

# Types that belong to this queue but have no implementation yet are NOT
# registered and NOT bound: `ai.grading.batch.requested`, `ai.embeddings.requested`,
# `ai.search.reindex.requested`. Bind them the day the handler ships, in the same
# commit, so nothing ever routes to a queue that will only dead-letter it.


async def run() -> None:
    cfg = config()
    announce(log, cfg)
    worker = Worker(queue=QUEUE, patterns=PATTERNS, handlers=HANDLERS, cfg=cfg, log=log)

    # SIGTERM is how a container is asked to stop, and the order matters: cancel
    # the consumer so no new delivery arrives, let what is in hand finish and be
    # acked, then close. A message still unacked when the socket drops is
    # redelivered, and the idempotency claim is what makes a redelivery harmless.
    loop = asyncio.get_running_loop()
    stopping = asyncio.Event()

    async def leave(sig: str) -> None:
        if stopping.is_set():
            return
        stopping.set()
        log.warning("%s: draining", sig)
        stats = await worker.stop()
        log.info("drained: %s", stats)

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, lambda s=sig: asyncio.create_task(leave(s.name)))
        except NotImplementedError:  # pragma: no cover - Windows only
            pass

    if cfg.enabled:
        log.info("bound %s to [%s] on %s", QUEUE, ", ".join(PATTERNS), cfg.exchange)
    await worker.run()


def main() -> None:
    """Console-script entrypoint (`ai-worker`), also used by `python -m course_ai.worker`."""
    logging.basicConfig(level=logging.INFO, format="[ai-worker] %(levelname)s %(message)s")
    asyncio.run(run())


if __name__ == "__main__":
    main()
