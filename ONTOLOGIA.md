# Ontología de la base para el agente de IA

> Generado desde `api/src/ontology.js`. No editar a mano: se regenera con `pnpm ontologia`.

## El aislamiento no está en el prompt

Un usuario no puede obtener datos de otro a través del agente, y la razón no es que
el prompt se lo pida: es que **ninguna herramienta acepta un identificador de usuario**.
El id sale de la cookie de sesión, en el servidor. El modelo no tiene forma de expresar
«los datos de otra persona», así que el ataque clásico —poner instrucciones dentro del
propio alias o de la respuesta de un lab— no tiene a dónde ir: en el peor caso el agente
devuelve otra vez los datos de quien pregunta.

Tampoco hay SQL. Hay 37 funciones con argumentos declarados; cualquier clave que no
esté declarada se descarta y queda registrada en la respuesta como `_ignorado`.

## Cómo se hablan entre ellas: una pila y una cola

Las herramientas no se llaman unas a otras. Se dejan trabajo en el bus de la sesión
(`api/src/agent-bus.js`), que son tres estructuras y nada más:

- **cola** (FIFO, tope 32) — el plan de estudio. `plan_estudio` y `mis_errores` la
  llenan; `cola_siguiente` saca la cabeza **ya resuelta** (ficha del lab, intentos propios,
  explicación si ya lo intentó y la lección de donde sale): tres herramientas en una llamada.
- **pila** (LIFO, tope 16) — el foco. Abrir una lección o un lab apila dónde estaba la
  persona; si la conversación se va por una rama, `foco_volver` regresa sin releer nada.
- **memo** (tope 96) — la caché de la sesión. El contenido del curso se reusa 10
  minutos; un dato propio **solo dentro del mismo turno**, porque entre dos mensajes la persona
  pudo resolver un lab en otra pestaña y un progreso viejo sería una mentira. Lo que sale de la
  caché viaja marcado con `_memo: true`, y la traza del chat lo dice.

El bus se indexa por el `userId` de la sesión, así que la cola de una persona no es
alcanzable desde la de otra. Es memoria del proceso: si el servidor se reinicia se pierde
el plan y no pasa nada — se vuelve a pedir. Por eso no hay tabla nueva.

## Herramientas

### familia `contenido` · 7

| herramienta | qué devuelve | argumentos |
|---|---|---|
| `curso_indice` | Las 12 lecciones con su título, su número ancla y cuántos labs tiene cada una. | — |
| `leccion` | El contenido completo de una lección y el enunciado de sus tres labs. Nunca trae las respuestas. | `n`: entero 1..12 |
| `leccion_texto` | La explicación técnica, la analogía y los dos ejemplos resueltos de una lección, en el idioma de la sesión. Es con lo que hay que enseñar antes de mandar al lab. | `n`: entero 1..12, `idioma`: opcional · «es» o «en»; por defecto el de la sesión |
| `buscar_en_curso` | Busca una palabra o una idea en las 12 lecciones y en los enunciados de los labs, y dice en qué lección está. Úsala antes de responder de memoria. | `consulta`: texto libre: «tokens», «por qué inventa cosas» |
| `glosario` | Qué significa un término del curso (token, perilla, temperatura, contexto…) y en qué lección se explica. Sin argumento devuelve la lista de términos. | `termino`: opcional · una palabra o expresión |
| `lab_ficha` | Un lab suelto: enunciado, nivel, cómo se responde su mecánica y si esta persona ya lo resolvió. Nunca la solución. | `lab_id`: texto como «5.2» |
| `requisitos_leccion` | Si esta persona puede saltar a una lección: qué debería traer entendido, cómo va en la anterior y si tiene la lección abierta. | `n`: entero 1..12 |

### familia `propio` · 16

