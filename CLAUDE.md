# What is in this repository

More than one project. Work out which one you are in before reading further —
this file used to describe the carousel as if it were the whole repository, and
the paths it gave stopped existing when the carousel moved into a subdirectory.

| Directory | Project | Its own instructions |
|---|---|---|
| `app_ai_from_scratch/` | **The course platform.** api (TypeScript) · ai (Python) · web (Astro) · queue (Go). This is the large, active one. | `app_ai_from_scratch/CLAUDE.md`, and `RUNBOOK.md` beside it for what command to run |
| `design_handoff_ai_carousel_hig/reference/` | The Instagram carousel documented in the rest of this file | this file, below |
| `iot/` | ESP32 and Raspberry Pi experiments (karaoke lyrics, sensor faces) | — |

For anything under `app_ai_from_scratch/`, read that directory's own `CLAUDE.md`
first; it carries the house rules that matter there, and `RUNBOOK.md` maps a task
to its command. The single command worth knowing: `pnpm verify`.

---

# AI Basics Carousel — 12 slides, bilingual, dual-theme

Single-file HTML system rendering 12 Instagram carousel slides (1080×1350) that teach AI fundamentals to absolute beginners. Exports PNGs at 2× (2160×2700) via html2canvas. Two languages (ES/EN) × two themes (dark/light) = 4 variants per slide, **48 PNGs total**.

Lives in `design_handoff_ai_carousel_hig/reference/`: `index.html` (single source of truth) · `validate.py`.
No build step. Only external deps: Google Fonts (Inter) + html2canvas CDN.

---

## Current state (v5)

- 12 slides, each with a fixed 4-section anatomy (see below).
- 164 i18n keys, 100% covered in both `es` and `en` dictionaries (validated).
- Per-slide word budget: currently 65–96 words. Ceiling is **90** — slides 7, 8, 9, 10 sit at/near it.
- Everything renders from CSS variables → theme switch is instant and complete.

## The product owner's journey (read this before changing anything)

This design survived **five rejected iterations**. The constraints below are not aesthetic preferences — each one fixes a specific failure the user called out:

| Rejected approach | Why it failed | Resulting rule |
|---|---|---|
| AI-generated 3D clay images | User wanted built diagrams with crisp text, not generated art | All visuals are HTML/CSS/SVG. Never generated images. |
| Dense technical node diagrams | "Too technical for beginners" | Everyday UI (chat bubbles, sliders, toggles) is the explanatory metaphor |
| 24px body text on 1080px canvas | Illegible on phones (~8px effective) | **Content text ≥25px, hard floor.** Bubbles 29px, section prose 30px |
| Text describing one thing, visual showing another | "UX/UI goes one way, text goes another — no synergy" | Title states the idea → scene *acts out that exact sentence* → take lands the punchline |
| Overloaded slides (3+ ideas each) | Cognitive overload | One concept per slide; fixed anatomy; ≤90 words |

**Do not regress on these.** If a requested change collides with one, flag the collision instead of silently complying.

## Slide anatomy (fixed, all 12 slides)

```
[eyebrow]  NN · CONCEPT NAME
[h1]       Spoken-language sentence (never a concept noun)
[QUÉ ES]           1 sentence, key phrase in <b> (white)
[CÓMO FUNCIONA]    flow pills: step → step → step (→ step)
[LA MATEMÁTICA]    math card: blue left border + one big number/comparison
[EJEMPLO]          mini chat scene (user blue / AI panel bubbles)
[take]     punchline line, key phrase in <b>
[hand]     @alxn_dev_ai (bottom right)
```

Each section owns exactly one visual language and never borrows another's:
prose / flow pills / number card / chat. This repetition across all 12 slides IS the design system.

**Math rule:** numbers and comparisons only — never formulas, never Greek letters. Existing math cards: `100.000` (examples needed) · `94 → 23 → 4` (error dropping) · `70.000.000.000` (dials) · `1 vez / ∞ veces` (train vs inference) · `3 palabras = 5 tokens` · probability bars summing to 100 · `qué + para quién + cómo` (prompt formula) · `≈ 120.000` (context words) · `99 de 100 / 4 de 10` (temperature) · `suena ≠ cierto` (hallucination — the most important card in the set) · `memoria: ayer · internet: hoy`.

**Voice rule:** the AI speaks in first person inside examples ("No guardé tus fotos. Me quedó el ajuste."). Plain spoken language, short sentences, zero jargon without instant translation. Honest claims only — no invented statistics.

## Architecture

**Theming** — CSS custom properties on `:root` (dark) overridden by `body.light`. Every component color references a var. Never hardcode hex in slide markup (inline styles are for structural widths only: bar fills, knob positions).

Core tokens:

