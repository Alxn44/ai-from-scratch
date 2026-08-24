"""The concept map: the words a beginner TYPES -> the lesson NUMBER that answers.

WHY THIS IS NEW KNOWLEDGE AND NOT A COPY OF ANYTHING

Node's `buscar_en_curso` scores by counting how many query words occur as
substrings of the lesson text. That works for one discriminating word and breaks
on a sentence, and no amount of scoring fixes a word the corpus does not contain.
Measured over api/src/content.ts, the whole teaching corpus, 36 181 characters:

    `aleatori`   0 occurrences        `alucin`     0
    `azar`       2 (both in lesson 9's own text about the dial, ES)
    `random`     1 — line 59, inside LESSON 2, in «at first it answers close to
                 random», which is the error-dropping lesson, not the temperature
                 one. A route to it is not a miss, it is a poisoned route.
    `hallucin`   0                    `habito`     0

So «como lo hago menos aleatorio» scores zero and the model answers from memory —
the exact failure `buscar_en_curso`'s own description tells it not to commit — and
«how do i make it less random» routes to lesson 2 with confidence. The student's
words are simply not the course's words, and nothing in the corpus can bridge
them. Authoring that bridge is the value this module adds.

WHAT IT MAY HOLD, AND WHAT IT MAY NEVER

Three things, and the discipline is in the third:

  · lesson NUMBERS. Metadata, and validated against the index Node serves
    (`ai-check-concepts`, and again at call time inside `entender_pregunta`).
  · beginner PHRASINGS. Authored here, in the student's own words. They occur
    nowhere in the corpus — that is the whole point of writing them down.
  · PUBLIC glossary terms and their aliases, i.e. what `glosario` answers with. In
    the map they are checked, not trusted: every one has to exist in the fetched
    glossary AND belong to the lesson the concept points at.

What it may NEVER hold is a word lifted out of the corpus. The obvious «cheap
win» is to embed the measured unique-anchor words per lesson — perro, guitarra,
mesero, panaderia, enciclopedista — because they route perfectly. They are also
verbatim `lessons.technical`, `lessons.analogy` and `lesson_text.*`, all
`muro: de_pago`. Embedding them makes this module a derivative of the paid corpus:
a second place where paid content lives, which is the shape of the P4 failure even
where it is not the letter. Only two things cross over from that research: the
query STRINGS a student types and the lesson NUMBER they should reach.

No titles, no summaries, no counts either. Everything the model must SEE about a
lesson beyond its number is fetched from the bridged `curso_indice` at call time.
`check.py` enforces the shape structurally: a seventh field on `Concept` fails the
gate rather than being quietly accepted.

WHAT THIS MAP IS WORTH, MEASURED — and it is less than it looks, so it is written
here rather than in a summary somebody quotes.

On the 121 fixture questions that are NOT verbatim phrasings of this file, the map
alone routes 45 correctly and Node's substring counter gets 66. The map is BEHIND.
It only looks ahead on the 17 questions that ARE verbatim phrasings, where it scores
16 and the search scores 4 — which is the map finding itself, and the reason
test_retrieval.py asserts its floors on the 121 and pins the 17 at a ceiling.

So growing this file does not buy general accuracy. Every new phrasing raises the
in-map number, and the honest measurement stays where it was; worse, each new word
that becomes unique to one concept is a new way for one ordinary word to look like
evidence. Three things are what this file actually buys, all of them measured:

  · the HARD subset: 7 of 12, against 0 of 12 for the search. No re-weighting
    inside `buscar_en_curso` can reach `aleatorio`, `alucinacion` or `habito`,
    because the corpus does not contain them. Only an authored bridge can.
  · PRECISION: it answers 64 of the 138 and gets 61 of those right — 95%, and 94%
    on the held-out 121. That is what makes a decline worth handing to the gated
    search instead of guessing.
  · the COMPOSITION those two make possible: 87 of the same 121, against 66.

Add a phrasing when a real question missed and the miss is a vocabulary gap. Do not
add one to move a number.
"""

from __future__ import annotations

from dataclasses import dataclass, fields
from typing import Literal

Lang = Literal["es", "en"]


@dataclass(frozen=True, slots=True)
class Concept:
    """One lesson-sized idea, addressed by the words people use for it.

    `slug` is a stable English id: it is what `entender_pregunta` returns to the
    model and what a reviewer greps for. It is NOT shown to a student, so it does
    not follow the Spanish product-copy exception.
    """

    slug: str
    leccion: int
    phrasings_es: tuple[str, ...]
    phrasings_en: tuple[str, ...]
    terms_es: tuple[str, ...]
    terms_en: tuple[str, ...]