| herramienta | qué devuelve | argumentos |
|---|---|---|
| `mi_panorama` | TODO el estado de esta persona de una sola vez: perfil, progreso, racha, siguiente paso, liga y qué tiene en la cola. Empieza por aquí: ahorra cuatro llamadas. | — |
| `mi_progreso` | Cuántas lecciones y labs lleva resueltos la persona de esta sesión, lección por lección. | — |
| `mis_intentos` | Los intentos de la persona de esta sesión en un lab, con lo que respondió. La explicación solo llega si ya lo intentó. | `lab_id`: texto como «5.2» |
| `mi_perfil` | Nombre de pila, rol, idioma y si compró el curso. Solo de la sesión actual. | — |
| `mi_siguiente_paso` | Qué lab concreto sigue ahora, respetando candados y borradores. La respuesta a «¿qué hago?». Deja el lab en la cola. | — |
| `mis_pendientes` | Los labs que le faltan, en orden de curso, marcando los que están cerrados por compra. Opcionalmente los de una sola lección. | `n`: opcional · entero 1..12 para filtrar por lección |
| `mis_errores` | Los labs que intentó y no ha resuelto, con lo que respondió y qué mecánica se le atraviesa. Aquí está el patrón del error. Los deja en la cola. | — |
| `mi_racha` | Días seguidos con actividad, mejor racha y cuándo fue la última vez. Sirve para «llevas dos semanas sin abrirlo». | — |
| `mi_ritmo` | Cuántos labs resuelve por semana y, a ese ritmo, cuánto le falta para terminar los 36. Responde «¿cuánto me queda?». | — |
| `mi_historial` | Los últimos intentos con su fecha: qué tocó y si acertó. Responde «¿qué hice ayer?». | `dias`: opcional · entero 1..30, por defecto 7 |
| `mi_acceso` | Qué tiene abierto y qué no, y por qué. La respuesta a «¿por qué no puedo abrir la lección 4?». | — |
| `mis_logros` | El rango de la persona de esta sesión. Un rango por cada lección cerrada. | — |
| `logros_faltantes` | Qué logros le faltan y qué hay que hacer exactamente para cada uno. Responde «¿qué me falta para el siguiente?». | — |
| `mi_liga` | Su liga de esta semana: metal, puesto, caudal y cuándo cierra. Si no está en liga, dice exactamente qué falta. | — |
| `ligas_tabla` | La tabla de la liga semanal: alias, metal, puesto y caudal de quienes aceptaron aparecer. Nunca nombres ni correos. | — |
| `ranking_publico` | Alias y avance de quienes aceptaron aparecer, más la posición propia. Nunca nombres ni correos. | — |

### familia `producto` · 7

| herramienta | qué devuelve | argumentos |
|---|---|---|
| `como_funciona` | Cómo funciona la plataforma: lecciones, labs, logros, ranking y ligas. Para «¿qué es esto?» y «¿cómo se usa?». | — |
| `donde_encuentro` | En qué página de la plataforma se hace algo. Para «¿dónde cambio el idioma?», «¿dónde veo mi puesto?». Devuelve la ruta exacta. | `consulta`: texto libre: «cambiar el tema», «descargar el pdf» |
| `precio_y_compra` | Cuánto cuesta, qué incluye, la garantía y si esta persona ya lo compró. El precio sale del mismo sitio que el checkout. | — |
| `mis_datos_y_privacidad` | Qué guarda la plataforma de esta persona, qué puede ver el agente y cómo borrar la cuenta. Para «¿qué sabes de mí?». | — |
| `descargar_pdf` | Si esta persona puede descargar el PDF del curso, en qué idiomas y desde dónde. | — |
| `soporte` | Qué hacer cuando algo no funciona: responde el problema frecuente que casa y, si no, cómo escribirle a una persona. | `tema`: opcional · el problema en palabras de la persona |
| `ajustes` | Idioma y tema que tiene puestos, qué valores existen y dónde se cambian. | — |

### familia `coordinar` · 7

| herramienta | qué devuelve | argumentos |
|---|---|---|
| `plan_estudio` | Arma un plan con los siguientes labs en orden y lo deja en la cola. Después, cada `cola_siguiente` entrega uno ya resuelto con su contexto. | `sesiones`: opcional · entero 1..12, cuántos labs planear; por defecto 5 |
| `cola_siguiente` | Saca lo primero de la cola y lo devuelve YA RESUELTO: ficha del lab, intentos propios, explicación si ya lo intentó y la lección de donde sale. Una llamada en vez de tres. | — |
| `cola_estado` | Qué hay pendiente en la cola de estudio y cuál es el foco actual, sin sacar nada. | — |
| `cola_encolar` | Deja algo pendiente para más tarde en la cola: un lab, una lección o un tema que salió en la conversación. | `tipo`: «lab», «leccion» o «tema», `ref`: el lab («5.2»), la lección («7») o el tema («tokens»), `motivo`: opcional · por qué queda pendiente |
| `foco_apilar` | Guarda dónde está la persona antes de irte por una rama de la conversación. Después `foco_volver` regresa aquí. | `tipo`: «lab», «leccion» o «tema», `ref`: el lab, la lección o el tema, `nota`: opcional · qué se estaba haciendo |
| `foco_volver` | Cierra la rama actual y devuelve a dónde estaba la persona antes. Para «volvamos a lo que estábamos». | — |
| `bus_diagnostico` | Cómo va la coordinación de esta sesión: largo de la cola, alto de la pila y cuántas consultas ahorró la caché. Para explicar de dónde salió un dato. | — |

