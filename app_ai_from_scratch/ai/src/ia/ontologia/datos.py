"""La ontologia como DATOS, no como prosa.

Portada de api/src/ontology.js, que era la fuente de verdad hasta v2. La
diferencia no es de lenguaje: en v2 la ontologia describia el aislamiento y el
codigo lo implementaba aparte, asi que nada garantizaba que coincidieran. Aqui
cada herramienta declara que tablas toca y que columnas devuelve, y grafo.py
demuestra sobre esos datos que ninguna columna `jamas` puede salir. La garantia
pasa de comentario a teorema comprobable.

Clases de sensibilidad:
    publico   contenido del curso; cualquiera puede verlo
    propio    solo del usuario de la sesion, nunca de terceros
    agregado  sale de varios usuarios, pero solo como conteo o alias con opt-in
    jamas     nunca llega al modelo, ni del propio usuario
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

Clase = Literal["publico", "propio", "agregado", "jamas"]
CLASES: tuple[Clase, ...] = ("publico", "propio", "agregado", "jamas")

# Alcance de una herramienta sobre datos personales:
#   sesion    filtra por el userId que pone el servidor
#   publico   no toca ninguna tabla con datos de persona
#   agregado  cruza varias personas, y solo devuelve conteos o alias con opt-in
Alcance = Literal["sesion", "publico", "agregado"]


@dataclass(frozen=True, slots=True)
class Columna:
    clase: Clase
    nota: str = ""


@dataclass(frozen=True, slots=True)
class Tabla:
    proposito: str
    por_usuario: str
    columnas: Mapping[str, Columna]
    # Aristas tabla -> tabla POR DONDE SE PUEDE UNIR. Es alcanzabilidad, no
    # dependencia: se declara en los dos sentidos porque un join se escribe en
    # cualquiera de los dos. Sirve para responder «que hay a un join de aqui»,
    # que es una pregunta de revision de diseno.
    une: tuple[str, ...] = ()
    # Aristas DIRIGIDAS de clave ajena: «esta tabla apunta a estas». De aqui sale
    # el orden de borrado de una cuenta, y por eso no puede ser `une`: `une` es
    # simetrica y con ella Kahn mete casi todo en un ciclo.
    depende_de: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class Herramienta:
    descripcion: str
    args: Mapping[str, str]
    alcance: Alcance
    # Tablas que la consulta toca, joins incluidos.
    usa: tuple[str, ...]
    # Columnas que SALEN del servidor, con nombre completo «tabla.columna».
    # No es lo mismo que `usa`: `mis_intentos` toca labs entera y devuelve ocho
    # columnas de las nueve. La novena es labs.solution.
    devuelve: tuple[str, ...] = field(default=())


def _c(clase: Clase, nota: str = "") -> Columna:
    return Columna(clase=clase, nota=nota)


TABLAS: Mapping[str, Tabla] = {
    "users": Tabla(
        proposito="Una fila por persona registrada. Identidad, rol, preferencias y si compro el curso.",
        por_usuario="El agente solo ve la fila de la sesion. Las demas filas no son alcanzables por ninguna herramienta.",
        une=("attempts", "payments", "ranking_optin", "role_audit"),
        columnas={
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
        },
    ),
    "lessons": Tabla(
        proposito="Las 12 lecciones del Vol. 1. Es el corpus con el que el agente ensena.",
        por_usuario="Identico para todos: no hay nada personal aqui.",
        une=("labs",),
        columnas={
            "n": _c("publico", "1..12, el orden del curso."),
            "eyebrow": _c("publico", "Etiqueta corta del tema."),
            "title": _c("publico", "La idea en lenguaje hablado."),
            "summary": _c("publico", "Una frase con el concepto."),
            "math": _c("publico", "El numero que ancla la leccion. Solo numeros, nunca formulas."),
            "math_cap": _c("publico", "Que significa ese numero."),
            "technical": _c("publico", "El mecanismo con precision. Puede estar vacio mientras se redacta."),
            "analogy": _c("publico", "Una sola imagen cotidiana. Puede estar vacia mientras se redacta."),
        },
    ),
    "labs": Tabla(
        proposito="Los 36 ejercicios, tres por leccion, con su mecanica y su correccion.",
        por_usuario="El enunciado es igual para todos. La explicacion solo se entrega si esa persona ya intento ese lab.",
        une=("lessons", "attempts"),
        depende_de=("lessons",),
        columnas={
            "id": _c("publico", "«5.2» = leccion 5, ejercicio 2."),
            "lesson_n": _c("publico", "A que leccion pertenece."),
            "idx": _c("publico", "1 facil, 2 medio, 3 dificil."),
            "level": _c("publico", "facil | medio | dificil."),
            "kind": _c("publico", "choice | cut | order | build | knob | hotcold."),
            "prompt": _c("publico", "El enunciado."),
            "payload": _c("publico", "JSON de lo que se ve en pantalla: opciones, palabras, pasos."),
            "solution": _c("jamas", "LA MAS IMPORTANTE. Si el agente puede leerla, «dime la respuesta del 5.2» destruye el curso."),
            "explanation": _c("publico", "Condicionada: solo para labs que esa persona ya intento."),
            "draft": _c("publico", "1 = sin escribir. Evita que el agente invente contenido."),
        },
    ),
    "attempts": Tabla(
        proposito="Cada intento de cada persona en cada lab. Es de donde sale el progreso.",
        por_usuario="Solo las filas propias. «Cuantos intentos lleva Paula» es exactamente la fuga que hay que evitar.",
        une=("users", "labs"),
        depende_de=("users", "labs"),
        columnas={
            "id": _c("jamas", "Identificador interno."),
            "user_id": _c("jamas", "El agente nunca lo ve ni lo escribe: sale de la sesion."),
            "lab_id": _c("propio", "Que lab se intento."),
            "answer": _c("propio", "Lo que respondio. Aqui esta el valor real del agente: ve el patron del error."),
            "correct": _c("propio", "1 acerto, 0 fallo."),
            "at": _c("propio", "Cuando. Sirve para «llevas dos semanas sin abrirlo»."),
        },
    ),
    "payments": Tabla(
        proposito="Los cobros de Mercado Pago.",
        por_usuario="Del propio usuario solo un booleano «pagado». Nada mas, ni para el.",
        une=("users",),
        depende_de=("users",),
        columnas={
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
    "role_audit": Tabla(
        proposito="Rastro de quien cambio el rol de quien.",
        por_usuario="Ninguna herramienta lo expone. Es rastro de administracion: no hay nada que ensenar con el.",
        une=("users",),
        depende_de=("users",),
        columnas={
            "id": _c("jamas"), "actor_id": _c("jamas"), "user_id": _c("jamas"),
            "from_role": _c("jamas"), "to_role": _c("jamas"), "at": _c("jamas"),
        },
    ),
    "achievements": Tabla(
        proposito="Rango y grados conseguidos por persona.",
        por_usuario="Solo los propios. El rango de un tercero solo aparece dentro del ranking, y solo con opt-in.",
        une=("users",),
        depende_de=("users",),
        columnas={
            "id": _c("jamas"), "user_id": _c("jamas"),
            "code": _c("propio", "leccion.N.grado o rango.N."),
            "kind": _c("propio", "leccion | rango."),
            "lesson_n": _c("propio", "A que leccion pertenece, si aplica."),
            "at": _c("propio", "Cuando se consiguio."),
        },
    ),
    "ranking_optin": Tabla(
        proposito="Quien acepto aparecer en el ranking y con que alias.",
        por_usuario="AGREGADO: alias + conteos de quienes aceptaron. El mapeo alias -> nombre/correo no lo expone ninguna herramienta.",
        une=("users",),
        depende_de=("users",),
        columnas={
            "user_id": _c("jamas", "El puente alias -> persona. Es justo lo que no puede salir."),
            "alias": _c("agregado", "Lo unico publico de otra persona."),
            "joined_at": _c("agregado", "Desempata el ranking."),
        },
    ),
    "league_week": Tabla(
        proposito="El cierre semanal de ligas: metal, caudal y puesto por persona y semana.",
        por_usuario="El propio metal y puesto. De terceros, solo a traves del alias del ranking.",
        une=("users",),
        depende_de=("users",),
        columnas={
            "user_id": _c("jamas", "Igual que en ranking_optin: es el puente."),
            "week": _c("agregado", "Lunes de la semana cerrada."),
            "metal": _c("propio", "bronce | plata | oro."),
            "caudal": _c("propio", "Labs resueltos por primera vez esa semana."),
            "puesto": _c("agregado", "Posicion en la tabla."),
            "estado": _c("propio", "activo | salon."),
            "cerrada": _c("jamas", "Estado interno del cron."),
        },
    ),
}

# Las siete herramientas, con lo que TOCAN y lo que DEVUELVEN. Copiadas una a una
# de api/src/agent-tools.js; el test de contrato comprueba que los nombres siguen
# coincidiendo con el catalogo que declara Node, para que esto no se quede viejo.
HERRAMIENTAS: Mapping[str, Herramienta] = {
    "curso_indice": Herramienta(
        descripcion="Las 12 lecciones con su titulo, su numero ancla y cuantos labs tiene cada una.",
        args={}, alcance="publico", usa=("lessons",),
        devuelve=("lessons.n", "lessons.eyebrow", "lessons.title", "lessons.summary",
                  "lessons.math", "lessons.math_cap"),
    ),
    "leccion": Herramienta(
        descripcion="El contenido completo de una leccion y el enunciado de sus tres labs. Nunca trae las respuestas.",
        args={"n": "entero 1..12"}, alcance="publico", usa=("lessons", "labs"),
        devuelve=("lessons.n", "lessons.eyebrow", "lessons.title", "lessons.summary",
                  "lessons.math", "lessons.math_cap", "lessons.technical", "lessons.analogy",
                  "labs.id", "labs.lesson_n", "labs.idx", "labs.level", "labs.kind",
                  "labs.prompt", "labs.payload", "labs.draft"),
    ),
    "mi_progreso": Herramienta(
        descripcion="Cuantas lecciones y labs lleva resueltos la persona de esta sesion, leccion por leccion.",
        args={}, alcance="sesion", usa=("labs", "attempts"),
        devuelve=("labs.lesson_n", "attempts.correct"),
    ),
    "mis_intentos": Herramienta(
        descripcion="Los intentos de la persona de esta sesion en un lab, con lo que respondio.",
        args={"lab_id": "texto como «5.2»"}, alcance="sesion", usa=("attempts", "labs"),
        devuelve=("attempts.lab_id", "attempts.answer", "attempts.correct", "attempts.at",
                  "labs.id", "labs.lesson_n", "labs.idx", "labs.level", "labs.kind",
                  "labs.prompt", "labs.payload", "labs.draft", "labs.explanation"),
    ),
    "mi_perfil": Herramienta(
        descripcion="Nombre de pila, rol, idioma y si compro el curso. Solo de la sesion actual.",
        args={}, alcance="sesion", usa=("users",),
        devuelve=("users.name", "users.role", "users.lang", "users.paid",
                  "users.cohort", "users.created_at"),
    ),
    "ranking_publico": Herramienta(
        descripcion="Alias y avance de quienes aceptaron aparecer, mas la posicion propia. Nunca nombres ni correos.",
        args={}, alcance="agregado", usa=("ranking_optin", "attempts", "labs"),
        devuelve=("ranking_optin.alias", "ranking_optin.joined_at", "labs.lesson_n"),
    ),
    "mis_logros": Herramienta(
        descripcion="El rango de la persona de esta sesion. Un rango cada dos lecciones cerradas.",
        args={}, alcance="sesion", usa=("labs", "attempts"),
        devuelve=("labs.lesson_n", "attempts.correct"),
    ),
}

# Nombres de argumento que ninguna herramienta puede aceptar. No es una lista de
# buenas practicas: es la condicion que hace imposible expresar «los datos de
# otro». Si una herramienta nueva declara `user_id`, el test falla.
ARGS_PROHIBIDOS: frozenset[str] = frozenset({
    "user_id", "userid", "usuario", "user", "id_usuario", "email", "correo",
    "alias_de", "de_quien", "persona", "cuenta", "pass_hash", "session", "token",
})

ONTOLOGIA = {"tablas": TABLAS, "herramientas": HERRAMIENTAS}
