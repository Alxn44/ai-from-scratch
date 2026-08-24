# AI service (v3). Thin image: uv resolves and installs from the lock file.
FROM python:3.13-slim

# uv instead of pip: it installs from uv.lock, so the image carries the SAME
# versions as the development machine. `pip install .` would resolve again and
# could bring a different one.
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1

# Dependencies before the code: changing a .py does not invalidate the deps layer.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN uv sync --frozen --no-dev

# The isolation proof runs AT BUILD TIME: if the ontology declares a leak, the
# image does not get built. Failing here is cheaper than failing in production.
RUN uv run ai-prove-isolation

# Drop root. This container is the one that must not run as uid 0: its
# environment holds ANTHROPIC_API_KEY, OPENROUTER_API_KEY, DEEPSEEK_API_KEY and
# the rest, so code execution as root here reads every model key at once.
# python:3.13-slim ships no unprivileged user, so create one. A fixed uid pinned
# here (not --system, which warns above SYS_UID_MAX and picks its own number)
# keeps ownership stable if a volume is ever mounted into this container.
RUN groupadd --gid 10001 ai \
 && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin ai

# uvicorn straight out of the venv instead of `uv run`: uv checks and re-syncs
# the environment on every run, which means writing to /app/.venv — something
# the ai user cannot do and should not be able to do. Putting the venv on PATH
# gives the same interpreter without the write. (The healthcheck's bare `python`
# resolves here too.) UV_COMPILE_BYTECODE above already wrote the .pyc files at
# build time, so nothing needs a writable tree at runtime.
ENV PATH="/app/.venv/bin:$PATH"
USER 10001

EXPOSE 8799
CMD ["uvicorn", "course_ai.app:app", "--host", "0.0.0.0", "--port", "8799"]