## Tablas

### `users`

Una fila por persona registrada. Identidad, rol, preferencias y si compró el curso.

**Alcance por usuario:** El agente solo ve la fila de la sesión. Las demás filas no son alcanzables por ninguna herramienta.

**Borrado suave:** deleted_at marcado = la fila se conserva para que cuadren los intentos, pero la persona ya no existe para el sistema.

| columna | clase | nota |
|---|---|---|
| `id` | **JAMÁS** · no sale del servidor | Identificador interno. El modelo no lo necesita y darlo invita a pedir el de otro. |
| `email` | **JAMÁS** · no sale del servidor | Dato personal sin valor para enseñar. La interfaz ya lo muestra a su dueño. |
| `name` | propio · solo de la sesión | Solo el primer nombre, para dirigirse a la persona. |
| `pass_hash` | **JAMÁS** · no sale del servidor | Hash scrypt. Fuera del alcance de todo el código que no sea auth.js. |
| `role` | propio · solo de la sesión | student | tutor | admin. Define qué puede pedir, no qué sabe el agente. |
| `lang` | propio · solo de la sesión | Para responder en el idioma correcto. |
| `theme` | propio · solo de la sesión | Sin valor para el agente; se expone porque no revela nada. |
| `paid` | propio · solo de la sesión | Para decir «eso se abre con la compra» sin inventar. |
| `cohort` | propio · solo de la sesión | Solo como etiqueta. NUNCA para enumerar a los compañeros de cohorte. |
| `created_at` | propio · solo de la sesión | Antigüedad de la cuenta. |
| `failed` | **JAMÁS** · no sale del servidor | Telemetría de seguridad. Para un tercero es señal de ataque. |
| `locked_until` | **JAMÁS** · no sale del servidor | Igual que failed. |
| `deleted_at` | **JAMÁS** · no sale del servidor | Estado interno del borrado suave. |

Bloqueadas en código (`assertSinProhibidas`): `id`, `email`, `pass_hash`, `failed`, `locked_until`, `deleted_at`

### `lessons`

Las 12 lecciones del Vol. 1. Es el corpus con el que el agente enseña.

**Alcance por usuario:** Idéntico para todos: no hay nada personal aquí.

| columna | clase | nota |
|---|---|---|
| `n` | público · contenido del curso | 1..12, el orden del curso. |
| `eyebrow` | público · contenido del curso | Etiqueta corta del tema. |
| `title` | público · contenido del curso | La idea en lenguaje hablado. |
| `summary` | público · contenido del curso | Una frase con el concepto. |
| `math` | público · contenido del curso | El número que ancla la lección. Solo números, nunca fórmulas. |
| `math_cap` | público · contenido del curso | Qué significa ese número. |
| `technical` | público · contenido del curso | El mecanismo con precisión. Puede estar vacío mientras se redacta. |
| `analogy` | público · contenido del curso | Una sola imagen cotidiana. Puede estar vacía mientras se redacta. |

Bloqueadas en código (`assertSinProhibidas`): ninguna

### `labs`

Los 36 ejercicios, tres por lección, con su mecánica y su corrección.

**Alcance por usuario:** El enunciado es igual para todos. La explicación solo se entrega si esa persona ya intentó ese lab.