| Token | Dark | Light |
|---|---|---|
| `--bg` | `#000` | `#FFFFFF` |
| `--blue` (brand, both themes) | `#3355FF` | `#3355FF` |
| `--blue-hi` | `#5C7BFF` | `#5C7BFF` |
| `--panel` / `--panel-b` | `#12161F` / `#262E42` | `#F4F6FB` / `#E3E7F2` |
| `--ink` … `--ink4` | `#fff → #565B6C` | `#0C1020 → #98A0B3` |
| `--ok` / `--warn` / `--bad` | `#2ED47A / #FFB03A / #FF6B6B` | `#149A5B / #C97F00 / #E04545` |

Note the light theme is hand-calibrated (status colors darkened for contrast on white), not an auto-invert. Keep it that way.

**i18n** — every text node carries `data-t="key"`. Content lives in `const I18N = { es: {...}, en: {...} }`; `apply()` injects via innerHTML. Keys are namespaced `s{n}.*` plus shared `lbl.*` (section labels). Allowed HTML inside values: `<b>`, `<small>`, `<span class='cursor'>` (single-quoted attrs only). Missing keys render as `⟦key⟧` — visible on purpose.

**Translation = adaptation, not literal translation:**
- Tokenization example is re-tokenized per language: ES `Carta|gena|es|her|mosa`, EN `Cart|agena|is|beaut|iful`
- Idioms/games localized: "frío y caliente" → "hot and cold"; "Sr. Mostacho" → "Mr. Whiskers"
- Number scales: "70 mil millones" → "70 billion"; token ratio: ES "media palabra larga", EN "three quarters of a word"

**Export** — `one(i)` captures slide *i* with html2canvas `scale:2`, filename `ia-{NN}-{lang}-{theme}.png`. `all()` loops 12 with 650ms delay. Full 48-file export is currently 4 manual passes flipping the toolbar toggles.

**Layout constraint** — `.slide` is fixed 1080×1350 with `overflow:hidden`. Content that doesn't fit is **silently cropped** (the `.take` line dies first). After any copy change, eyeball slides 7–10.

## Component inventory

`.m` `.m.u` `.m.a` `.m.ghost` `.m.dim` (chat bubbles) · `.tag` `.tag.ok` `.tag.bad` (dashed-leader annotation pills) · `.div` (labeled divider) · `.flow i/s` (step pills) · `.math` + `b.n` + `.opt` rows + `.mrow` (math cards) · `.chips` (token chips) · `.sl` + `.knob` (sliders) · `.hot` + `.f-cold/.f-warm/.f-hot` (hot-and-cold rows) · `.src` (verified-source pill) · `.stxt` `.slbl` `.take` `.eb` `.glow`

## Validation

Run after **any** content change:

```bash
cd design_handoff_ai_carousel_hig/reference
python3 validate.py            # defaults to ./index.html
```

Checks: every `data-t` key exists in both dictionaries, no orphan dictionary keys, slide/h1 count = 12, per-slide word counts with warnings >90 words. Exits 1 on missing keys.

## Known issues / watchlist

1. **Overflow risk** on slides 7–10 (densest). Backlog item 2 adds an automated guard.
2. **html2canvas + webfonts**: first export right after page load can race font loading → default glyphs. Workaround: re-click. Proper fix: gate capture on `document.fonts.ready` (backlog 1 includes it).
3. Keep the canvas untainted: **no external `<img>`** in slides, ever, or export breaks.
4. `≈`, `·`, `∞`, `→` glyphs are fine in Inter; keep `<meta charset="utf-8">` as the first line.

## Backlog (priority order)

1. **`export.mjs` (Playwright headless)** — iterate lang × theme × slide, `await document.fonts.ready`, element-screenshot to `dist/{lang}/{theme}/ia-NN.png`. One command → 48 files. Kills the 4-manual-passes problem.
2. **Overflow guard** — dev flag that outlines any `.slide` whose `scrollHeight > 1350` and fails validate.py.
3. **Cover slide + CTA slide** (slides 00 and 13) per language, same anatomy-lite.
4. **Watermark toggle** — `@alxn_dev_ai` on/off for client-neutral exports.
5. **Per-concept deep-dive carousels** (4–6 slides each) reusing this anatomy. Content source already written: the long-form markdown guide from earlier in this project (each concept has qué es / para qué sirve / paso a paso).
6. If strings keep growing: extract `I18N` to `i18n/{es,en}.json` + a 5-line inline build.

## Commands

```bash
cd design_handoff_ai_carousel_hig/reference

# preview
open index.html          # no server needed

# export current lang+theme combo
# → toolbar button "Descargar las 12 (PNG)"

# validate content integrity
python3 validate.py
```
