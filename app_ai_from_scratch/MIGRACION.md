# Migración v2 → v3

**v3 es lo actual. v1 y v2 son legacy y están deprecadas** (`Sunset: 2027-02-21`).

Cinco encargos: IA a Python, TS 7 con el compilador de Go, algoritmos y
complejidad, colas, y Go preparado para operar. Lo que sigue dice qué se hizo,
con qué número se decidió, y **qué NO se hizo y por qué**.

---

## 1 · Toda la IA a Python

| antes (v2, Node) | ahora (v3, Python) | líneas |
|---|---|---|
| `api/src/ontology.js` | `ai/src/ia/ontologia/datos.py` + `grafo.py` + `render.py` | 155 → 520 |
| `api/src/harness.js` | `ai/src/ia/agente/bucle.py` | 98 → 140 |
| `api/src/proveedores.js` | `ai/src/ia/agente/proveedores.py` | 109 → 145 |
| — | `ai/src/ia/app.py` (FastAPI) | 130 |

Los tres archivos de Node **siguen en el repo con cabecera de deprecación**, no
se importan desde `server.js`, y sus pruebas v2 siguen pasando. Se borran cuando
`/api/version` deje de contar golpes en v1 y v2.

### La frontera, y por qué está donde está

```
navegador → API (Node)  ──POST /agente/turno──→  servicio IA (Python)
                ↑                                        │
                └──POST /api/interno/herramienta ────────┘
                     (con la cookie, no con un userId)
```

**El servicio de IA no habla con Postgres.** Las herramientas las ejecuta Node,
que es el único que tiene la sesión. La razón no es de gusto: el aislamiento
entre usuarios consiste en que ninguna herramienta acepte un identificador de
persona. Si Python también consultara la base, esa regla estaría implementada
dos veces en dos lenguajes, y el día que divergieran ganaría la copia
equivocada — el mismo error que se evitó al extraer el reparto de metales a
`api/src/ligas.js`.

El servicio **nunca ve un userId**. Recibe la cookie opaca y la reenvía.

### De prosa a teorema

En v2 la ontología *describía* el aislamiento y el código lo implementaba
aparte: nada garantizaba que coincidieran. En v3 la ontología son datos y un
grafo lo **demuestra** (`ai/src/ia/ontologia/grafo.py`):

- **P1** ninguna herramienta devuelve una columna de clase `jamas`
- **P2** toda herramienta que toca una tabla con columnas `propio` declara
  alcance `sesion` o `agregado`
- **P3** ninguna firma acepta un argumento con el que expresar «otra persona»

```
grafo: 84 nodos, 95 aristas (9 tablas, 68 columnas, 7 herramientas)
columnas jamas: 29
aislamiento: P1, P2 y P3 se cumplen en las 7 herramientas
```

Se corre en cada test, en `uv run ia-prueba-aislamiento` y **en el `docker
build`**: una imagen con una fuga declarada no se construye.

La prueba está probada: `tests/test_grafo.py` mete herramientas falsas que
devuelven `labs.solution`, que leen `attempts` sin filtro y que declaran
`user_id`, y comprueba que las tres se atrapan **con el camino** que las causa.
Una prueba de aislamiento que nunca ha fallado no ha demostrado nada.

### Un error propio que hay que contar

La primera versión de P2 cerraba transitivamente las aristas de unión y
reportaba **4 violaciones falsas**: `curso_indice` sólo lee `lessons`, pero el
BFS le atribuía `lessons → labs → attempts → users`. Una prueba que grita en
verde se desactiva en una semana y entonces no protege nada. P2 se comprueba
ahora sobre las tablas que la consulta **toca**; el cierre transitivo quedó como
aviso de diseño (`vecindad_de_riesgo()`): «esto está a un join de datos
personales».

### Una fuente, un artefacto, dos lectores

Node necesita las columnas prohibidas para su guardia. En vez de copiarlas,
Python las **emite**: `uv run ia-exporta` escribe `api/src/ontologia.json` y
`api/src/ontology.js` lo lee. Si falta, el servidor **no arranca** — sin la
lista, la guardia no protege nada y seguir sería peor que parar.

---

## 2 · TS 7 con el compilador de Go (`tsgo`)

Instalado `@typescript/native-preview` 7.0.0-dev en `web/` y `api/`. Medido, no
supuesto:

| qué | tsc | tsgo | |
|---|---|---|---|
| los `.ts` de `web/` | 1.380 s | **0.208 s** | 6.6× |
| la API entera con `checkJs` | — | **0.83 s** | no existía |

**Lo que `tsgo` no hace, dicho claro:**

1. **No acelera nada en ejecución.** Es un compilador de chequeo; el código que
   corre sigue siendo el mismo JavaScript sobre el mismo V8. Cualquier promesa
   de «máximo rendimiento» por cambiar de compilador es falsa. Lo que mejora es
   el bucle de edición.