| columna | clase | nota |
|---|---|---|
| `id` | público · contenido del curso | «5.2» = lección 5, ejercicio 2. |
| `lesson_n` | público · contenido del curso | A qué lección pertenece. |
| `idx` | público · contenido del curso | 1 fácil, 2 medio, 3 difícil. |
| `level` | público · contenido del curso | facil | medio | dificil. |
| `kind` | público · contenido del curso | choice | cut | order | build | knob | hotcold. El agente lo necesita para explicar la mecánica. |
| `prompt` | público · contenido del curso | El enunciado. |
| `payload` | público · contenido del curso | JSON de lo que se ve en pantalla: opciones, palabras, pasos. |
| `solution` | **JAMÁS** · no sale del servidor | LA MÁS IMPORTANTE. Si el agente puede leerla, «dime la respuesta del 5.2» destruye el curso. No sale del servidor por ningún camino. |
| `explanation` | público · contenido del curso | Condicionada: solo para labs que esa persona ya intentó. La interfaz hace lo mismo. |
| `draft` | público · contenido del curso | 1 = sin escribir. Evita que el agente invente contenido. |

Bloqueadas en código (`assertSinProhibidas`): `solution`

### `lesson_text`

El texto de enseñanza de cada lección por idioma: mecanismo, analogía y ejemplos resueltos.

**Alcance por usuario:** Idéntico para todos. Se sirve en el idioma de la sesión, con respaldo al español.

| columna | clase | nota |
|---|---|---|
| `lesson_n` | público · contenido del curso | A qué lección pertenece. |
| `lang` | público · contenido del curso | es | en (fr y pt cuando existan). |
| `technical` | público · contenido del curso | El mecanismo con precisión, 90-140 palabras. |
| `analogy` | público · contenido del curso | Una sola imagen cotidiana, 50-80 palabras. |
| `examples` | público · contenido del curso | JSON con dos casos resueltos: entrada, salida y por qué. |

Bloqueadas en código (`assertSinProhibidas`): ninguna

### `achievements`

Logros ganados: tres grados por lección y un rango por cada lección cerrada.

**Alcance por usuario:** Solo los propios. El rango de un tercero solo aparece dentro del ranking, y solo si esa persona aceptó salir.

| columna | clase | nota |
|---|---|---|
| `user_id` | **JAMÁS** · no sale del servidor | El agente nunca lo ve ni lo escribe: sale de la sesión. |
| `code` | propio · solo de la sesión | l07.maestro, rango.05. El nombre visible vive en el i18n del front. |
| `kind` | propio · solo de la sesión | leccion | rango. |
| `lesson_n` | propio · solo de la sesión | A qué lección pertenece, o vacío en los rangos. |
| `earned_at` | propio · solo de la sesión | Cuándo se ganó. |

Bloqueadas en código (`assertSinProhibidas`): `user_id`

### `ranking_optin`

Quién aceptó aparecer en el ranking y con qué alias.

**Alcance por usuario:** AGREGADO: el agente ve alias y conteos de quienes aceptaron. El mapeo alias → nombre/correo no lo expone ninguna herramienta, así que «quién es kata.mono» no tiene respuesta.

| columna | clase | nota |
|---|---|---|
| `user_id` | **JAMÁS** · no sale del servidor | Uniría el alias con la persona: es justo lo que no puede salir. |
| `alias` | agregado · conteos o alias con opt-in | Lo único público de otra persona. |
| `joined_at` | agregado · conteos o alias con opt-in | Desempata la tabla: a igual avance, quien llegó antes va arriba. |

Bloqueadas en código (`assertSinProhibidas`): `user_id`

### `league_week`

La liga semanal cerrada: metal, caudal y puesto de cada semana.

**Alcance por usuario:** El puesto propio, y de terceros solo el alias con su metal. El caudal se calcula de attempts, no de aquí.

| columna | clase | nota |
|---|---|---|
| `user_id` | **JAMÁS** · no sale del servidor | De la sesión. |
| `week` | propio · solo de la sesión | El lunes de la semana, en America/Bogota. |
| `metal` | agregado · conteos o alias con opt-in | bronce | plata | oro, por tercios de la tabla. |
| `caudal` | agregado · conteos o alias con opt-in | Labs resueltos por primera vez esa semana. |
| `puesto` | agregado · conteos o alias con opt-in | Dentro de su metal, 1 = arriba. |
| `estado` | agregado · conteos o alias con opt-in | activo | salon. Quien acabó los 36 conserva su metal. |
| `cerrada` | propio · solo de la sesión | 1 = la semana ya se cerró y no se recalcula. |

Bloqueadas en código (`assertSinProhibidas`): `user_id`

### `attempts`

Cada intento de cada persona en cada lab. Es de donde sale el progreso.

