# Database ontology for the AI agent

> Generated from `ai/src/course_ai/ontology/data.py` by `ai-doc`.
> Regenerate with `pnpm ontology`. Do not edit by hand — edit `data.py`.

16 tables · 120 columns · 44 tools · 62 `jamas` columns · 13 `de_pago` columns

## Isolation is not in the prompt

A user cannot obtain another user's data through the agent, and the reason is not that the prompt asks nicely: it is that **no tool accepts a user identifier**. The id comes off the session cookie, on the server. The model has no way to express «somebody else's data», so the classic attack — putting instructions inside your own alias or a lab answer — has nowhere to go: at worst the agent returns the asker's own data again.

There is no SQL either. There are 44 functions with declared arguments, and an argument key that is not declared is **discarded and written to the server log**. Nothing about it comes back in the response. That is deliberate: the rejected key used to be echoed to the model as `_ignorado`, which told it exactly which name had just been refused — an invitation to try the next one — while leaving no trace an operator could read. A rejected identity argument is the highest-signal event this surface produces, so it goes where the operator looks and nowhere else.

## Two axes, and they are orthogonal

`clase` answers **whose data is this** — privacy. `muro` answers **who paid to read it** — entitlement. They are independent, and collapsing them into one is what let through the most expensive leak in the project.

`lessons.technical` is classified `publico`, and correctly so: it is identical for everybody and there is nothing personal in it. The isolation proof was green while four tools handed it to accounts that had not paid. The proof was not broken — the paywall rule could not be *expressed* in the model, so no test could check it. One axis, and the hottest rule in the product was invisible.

So a column carries both: `publico` + `de_pago` is ordinary paid course content, and it is the combination that used to be inexpressible.

| axis | values | what it means |
|---|---|---|
| `clase` | `publico` `propio` `agregado` `jamas` | whose data it is |
| `muro` | `gratis` `de_pago` | whether reading it needs an entitlement |

## The four obligations

Proved over the graph on every test run, in the Docker build (`ai-prove-isolation`) and before the artifact is written. If all four hold, a user cannot reach another user's data, a forbidden column, or content they did not pay for, by any declared path.

| | obligation |
|---|---|
| **P1** | No tool RETURNS a column of class `jamas`. |
| **P2** | Every tool that reaches a table with `propio` columns declares scope `sesion` or `agregado`. Reaching it as `publico` means a query with no per-user filter. |
| **P3** | No signature accepts an argument that can express «another person». |
| **P4** | No tool returns a `de_pago` column without declaring that it checks entitlement. |

P4 is the youngest and the reason the second axis exists: P1..P3 were green while the course was being handed out for free.

## Tools

Read from the registry itself, by `scripts/emit-tool-catalog.mjs`, which imports `api/src/tools/index.ts` rather than scanning it. The families are the registry's own grouping, in its own order. The `native` section below it is not in that registry: those tools are executed by this service, and `runner` in `data.py` is what says so.

### family `contenido` · 11

| tool | what it does | arguments | scope | paywalled |
|---|---|---|---|---|
| `curso_indice` | Las 12 lecciones con su titulo, su numero ancla y cuantos labs tiene cada una. | — | `publico` | — |
| `leccion` | El contenido completo de una leccion y el enunciado de sus tres labs. Nunca trae las respuestas. | `n` (entero 1..12) | `sesion` | yes |
| `leccion_texto` | La explicacion tecnica, la analogia y los dos ejemplos resueltos de una leccion, en el idioma de la sesion. Es con lo que hay que ensenar antes de mandar al lab. | `n` (entero 1..12) · `idioma` (opcional · «es» o «en»; por defecto el de la sesion) | `sesion` | yes |
| `buscar_en_curso` | Busca una palabra o una idea en las 12 lecciones y en los enunciados de los labs, y dice en que leccion esta. Usala antes de responder de memoria. | `consulta` (texto libre: «tokens», «por que inventa cosas») | `sesion` | yes |
| `glosario` | Que significa un termino del curso (token, perilla, temperatura, contexto...) y en que leccion se explica. Sin argumento devuelve la lista de terminos. | `termino` (opcional · una palabra o expresion) | `publico` | — |
| `lab_ficha` | Un lab suelto: enunciado, nivel, como se responde su mecanica y si esta persona ya lo resolvio. Nunca la solucion. | `lab_id` (texto como «5.2») | `sesion` | yes |
| `quiz_leccion` | El quiz rapido de una leccion: tres preguntas de opcion, sin las respuestas. Dice si esta persona ya las acerto. | `n` (entero 1..12) | `sesion` | yes |
| `examen` | Un examen de bloque (1: lecciones 1-4, 2: 5-8, 3: 9-12): preguntas sin respuestas, nota de corte y si esta persona ya lo aprobo. | `n` (entero 1..3) | `sesion` | yes |
| `requisitos_leccion` | Si esta persona puede saltar a una leccion: que deberia traer entendido, como va en la anterior y si tiene la leccion abierta. | `n` (entero 1..12) | `sesion` | — |
| `consulta_campos` | La superficie del planificador seguro: tablas, columnas legibles, operadores y limites. | — | `publico` | — |
| `consulta` | Compone una lectura segura con tabla, columnas, filtros, agregados, orden y limite; nunca recibe SQL ni un identificador de persona. | `table` (tabla declarada por consulta_campos) · `select` (columnas legibles) · `where` (filtros AND sobre columnas legibles) · `group` (columnas seleccionadas para agrupar) · `aggregate` (count, sum, avg, min o max) · `order` (columnas devueltas y direccion) · `limit` (entero 1..500) | `sesion` | — |