2. **No entiende `.astro`.** No hay plugin de plantilla, así que `astro check`
   sigue siendo obligatorio. Por eso `web/tsconfig.tsgo.json` incluye sólo
   `src/**/*.ts`, y `pnpm check` corre los dos (5.08 s en total, 0 errores,
   0 avisos, 56 archivos).

**Lo que sí aportó:** la API era JavaScript **sin ningún chequeo de tipos**. Con
`checkJs` encontró, en 0.83 s:

- **Un bug real que yo acababa de escribir**: `{ ...await res.json() }` en
  `api/src/ia.js`. Si el servicio devolviera `null` o texto plano (un proxy que
  responde «Bad Gateway»), el spread lanza `TypeError` y el chat cae con un 500
  sin explicación. Corregido con comprobación de forma.
- **Otro bug real**: `alias.padEnd(7)` en `api/scripts/liga-demo.mjs` sobre un
  valor `string | number | boolean`.
- **Una debilidad con consecuencia de seguridad**: `cookieOpts.sameSite` se
  ensanchaba a `string`. Alguien escribe `'Lax'` y compila igual; la cookie sale
  sin protección CSRF y nada avisa. Fijado al literal.
- **El contrato Node↔Python sin escribir**: `server.js` leía `s.proveedores` de
  un valor que el compilador sólo conocía como `object`. Ahora está declarado en
  `api/src/ia.js`, así que un cambio de clave en FastAPI lo detecta `pnpm check`.

**El baseline es 59, no 0, y es honesto.** 58 de los 59 son la misma cosa:
`req.body` y `await res.json()` se leen sin forma declarada. No son bugs — son
la marca de dónde entra dato externo sin validar. El arreglo de verdad es poner
esquema JSON por ruta (Fastify valida solo), y eso ya está hecho en las rutas
nuevas: `/api/chat` y `/api/interno/herramienta` con
`additionalProperties: false`. `api/scripts/tipos.mjs` **impide que el número
suba** sin que nadie lo note: un informe de 59 que nadie mira no protege nada;
uno que falla en 60 sí. Ya funcionó — atrapó los 10 mensajes que añadió mi
propio código de colas.

---

## 3 · Complejidad algorítmica: medir primero

### El único cuadrático que había

`api/src/ligas.js` calculaba el total de labs con una subconsulta
correlacionada. `EXPLAIN (ANALYZE, BUFFERS)` con 11 usuarios y 74 primeras
veces:

```
SubPlan 2
  -> CTE Scan on primera q  (actual time=0.001..0.002 rows=8 loops=9)
```

`loops=9` — una relectura de la CTE **por usuario**: O(U × P). Con 11 usuarios
es invisible; con 10.000 no. Agregando `totales` una sola vez y uniendo:

| | ejecución | planificación | forma |
|---|---|---|---|
| antes | 1.314 ms | 2.194 ms | O(U × P), `SubPlan`, `loops=9` |
| después | **0.603 ms** | **1.090 ms** | O(U + P), todo `loops=1` |

Verificado además que devuelve las mismas 9 filas con los mismos totales.

**Y lo que la medición dijo que NO hay que hacer:** la planificación costaba más
que la ejecución (2.194 ms contra 1.314 ms). A este tamaño de datos no hay nada
más que optimizar en la base. Optimizar antes de medir es adivinar.

### Estructuras y complejidad donde importan

`ai/src/ia/ontologia/grafo.py`, todo declarado en el docstring:

| operación | algoritmo | complejidad |
|---|---|---|
| `alcance()` | BFS sobre lista de adyacencia | O(V+E) |
| `camino()` | BFS con padres | O(V+E) |
| `orden_topologico()` | Kahn | O(V+E) |
| `prueba_aislamiento()` | \|H\| BFS | O(\|H\|·(V+E)) |

Se eligió BFS memoizado y no el cierre transitivo de Floyd-Warshall (O(V³)):
con V=84 sería **16 veces más trabajo para responder menos**. Y no se metió
recursividad donde la iteración es correcta — la reconstrucción del camino desde
los padres es iterativa porque así es como se escribe.

El **orden topológico** dio un hallazgo: con las aristas de unión (simétricas)
Kahn metía 7 de 9 tablas en un ciclo. Hacía falta un segundo conjunto de aristas
**dirigidas** de clave ajena (`depende_de`). Con ellas sale el orden real de
borrado de una cuenta, que hoy estaba implícito en el código:

```
attempts → role_audit → ranking_optin → payments → league_week
         → achievements → labs → users → lessons
```

El índice de la cola también es la consulta, no un adorno:
`CREATE INDEX jobs_listos ON jobs (estado, corre_en) WHERE estado = 'pendiente'`.

---

## 4 · Colas: Postgres, no RabbitMQ (todavía)

### El único trabajo que de verdad no puede ser síncrono

El webhook de Mercado Pago. Antes verificaba la firma y **entonces** llamaba a
la API de Mercado Pago y escribía dos veces en la base, todo antes de responder
200. Dos consecuencias reales:

