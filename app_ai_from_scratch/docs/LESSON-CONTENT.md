# Lesson content · translation and review assignment

**Status: the Spanish and English content IS ALREADY WRITTEN.** Claude wrote it on
2026-08-21 and it is in production. This file no longer asks for copywriting: it asks for
**French and Portuguese**, and a **critical review** of what already exists.

If anything here clashes with what you see in the code, the code wins and it has to be
reported, not improvised around.

---

## 1. What exists today

| where | what | languages |
|---|---|---|
| `api/src/content.ts` | `technical`, `analogy` and 2 `examples` per lesson, 12 lessons | es, en |
| Postgres, `lesson_text` table | the above, one row per `(lesson_n, lang)` — 24 rows | es, en |
| `api/src/seed.js` | `LESSONS` (12 lesson cards) and `REAL` (36 labs: prompt, payload, solution, explanation) | es |
| `web/src/lib/i18n.ts` | 502 interface keys, identical tree in both languages | es, en |

The rules it was written to (verifiable, not opinion):

- `technical`: **90–140 words.** The mechanism, precisely, no metaphors.
- `analogy`: **50–80 words.** ONE single everyday image. Never two metaphors mixed together.
- `examples`: exactly 2, each with `titulo`, `entrada`, `salida`, `nota`.
- Order on the page: mechanism → analogy → examples → labs. Lesson 5 is the reference for register.
- Allowed numbers: only the ones the course already uses (100.000 · 94→23→4 · 70.000.000.000 · 3 palabras = 5 tokens · 31 de 100 · ≈120.000 · 99 de 100 · suena ≠ cierto). **Inventing statistics is forbidden.**

Length check (already passes):

```bash
node --input-type=module -e "
import { CONTENIDO } from './api/src/contenido.js';
const w = s => s.trim().split(/\s+/).length;
for (const [n,v] of Object.entries(CONTENIDO)) for (const l of ['es','en'])
  console.log(n, l, w(v[l].technical), w(v[l].analogy), v[l].examples.length);"
```

---

## 2. Assignment A · French and Portuguese

Two deliverables, and both are **adaptation, not literal translation**.

### A.1 · Lesson content (`fr`, `pt`)

For each of the 12 lessons: `technical`, `analogy`, `examples` (2), at the same lengths.
What **has to be localised, not translated**:

| case | es | en | what to do in fr/pt |
|---|---|---|---|
| tokenisation (lesson 5) | `Carta\|gena\|es\|her\|mosa` | `Cart\|agena\|is\|beaut\|iful` | re-tokenise a phrase that belongs to the language. Do not translate the Spanish splits. |
| token/word ratio | «media palabra larga» | «three quarters of a word» | the real ratio for that language. |
| number scale | «70 mil millones» | «70 billion» | fr: «70 milliards» · pt: «70 mil milhões»/«70 bilhões» depending on the variant chosen. |
| children's game (lesson 2) | «frío y caliente» | «hot and cold» | the local equivalent. |
| examples with currency | «30 dólares a pesos» | same | a currency that makes sense to that reader. |
| places and names | Cartagena, Medellín | same | they can stay: they are the author's own. Do not invent fake local colour. |

Variants: **fr of France** and **pt of Brazil** (the larger market). State it in the delivery.

### A.2 · Interface (`fr`, `pt`)

Translate the whole tree of `web/src/lib/i18n.ts` (502 keys). The tree has to end up
**identical in shape**: same paths, same arrays, same array lengths.
There is an automatic guard:

```bash
cd web && pnpm i18n      # fails if one language has a key another does not
```

Watch out for:

- The placeholders `{n}`, `{a}`, `{id}`, `{grado}`, `{p}`, `{m}`, `{t}`: they are kept exactly as they are.
- `logros.rangos`: 12 names, cult/niche tone, **no third-party trademarks**. The current ones:
  Iniciado · Lector de Señales · Contador de Trozos · Guardián de Perillas · Domador de
  Temperatura · Cazador de Espejismos · Custodio del Contexto · Tejedor de Cadenas ·
  Alquimista de Datos · Oráculo de Probabilidades · Arquitecto de Agentes · Mano Firme.
  In fr/pt look for names with the same charge, not the word-by-word translation.
- `pub.term` and `pub.priv` are **legal texts**: they are translated without changing the
  substance. If a sentence does not apply in France or Brazil, flag it and ask. It is not
  adapted at your own discretion.
- HTML allowed inside the values: `<b>`, `<small>`. Single quotes escaped or typographic.

---

## 3. Assignment B · critical review of es/en

This is not style correction: it is hunting for errors that teach something false.

1. **Technical accuracy.** Every `technical` in `api/src/content.ts`. If a sentence is
   defensible but misleading for a beginner, say so with the alternative sentence.
2. **Coherence of the analogy.** The analogy has to explain *the same* mechanism as the
   technical text, not one that resembles it.
3. **The lab has to be solvable by reading the lesson.** This is the hard criterion: the lab
   prompt (`REAL` in `seed.js`) against the lesson text. If getting it right needs a fact
   the lesson does not give, **that is a bug** and it has to be reported with lesson, lab and
   the missing fact.
4. **Grammar and clumsiness** in `title`, `summary`, `math_cap` (12 lessons) and `prompt` +
   `explanation` (36 labs). Every proposed change carries its reason. No rewriting for taste.

---

## 4. Delivery format

A single `docs/lesson-content.json` file at the root:

```json
{
  "lesson_text": {
    "fr": { "1": { "technical": "…", "analogy": "…", "examples": [ { "titulo": "…", "entrada": "…", "salida": "…", "nota": "…" }, { } ] } },
    "pt": { "1": { } }
  },
  "i18n": {
    "fr": { "nav": { "panel": "…" } },
    "pt": { }
  },
  "revision": [
    { "donde": "contenido.js leccion 9 es.technical", "problema": "…", "propuesta": "…", "motivo": "…" },
    { "donde": "seed.js lab 7.2", "problema": "el lab pide un dato que la leccion no da", "propuesta": "…", "motivo": "…" }
  ]
}
```

With that, landing it is mechanical: `lesson_text` goes in through `seed.js` (upsert on
`(lesson_n, lang)`), `i18n` goes in as two new dictionaries in `STR` — and the language
selectors pick them up by themselves, because they are built with `IDIOMAS = Object.keys(STR)`.

## 5. What is NOT touched

- The labs' `solution`. It never leaves the server and it is not translated.
- The design tokens or the CSS.
- The price, the 14-day guarantee and the legal deadlines: those are decisions already taken.
- The database schema. If something does not fit in `lesson_text`, it gets reported.
