# Contenido de las lecciones · encargo de traducción y revisión

**Estado: el contenido en español e inglés YA ESTÁ ESCRITO.** Lo escribió Claude el
2026-08-21 y está en producción. Este archivo ya no pide redacción: pide **francés y
portugués**, y una **revisión crítica** de lo que existe.

Si algo aquí choca con lo que ves en el código, el código gana y hay que reportarlo,
no improvisar.

---

## 1. Qué existe hoy

| dónde | qué | idiomas |
|---|---|---|
| `api/src/contenido.js` | `technical`, `analogy` y 2 `examples` por lección, 12 lecciones | es, en |
| Postgres, tabla `lesson_text` | lo anterior, una fila por `(lesson_n, lang)` — 24 filas | es, en |
| `api/src/seed.js` | `LESSONS` (12 fichas) y `REAL` (36 labs: enunciado, payload, solución, explicación) | es |
| `web/src/lib/i18n.ts` | 502 claves de interfaz, árbol idéntico en los dos idiomas | es, en |

Reglas con las que se escribió (verificables, no opinión):

- `technical`: **90–140 palabras.** El mecanismo con precisión, sin metáforas.
- `analogy`: **50–80 palabras.** UNA sola imagen cotidiana. Nunca dos metáforas mezcladas.
- `examples`: exactamente 2, cada uno con `titulo`, `entrada`, `salida`, `nota`.
- Orden en la página: mecanismo → analogía → ejemplos → labs. La lección 5 es la referencia de registro.
- Números permitidos: solo los que ya usa el curso (100.000 · 94→23→4 · 70.000.000.000 · 3 palabras = 5 tokens · 31 de 100 · ≈120.000 · 99 de 100 · suena ≠ cierto). **Prohibido inventar estadísticas.**

Verificación de largos (ya pasa):

```bash
node --input-type=module -e "
import { CONTENIDO } from './api/src/contenido.js';
const w = s => s.trim().split(/\s+/).length;
for (const [n,v] of Object.entries(CONTENIDO)) for (const l of ['es','en'])
  console.log(n, l, w(v[l].technical), w(v[l].analogy), v[l].examples.length);"
```

---

## 2. Encargo A · francés y portugués

Dos entregables, y los dos son **adaptación, no traducción literal**.

### A.1 · Contenido de lecciones (`fr`, `pt`)

Para cada una de las 12 lecciones: `technical`, `analogy`, `examples` (2), con los mismos
largos. Lo que **hay que localizar, no traducir**:

| caso | es | en | qué hacer en fr/pt |
|---|---|---|---|
| tokenización (lección 5) | `Carta\|gena\|es\|her\|mosa` | `Cart\|agena\|is\|beaut\|iful` | re-tokenizar una frase propia del idioma. No traducir los cortes del español. |
| ratio token/palabra | «media palabra larga» | «three quarters of a word» | el ratio real de ese idioma. |
| escala numérica | «70 mil millones» | «70 billion» | fr: «70 milliards» · pt: «70 mil milhões»/«70 bilhões» según variante elegida. |
| juego infantil (lección 2) | «frío y caliente» | «hot and cold» | el equivalente local. |
| ejemplos con moneda | «30 dólares a pesos» | idem | moneda que tenga sentido para ese lector. |
| lugares y nombres | Cartagena, Medellín | idem | pueden quedarse: son del autor. No inventar localismos falsos. |

Variantes: **fr de Francia** y **pt de Brasil** (mercado más grande). Decláralo en la entrega.

### A.2 · Interfaz (`fr`, `pt`)

Traducir el árbol completo de `web/src/lib/i18n.ts` (502 claves). El árbol debe quedar
**idéntico en forma**: mismas rutas, mismos arreglos, misma longitud de arreglos.
Hay guardia automática:

```bash
cd web && pnpm i18n      # falla si un idioma tiene una clave que otro no
```

Cuidado con:

- Los marcadores `{n}`, `{a}`, `{id}`, `{grado}`, `{p}`, `{m}`, `{t}`: se conservan tal cual.
- `logros.rangos`: 12 nombres, tono de culto/nicho, **sin marcas de terceros**. Los actuales:
  Iniciado · Lector de Señales · Contador de Trozos · Guardián de Perillas · Domador de
  Temperatura · Cazador de Espejismos · Custodio del Contexto · Tejedor de Cadenas ·
  Alquimista de Datos · Oráculo de Probabilidades · Arquitecto de Agentes · Mano Firme.
  En fr/pt busca nombres con la misma carga, no la traducción palabra por palabra.
- `pub.term` y `pub.priv` son **textos legales**: se traducen sin cambiar el fondo. Si una
  frase no aplica en Francia o Brasil, se marca y se pregunta. No se adapta por criterio propio.
- HTML permitido dentro de los valores: `<b>`, `<small>`. Comillas simples escapadas o tipográficas.

---

## 3. Encargo B · revisión crítica de es/en

No es corrección de estilo: es cazar errores que enseñen algo falso.

1. **Precisión técnica.** Cada `technical` de `api/src/contenido.js`. Si una frase es
   defendible pero engañosa para un principiante, dilo con la frase alternativa.
2. **Coherencia de la analogía.** Que la analogía explique *el mismo* mecanismo del técnico,
   no uno parecido.
3. **Que el lab se pueda resolver leyendo la lección.** Es el criterio duro: enunciado del
   lab (`REAL` en `seed.js`) contra el texto de la lección. Si para acertar hace falta un dato
   que la lección no da, **eso es un bug** y hay que reportarlo con lección, lab y dato faltante.
4. **Gramática y torpezas** en `title`, `summary`, `math_cap` (12 lecciones) y `prompt` +
   `explanation` (36 labs). Cada cambio propuesto lleva el motivo. No reescribir por gusto.

---

## 4. Formato de entrega

Un solo archivo `contenido-idiomas.json` en la raíz:

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

Con eso, meterlo es mecánico: `lesson_text` entra por `seed.js` (upsert por
`(lesson_n, lang)`), `i18n` entra como dos diccionarios nuevos en `STR` — y los selectores
de idioma los recogen solos, porque se construyen con `IDIOMAS = Object.keys(STR)`.

## 5. Lo que NO se toca

- `solution` de los labs. Nunca sale del servidor y no se traduce.
- Los tokens de diseño ni el CSS.
- El precio, la garantía de 14 días y los plazos legales: son decisiones tomadas.
- El esquema de la base. Si algo no cabe en `lesson_text`, se reporta.
