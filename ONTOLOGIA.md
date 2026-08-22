# Ontología de la base para el agente de IA

> Generado desde `api/src/ontology.js`. No editar a mano: se regenera con `pnpm ontologia`.

## El aislamiento no está en el prompt

Un usuario no puede obtener datos de otro a través del agente, y la razón no es que
el prompt se lo pida: es que **ninguna herramienta acepta un identificador de usuario**.
El id sale de la cookie de sesión, en el servidor. El modelo no tiene forma de expresar
«los datos de otra persona», así que el ataque clásico —poner instrucciones dentro del
propio alias o de la respuesta de un lab— no tiene a dónde ir: en el peor caso el agente
devuelve otra vez los datos de quien pregunta.

Tampoco hay SQL. Hay siete funciones con argumentos declarados; cualquier clave que no
esté declarada se descarta y queda registrada en la respuesta como `_ignorado`.

## Herramientas

| herramienta | qué devuelve | argumentos |
|---|---|---|
| `curso_indice` | Las 12 lecciones con su título, su número ancla y cuántos labs tiene cada una. | — |
| `leccion` | El contenido completo de una lección y el enunciado de sus tres labs. Nunca trae las respuestas. | `n`: entero 1..12 |
| `mi_progreso` | Cuántas lecciones y labs lleva resueltos la persona de esta sesión, lección por lección. | — |
| `mis_intentos` | Los intentos de la persona de esta sesión en un lab, con lo que respondió. La explicación solo llega si ya lo intentó. | `lab_id`: texto como «5.2» |
| `mi_perfil` | Nombre de pila, rol, idioma y si compró el curso. Solo de la sesión actual. | — |
| `ranking_publico` | Alias y avance de quienes aceptaron aparecer, más la posición propia. Nunca nombres ni correos. | — |
| `mis_logros` | El rango de la persona de esta sesión. Un rango cada dos lecciones cerradas. | — |

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

### `achievements`

Rango conseguido por persona (Iniciado … Mano Firme).

**Alcance:** Solo los propios. El rango de un tercero solo aparece dentro del ranking, y solo si esa persona aceptó salir.

### `ranking_optin`

Quién aceptó aparecer en el ranking y con qué alias.

**Alcance:** AGREGADO: el agente ve alias + conteos de quienes aceptaron. El mapeo alias → nombre/correo no lo expone ninguna herramienta, así que «quién es kata.mono» no tiene respuesta.

## Cómo se verifica

```bash
pnpm test:aislamiento
```

Intenta 31 cosas: colar `user_id` en las siete herramientas, leer el `pass_hash`, el
correo, el nombre y los intentos de otra persona, sacar las `solution` de los labs,
pedir la explicación antes del primer intento, inyectar SQL en `lab_id`, inventar una
herramienta y pasar un `userId` que no sea entero. Ninguna debe pasar.