### family `propio` · 16

| tool | what it does | arguments | scope | paywalled |
|---|---|---|---|---|
| `mi_panorama` | TODO el estado de esta persona de una sola vez: perfil, progreso, racha, siguiente paso, liga y que tiene en la cola. Empieza por aqui: ahorra cuatro llamadas. | — | `agregado` | — |
| `mi_progreso` | Cuantas lecciones, labs, quizzes y examenes lleva resueltos la persona de esta sesion, leccion por leccion. | — | `sesion` | — |
| `mis_intentos` | Los intentos de la persona de esta sesion en un lab, con lo que respondio. | `lab_id` (texto como «5.2») | `sesion` | yes |
| `mi_perfil` | Nombre de pila, rol, idioma y si compro el curso. Solo de la sesion actual. | — | `sesion` | — |
| `mi_siguiente_paso` | Que lab concreto sigue ahora, respetando candados y borradores. La respuesta a «que hago?». Deja el lab en la cola. | — | `sesion` | — |
| `mis_pendientes` | Los labs que le faltan, en orden de curso, marcando los que estan cerrados por compra. Opcionalmente los de una sola leccion. | `n` (opcional · entero 1..12 para filtrar por leccion) | `sesion` | — |
| `mis_errores` | Los labs que intento y no ha resuelto, con lo que respondio y que mecanica se le atraviesa. Aqui esta el patron del error. Los deja en la cola. | — | `sesion` | yes |
| `mi_racha` | Dias seguidos con actividad, mejor racha y cuando fue la ultima vez. Sirve para «llevas dos semanas sin abrirlo». | — | `sesion` | — |
| `mi_ritmo` | Cuantos labs resuelve por semana y, a ese ritmo, cuanto le falta para terminar los 36. Responde «cuanto me queda?». | — | `sesion` | — |
| `mi_historial` | Los ultimos intentos con su fecha: que toco y si acerto. Responde «que hice ayer?». | `dias` (opcional · entero 1..30, por defecto 7) | `sesion` | — |
| `mi_acceso` | Que tiene abierto y que no, y por que. La respuesta a «por que no puedo abrir la leccion 4?». | — | `sesion` | — |
| `mis_logros` | El rango de la persona de esta sesion. Un rango por cada leccion cerrada. | — | `sesion` | — |
| `logros_faltantes` | Que logros le faltan y que hay que hacer exactamente para cada uno. Responde «que me falta para el siguiente?». | — | `sesion` | — |
| `mi_liga` | Su liga de esta semana: metal, puesto, caudal y cuando cierra. Si no esta en liga, dice exactamente que falta. | — | `agregado` | — |
| `ligas_tabla` | La tabla de la liga semanal: alias, metal, puesto y caudal de quienes aceptaron aparecer. Nunca nombres ni correos. | — | `agregado` | — |
| `ranking_publico` | Alias y avance de quienes aceptaron aparecer, mas la posicion propia. Nunca nombres ni correos. | — | `agregado` | — |

### family `producto` · 7