**Alcance por usuario:** Solo las filas propias. Los intentos de terceros no son alcanzables ni como conteo: «cuántos intentos lleva Paula» es exactamente la fuga que hay que evitar.

| columna | clase | nota |
|---|---|---|
| `id` | **JAMÁS** · no sale del servidor | Identificador interno. |
| `user_id` | **JAMÁS** · no sale del servidor | El agente nunca lo ve ni lo escribe: sale de la sesión. |
| `lab_id` | propio · solo de la sesión | Qué lab se intentó. |
| `answer` | propio · solo de la sesión | Lo que respondió. Aquí está el valor real del agente: ve el patrón del error. |
| `correct` | propio · solo de la sesión | 1 acertó, 0 falló. |
| `at` | propio · solo de la sesión | Cuándo. Sirve para «llevas dos semanas sin abrirlo». |

Bloqueadas en código (`assertSinProhibidas`): `id`, `user_id`

### `payments`

Los cobros de Mercado Pago.

**Alcance por usuario:** Del propio usuario solo un booleano «pagado». Nada más, ni para él.

| columna | clase | nota |
|---|---|---|
| `id` | **JAMÁS** · no sale del servidor | Interno. |
| `user_id` | **JAMÁS** · no sale del servidor | De la sesión. |
| `provider` | **JAMÁS** · no sale del servidor | Sin valor para enseñar. |
| `ext_id` | **JAMÁS** · no sale del servidor | Referencia de la pasarela. Sirve para soporte, no para el agente. |
| `status` | **JAMÁS** · no sale del servidor | users.paid ya responde lo único que el agente necesita. |
| `amount` | **JAMÁS** · no sale del servidor | Dato financiero. |
| `currency` | **JAMÁS** · no sale del servidor | Dato financiero. |
| `raw` | **JAMÁS** · no sale del servidor | Respuesta completa de Mercado Pago: trae datos del pagador y metadatos de la tarjeta. Jamás sale del servidor. |
| `at` | **JAMÁS** · no sale del servidor | Dato financiero. |

Bloqueadas en código (`assertSinProhibidas`): `id`, `user_id`, `provider`, `ext_id`, `status`, `amount`, `currency`, `raw`, `at`

### `role_audit`

Rastro de quién cambió el rol de quién.

**Alcance por usuario:** Ninguna herramienta lo expone. Es rastro de administración: no hay nada que enseñar con él.

| columna | clase | nota |
|---|---|---|
| `id` | **JAMÁS** · no sale del servidor |  |
| `actor_id` | **JAMÁS** · no sale del servidor |  |
| `user_id` | **JAMÁS** · no sale del servidor |  |
| `from_role` | **JAMÁS** · no sale del servidor |  |
| `to_role` | **JAMÁS** · no sale del servidor |  |
| `at` | **JAMÁS** · no sale del servidor |  |

Bloqueadas en código (`assertSinProhibidas`): `id`, `actor_id`, `user_id`, `from_role`, `to_role`, `at`

## Tablas previstas

La regla se escribe antes de construirlas, para que se herede:

### `chat_log`

Historial de conversaciones del modo IA, si algún día se guarda.

**Alcance:** PROPIO y con fecha de caducidad. Hoy no se guarda nada: la conversación vive en el navegador y el servidor solo la ve de paso. Si se añade la tabla, el agente no debe poder leer conversaciones anteriores sin que la persona lo pida.

## Cómo se verifica

```bash
pnpm --dir api test        # aislamiento + bus + herramientas + harness
pnpm test:aislamiento      # solo el aislamiento
```

`test/aislamiento.mjs` intenta lo prohibido contra las 37 herramientas: colar `user_id` en
todas, leer el `pass_hash`, el correo, el nombre y los intentos de otra persona, sacar las
`solution` de los labs, pedir la explicación antes del primer intento, inyectar SQL en
`lab_id`, inventar una herramienta, pasar un `userId` que no sea entero y ver la cola de
otra sesión. Ninguna debe pasar.

`test/bus.mjs` comprueba la estructura: FIFO, LIFO, los topes, que el memo distinga lo
público de lo propio y que dos sesiones no compartan nada. `test/herramientas.mjs`
comprueba lo contrario del aislamiento —que esto sirva—: que las
37 respondan con datos, que lo que una encola otra lo consuma y que el memo ahorre
consultas. `test/harness.mjs` corre el bucle contra un proveedor falso.
