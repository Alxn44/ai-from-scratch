"""What the customer is asking about when they are NOT asking about a lesson.

WHY THIS EXISTS, measured. `entender_pregunta` used to answer every question with a
lesson number or `sin_ruta`, and a router with only those two answers gets the
commonest kind of message wrong in the most confident way available to it. Over the
44 realistic off-topic customer messages in ai/tests/queries.py (`OFF_TOPIC`) it
named a lesson for 18 of them. The worst was «cuanto cuesta el curso completo»: `cuesta`
is a synonym of `inferencia`, lesson 4 carries the phrasing «cuanto cuesta una
respuesta», so the tool answered lesson 4 at confianza 1.0 and the model explained
that training costs millions and answering costs cents. The person had asked the
price. `precio_y_compra` — the tool that holds the real price, next to the
checkout — was never called.

That is not a scoring problem. Raising the floor stops the tool from naming a
lesson, but `sin_ruta` for «how much does it cost» is still a wrong answer: there
IS a tool for it, and the model was not told. So this module answers the other
question a customer asks — price, account, settings, privacy, downloads, where
something is, something is broken — by NAMING THE PUBLIC TOOL that holds the fact.

WHAT IT MAY DO, and the boundaries are the same as the rest of this package:

  · it names a BRIDGED tool. It does not call one, it does not answer one, and it
    holds no answer of its own: not a price, not a route, not a policy. Those live
    in api/src/product.ts, which the checkout reads too — a price copied into
    Python would be the second copy that goes stale in the direction that costs
    money.
  · every tool it can name is PUBLIC: declared, executed by Node, and not gated.
    Checked at import time below, so this can never become a way to point at paid
    content, and it can never become an entitlement decision.
  · it decides nothing about who the person is. It reads the words of one message.

HOW A MARKER EARNS ITS PLACE. Two tiers, because one tier cannot be both precise
and useful:

  SOLO markers belong to the product and to nothing else — `tarjeta`, `reembolso`,
  `contrasena`, `pdf`, `liga`, `oscuro`. Seeing one is enough.

  PAIRED markers are ordinary words that mean the product only next to a product
  noun: `cuesta`, `precio`, `pagar`, `borrar`, `datos`, `descargar`. Alone they
  are course vocabulary — «por que entrenarla cuesta tanto» is lesson 4 and «sabe
  el precio de hoy» is lesson 11 — so they fire only with `curso`, `plataforma`,
  `mi cuenta`, `app`… in the same sentence. That pairing is the whole precision of
  this module: it is what separates «cuanto cuesta el curso» from «cuanto cuesta
  una respuesta», which no single word can do.

The vocabulary is bilingual in one list per intent rather than split by language,
because a Spanish-speaking customer types `password` and `refund` and this is not
a corpus that has to be searched in one language at a time.

AND WHAT STOPS IT FROM EATING THE COURSE. Three checks, none of them a comment:

  1. at import time, a SOLO marker or a product noun that the concept map already
     uses is REFUSED (the last block of `_check`). `error` is lesson 2's own term
     and `cuenta` is «cuenta letras o palabras», so neither can ever become a
     marker — the two layers cannot fight over one word. A PAIRED marker is exempt
     by design: it is ambiguous, and the product noun is what disambiguates it.
  2. at import time, a marker claimed by two intents is REFUSED. Ambiguity a
     scorer would resolve silently, by declaration order.
  3. in the tests, no marker may match any of the 138 course questions. That is
     the direction an import-time check cannot see, and it is asserted over the
     whole fixture rather than over the examples somebody remembered.
"""

from __future__ import annotations

from dataclasses import dataclass, fields

from ..ontology.data import TOOLS
from .concepts import CONCEPTS, phrasings, terms
from .query import _stems, stem, words


@dataclass(frozen=True, slots=True)
class Intent:
    """One thing a customer asks that no lesson answers, and the tool that does.

    `slug` is a stable English id for the trace; `tool` is the bridged, public tool
    the model is told to call next.
    """

    slug: str
    tool: str
    solo: tuple[str, ...]
    paired: tuple[str, ...]


# The four fields above, spelled out for the same reason `CONCEPT_FIELDS` is: a
# fifth one holding an ANSWER — a price, a route, a policy line — is the copy this
# module refuses to be, and the only enforceable way to say so is to state the
# shape where a check can read it.
INTENT_FIELDS: tuple[str, ...] = ("slug", "tool", "solo", "paired")


