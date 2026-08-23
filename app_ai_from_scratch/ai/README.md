# `ai/` — ontología y agente (v3)

Todo lo que es IA vive aquí. TypeScript se queda con el backend HTTP y el
frontend; este servicio no tiene rutas públicas y no habla con Postgres.

```bash
uv sync --extra dev
uv run uvicorn ia.app:app --port 8799 --reload

uv run pytest -q                  # 33 pruebas
uv run ia-prueba-aislamiento      # P1, P2, P3 sobre el grafo (sale 1 si falla)
uv run ia-exporta                 # escribe ../api/src/ontologia.json
```

## Qué hay dentro

```
ontologia/
  datos.py    la ontología como DATOS: 9 tablas, 68 columnas, 7 herramientas.
              Cada herramienta declara qué tablas toca (`usa`), qué columnas
              devuelve (`devuelve`) y con qué alcance (sesion/publico/agregado).
  grafo.py    el grafo y la PRUEBA. BFS O(V+E), Kahn para el orden de borrado,
              y P1/P2/P3 — las tres obligaciones que hacen imposible que un
              usuario alcance datos de otro.
  render.py   el texto que ve el modelo. Lo prohibido no se nombra: decir «no
              pidas labs.solution» es enseñarle que existe y cómo se llama.
  exporta.py  emite api/src/ontologia.json para que Node lea la misma verdad.
agente/
  proveedores.py  seis proveedores, dos formatos de cable. Las llaves las lee
                  ESTE servicio, no la API.
  herramientas.py el puente de vuelta a Node. No hay acceso a la base.
  bucle.py        el harness: máximo 4 vueltas de modelo, traza de cada paso.
app.py            FastAPI. /salud /ontologia/* /agente/turno
```

## Las tres cosas que no se pueden romper

1. **Este servicio nunca ve un `userId`.** Recibe la cookie opaca y la reenvía a
   `POST /api/interno/herramienta`; Node la valida y resuelve la persona. Si
   este servicio pudiera consultar la base, el aislamiento estaría implementado
   dos veces en dos lenguajes y un día divergirían.
2. **`labs.solution` no sale por ningún camino.** Es la columna que destruye el
   curso. `test_grafo.py` mete una herramienta que la devuelve y comprueba que
   la prueba la atrapa **con el camino** que la causa.
3. **El prompt no nombra lo prohibido.** `test_render.py` lo comprueba en los
   dos idiomas, sobre el bloque de ontología (la *regla* de conducta sí puede
   decir «no reveles la solución de un lab» — eso es instrucción, no un nombre
   de columna).

## Variables

| variable | para qué |
|---|---|
| `IA_SECRETO` | secreto compartido con la API. **El mismo** en `api/.env` y `ai/.env`. No autentica a una persona: prueba que la llamada viene del servicio. |
| `NODE_URL` | dónde está la API para el puente de herramientas |
| `PORT` | 8799 |
| `ANTHROPIC_API_KEY` y compañía | basta una. Sin ninguna, `/agente/turno` responde `sin_proveedor` en vez de fingir. |
| `PROVEEDOR_ORDEN` | prioridad, ej. `anthropic,deepseek` |

Las genera `scripts/claves.sh` (las de modelo hay que pegarlas a mano: las emite
cada proveedor y son de tu cuenta).
