"""The ontology as DATA, not as prose.

Ported from api/src/ontology.js, which was the source of truth up to v2. The
difference is not the language: in v2 the ontology DESCRIBED the isolation and
the code implemented it separately, so nothing guaranteed the two matched. Here
every tool declares which tables it touches and which columns it returns, and
graph.py PROVES over that data that no `jamas` column can get out. The guarantee
goes from a comment to a checkable theorem.

Sensitivity classes:
    publico   course content; anybody may see it
    propio    only the session's user, never a third party's
    agregado  comes from several users, but only as a count or an opted-in alias
    jamas     never reaches the model, not even the user's own
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

Sensitivity = Literal["publico", "propio", "agregado", "jamas"]
SENSITIVITIES: tuple[Sensitivity, ...] = ("publico", "propio", "agregado", "jamas")

# A tool's scope over personal data:
#   sesion    filters by the userId the server sets
#   publico   touches no table holding person data
#   agregado  crosses several people, and returns only counts or opted-in aliases
Scope = Literal["sesion", "publico", "agregado"]

# WHO EXECUTES THE TOOL. The field the model did not have.
#
# Until now every declared tool was executed by Node over the bridge, and the
# ontology had no way to say so because there was nothing else to distinguish it
# from. `reads=()` does not mean it: nine Node-executed tools declare `reads=()`
# (the five bus tools, `glosario`, `como_funciona`, `donde_encuentro`, `soporte`)
# because they touch no TABLE, not because they run here.
#
# The distinction has to be a field and not a naming convention, and not a list in
# a test file either. A convention makes the contract source FORMATTING, which is
# the failure export.py documents twice; a list inside a test puts the fact
# somewhere production code cannot read it, so loop.py would have to re-derive the
# split by a second rule. As a field it travels with the thing it describes, so
# forgetting to set it is loud (the catalogue drift check fires) instead of quietly
# shrinking the population a guard covers.
#
#   node     Node's registry runs it: api/src/tools/*, one userId from the cookie.
#   python   a local handler in course_ai/retrieval/tools.py runs it. It may not
#            read a table, may not return a column and may NEVER decide
#            entitlement — see obligation P5 in graph.py.
Runner = Literal["node", "python"]

# SECOND AXIS, independent of `sensitivity`.
#
# `sensitivity` answers «whose data is this» — privacy. It does not answer «who
# paid to read it». They are orthogonal, and collapsing them is what let through
# the most expensive leak in the project: lessons.technical is classified
# `publico` (correctly: it is the same for everyone, there is nothing personal in
# it) and the isolation proof stayed green while four tools handed it to accounts
# that had not paid. The paywall rule was inexpressible in the model, so no test
# could check it.
#
#   gratis    any authenticated session may read it
#   de_pago   only with a purchase, a non-student role, or a lesson among the free ones
Paywall = Literal["gratis", "de_pago"]

# THIRD AXIS, and the only one that is not about the DATA: it is about WHO RUNS the
# tool.
#
#   node      the model's call travels the bridge (POST /api/v3/interno/herramienta)
#             and Node executes it with the userId of the session cookie.
#   python    the /ai service answers it in-process, with no database and no bridge.
#
# It exists because the model had no field for the fact, and the absence made a
# whole population invisible to the guard. The contract test compares what this
# ontology DECLARES against what Node's registry EXPOSES, and that comparison is a
# total equality in both directions — the only reason it is worth running. Adding a
# Python-executed tool to a single flat list would have turned that equality into
# «declared is a superset of Node», i.e. into nothing.
#
# So the population is split HERE, in the data, and the equality keeps running
# unchanged over the half that claims Node executes it. A tool cannot be in that
# half by accident: `runner` defaults to "node", so anything added without thinking
# about it lands in BRIDGED and Node has to expose it or the drift check fires with
# its original message.
Runner = Literal["node", "python"]


@dataclass(frozen=True, slots=True)
class Column:
    sensitivity: Sensitivity
    note: str = ""
    paywall: Paywall = "gratis"


@dataclass(frozen=True, slots=True)
class Table:
    purpose: str
    per_user: str
    columns: Mapping[str, Column]
    # table -> table edges FOR WHERE A JOIN CAN BE WRITTEN. This is reachability,
    # not dependency: it is declared in both directions because a join can be
    # written from either side. It answers «what is one join away from here»,
    # which is a design-review question.
    joins_with: tuple[str, ...] = ()
    # DIRECTED foreign-key edges: «this table points at these». The deletion order
    # for an account comes out of here, and that is why it cannot be `joins_with`:
    # `joins_with` is symmetric, and with it Kahn puts almost everything in a cycle.
    depends_on: tuple[str, ...] = ()
    # What a soft delete means for THIS table, when it has one. Prose, like
    # `purpose` and `per_user`, and it lives here for the same reason: the generated
    # document renders it, so there is one copy instead of a hand-written one in a
    # Markdown file that nothing checks. Empty = this table has no soft delete.
    soft_delete: str = ""


@dataclass(frozen=True, slots=True)
class Tool:
    description: str
    args: Mapping[str, str]
    scope: Scope
    # Tables the query touches, joins included.
    reads: tuple[str, ...]
    # Columns that LEAVE the server, with their full «table.column» name.
    # Not the same as `reads`: `mis_intentos` touches the whole of labs and returns
    # eight of its nine columns. The ninth is labs.solution.
    returns: tuple[str, ...] = field(default=())
    # Declares that the tool checks the right of access before returning.
    # P4 requires it: a `de_pago` column cannot be returned without this. It is a
    # declaration, not a proof that the code does it — but it turns «I forgot» into
    # «I declared it and the contract does not add up», which is what a test can
    # catch.
    checks_entitlement: bool = False
    # WHO EXECUTES IT. Defaults to "node" so every declaration written before this
    # field existed keeps meaning exactly what it meant, and so that FORGETTING to
    # mark a Python tool is loud instead of quiet: it stays in BRIDGED, Node does not
    # expose it, and drift() reports it as «declared here and Node does NOT expose
    # them (the ontology is lying)».
    runner: Runner = "node"
    # For a native tool, the BRIDGED tools its handler is allowed to call. It is the
    # composition made visible: a native returns numbers, terms and the name of the
    # next call, and the content itself arrives through a bridged tool that Node
    # executes and gates. A bridged tool declares nothing here — it does not compose,
    # it runs a query — and P5 requires that.
    composes: tuple[str, ...] = ()


def _c(sensitivity: Sensitivity, note: str = "", paywall: Paywall = "gratis") -> Column:
    return Column(sensitivity=sensitivity, note=note, paywall=paywall)


def _paid(sensitivity: Sensitivity, note: str = "") -> Column:
    """A column behind the paywall. Sugar, so the table reads in one glance."""
    return Column(sensitivity=sensitivity, note=note, paywall="de_pago")


TABLES: Mapping[str, Table] = {
    "users": Table(
        purpose="Una fila por persona registrada. Identidad, rol, preferencias y si compro el curso.",
        per_user="El agente solo ve la fila de la sesion. Las demas filas no son alcanzables por ninguna herramienta.",
        soft_delete="deleted_at set = the row is kept so the attempts still add up, but the person no longer exists as far as the system is concerned.",
        joins_with=("attempts", "payments", "ranking_optin", "role_audit"),
        columns={
            "id": _c("jamas", "Identificador interno. El modelo no lo necesita y darlo invita a pedir el de otro."),
            "email": _c("jamas", "Dato personal sin valor para ensenar. La interfaz ya lo muestra a su dueno."),
            "name": _c("propio", "Solo el primer nombre, para dirigirse a la persona."),
            "pass_hash": _c("jamas", "Hash scrypt. Fuera del alcance de todo el codigo que no sea auth."),
            "role": _c("propio", "student | tutor | admin. Define que puede pedir, no que sabe el agente."),
            "lang": _c("propio", "Para responder en el idioma correcto."),
            "theme": _c("propio", "Sin valor para el agente; se expone porque no revela nada."),
            "paid": _c("propio", "Para decir «eso se abre con la compra» sin inventar."),
            "cohort": _c("propio", "Solo como etiqueta. NUNCA para enumerar a los companeros de cohorte."),
            "created_at": _c("propio", "Antiguedad de la cuenta."),
            "failed": _c("jamas", "Telemetria de seguridad. Para un tercero es senal de ataque."),
            "locked_until": _c("jamas", "Igual que failed."),
            "deleted_at": _c("jamas", "Estado interno del borrado suave."),
            # Undeclared until now. Same class as the three above — security
            # machinery, not teaching material: it is the counter auth bumps to
            # invalidate every live session for this account. Nothing a model
            # needs, and an undeclared column is one the guard cannot forbid.
            "token_version": _c("jamas", "Contador de invalidacion de sesiones. Solo lo toca auth."),
        },
    ),
    "lessons": Table(
        purpose="Las 12 lecciones del Vol. 1. Es el corpus con el que el agente ensena.",
        per_user="Identico para todos: no hay nada personal aqui.",
        joins_with=("labs",),
        columns={
            "n": _c("publico", "1..12, el orden del curso."),
            "eyebrow": _c("publico", "Etiqueta corta del tema."),
            "title": _c("publico", "La idea en lenguaje hablado."),
            "summary": _c("publico", "Una frase con el concepto."),
            "math": _c("publico", "El numero que ancla la leccion. Solo numeros, nunca formulas."),
            "math_cap": _c("publico", "Que significa ese numero."),
            "technical": _paid("publico", "El mecanismo con precision. Puede estar vacio mientras se redacta."),
            "analogy": _paid("publico", "Una sola imagen cotidiana. Puede estar vacia mientras se redacta."),
        },
    ),
    "labs": Table(
        purpose="Los 36 ejercicios, tres por leccion, con su mecanica y su correccion.",
        per_user="El enunciado es igual para todos. La explicacion solo se entrega si esa persona ya intento ese lab.",
        joins_with=("lessons", "attempts"),
        depends_on=("lessons",),
        columns={
            "id": _c("publico", "«5.2» = leccion 5, ejercicio 2."),
            "lesson_n": _c("publico", "A que leccion pertenece."),
            "idx": _c("publico", "1 facil, 2 medio, 3 dificil."),
            "level": _c("publico", "facil | medio | dificil."),
            "kind": _c("publico", "choice | cut | order | build | knob | hotcold."),
            "prompt": _paid("publico", "El enunciado."),
            # It goes out through COLS_LAB, and for the ordering labs it CARRIED the
            # answer: payload.steps came in the same order as the forbidden column in
            # all 8 cases (abcd == abcd, verified against the database). The column
            # guard let it pass because the forbidden NAME was not among the keys; the
            # secret got out all the same, through an allowed column. It is now
            # shuffled at seed time.
            #
            # CAREFUL: this `note` goes into the MODEL's prompt via render_for_model.
            # It cannot name the forbidden column — saying «do not deduce X» teaches
            # the model that X exists and what it is called. test_render checks this.
            "payload": _paid("publico", "JSON de lo que se ve en pantalla: opciones, palabras, pasos. Nunca permite deducir la respuesta correcta."),
            "solution": _c("jamas", "LA MAS IMPORTANTE. Si el agente puede leerla, «dime la respuesta del 5.2» destruye el curso."),
            "explanation": _paid("publico", "Condicionada: solo para labs que esa persona ya intento."),
            "draft": _c("publico", "1 = sin escribir. Evita que el agente invente contenido."),
        },
    ),
    "attempts": Table(
        purpose="Cada intento de cada persona en cada lab. Es de donde sale el progreso.",
        per_user="Solo las filas propias. «Cuantos intentos lleva Paula» es exactamente la fuga que hay que evitar.",
        joins_with=("users", "labs"),
        depends_on=("users", "labs"),
        columns={
            "id": _c("jamas", "Identificador interno."),
            "user_id": _c("jamas", "El agente nunca lo ve ni lo escribe: sale de la sesion."),
            "lab_id": _c("propio", "Que lab se intento."),
            "answer": _c("propio", "Lo que respondio. Aqui esta el valor real del agente: ve el patron del error."),
            "correct": _c("propio", "1 acerto, 0 fallo."),
            "at": _c("propio", "Cuando. Sirve para «llevas dos semanas sin abrirlo»."),
        },
    ),
    "payments": Table(
        purpose="Los cobros de Mercado Pago.",
        per_user="Del propio usuario solo un booleano «pagado». Nada mas, ni para el.",
        joins_with=("users",),
        depends_on=("users",),
        columns={
            "id": _c("jamas", "Interno."),
            "user_id": _c("jamas", "De la sesion."),
            "provider": _c("jamas", "Sin valor para ensenar."),
            "ext_id": _c("jamas", "Referencia de la pasarela. Sirve para soporte, no para el agente."),
            "status": _c("jamas", "users.paid ya responde lo unico que el agente necesita."),
            "amount": _c("jamas", "Dato financiero."),
            "currency": _c("jamas", "Dato financiero."),
            "raw": _c("jamas", "Respuesta completa de Mercado Pago: trae datos del pagador y metadatos de la tarjeta."),
            "at": _c("jamas", "Dato financiero."),
        },
    ),
    "role_audit": Table(
        purpose="Rastro de quien cambio el rol de quien.",
        per_user="Ninguna herramienta lo expone. Es rastro de administracion: no hay nada que ensenar con el.",
        joins_with=("users",),
        depends_on=("users",),
        columns={
            "id": _c("jamas"), "actor_id": _c("jamas"), "user_id": _c("jamas"),
            "from_role": _c("jamas"), "to_role": _c("jamas"), "at": _c("jamas"),
        },
    ),
    "achievements": Table(
        purpose="Rango y grados conseguidos por persona.",
        per_user="Solo los propios. El rango de un tercero solo aparece dentro del ranking, y solo con opt-in.",
        joins_with=("users",),
        depends_on=("users",),
        columns={
            # RESOLVED, and this is the note the previous one promised. Two phantom
            # columns used to be declared here — `id` (jamas) and `at` (propio) —
            # and neither exists: api/prisma/schema.prisma gives this table
            # (user_id, code, kind, lesson_n, earned_at) with the primary key on
            # (user_id, code) and no surrogate `id`. Confirmed twice, against the
            # live information_schema and against schema.prisma.
            #
            # Why deleting them is the fix and not a cosmetic tidy: the phantom
            # `id` was `jamas`, so `forbidden_columns('achievements')` shipped it
            # into the artefact Node blocks on. A guard list naming a column that
            # does not exist buys nothing and hides the one thing it is for —
            # whether the list is trustworthy. `at` was worse in a quieter way: it
            # was `propio`, so it went into the model's prompt as a real column of
            # this table, which is the prompt promising a field no query can return.
            #
            # `earned_at` is the real timestamp and `mis_logros` returns it, so the
            # declaration below is the one that has to exist: an undeclared name in
            # `returns` makes P1 report `columna_desconocida` instead of checking
            # anything.
            "user_id": _c("jamas"),
            "code": _c("propio", "leccion.N.grado o rango.N."),
            "kind": _c("propio", "leccion | rango."),
            "lesson_n": _c("propio", "A que leccion pertenece, si aplica."),
            "earned_at": _c("propio", "Cuando se consiguio. Es el nombre real de la columna en la base."),
        },
    ),
    "ranking_optin": Table(
        purpose="Quien acepto aparecer en el ranking y con que alias.",
        per_user="AGREGADO: alias + conteos de quienes aceptaron. El mapeo alias -> nombre/correo no lo expone ninguna herramienta.",
        joins_with=("users",),
        depends_on=("users",),
        columns={
            "user_id": _c("jamas", "El puente alias -> persona. Es justo lo que no puede salir."),
            "alias": _c("agregado", "Lo unico publico de otra persona."),
            "joined_at": _c("agregado", "Desempata el ranking."),
        },
    ),
    "league_week": Table(
        purpose="El cierre semanal de ligas: metal, caudal y puesto por persona y semana.",
        per_user="El propio metal y puesto. De terceros, solo a traves del alias del ranking.",
        joins_with=("users",),
        depends_on=("users",),
        columns={
            "user_id": _c("jamas", "Igual que en ranking_optin: es el puente."),
            "week": _c("agregado", "Lunes de la semana cerrada."),
            "metal": _c("propio", "bronce | plata | oro."),
            "caudal": _c("propio", "Labs resueltos por primera vez esa semana."),
            "puesto": _c("agregado", "Posicion en la tabla."),
            "estado": _c("propio", "activo | salon."),
            "cerrada": _c("jamas", "Estado interno del cron."),
        },
    ),
    # The three tables below were absent while the database had them. Their
    # absence was not a documentation gap: `columnasProhibidas` answered [] for an
    # unknown table, so the guard silently approved every read from them. It now
    # fails closed, which is why they have to be declared.
    "lesson_text": Table(
        purpose="El texto de ensenanza de cada leccion, una fila por leccion e idioma.",
        per_user="Identico para todos. Lo que cambia por persona no es el contenido, es el derecho a leerlo.",
        joins_with=("lessons",),
        depends_on=("lessons",),
        columns={
            "lesson_n": _c("publico", "A que leccion pertenece."),
            "lang": _c("publico", "Idioma en el que esta escrito."),
            "technical": _paid("publico", "El mecanismo con precision. Es el producto que se vende."),
            "analogy": _paid("publico", "La imagen cotidiana. Es el producto que se vende."),
            "examples": _paid("publico", "Los dos ejemplos resueltos. Es el producto que se vende."),
        },
    ),
    "reset_tokens": Table(
        purpose="Los enlaces de recuperacion de contrasena. Guarda el hash del token, nunca el token.",
        per_user="Ninguna herramienta lo toca, y ninguna debe poder. Leerlo es tomar la cuenta.",
        joins_with=("users",),
        depends_on=("users",),
        columns={
            "id": _c("jamas", "Interno."),
            "user_id": _c("jamas", "El puente token -> persona."),
            "token_hash": _c("jamas", "Leer esto es apoderarse de la cuenta. La razon por la que esta tabla existe aqui."),
            # Undeclared until now, which meant the guard could never forbid it:
            # forbidden_columns() works from the declared `jamas` list, so a column
            # nobody declared is a column nobody blocks. Every other column in this
            # table is `jamas` and the table is credential material end to end.
            "created_at": _c("jamas", "Telemetria de seguridad."),
            "expires_at": _c("jamas", "Telemetria de seguridad."),
            "used_at": _c("jamas", "Telemetria de seguridad."),
        },
    ),
    "jobs": Table(
        purpose="La cola de trabajos en Postgres: cobros, cierres de liga, correos.",
        per_user="Nada aqui es del alumno. Es infraestructura, y sus datos pueden llevar datos de pago.",
        joins_with=("users",),
        # Listed in schema.prisma order so the next drift check is a straight diff.
        # Two of these names used to be wrong — `payload` for `datos` and
        # `correr_en` for `corre_en` — and the two real columns they should have
        # been were therefore undeclared, along with `tomado_en` and `acabado_en`.
        # A wrong name is worse here than a missing one: it puts a name that does
        # not exist into the guard's forbidden list while leaving the real column
        # unlisted, so the list looks full and protects nothing. Verified against
        # api/prisma/schema.prisma and the live information_schema.
        columns={
            "id": _c("jamas", "Interno."),
            "tipo": _c("jamas", "Infraestructura."),
            "clave": _c("jamas", "Clave de idempotencia; puede llevar un id de pago."),
            "datos": _c("jamas", "Puede llevar el cuerpo crudo de un webhook de pago."),
            "estado": _c("jamas", "Infraestructura."),
            "intentos": _c("jamas", "Infraestructura."),
            "error": _c("jamas", "Puede llevar un mensaje del proveedor de pago."),
            "corre_en": _c("jamas", "Infraestructura."),
            "tomado_en": _c("jamas", "Infraestructura."),
            "acabado_en": _c("jamas", "Infraestructura."),
            "creado_en": _c("jamas", "Infraestructura."),
        },
    ),
}

# THE 37 TOOLS, with what they TOUCH and what they RETURN. Copied one by one from
# api/src/tools/index.ts; test_node_contract.py checks that the names still match
# the registry Node exposes, and export.py refuses to write when they drift.
#
# WHY 37 AND NOT 7. Until now only seven were declared, so the four obligations in
# graph.py ran over 19% of the surface and the report still read «P1..P4 se
# cumplen». The thirty that were missing include the ones that move the most
# columns: `cola_siguiente` returns lab statement + payload + explanation + lesson
# prose, `buscar_en_curso` searches every text column in the course, `mis_errores`
# returns lab statements, `ligas_tabla` and `mi_panorama` cross people. A proof
# that covers a fifth of the surface is not a proof, and printing it as one is
# the same class of lie as the guard that approved tables it never inspected.
#
# WHAT COUNTS AS `reads`. Every table the queries touch, joins included, AND the
# tables the shared helpers touch on the tool's behalf. That last part is where
# the old declarations were wrong: `leccionesAbiertas` -> `yo` reads `users`, so
# every tool behind the paywall touches `users` even when its own SQL never names
# it. Declaring `leccion` as `scope="publico"` while it reads `users` was a
# declaration that could not be true.
#
# WHAT COUNTS AS `returns` — the load-bearing decision, because P1 and P4 are
# checked against it. A column is declared when the caller can read its CONTENT:
# whole, truncated (`recorta`), or transformed row by row. A column that only
# feeds a filter, a JOIN condition or an existence bit is in `reads` and not here.
# Two consequences worth stating out loud, because both are judgement calls a
# reviewer may want to overturn:
#
#   · SQL_CAUDAL (ligas.js) joins on `users.paid = 1 AND users.deleted_at IS NULL`.
#     `deleted_at` is `jamas`. It is a filter, its value never leaves, so it is
#     not declared — declaring it would make P1 report a leak that is not one.
#   · `curso_indice` selects `(technical <> '') AS tiene_tecnico`. One bit saying
#     «this lesson has text written» reconstructs none of the paid prose, so
#     `lessons.technical` is NOT in its `returns`. Declare it and P4 fires on a
#     tool that leaks nothing. If a reviewer disagrees, adding it is a one-line
#     change and the proof will say so.
TOOLS: Mapping[str, Tool] = {

    # -------------------------------------------------------------- content
    "curso_indice": Tool(
        description="Las 12 lecciones con su titulo, su numero ancla y cuantos labs tiene cada una.",
        args={}, scope="publico", reads=("lessons",),
        returns=("lessons.n", "lessons.eyebrow", "lessons.title", "lessons.summary",
                  "lessons.math", "lessons.math_cap"),
    ),
    "leccion": Tool(
        description="El contenido completo de una leccion y el enunciado de sus tres labs. Nunca trae las respuestas.",
        args={"n": "entero 1..12"},
        # `sesion`, not `publico`: the gate reads the session's `users` row. The
        # old declaration said `publico` and omitted `users`, which made the
        # tool's own paywall check invisible to P2.
        scope="sesion", reads=("lessons", "labs", "users"),
        returns=("lessons.n", "lessons.eyebrow", "lessons.title", "lessons.summary",
                  "lessons.math", "lessons.math_cap", "lessons.technical", "lessons.analogy",
                  "labs.id", "labs.lesson_n", "labs.idx", "labs.level", "labs.kind",
                  "labs.prompt", "labs.payload", "labs.draft"),
        # Checks the right of access before returning (P4).
        checks_entitlement=True,
    ),
    "leccion_texto": Tool(
        description="La explicacion tecnica, la analogia y los dos ejemplos resueltos de una leccion, en el idioma de la sesion. Es con lo que hay que ensenar antes de mandar al lab.",
        args={"n": "entero 1..12",
              "idioma": "opcional · «es» o «en»; por defecto el de la sesion"},
        scope="sesion", reads=("lessons", "lesson_text", "users"),
        returns=("lessons.n", "lessons.eyebrow", "lessons.title", "lessons.summary",
                  "lessons.math", "lessons.math_cap",
                  "lesson_text.lang", "lesson_text.technical", "lesson_text.analogy",
                  "lesson_text.examples"),
        checks_entitlement=True,
    ),
    "buscar_en_curso": Tool(
        description="Busca una palabra o una idea en las 12 lecciones y en los enunciados de los labs, y dice en que leccion esta. Usala antes de responder de memoria.",
        args={"consulta": "texto libre: «tokens», «por que inventa cosas»"},
        scope="sesion", reads=("lessons", "lesson_text", "labs", "users"),
        # Returns 180-character fragments of EVERY text column in the course. The
        # filter for readable lessons runs BEFORE the search, not after the sort: if
        # it ran after, the number of results would already be a leak.
        returns=("lessons.n", "lessons.eyebrow", "lessons.title", "lessons.summary",
                  "lessons.math_cap", "lessons.technical", "lessons.analogy",
                  "lesson_text.lesson_n", "lesson_text.technical", "lesson_text.analogy",
                  "labs.id", "labs.lesson_n", "labs.prompt"),
        checks_entitlement=True,
    ),
    "glosario": Tool(
        description="Que significa un termino del curso (token, perilla, temperatura, contexto...) y en que leccion se explica. Sin argumento devuelve la lista de terminos.",
        # It does not touch the database: the glossary is static data in producto.js.
        args={"termino": "opcional · una palabra o expresion"},
        scope="publico", reads=(), returns=(),
    ),
    "lab_ficha": Tool(
        description="Un lab suelto: enunciado, nivel, como se responde su mecanica y si esta persona ya lo resolvio. Nunca la solucion.",
        args={"lab_id": "texto como «5.2»"},
        scope="sesion", reads=("labs", "users", "attempts"),
        returns=("labs.id", "labs.lesson_n", "labs.idx", "labs.level", "labs.kind",
                  "labs.prompt", "labs.payload", "labs.draft", "attempts.correct"),
        # FIXED. Found by P4 the moment coverage went from 7 tools to 37 — no human
        # reviewer had reported it across three separate audits.
        #
        # It used to compute `conAcceso(u, lab.lesson_n)` and return it as the LABEL
        # `cerrado`, sitting next to the `lab` object it was supposed to be
        # withholding, so `lab_ficha {lab_id: "12.3"}` handed labs.prompt and
        # labs.payload to a free account while GET /api/v3/lessons/12 answered 402
        # to the same cookie. Computing the rule and not obeying it is the same bug
        # as never computing it.
        #
        # api/src/tools/content.ts now sets `paywalled: true` and calls
        # readableLessons() before returning, so the declaration is true rather than
        # convenient. `scripts/emit-tool-catalog.mjs` reports that flag and
        # check_catalog() refuses to export when it disagrees with the line below.
        checks_entitlement=True,
    ),
    "requisitos_leccion": Tool(
        description="Si esta persona puede saltar a una leccion: que deberia traer entendido, como va en la anterior y si tiene la leccion abierta.",
        args={"n": "entero 1..12"},
        scope="sesion", reads=("users", "labs", "attempts", "lessons"),
        # The lesson header (n, eyebrow, title, summary) — all `gratis` — plus the
        # per-lesson count. `technical` and `analogy` are not read here.
        returns=("lessons.n", "lessons.eyebrow", "lessons.title", "lessons.summary",
                  "labs.lesson_n", "attempts.correct"),
    ),

    # -------------------------------------------------------------- progress
    "mi_panorama": Tool(
        description="TODO el estado de esta persona de una sola vez: perfil, progreso, racha, siguiente paso, liga y que tiene en la cola. Empieza por aqui: ahorra cuatro llamadas.",
        args={},
        # `agregado`, not `sesion`: the `liga` block comes from estadoLiga -> caudal(),
        # which crosses everybody signed up to the ranking. `activa` and `puesto`
        # depend on other people's rows even though only the own position gets out.
        scope="agregado", reads=("users", "labs", "attempts", "lessons", "ranking_optin"),
        returns=("users.name", "users.role", "users.lang", "users.paid",
                  "users.cohort", "users.created_at",
                  "labs.id", "labs.lesson_n", "labs.level", "labs.kind",
                  "attempts.correct", "attempts.at",
                  "lessons.title", "ranking_optin.alias"),
    ),
    "mi_progreso": Tool(
        description="Cuantas lecciones y labs lleva resueltos la persona de esta sesion, leccion por leccion.",
        args={}, scope="sesion", reads=("labs", "attempts"),
        returns=("labs.lesson_n", "attempts.correct"),
    ),
    "mis_intentos": Tool(
        description="Los intentos de la persona de esta sesion en un lab, con lo que respondio.",
        args={"lab_id": "texto como «5.2»"},
        # `users` is read by the paywall (leccionesAbiertas -> yo), not by the tool's SQL.
        scope="sesion", reads=("attempts", "labs", "users"),
        returns=("attempts.lab_id", "attempts.answer", "attempts.correct", "attempts.at",
                  "labs.id", "labs.lesson_n", "labs.idx", "labs.level", "labs.kind",
                  "labs.prompt", "labs.payload", "labs.draft", "labs.explanation"),
        # Checks the right of access before returning (P4).
        checks_entitlement=True,
    ),
    "mi_perfil": Tool(
        description="Nombre de pila, rol, idioma y si compro el curso. Solo de la sesion actual.",
        args={}, scope="sesion", reads=("users",),
        returns=("users.name", "users.role", "users.lang", "users.paid",
                  "users.cohort", "users.created_at"),
    ),
    "mi_siguiente_paso": Tool(
        description="Que lab concreto sigue ahora, respetando candados y borradores. La respuesta a «que hago?». Deja el lab en la cola.",
        args={}, scope="sesion", reads=("users", "labs", "lessons", "attempts"),
        # `pendientes` reads labs.draft and attempts.correct to FILTER; what comes out
        # is the lab's short card and its lesson title, all of it `gratis`.
        returns=("labs.id", "labs.lesson_n", "labs.level", "labs.kind", "lessons.title"),
    ),
    "mis_pendientes": Tool(
        description="Los labs que le faltan, en orden de curso, marcando los que estan cerrados por compra. Opcionalmente los de una sola leccion.",
        args={"n": "opcional · entero 1..12 para filtrar por leccion"},
        scope="sesion", reads=("users", "labs", "lessons", "attempts"),
        # It also lists the LOCKED labs, but only their card (id, level, mechanic)
        # and the lesson title. No statement and no payload: nothing `de_pago`.
        returns=("labs.id", "labs.lesson_n", "labs.idx", "labs.level", "labs.kind",
                  "labs.draft", "lessons.title"),
    ),
    "mis_errores": Tool(
        description="Los labs que intento y no ha resuelto, con lo que respondio y que mecanica se le atraviesa. Aqui esta el patron del error. Los deja en la cola.",
        args={}, scope="sesion", reads=("attempts", "labs"),
        returns=("attempts.lab_id", "attempts.answer", "attempts.at",
                  "labs.lesson_n", "labs.level", "labs.kind", "labs.prompt"),
        # FIXED. Found by P4, not by a reviewer.
        #
        # It emitted `enunciado: recorta(f.prompt)` — 180 characters of a `de_pago`
        # column — with no gate. Having attempted a lab is not a licence to read its
        # statement: POST /api/v3/labs/:id/attempt checks entitlement at ATTEMPT
        # time, so the row outlives it. A refund (users.paid -> 0) or a tutor
        # demoted to student leaves the attempts behind, and this tool kept serving
        # statements from lessons the account could no longer open.
        #
        # api/src/tools/progress.ts now filters the failed labs to the readable lessons
        # and reports how many were withheld, so the count stays honest.
        checks_entitlement=True,
    ),
    "mi_racha": Tool(
        description="Dias seguidos con actividad, mejor racha y cuando fue la ultima vez. Sirve para «llevas dos semanas sin abrirlo».",
        args={}, scope="sesion", reads=("attempts",),
        returns=("attempts.at",),
    ),
    "mi_ritmo": Tool(
        description="Cuantos labs resuelve por semana y, a ese ritmo, cuanto le falta para terminar los 36. Responde «cuanto me queda?».",
        args={}, scope="sesion", reads=("attempts",),
        returns=("attempts.at", "attempts.correct"),
    ),
    "mi_historial": Tool(
        description="Los ultimos intentos con su fecha: que toco y si acerto. Responde «que hice ayer?».",
        args={"dias": "opcional · entero 1..30, por defecto 7"},
        scope="sesion", reads=("attempts", "labs"),
        returns=("attempts.lab_id", "attempts.correct", "attempts.at", "labs.lesson_n"),
    ),
    "mi_acceso": Tool(
        description="Que tiene abierto y que no, y por que. La respuesta a «por que no puedo abrir la leccion 4?».",
        args={}, scope="sesion", reads=("users", "lessons"),
        # It reads lessons.title but emits only the lesson NUMBERS, open and locked.
        returns=("users.paid", "users.role", "lessons.n"),
    ),
    "mis_logros": Tool(
        description="El rango de la persona de esta sesion. Un rango por cada leccion cerrada.",
        args={}, scope="sesion",
        # `achievements` was missing from the old declaration, and with it the four
        # names the tool returns from that table.
        reads=("labs", "attempts", "achievements"),
        returns=("labs.lesson_n", "attempts.correct",
                  "achievements.code", "achievements.kind", "achievements.lesson_n",
                  "achievements.earned_at"),
    ),
    "logros_faltantes": Tool(
        description="Que logros le faltan y que hay que hacer exactamente para cada uno. Responde «que me falta para el siguiente?».",
        args={}, scope="sesion", reads=("labs", "attempts", "achievements"),
        # It reads achievements.code but emits only its COUNT: the codes that get out
        # are generated by logros.js (codigoLeccion/codigoRango), not by the table.
        returns=("labs.lesson_n", "attempts.correct"),
    ),
    "mi_liga": Tool(
        description="Su liga de esta semana: metal, puesto, caudal y cuando cierra. Si no esta en liga, dice exactamente que falta.",
        args={}, scope="agregado", reads=("users", "ranking_optin", "attempts"),
        # metal, puesto and estado are computed by reparteMetales() in JS from the
        # crossed table; they do not come from league_week, which no tool reads.
        returns=("ranking_optin.alias",),
    ),
    "ligas_tabla": Tool(
        description="La tabla de la liga semanal: alias, metal, puesto y caudal de quienes aceptaron aparecer. Nunca nombres ni correos.",
        args={}, scope="agregado", reads=("ranking_optin", "users", "attempts"),
        # `map(({user_id, ...r}) => r)` strips the alias -> person bridge before
        # returning. The alias is the only thing of another person that gets out.
        returns=("ranking_optin.alias",),
    ),
    "ranking_publico": Tool(
        description="Alias y avance de quienes aceptaron aparecer, mas la posicion propia. Nunca nombres ni correos.",
        args={}, scope="agregado", reads=("ranking_optin", "attempts", "labs"),
        returns=("ranking_optin.alias", "ranking_optin.joined_at", "labs.lesson_n"),
    ),

    # -------------------------------------------------------------- product
    "como_funciona": Tool(
        description="Como funciona la plataforma: lecciones, labs, logros, ranking y ligas. Para «que es esto?» y «como se usa?».",
        # Static figures and routes from producto.js. It does not touch the database.
        args={}, scope="publico", reads=(), returns=(),
    ),
    "donde_encuentro": Tool(
        description="En que pagina de la plataforma se hace algo. Para «donde cambio el idioma?», «donde veo mi puesto?». Devuelve la ruta exacta.",
        args={"consulta": "texto libre: «cambiar el tema», «descargar el pdf»"},
        scope="publico", reads=(), returns=(),
    ),
    "precio_y_compra": Tool(
        description="Cuanto cuesta, que incluye, la garantia y si esta persona ya lo compro. El precio sale del mismo sitio que el checkout.",
        args={}, scope="sesion", reads=("users",),
        returns=("users.paid",),
    ),
    "mis_datos_y_privacidad": Tool(
        description="Que guarda la plataforma de esta persona, que puede ver el agente y como borrar la cuenta. Para «que sabes de mi?».",
        args={}, scope="sesion", reads=("users", "attempts", "achievements", "ranking_optin"),
        # From attempts and achievements only counts get out. The own alias does come
        # out in full: it is the answer to «what can another person see about me».
        returns=("users.name", "users.role", "users.lang", "users.theme",
                  "users.paid", "users.created_at", "ranking_optin.alias"),
    ),
    "descargar_pdf": Tool(
        description="Si esta persona puede descargar el PDF del curso, en que idiomas y desde donde.",
        args={}, scope="sesion", reads=("users",),
        returns=("users.paid",),
    ),
    "soporte": Tool(
        description="Que hacer cuando algo no funciona: responde el problema frecuente que casa y, si no, como escribirle a una persona.",
        args={"tema": "opcional · el problema en palabras de la persona"},
        scope="publico", reads=(), returns=(),
    ),
    "ajustes": Tool(
        description="Idioma y tema que tiene puestos, que valores existen y donde se cambian.",
        args={}, scope="sesion", reads=("users",),
        returns=("users.lang", "users.theme"),
    ),

    # ---------------------------------------------------------- coordination
    "plan_estudio": Tool(
        description="Arma un plan con los siguientes labs en orden y lo deja en la cola. Despues, cada `cola_siguiente` entrega uno ya resuelto con su contexto.",
        args={"sesiones": "opcional · entero 1..12, cuantos labs planear; por defecto 5"},
        scope="sesion", reads=("users", "labs", "lessons", "attempts"),
        # The plan carries only OPEN, non-draft labs, and only their short card.
        returns=("labs.id", "labs.lesson_n", "labs.level", "labs.kind", "lessons.title"),
    ),
    "cola_siguiente": Tool(
        description="Saca lo primero de la cola y lo devuelve YA RESUELTO: ficha del lab, intentos propios, explicacion si ya lo intento y la leccion de donde sale. Una llamada en vez de tres.",
        args={},
        scope="sesion", reads=("labs", "attempts", "lessons", "lesson_text", "users"),
        # The tool that moves the most columns of the 37: three tools in one. The
        # `lab` branch returns the card, the attempts, the explanation and a truncated
        # slice of the lesson; the `leccion` branch returns the COMPLETE text.
        returns=("labs.id", "labs.lesson_n", "labs.idx", "labs.level", "labs.kind",
                  "labs.prompt", "labs.payload", "labs.draft", "labs.explanation",
                  "attempts.answer", "attempts.correct", "attempts.at",
                  "lessons.n", "lessons.eyebrow", "lessons.title", "lessons.summary",
                  "lessons.math", "lessons.math_cap",
                  "lesson_text.lang", "lesson_text.technical", "lesson_text.analogy",
                  "lesson_text.examples"),
        # Checks the right of access before returning, in both branches (P4).
        checks_entitlement=True,
    ),
    # The five below do NOT touch the database: they read the session's in-memory bus
    # (agent-bus.js). `publico` here means exactly what the definition says — it
    # touches no TABLE holding person data — not that its output belongs to everyone:
    # the bus is indexed by userId like everything else.
    "cola_estado": Tool(
        description="Que hay pendiente en la cola de estudio y cual es el foco actual, sin sacar nada.",
        args={}, scope="publico", reads=(), returns=(),
    ),
    "cola_encolar": Tool(
        description="Deja algo pendiente para mas tarde en la cola: un lab, una leccion o un tema que salio en la conversacion.",
        args={"tipo": "«lab», «leccion» o «tema»",
              "ref": "el lab («5.2»), la leccion («7») o el tema («tokens»)",
              "motivo": "opcional · por que queda pendiente"},
        scope="publico", reads=(), returns=(),
    ),
    "foco_apilar": Tool(
        description="Guarda donde esta la persona antes de irte por una rama de la conversacion. Despues `foco_volver` regresa aqui.",
        args={"tipo": "«lab», «leccion» o «tema»",
              "ref": "el lab, la leccion o el tema",
              "nota": "opcional · que se estaba haciendo"},
        scope="publico", reads=(), returns=(),
    ),
    "foco_volver": Tool(
        description="Cierra la rama actual y devuelve a donde estaba la persona antes. Para «volvamos a lo que estabamos».",
        args={}, scope="publico", reads=(), returns=(),
    ),
    "bus_diagnostico": Tool(
        description="Como va la coordinacion de esta sesion: largo de la cola, alto de la pila y cuantas consultas ahorro la cache. Para explicar de donde salio un dato.",
        args={}, scope="publico", reads=(), returns=(),
    ),

    # ------------------------------------------------------- native (runner=python)
    #
    # Answered inside this service, by course_ai/retrieval/. All three declare
    # `reads=()`, `returns=()` and `checks_entitlement=False`, and P5 REQUIRES all
    # three of those rather than treating them as convention:
    #
    #  · `reads`/`returns` empty because there is no database driver in this process
    #    to make them true with. Declaring the tables they «conceptually» search
    #    produces phantom violations — measured: reads=("lessons","labs") +
    #    returns=("lessons.technical","labs.prompt") yields two `de_pago_sin_verificar`
    #    for a code path that does not exist — and the only way to silence those
    #    inside this model is checks_entitlement=True, i.e. declaring Python an
    #    entitlement authority. Which is the next bullet, and it is forbidden.
    #  · `checks_entitlement` false because the flag MEANS «Node's registry gates
    #    this»: it is compared against the emitter's own `paywalled` field. A native
    #    setting it would not be a declaration, it would be a lie that breaks the
    #    contract test and check_catalog at once. Forbidding it is the same sentence
    #    as «a native may never return gated content», made structural — which is
    #    obligation P4's reason for existing, in a second language.
    #
    # So what do they return? Lesson NUMBERS, public glossary terms, a rewritten
    # query string, and the NAME of the bridged tool to call next. The content
    # arrives through that bridged tool, which Node executes and gates. The
    # composition stays visible in the trace instead of a Python tool appearing to
    # answer with paid prose.
    "entender_pregunta": Tool(
        description="A que responde la pregunta de la persona, dicha con sus palabras: una leccion del curso (devuelve el numero, la consulta reescrita y que herramienta llamar despues), o el PRODUCTO (devuelve `intencion` y la herramienta publica que tiene el dato: precio, cuenta, ajustes, soporte…), o `sin_ruta` si no es ninguna de las dos. Usala ANTES de `buscar_en_curso` cuando la pregunta no traiga una palabra del curso: «por que se inventa cosas», «como lo hago menos aleatorio», «cuanto cuesta el curso».",
        args={"pregunta": "texto libre · la pregunta tal como la escribio la persona",
              "idioma": "opcional · «es» o «en»; por defecto el de la sesion"},
        scope="publico", reads=(), returns=(),
        runner="python", composes=("curso_indice",),
    ),
    "ampliar_consulta": Tool(
        description="Prepara una consulta para `buscar_en_curso`: quita las palabras que salen en todas las lecciones y la reescribe con las palabras del curso, en los dos idiomas. Sin leer nada: es solo la consulta.",
        args={"consulta": "texto libre · la consulta original",
              "idioma": "opcional · «es» o «en»; por defecto el de la sesion"},
        scope="publico", reads=(), returns=(),
        runner="python",
    ),
    "mapa_de_conceptos": Tool(
        description="Los conceptos que cubre el curso y en que leccion esta cada uno, con sus terminos del glosario. Para «cubre esto el curso?» sin adivinar.",
        args={"concepto": "opcional · un concepto o una palabra; sin argumento devuelve todos"},
        scope="publico", reads=(), returns=(),
        runner="python", composes=("curso_indice",),
    ),
}
# TWO DERIVED VIEWS, so that no consumer re-derives the split by a second rule.
#
# TOOLS stays the UNION and that is deliberate: it is what the model must see (one
# list of what it can call), what render.catalog() documents, what the loop's
# allowlist admits and what the exported artefact carries. The split matters only to
# whoever is comparing against Node.
#
#   BRIDGED  the population the Node contract covers. `len(BRIDGED)` and
#            `set(BRIDGED)` are compared to the registry's own catalogue, both
#            directions, no exceptions.
#   NATIVE   answered inside /ai. Covered by obligation P5 in graph.py, which is
#            what stops this from being a hole with better typing.
BRIDGED: Mapping[str, Tool] = {n: h for n, h in TOOLS.items() if h.runner == "node"}
NATIVE: Mapping[str, Tool] = {n: h for n, h in TOOLS.items() if h.runner == "python"}

# Argument names no tool may accept. This is not a list of best practices: it is the
# condition that makes «somebody else's data» impossible to express. If a new tool
# declares `user_id`, the test fails.
IDENTITY_ARGS: frozenset[str] = frozenset({
    "user_id", "userid", "usuario", "user", "id_usuario", "email", "correo",
    "alias_de", "de_quien", "persona", "cuenta", "pass_hash", "session", "token",
})

ONTOLOGY = {"tables": TABLES, "tools": TOOLS}
