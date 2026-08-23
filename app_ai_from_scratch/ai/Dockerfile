# Servicio de IA (v3). Imagen delgada: uv resuelve e instala desde el lock.
FROM python:3.13-slim

# uv en vez de pip: instala desde uv.lock, asi la imagen trae las MISMAS
# versiones que la maquina de desarrollo. `pip install .` resolveria de nuevo y
# podria traer otra.
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1

# Las dependencias antes del codigo: cambiar un .py no invalida la capa de deps.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN uv sync --frozen --no-dev

# La prueba de aislamiento corre EN EL BUILD: si la ontologia declara una fuga,
# la imagen no se construye. Es mas barato fallar aqui que en produccion.
RUN uv run ia-prueba-aislamiento

EXPOSE 8799
CMD ["uv", "run", "uvicorn", "ia.app:app", "--host", "0.0.0.0", "--port", "8799"]