# The nouns that make a paired marker mean the product. `mi cuenta` is two words on
# purpose: `cuenta` alone is the verb — «como cuenta lo que escribo» is lesson 5 —
# and a multi-word marker requires every word, so «mi cuenta» cannot fire on it.
PRODUCT_NOUNS: tuple[str, ...] = (
    "curso", "plataforma", "pagina", "sitio", "web", "app", "aplicacion", "perfil",
    "mi cuenta", "esta cuenta", "la cuenta",
    "course", "platform", "page", "site", "website", "profile", "dashboard",
    "my account", "this account", "the account",
    # These are nouns and not intent markers: a subscription IS the product, so it
    # licenses `cobran`, `cancelar` and `precio` exactly the way `curso` does.
    "suscripcion", "subscription", "membresia", "membership",
)


INTENTS: tuple[Intent, ...] = (
    Intent(
        slug="price_and_purchase", tool="precio_y_compra",
        solo=("tarjeta", "credito", "reembolso", "descuento", "garantia", "paypal",
              "card", "refund", "discount", "guarantee", "checkout", "coupon", "cupon"),
        paired=("cuesta", "cuestan", "costo", "coste", "precio", "vale", "valor",
                "pagar", "pago", "pague", "pagado", "comprar", "compra", "comprado",
                "cobran", "cobrar", "cobraron", "cobro", "gratis",
                "cost", "costs", "price", "pay", "paid", "buy", "bought", "purchase",
                "charge", "charged", "billed", "free", "trial", "prueba"),
    ),
    Intent(
        slug="account_trouble", tool="soporte",
        # `no funciona` and `no carga` are two words for the same reason `mi cuenta`
        # is: `carga` alone is ordinary Spanish. `error` and `falla` are deliberately
        # absent — `error` is lesson 2's glossary term, and check 1 in the header
        # refuses it.
        solo=("contrasena", "password", "factura", "invoice", "soporte", "support",
              "bug", "roto", "broken", "verificacion", "spam",
              "no funciona", "no carga", "no puedo entrar", "cannot log", "does not load",
              "does not work"),
        paired=("entrar", "ingresar", "acceder", "login", "abre", "abrir",
                "recuperar", "reset", "restablecer", "cancelar", "cancel",
                "cerrada", "cerrado", "locked", "blocked", "bloqueada"),
    ),
    Intent(
        slug="settings", tool="ajustes",
        solo=("idioma", "language", "ajustes", "settings", "preferencias", "preferences",
              "oscuro", "claro", "dark mode", "light mode", "notificaciones",
              "notifications"),
        paired=("tema", "theme", "cambiar", "cambio", "change", "configurar", "configure"),
    ),
    Intent(
        slug="privacy_and_data", tool="mis_datos_y_privacidad",
        # «mis datos» is NOT here and the refusal below is why: `mis` and `dato` are
        # both words the concept map uses, so the marker is expressible entirely in
        # course vocabulary and check 1 rejects it. The cost is real and recorded in
        # the fixture — «que datos mios guardan» reaches no intent and comes back
        # `sin_ruta` — and it is the right price: a marker made of the course's own
        # words would answer «product» to a question about the course.
        solo=("privacidad", "privacy", "gdpr", "my data", "personal data",
              "datos personales"),
        paired=("borrar", "borro", "eliminar", "elimino", "delete", "remove", "guardan",
                "guardas", "datos", "data", "olvidar"),
    ),
    Intent(
        slug="download", tool="descargar_pdf",
        solo=("pdf", "epub", "imprimir", "print"),
        paired=("descargar", "descargo", "download", "offline", "copia"),
    ),
    Intent(
        slug="where_is_it", tool="donde_encuentro",
        solo=("liga", "ligas", "league", "leagues", "ranking", "puesto", "medalla",
              "insignia", "badge", "logros", "achievements", "racha", "streak"),
        paired=("donde", "where", "boton", "button", "menu", "pantalla", "screen"),
    ),
    Intent(
        slug="what_is_this", tool="como_funciona",
        solo=("movil", "mobile", "android", "certificado", "certificate",
              "cohorte", "cohort"),
        paired=("funciona", "works", "incluye", "includes", "sirve", "trata",
                "nivel", "level", "temario", "syllabus"),
    ),
)


# --------------------------------------------------------------- what a match is
@dataclass(frozen=True, slots=True)
class Matched:
    """An intent, and WHY — the words that produced it, for the trace.

    `noun` is empty when the intent fired on a solo marker alone. The model is
    handed both, so «why did it stop talking about lessons» is answerable from the
    trace rather than from this file.
    """

    intent: Intent
    markers: tuple[str, ...]
    noun: str
    score: float