# The six fields above, spelled out so the gate can refuse a seventh. A field
# holding «anchor words» or a title would be exactly the regression this module's
# header argues against, and the only way to make that argument enforceable is to
# state the shape somewhere a check can read it.
CONCEPT_FIELDS: tuple[str, ...] = (
    "slug", "leccion", "phrasings_es", "phrasings_en", "terms_es", "terms_en",
)


CONCEPTS: tuple[Concept, ...] = (
    Concept(
        slug="learning_from_examples", leccion=1,
        phrasings_es=(
            "como aprende la ia", "de donde saca lo que sabe",
            "quien le escribe las reglas", "necesita muchos ejemplos",
            "aprende viendo ejemplos", "aprende sola o la programan",
            "como reconoce un gato", "que es el aprendizaje automatico",
        ),
        phrasings_en=(
            "how does it learn", "who writes its rules",
            "does it need many examples", "how does it recognize a cat",
            "what is machine learning", "does it learn by itself",
        ),
        terms_es=("aprendizaje", "aprender", "entrenar con ejemplos"),
        terms_en=("machine learning", "learning"),
    ),
    Concept(
        slug="training_and_error", leccion=2,
        phrasings_es=(
            "como mejora", "que es entrenar", "como baja el error",
            "que es la perdida", "como sabe si se equivoco",
            "como practica hasta acertar", "que significa que el error baje",
        ),
        phrasings_en=(
            "how does it improve", "what is training",
            "how does the error go down", "what is loss",
            "how does it know it was wrong", "how does it get better with practice",
        ),
        terms_es=("entrenamiento", "entrenar", "error", "perdida"),
        terms_en=("training", "train", "loss"),
    ),
    Concept(
        slug="parameters", leccion=3,
        phrasings_es=(
            "donde guarda lo que aprendio", "guarda mis fotos",
            "que es un parametro", "cuantas perillas tiene",
            "guarda los textos que le doy", "que hay adentro",
            "donde queda lo aprendido",
        ),
        phrasings_en=(
            "where does it store what it learned", "does it keep my photos",
            "what is a parameter", "how many weights does it have",
            "what is inside it", "does it save the texts i send",
        ),
        terms_es=("perilla", "parametro", "peso", "pesos"),
        terms_en=("parameter", "weights", "knob"),
    ),
    Concept(
        slug="inference_not_learning", leccion=4,
        phrasings_es=(
            "aprende de mi", "por que no cambia",
            "si le corrijo aprende", "se entrena cuando le hablo",
            "cuanto cuesta una respuesta", "mejora con lo que le digo",
        ),
        phrasings_en=(
            "does it learn from me", "why does it not change",
            "if i correct it does it learn", "how much does an answer cost",
            "does talking to it train it", "does it improve while i use it",
        ),
        terms_es=("inferencia", "costo por respuesta"),
        terms_en=("inference",),
    ),
    Concept(
        slug="tokens", leccion=5,
        phrasings_es=(
            "como lee mi texto", "que es un token",
            "por que cobran por tokens", "parte las palabras en pedazos",
            "ve letras o palabras", "por que no cuenta bien las letras",
        ),
        phrasings_en=(
            "how does it read my text", "what is a token",
            "why is it billed in tokens", "does it see letters or words",
            "why can it not count letters", "how is text split up",
        ),
        terms_es=("token", "tokens", "tokenizar"),
        terms_en=("tokenize", "tokenization"),
    ),
    Concept(
        slug="next_word_probability", leccion=6,
        phrasings_es=(
            "como escribe", "como escoge la siguiente palabra",
            "por que dice eso y no otra cosa", "que es un puntaje",
            "adivina la palabra que sigue", "de donde salen esos porcentajes",
        ),
        phrasings_en=(
            "how does it write", "how does it pick the next word",
            "what is a score", "does it guess the next word",
            "where do those percentages come from",
        ),
        terms_es=("probabilidad", "puntaje", "puntajes", "siguiente palabra"),
        terms_en=("probability", "scores"),
    ),
    Concept(
        slug="prompting", leccion=7,
        phrasings_es=(
            "como le pido bien las cosas", "por que me responde generico",
            "como escribo un buen prompt", "que le tengo que decir",
            "me responde cualquier cosa", "como pedirle algo concreto",
            "como se pide bien",
        ),
        phrasings_en=(
            "how do i ask properly", "why are the answers so generic",
            "how do i write a good prompt", "what should i tell it",
            "how do i get a specific answer", "how do i ask for what i want",
        ),
        terms_es=("prompt", "pedido", "instruccion"),
        terms_en=("prompting",),
    ),
    Concept(
        slug="context_window", leccion=8,
        phrasings_es=(
            "se le olvida lo que hablamos", "por que pierde el hilo",
            "cuanto texto le cabe", "que es la ventana de contexto",
            "olvida lo del principio", "puedo pasarle un libro entero",
            "cuanta conversacion aguanta",
        ),
        phrasings_en=(
            "why does it forget what we said", "how much text fits",
            "what is the context window", "why does it lose the thread",
            "can i paste a whole book", "it forgot the beginning",
        ),
        terms_es=("contexto", "ventana de contexto", "memoria de la conversacion"),
        terms_en=("context", "context window"),
    ),
    Concept(
        slug="temperature", leccion=9,
        phrasings_es=(
            "como lo hago menos aleatorio", "por que cada vez responde distinto",
            "como lo hago mas creativo", "que es la temperatura",
            "quiero respuestas mas estables", "responde diferente a lo mismo",
            "como le bajo la creatividad",
        ),
        phrasings_en=(
            "how do i make it less random", "why does it answer differently every time",
            "how do i make it more creative", "what is temperature",
            "i want stable answers", "how do i make it consistent",
        ),
        terms_es=("temperatura", "perilla creativa", "creatividad"),
        terms_en=("temperature", "top-p"),
    ),
    Concept(
        slug="hallucination", leccion=10,
        phrasings_es=(
            "por que se inventa cosas", "por que me miente",
            "dice cosas falsas con seguridad", "se invento un dato",
            "como se si lo que dice es verdad", "por que no dice que no sabe",
        ),
        phrasings_en=(
            "why does it make things up", "why does it lie to me",
            "it invented a fact", "how do i know if it is true",
            "why does it not say i do not know", "it says false things confidently",
        ),
        terms_es=("alucinacion", "inventar", "se lo inventa"),
        terms_en=("hallucination", "made up"),
    ),
    Concept(
        slug="knowledge_cutoff", leccion=11,
        phrasings_es=(
            "sabe lo de hoy", "hasta cuando sabe",
            "esta actualizado", "puede buscar en internet",
            "conoce las noticias de esta semana", "por que no sabe algo reciente",
        ),
        phrasings_en=(
            "does it know what happened today", "how up to date is it",
            "can it search the internet", "why does it not know recent things",
            "does it know this week's news",
        ),
        terms_es=("fecha de corte", "corte de conocimiento", "buscar en internet"),
        terms_en=("cutoff", "knowledge cutoff"),
    ),
    Concept(
        slug="daily_habit", leccion=12,
        phrasings_es=(
            "como empiezo a usarla", "cuanto tiempo al dia",
            "que hago para no dejarlo", "como lo vuelvo costumbre",
            "por donde empiezo hoy", "cuanto deberia practicar",
        ),
        phrasings_en=(
            "how do i start using it", "how much time a day",
            "how do i build the habit", "where do i start today",
            "how often should i practice",
        ),
        terms_es=("habito", "practica", "rutina"),
        terms_en=("habit", "practice"),
    ),
)

BY_SLUG: dict[str, Concept] = {c.slug: c for c in CONCEPTS}


def phrasings(c: Concept, lang: Lang | None = None) -> tuple[str, ...]:
    """Both languages unless one is asked for.

    Both is the default on purpose: `lessons` and `labs` have no `lang` column, so
    an English session already searches 72 Spanish fields out of 96 in Node. Routing
    an English question through a Spanish phrasing is not a bug here, it is the only
    way an English speaker reaches a lesson at all.
    """
    if lang == "es":
        return c.phrasings_es
    if lang == "en":
        return c.phrasings_en
    return c.phrasings_es + c.phrasings_en


def terms(c: Concept, lang: Lang | None = None) -> tuple[str, ...]:
    if lang == "es":
        return c.terms_es
    if lang == "en":
        return c.terms_en
    return c.terms_es + c.terms_en


def declared_fields() -> tuple[str, ...]:
    """The dataclass's real field names, for the structural check in check.py."""
    return tuple(f.name for f in fields(Concept))