| tool | what it does | arguments | scope | paywalled |
|---|---|---|---|---|
| `como_funciona` | Como funciona la plataforma: lecciones, labs, logros, ranking y ligas. Para «que es esto?» y «como se usa?». | — | `publico` | — |
| `donde_encuentro` | En que pagina de la plataforma se hace algo. Para «donde cambio el idioma?», «donde veo mi puesto?». Devuelve la ruta exacta. | `consulta` (texto libre: «cambiar el tema», «descargar el pdf») | `publico` | — |
| `precio_y_compra` | Cuanto cuesta, que incluye, la garantia y si esta persona ya lo compro. El precio sale del mismo sitio que el checkout. | — | `sesion` | — |
| `mis_datos_y_privacidad` | Que guarda la plataforma de esta persona, que puede ver el agente y como borrar la cuenta. Para «que sabes de mi?». | — | `sesion` | — |
| `descargar_pdf` | Si esta persona puede descargar el PDF del curso, en que idiomas y desde donde. | — | `sesion` | — |
| `soporte` | Que hacer cuando algo no funciona: responde el problema frecuente que casa y, si no, como escribirle a una persona. | `tema` (opcional · el problema en palabras de la persona) | `publico` | — |
| `ajustes` | Idioma y tema que tiene puestos, que valores existen y donde se cambian. | — | `sesion` | — |

### family `coordinar` · 7

| tool | what it does | arguments | scope | paywalled |
|---|---|---|---|---|
| `plan_estudio` | Arma un plan con los siguientes labs en orden y lo deja en la cola. Despues, cada `cola_siguiente` entrega uno ya resuelto con su contexto. | `sesiones` (opcional · entero 1..12, cuantos labs planear; por defecto 5) | `sesion` | — |
| `cola_siguiente` | Saca lo primero de la cola y lo devuelve YA RESUELTO: ficha del lab, intentos propios, explicacion si ya lo intento y la leccion de donde sale. Una llamada en vez de tres. | — | `sesion` | yes |
| `cola_estado` | Que hay pendiente en la cola de estudio y cual es el foco actual, sin sacar nada. | — | `publico` | — |
| `cola_encolar` | Deja algo pendiente para mas tarde en la cola: un lab, una leccion o un tema que salio en la conversacion. | `tipo` («lab», «leccion» o «tema») · `ref` (el lab («5.2»), la leccion («7») o el tema («tokens»)) · `motivo` (opcional · por que queda pendiente) | `publico` | — |
| `foco_apilar` | Guarda donde esta la persona antes de irte por una rama de la conversacion. Despues `foco_volver` regresa aqui. | `tipo` («lab», «leccion» o «tema») · `ref` (el lab, la leccion o el tema) · `nota` (opcional · que se estaba haciendo) | `publico` | — |
| `foco_volver` | Cierra la rama actual y devuelve a donde estaba la persona antes. Para «volvamos a lo que estabamos». | — | `publico` | — |
| `bus_diagnostico` | Como va la coordinacion de esta sesion: largo de la cola, alto de la pila y cuantas consultas ahorro la cache. Para explicar de donde salio un dato. | — | `publico` | — |

### native · 3

Executed inside `/ai` by `course_ai/retrieval/`, not over the bridge. They read no table, return no column and decide no entitlement — obligation P5 requires all three — so what they answer with is lesson NUMBERS, public glossary terms, a rewritten query and the name of the bridged tool to call next. The content itself always arrives through that bridged tool, which Node executes and gates.

| tool | what it does | arguments | scope | composes |
|---|---|---|---|---|
| `entender_pregunta` | A que responde la pregunta de la persona, dicha con sus palabras: una leccion del curso (devuelve el numero, la consulta reescrita y que herramienta llamar despues), o el PRODUCTO (devuelve `intencion` y la herramienta publica que tiene el dato: precio, cuenta, ajustes, soporte…), o `sin_ruta` si no es ninguna de las dos. Usala ANTES de `buscar_en_curso` cuando la pregunta no traiga una palabra del curso: «por que se inventa cosas», «como lo hago menos aleatorio», «cuanto cuesta el curso». | `pregunta` (texto libre · la pregunta tal como la escribio la persona) · `idioma` (opcional · «es» o «en»; por defecto el de la sesion) | `publico` | `curso_indice` |
| `ampliar_consulta` | Prepara una consulta para `buscar_en_curso`: quita las palabras que salen en todas las lecciones y la reescribe con las palabras del curso, en los dos idiomas. Sin leer nada: es solo la consulta. | `consulta` (texto libre · la consulta original) · `idioma` (opcional · «es» o «en»; por defecto el de la sesion) | `publico` | — |
| `mapa_de_conceptos` | Los conceptos que cubre el curso y en que leccion esta cada uno, con sus terminos del glosario. Para «cubre esto el curso?» sin adivinar. | `concepto` (opcional · un concepto o una palabra; sin argumento devuelve todos) | `publico` | `curso_indice` |