def _present(marker: str, stems: frozenset[str]) -> bool:
    """Every word of the marker is in the sentence. Whole stems, never substrings.

    Multi-word markers are the precision tier: `mi cuenta`, `no funciona`, `datos
    personales`. Requiring all the words is what makes them narrower than any single
    word in them, which is the only reason they are worth declaring — `cuenta` alone
    is lesson 5's verb and `carga` alone is ordinary Spanish.
    """
    parts = tuple(stem(w) for w in words(marker))
    return bool(parts) and all(p in stems for p in parts)


def _hits(markers: tuple[str, ...], stems: frozenset[str]) -> tuple[str, ...]:
    return tuple(m for m in markers if _present(m, stems))


def match(query: str) -> Matched | None:
    """The intent this message is about, or None when it is not about the product.

    None is the common answer and the important one: it is what hands the sentence
    back to the concept router. This function is not a classifier over everything a
    person can type, it is a narrow «is this one of seven product questions».
    """
    stems = frozenset(stem(w) for w in words(query))
    if not stems:
        return None
    noun = next((n for n in PRODUCT_NOUNS if _present(n, stems)), "")

    best: Matched | None = None
    for it in INTENTS:
        solo = _hits(it.solo, stems)
        paired = _hits(it.paired, stems) if noun else ()
        if not solo and not paired:
            continue
        # A solo marker is worth twice a paired one: it needed no help to mean the
        # product. The tie-break is declaration order, so the same sentence always
        # produces the same answer — a tie broken by dict order changes with an edit
        # somewhere else.
        score = 2.0 * len(solo) + len(paired)
        if best is None or score > best.score:
            best = Matched(intent=it, markers=solo + paired,
                           noun=noun if paired else "", score=score)
    return best


# ------------------------------------------------------- the import-time refusals
#
# A raise, not an assert: `python -O` removes asserts and these have to hold in
# production too. Same reasoning as the native handler/declaration check in
# tools.py.
def _declared_fields() -> tuple[str, ...]:
    return tuple(f.name for f in fields(Intent))


def _map_stems() -> frozenset[str]:
    out: set[str] = set()
    for c in CONCEPTS:
        for text in (*phrasings(c), *terms(c)):
            out |= _stems(text)
    return frozenset(out)


def _refuse(problem: str) -> None:
    raise RuntimeError(f"the product-intent table is not usable: {problem}")


def _check() -> None:
    if _declared_fields() != INTENT_FIELDS:
        _refuse(f"the shape of `Intent` changed: {_declared_fields()}. Four fields and no "
                f"fifth — a field holding a price, a route or a policy line would make this "
                f"module a second copy of api/src/product.ts.")

    seen: dict[str, str] = {}
    for it in INTENTS:
        if it.slug in {x.slug for x in INTENTS if x is not it}:
            _refuse(f"two intents share the slug «{it.slug}»")
        h = TOOLS.get(it.tool)
        if h is None:
            _refuse(f"«{it.slug}» names the tool «{it.tool}», which is not declared at all. "
                    f"The model would be told to call something that answers "
                    f"`herramienta_desconocida`.")
        elif h.runner != "node":
            _refuse(f"«{it.slug}» names «{it.tool}», which is not a bridged tool "
                    f"(runner={h.runner}). This table names what NODE answers; a native "
                    f"naming a native is a loop, not a route.")
        elif h.checks_entitlement:
            _refuse(f"«{it.slug}» names «{it.tool}», which is GATED. Every tool this table "
                    f"can name has to be public: pointing at paid content is how a router "
                    f"becomes a second entitlement authority.")
        if not it.solo and not it.paired:
            _refuse(f"«{it.slug}» has no marker at all; nothing can ever match it")
        for m in it.solo + it.paired:
            if m in seen and seen[m] != it.slug:
                _refuse(f"the marker «{m}» belongs to both «{seen[m]}» and «{it.slug}». "
                        f"Ambiguity a scorer would resolve silently, by declaration order.")
            seen[m] = it.slug

    # The overlap refusal. A SOLO marker fires with no help, so it must contain a
    # word the course does not use; a PRODUCT NOUN is what licenses every paired
    # marker, so the same rule applies to it. Paired markers are exempt BY DESIGN —
    # they are ambiguous, and the noun is what disambiguates them.
    course = _map_stems()
    for label, group in (("product noun", PRODUCT_NOUNS),
                         *((f"solo marker of «{it.slug}»", it.solo) for it in INTENTS)):
        for m in group:
            parts = [stem(w) for w in words(m)]
            if not parts:
                _refuse(f"the {label} «{m}» has no words in it")
            if all(p in course for p in parts):
                _refuse(f"the {label} «{m}» is vocabulary the concept map already uses. "
                        f"Two layers cannot own one word: it would answer «product» for a "
                        f"question about the course.")


_check()