- si su API tarda, MP da timeout y **reintenta**; el `paid = 1` del comprador
  quedaba a merced de la política de reintentos de un tercero;
- si el fetch falla, respondemos 500 y **el evento se pierde** salvo que MP
  insista.

Ahora: verifica la firma → **encola** → responde 200 en milisegundos → un obrero
lo procesa con reintentos.

### Por qué no RabbitMQ

Un broker resuelve fan-out entre servicios, throughput alto y consumidores en
varias máquinas. Hoy hay **un** trabajo, **un** consumidor y un pago único de
USD 9.99 por persona. Añadirlo sería un contenedor más, un protocolo más, una
cola de mensajes muertos que vigilar y un modo de fallo nuevo (broker caído =
pagos sin procesar) para mover un mensaje de vez en cuando.

`FOR UPDATE SKIP LOCKED` da semántica de cola de verdad sobre una base que ya
está desplegada y respaldada. Es la técnica de pgmq, Oban y Solid Queue; no es
un apaño. Verificado con dos obreros simultáneos: 12 trabajos, 12 ids distintos,
ninguno tomado dos veces.

### Cuándo cambiar (condiciones, no opiniones)

1. más de ~50 trabajos/segundo sostenidos, **o**
2. un consumidor que no es este proceso (correo, PDF en otra máquina), **o**
3. hace falta fan-out: un evento con varios interesados.

**Preparado para operar:** `encola()` y el bucle de obrero son la única
frontera. Un driver de RabbitMQ sustituye `tomaLote()` y `termina()` sin tocar
quién encola ni quién ejecuta.

21 comprobaciones en `api/test/cola.mjs`: idempotencia por clave, SKIP LOCKED,
espera exponencial con techo (2 s → 1024 s), muerte a los 6 intentos **sin
borrar el trabajo** (un pago perdido sin rastro es peor que uno visible en
estado `muerto`), y un tipo sin manejador que se queda pendiente.

### Un bug de diseño que encontró una prueba

La primera versión tomaba cualquier trabajo vencido. La prueba de la cola empezó
a fallar porque el obrero del servidor en marcha se comía los trabajos `test.*`,
no encontraba manejador y **los mataba**. El síntoma era del test; el bug era de
producción: en un despliegue rodado la instancia vieja mata trabajos de un tipo
nuevo que la instancia nueva sí sabría ejecutar.

Arreglado: `tomaLote()` filtra por los tipos que ese proceso sabe ejecutar
(`tipo = ANY(?)`). Un tipo que nadie sabe hacer se queda pendiente — y
`estadoCola()` lo cuenta como **huérfano**, porque un trabajo que nadie toma y
nadie cuenta es un trabajo perdido en silencio.

---

## 5 · Go: preparado para operar, sin escribir Go

**No hay código Go, y es lo correcto hoy.** Escribir un servicio en Go que
sustituya algo que responde en 0.6 ms no es preparación, es trabajo que hay que
mantener sin nada que devuelva.

Lo que sí está preparado es la **posibilidad**: los tres servicios se hablan por
HTTP con JSON y contratos escritos (`api/src/ia.js` declara el de IA; FastAPI
publica el suyo en `/docs`). Cualquiera puede reimplementarse en Go sin tocar
los otros dos.

**El primer candidato NO es la API.** Fastify con 4 usuarios está a órdenes de
magnitud de su límite. Y no es el servicio de IA: pasa el 99 % del tiempo
esperando a un modelo — es I/O, y `asyncio` ya lo hace bien. Cambiarlo a Go
mejoraría el 1 % del tiempo.

El primer candidato real será lo primero que sea **CPU-bound o de muchas
conexiones a la vez**. Hoy no existe. Cuando exista:

| trabajo futuro | por qué Go | disparador |
|---|---|---|
| generación de PDF a demanda | CPU y memoria por petición | > 1 PDF/s o p95 > 3 s |
| presencia / tabla en vivo por WebSocket | miles de conexiones ociosas | > 5.000 conexiones simultáneas |
| obrero de la cola en varias máquinas | consumo constante, binario suelto | > 50 trabajos/s (el mismo umbral que RabbitMQ) |

Hasta que alguno se cumpla, la decisión es no. Y queda escrita para que la
próxima persona no la tenga que volver a discutir.

---

## Cómo se comprueba todo

```bash
# IA (Python)
uv --directory ai run pytest -q               # 33 pruebas
uv --directory ai run ia-prueba-aislamiento   # P1, P2, P3
uv --directory ai run ia-exporta              # regenera api/src/ontologia.json

# API (Node)
pnpm --dir api test                           # aislamiento + harness v2 + cola + puente v3
pnpm --dir api check                          # tipos con tsgo, contra baseline

# Frontend
pnpm --dir web check                          # tsgo (.ts) + astro check (.astro)

# Todo junto
docker compose up --build                     # db + ia + api + web
```