## How the tools talk to each other: a stack and a queue

Tools never call each other. They leave work on the session bus (`api/src/agent-bus.ts`), which is three structures and nothing more:

- **queue** (FIFO) — the study plan. `plan_estudio` and `mis_errores` fill it; `cola_siguiente` takes the head **already resolved** (the lab card, the person's own attempts, the explanation if they have tried it, and the lesson it comes from): three tools in one call.
- **stack** (LIFO) — the focus. Opening a lesson or a lab pushes where the person was; if the conversation wanders, `foco_volver` returns without re-reading anything.
- **memo** — the session cache. Course content is reused for a few minutes; own data **only inside the same turn**, because between two messages the person may have solved a lab in another tab and stale progress would be a lie. What comes out of the cache travels marked `_memo: true`, and the chat trace says so.

| structure | cap |
|---|---|
| `queue` | 32 |
| `stack` | 16 |
| `memo` | 96 |
| `sessions` | 400 |

Read out of `CAPS` in `api/src/agent-bus.ts` by `scripts/emit-tool-catalog.mjs`, which imports the module. The numbers cannot drift from the code because they are not copied — they are the code's own answer at the moment this was generated.

The bus is indexed by the session's `userId`, so one person's queue is not reachable from another's. It is process memory: if the server restarts the plan is lost and nothing breaks — it gets asked for again. That is why there is no table for it.

## Tables

### `users`

**Purpose:** Una fila por persona registrada. Identidad, rol, preferencias y si compro el curso.

**Per-user scope:** El agente solo ve la fila de la sesion. Las demas filas no son alcanzables por ninguna herramienta.

**Soft delete:** deleted_at set = the row is kept so the attempts still add up, but the person no longer exists as far as the system is concerned.

**One join away:** `attempts`, `question_attempts`, `payments`, `ranking_optin`, `role_audit`, `entitlement_events`, `auth_throttles`

| column | clase | muro | nota |
|---|---|---|---|
| `id` | `jamas` | `gratis` | Identificador interno. El modelo no lo necesita y darlo invita a pedir el de otro. |
| `email` | `jamas` | `gratis` | Dato personal sin valor para ensenar. La interfaz ya lo muestra a su dueno. |
| `name` | `propio` | `gratis` | Solo el primer nombre, para dirigirse a la persona. |
| `pass_hash` | `jamas` | `gratis` | Hash scrypt. Fuera del alcance de todo el codigo que no sea auth. |
| `role` | `propio` | `gratis` | student \| tutor \| admin. Define que puede pedir, no que sabe el agente. |
| `lang` | `propio` | `gratis` | Para responder en el idioma correcto. |
| `theme` | `propio` | `gratis` | Sin valor para el agente; se expone porque no revela nada. |
| `paid` | `propio` | `gratis` | Para decir «eso se abre con la compra» sin inventar. |
| `cohort` | `propio` | `gratis` | Solo como etiqueta. NUNCA para enumerar a los companeros de cohorte. |
| `created_at` | `propio` | `gratis` | Antiguedad de la cuenta. |
| `failed` | `jamas` | `gratis` | Telemetria de seguridad. Para un tercero es senal de ataque. |
| `locked_until` | `jamas` | `gratis` | Igual que failed. |
| `deleted_at` | `jamas` | `gratis` | Estado interno del borrado suave. |
| `token_version` | `jamas` | `gratis` | Contador de invalidacion de sesiones. Solo lo toca auth. |

### `lessons`

**Purpose:** Las 12 lecciones del Vol. 1. Es el corpus con el que el agente ensena.

**Per-user scope:** Identico para todos: no hay nada personal aqui.

**One join away:** `labs`, `questions`

| column | clase | muro | nota |
|---|---|---|---|
| `n` | `publico` | `gratis` | 1..12, el orden del curso. |
| `eyebrow` | `publico` | `gratis` | Etiqueta corta del tema. |
| `title` | `publico` | `gratis` | La idea en lenguaje hablado. |
| `summary` | `publico` | `gratis` | Una frase con el concepto. |
| `math` | `publico` | `gratis` | El numero que ancla la leccion. Solo numeros, nunca formulas. |
| `math_cap` | `publico` | `gratis` | Que significa ese numero. |
| `technical` | `publico` | `de_pago` | El mecanismo con precision. Puede estar vacio mientras se redacta. |
| `analogy` | `publico` | `de_pago` | Una sola imagen cotidiana. Puede estar vacia mientras se redacta. |

### `labs`

**Purpose:** Los 36 ejercicios, tres por leccion, con su mecanica y su correccion.

**Per-user scope:** El enunciado es igual para todos. La explicacion solo se entrega si esa persona ya intento ese lab.

**One join away:** `lessons`, `attempts`

| column | clase | muro | nota |
|---|---|---|---|
| `id` | `publico` | `gratis` | «5.2» = leccion 5, ejercicio 2. |
| `lesson_n` | `publico` | `gratis` | A que leccion pertenece. |
| `idx` | `publico` | `gratis` | 1 facil, 2 medio, 3 dificil. |
| `level` | `publico` | `gratis` | facil \| medio \| dificil. |
| `kind` | `publico` | `gratis` | choice \| cut \| order \| build \| knob \| hotcold. |
| `prompt` | `publico` | `de_pago` | El enunciado. |
| `payload` | `publico` | `de_pago` | JSON de lo que se ve en pantalla: opciones, palabras, pasos. Nunca permite deducir la respuesta correcta. |
| `solution` | `jamas` | `gratis` | LA MAS IMPORTANTE. Si el agente puede leerla, «dime la respuesta del 5.2» destruye el curso. |
| `explanation` | `publico` | `de_pago` | Condicionada: solo para labs que esa persona ya intento. |
| `draft` | `publico` | `gratis` | 1 = sin escribir. Evita que el agente invente contenido. |

### `questions`

**Purpose:** Los quizzes rapidos (3 por leccion) y los tres examenes de bloque. Corregidos en el servidor.

**Per-user scope:** El enunciado es igual para todos. La explicacion solo se entrega si esa persona ya intento esa pregunta.

**One join away:** `lessons`, `question_attempts`

| column | clase | muro | nota |
|---|---|---|---|
| `id` | `publico` | `gratis` | «q01.2» o «e1.3». |
| `kind` | `publico` | `gratis` | quiz \| exam. |
| `pack` | `publico` | `gratis` | «q01»..«q12» o «e1»..«e3». |
| `idx` | `publico` | `gratis` | Orden dentro del pack. |
| `lesson_n` | `publico` | `gratis` | La leccion de la que sale la pregunta. |
| `prompt_es` | `publico` | `de_pago` | El enunciado en espanol. |
| `prompt_en` | `publico` | `de_pago` | El enunciado en ingles. |
| `payload` | `publico` | `de_pago` | Opciones. El id correcto no se deduce del orden: van barajadas. |
| `solution` | `jamas` | `gratis` | La respuesta. Si el agente la lee, el quiz deja de ensenar. |
| `explanation_es` | `publico` | `de_pago` | Condicionada: solo si esa persona ya intento. |
| `explanation_en` | `publico` | `de_pago` | Condicionada: solo si esa persona ya intento. |

### `attempts`

**Purpose:** Cada intento de cada persona en cada lab. Es de donde sale el progreso.

**Per-user scope:** Solo las filas propias. «Cuantos intentos lleva Paula» es exactamente la fuga que hay que evitar.

**One join away:** `users`, `labs`

| column | clase | muro | nota |
|---|---|---|---|
| `id` | `jamas` | `gratis` | Identificador interno. |
| `user_id` | `jamas` | `gratis` | El agente nunca lo ve ni lo escribe: sale de la sesion. |
| `lab_id` | `propio` | `gratis` | Que lab se intento. |
| `answer` | `propio` | `gratis` | Lo que respondio. Aqui esta el valor real del agente: ve el patron del error. |
| `correct` | `propio` | `gratis` | 1 acerto, 0 fallo. |
| `at` | `propio` | `gratis` | Cuando. Sirve para «llevas dos semanas sin abrirlo». |

### `question_attempts`

**Purpose:** Cada intento de cada persona en cada pregunta de quiz o examen.

**Per-user scope:** Solo las filas propias.

**One join away:** `users`, `questions`

| column | clase | muro | nota |
|---|---|---|---|
| `id` | `jamas` | `gratis` | Identificador interno. |
| `user_id` | `jamas` | `gratis` | Sale de la sesion. El agente no lo ve. |
| `question_id` | `propio` | `gratis` | Que pregunta se intento. |
| `answer` | `propio` | `gratis` | Lo que respondio. |
| `correct` | `propio` | `gratis` | 1 acerto, 0 fallo. |
| `at` | `propio` | `gratis` | Cuando. |

### `payments`

**Purpose:** Los cobros de Mercado Pago.

**Per-user scope:** Del propio usuario solo un booleano «pagado». Nada mas, ni para el.

**One join away:** `users`

| column | clase | muro | nota |
|---|---|---|---|
| `id` | `jamas` | `gratis` | Interno. |
| `user_id` | `jamas` | `gratis` | De la sesion. |
| `provider` | `jamas` | `gratis` | Sin valor para ensenar. |
| `ext_id` | `jamas` | `gratis` | Referencia de la pasarela. Sirve para soporte, no para el agente. |
| `status` | `jamas` | `gratis` | users.paid ya responde lo unico que el agente necesita. |
| `amount` | `jamas` | `gratis` | Dato financiero. |
| `currency` | `jamas` | `gratis` | Dato financiero. |
| `raw` | `jamas` | `gratis` | Respuesta completa de Mercado Pago: trae datos del pagador y metadatos de la tarjeta. |
| `at` | `jamas` | `gratis` | Dato financiero. |

### `entitlement_events`

**Purpose:** Eventos idempotentes con los que payments concede o revoca acceso.

**Per-user scope:** Nunca llega al agente. Auth deriva users.paid de la ultima transicion por fuente.

**One join away:** `users`

| column | clase | muro | nota |
|---|---|---|---|
| `id` | `jamas` | `gratis` | — |
| `event_key` | `jamas` | `gratis` | — |
| `user_id` | `jamas` | `gratis` | — |
| `active` | `jamas` | `gratis` | — |
| `source` | `jamas` | `gratis` | — |
| `external_id` | `jamas` | `gratis` | — |
| `occurred_at` | `jamas` | `gratis` | — |
| `received_at` | `jamas` | `gratis` | — |
| `period_end` | `jamas` | `gratis` | — |

### `auth_throttles`

**Purpose:** Controles temporales que auth aplica tras una decision acotada de defense.

**Per-user scope:** Telemetria y contencion de seguridad; ninguna herramienta la expone.

**One join away:** `users`

| column | clase | muro | nota |
|---|---|---|---|
| `user_id` | `jamas` | `gratis` | — |
| `expires_at` | `jamas` | `gratis` | — |
| `reason` | `jamas` | `gratis` | — |
| `updated_at` | `jamas` | `gratis` | — |

### `role_audit`

**Purpose:** Rastro de quien cambio el rol de quien.

**Per-user scope:** Ninguna herramienta lo expone. Es rastro de administracion: no hay nada que ensenar con el.

**One join away:** `users`

| column | clase | muro | nota |
|---|---|---|---|
| `id` | `jamas` | `gratis` | — |
| `actor_id` | `jamas` | `gratis` | — |
| `user_id` | `jamas` | `gratis` | — |
| `from_role` | `jamas` | `gratis` | — |
| `to_role` | `jamas` | `gratis` | — |
| `at` | `jamas` | `gratis` | — |

### `achievements`

**Purpose:** Rango y grados conseguidos por persona.

**Per-user scope:** Solo los propios. El rango de un tercero solo aparece dentro del ranking, y solo con opt-in.

**One join away:** `users`

| column | clase | muro | nota |
|---|---|---|---|
| `user_id` | `jamas` | `gratis` | — |
| `code` | `propio` | `gratis` | leccion.N.grado o rango.N. |
| `kind` | `propio` | `gratis` | leccion \| rango. |
| `lesson_n` | `propio` | `gratis` | A que leccion pertenece, si aplica. |
| `earned_at` | `propio` | `gratis` | Cuando se consiguio. Es el nombre real de la columna en la base. |

### `ranking_optin`

**Purpose:** Quien acepto aparecer en el ranking y con que alias.

**Per-user scope:** AGREGADO: alias + conteos de quienes aceptaron. El mapeo alias -> nombre/correo no lo expone ninguna herramienta.

**One join away:** `users`

| column | clase | muro | nota |
|---|---|---|---|
| `user_id` | `jamas` | `gratis` | El puente alias -> persona. Es justo lo que no puede salir. |
| `alias` | `agregado` | `gratis` | Lo unico publico de otra persona. |
| `joined_at` | `agregado` | `gratis` | Desempata el ranking. |

### `league_week`

**Purpose:** El cierre semanal de ligas: metal, caudal y puesto por persona y semana.

**Per-user scope:** El propio metal y puesto. De terceros, solo a traves del alias del ranking.

**One join away:** `users`

| column | clase | muro | nota |
|---|---|---|---|
| `user_id` | `jamas` | `gratis` | Igual que en ranking_optin: es el puente. |
| `week` | `agregado` | `gratis` | Lunes de la semana cerrada. |
| `metal` | `propio` | `gratis` | bronce \| plata \| oro. |
| `caudal` | `propio` | `gratis` | Labs resueltos por primera vez esa semana. |
| `puesto` | `agregado` | `gratis` | Posicion en la tabla. |
| `estado` | `propio` | `gratis` | activo \| salon. |
| `cerrada` | `jamas` | `gratis` | Estado interno del cron. |

### `lesson_text`

**Purpose:** El texto de ensenanza de cada leccion, una fila por leccion e idioma.

**Per-user scope:** Identico para todos. Lo que cambia por persona no es el contenido, es el derecho a leerlo.

**One join away:** `lessons`

| column | clase | muro | nota |
|---|---|---|---|
| `lesson_n` | `publico` | `gratis` | A que leccion pertenece. |
| `lang` | `publico` | `gratis` | Idioma en el que esta escrito. |
| `technical` | `publico` | `de_pago` | El mecanismo con precision. Es el producto que se vende. |
| `analogy` | `publico` | `de_pago` | La imagen cotidiana. Es el producto que se vende. |
| `examples` | `publico` | `de_pago` | Los dos ejemplos resueltos. Es el producto que se vende. |

### `reset_tokens`

**Purpose:** Los enlaces de recuperacion de contrasena. Guarda el hash del token, nunca el token.

**Per-user scope:** Ninguna herramienta lo toca, y ninguna debe poder. Leerlo es tomar la cuenta.

**One join away:** `users`

| column | clase | muro | nota |
|---|---|---|---|
| `id` | `jamas` | `gratis` | Interno. |
| `user_id` | `jamas` | `gratis` | El puente token -> persona. |
| `token_hash` | `jamas` | `gratis` | Leer esto es apoderarse de la cuenta. La razon por la que esta tabla existe aqui. |
| `created_at` | `jamas` | `gratis` | Telemetria de seguridad. |
| `expires_at` | `jamas` | `gratis` | Telemetria de seguridad. |
| `used_at` | `jamas` | `gratis` | Telemetria de seguridad. |

### `jobs`

**Purpose:** La cola de trabajos en Postgres: cobros, cierres de liga, correos.

**Per-user scope:** Nada aqui es del alumno. Es infraestructura, y sus datos pueden llevar datos de pago.

**One join away:** `users`

| column | clase | muro | nota |
|---|---|---|---|
| `id` | `jamas` | `gratis` | Interno. |
| `tipo` | `jamas` | `gratis` | Infraestructura. |
| `clave` | `jamas` | `gratis` | Clave de idempotencia; puede llevar un id de pago. |
| `datos` | `jamas` | `gratis` | Puede llevar el cuerpo crudo de un webhook de pago. |
| `estado` | `jamas` | `gratis` | Infraestructura. |
| `intentos` | `jamas` | `gratis` | Infraestructura. |
| `error` | `jamas` | `gratis` | Puede llevar un mensaje del proveedor de pago. |
| `corre_en` | `jamas` | `gratis` | Infraestructura. |
| `tomado_en` | `jamas` | `gratis` | Infraestructura. |
| `acabado_en` | `jamas` | `gratis` | Infraestructura. |
| `creado_en` | `jamas` | `gratis` | Infraestructura. |

## The forbidden list

`assertNoForbidden(table, row)` in `api/src/ontology.ts` runs before data is returned. It reads the list below out of the generated artifact and throws if a row carries any of these columns — so a column left out of a tool's `devuelve` declaration by mistake is still caught, on the real row, at runtime.

Its companion `forbiddenColumns(table)` **throws for a table it does not know** rather than returning an empty list. That direction matters: answering `[]` for an unknown table silently approves every read from it, which is how three tables went unguarded while every proof stayed green.

| table | `jamas` columns | `de_pago` columns |
|---|---|---|
| `achievements` | `user_id` | — |
| `attempts` | `id`, `user_id` | — |
| `auth_throttles` | `user_id`, `expires_at`, `reason`, `updated_at` | — |
| `entitlement_events` | `id`, `event_key`, `user_id`, `active`, `source`, `external_id`, `occurred_at`, `received_at`, `period_end` | — |
| `jobs` | `id`, `tipo`, `clave`, `datos`, `estado`, `intentos`, `error`, `corre_en`, `tomado_en`, `acabado_en`, `creado_en` | — |
| `labs` | `solution` | `prompt`, `payload`, `explanation` |
| `league_week` | `user_id`, `cerrada` | — |
| `lesson_text` | — | `technical`, `analogy`, `examples` |
| `lessons` | — | `technical`, `analogy` |
| `payments` | `id`, `user_id`, `provider`, `ext_id`, `status`, `amount`, `currency`, `raw`, `at` | — |
| `question_attempts` | `id`, `user_id` | — |
| `questions` | `solution` | `prompt_es`, `prompt_en`, `payload`, `explanation_es`, `explanation_en` |
| `ranking_optin` | `user_id` | — |
| `reset_tokens` | `id`, `user_id`, `token_hash`, `created_at`, `expires_at`, `used_at` | — |
| `role_audit` | `id`, `actor_id`, `user_id`, `from_role`, `to_role`, `at` | — |
| `users` | `id`, `email`, `pass_hash`, `failed`, `locked_until`, `deleted_at`, `token_version` | — |

Gated tools (9 of 44), which declare that they resolve entitlement before returning: `buscar_en_curso`, `cola_siguiente`, `examen`, `lab_ficha`, `leccion`, `leccion_texto`, `mis_errores`, `mis_intentos`, `quiz_leccion`.

**Deletion order** for an account, from the foreign keys — whoever points goes first: `role_audit` → `reset_tokens` → `ranking_optin` → `question_attempts` → `payments` → `league_week` → `entitlement_events` → `auth_throttles` → `attempts` → `achievements` → `users` → `questions` → `lesson_text` → `labs` → `lessons` → `jobs`.

## How it is verified

```bash
uv --directory ai run ai-verify        # style, tests, isolation, artifact
uv --directory ai run ai-prove-isolation
pnpm --dir api test                   # every api suite, listed below
pnpm test:isolation                   # delegates to api
pnpm test:tools                       # delegates to api
pnpm --dir api db:drift               # schema.prisma against the migrations
node scripts/check-ontology-drift.mjs # the artifact against schema.prisma
```

`pnpm --dir api test` runs `isolation.mts`, `agent-bus.mts`, `transport.mts`, `tools.mts`, `queue.mts`, `bridge.mts`, `coach.mts` and `data.mts`. The list is here and the count is not: a number in a document is a copy of something that changes, and this row already claimed a suite that had been deleted.

`isolation.mts` attempts what is forbidden against all 44 tools: slipping `user_id` into every one of them, reading another person's `pass_hash`, e-mail, name and attempts, extracting lab `solution`s, asking for the explanation before the first attempt, injecting SQL into `lab_id`, inventing a tool, passing a non-integer `userId`, and reading another session's queue. None may pass. `agent-bus.mts` checks the structure: FIFO, LIFO, the caps, that the memo tells public from own data, and that two sessions share nothing. `tools.mts` checks the opposite of isolation — that this is useful: that all 44 answer with data, that what one enqueues another consumes, and that the memo saves queries.

On the Python side, `ai-prove-isolation` proves P1..P4 over the graph and `test_node_contract.py` checks that this declaration still matches the registry Node executes — names and paywall flags both. Whatever is not declared is proved by nobody, so that comparison is a precondition of writing the artifact, not a test somebody remembers to run.

## A note on language

The prose here is English, like the rest of the repository. The values are not: `publico` `propio` `agregado` `jamas` `gratis` `de_pago` `sesion` are DATA, serialised into `api/src/ontologia.json` and read by Node at import time. Tool descriptions and column notes are also left as they are — they are read by the model and shape what it says to a Spanish-speaking student, so they are course content rather than code.
