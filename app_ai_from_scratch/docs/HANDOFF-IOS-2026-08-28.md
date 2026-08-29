# Handoff iOS — 28 de agosto de 2026

**La fecha está en el nombre a propósito**, igual que en `HANDOFF-2026-08-24.md`:
un documento de estado sin fecha se lee como verdad hoy y ya era falso. Esto dice
qué había el 28 de agosto de 2026. Si lo lees mucho después, verifica antes de
actuar.

Para quién: quien diseñe y quien construya la app de iOS. Da por hecho que el
backend no cambia salvo donde se diga explícitamente.

Lo que **no** repite: `PLATFORM.md` ya describe la plataforma pantalla por
pantalla, y `ARCHITECTURE.md` el reparto de servicios. Aquí solo está lo que
cambia al pasar a nativo.

---

## Tres decisiones antes de diseñar

Ninguna es de diseño, y las tres cambian el diseño. Si se resuelven después, se
rediseña.

### 1. La suscripción no puede cobrarse con Mercado Pago dentro de la app · BLOQUEA

La directriz 3.1.1 de la App Store obliga a compra integrada para contenido
digital que se consume dentro de la app. El curso lo es. Abrir el checkout de
Mercado Pago en un `WKWebView` o derivar a Safari es motivo de rechazo conocido.

No es un detalle de implementación: **cambia la pantalla de pago entera y cambia
el margen.** Sobre 35.000 COP/mes (`payments/src/price.ts:32`):

| Vía de cobro | Retención | Neto/mes | Dónde vive el paywall |
|---|---:|---:|---|
| Mercado Pago (web, hoy) | ~3–4 % | ~33.700 | Pantalla propia, diseño libre |
| Compra integrada · SBP 15 % | 15 % | 29.750 | Hoja de sistema, diseño acotado |
| Compra integrada · 30 % | 30 % | 24.500 | Hoja de sistema, diseño acotado |

> **Sin verificar:** la comisión exacta de Mercado Pago en Colombia para
> suscripciones. El ~3–4 % es un orden de magnitud, no un dato medido. La
> aritmética de Apple sí es la publicada.

Tercera salida: publicar como app **lector** — sin ninguna compra dentro, solo
inicio de sesión, y que la suscripción se haga en la web. Sale gratis de comisión
y cuesta conversión. Es decisión de negocio y hay que tomarla ya, porque define
si existe pantalla de pago o solo una de «entra con tu cuenta».

### 2. La sesión dura 12 horas · ARREGLAR ANTES

`auth/src/core.ts:282` — la cookie `sid` se emite con `maxAge: 60 * 60 * 12`.

En web es razonable. En una app significa pedir la contraseña dos veces al día, y
el curso está pensado para cinco minutos diarios: entrar costaría más que la
sesión de estudio.

El backend ya tiene con qué arreglarlo sin bajar seguridad: el token lleva
`token_version` (`auth/src/index.ts:127`), así que subir ese número invalida todas
las sesiones de un usuario al instante. Con revocación real disponible, una sesión
larga es defendible. Es un cambio de una línea, pero hay que decidirlo antes de
diseñar el arranque.

### 3. El chat no emite tokens en streaming · AFECTA AL DISEÑO

`api/src/server.ts:714` responde una sola vez, con el mensaje completo. No hay
`text/event-stream` en ninguna ruta — comprobado por grep sobre `api/src/server.ts`.

Consecuencia: no se puede hacer la máquina de escribir que la gente ya espera de
un chat de IA. O el diseño asume una espera con estado — y entonces el indicador
tiene que ser bueno, porque va a ser largo — o se pide al backend una ruta con
streaming. Decídelo antes de diseñar la pantalla.

---

## Lo que ya está resuelto

La plataforma se diseñó contra el lenguaje visual de Apple. No hay que traducir un
sistema web a iOS: en gran parte ya lo es.

### Color

Fuente: `web/src/lib/theme-css.ts`.

Los acentos y semánticos del tema oscuro **son exactamente los colores de sistema
de iOS en modo oscuro.** Comprobado valor a valor:

| Token | Oscuro | Equivale a | Papel | Nota |
|---|---|---|---|---|
| `--bg` | `#000000` | — | `#F2F2F2` | |
| `--panel` | `#0B0B0C` | — | `#FFFFFF` | |
| `--ac` | `#0A84FF` | `systemBlue` (dark) | `#0A5AD6` | acento |
| `--ok` | `#30D158` | `systemGreen` (dark) | `#0C6B3E` | |
| `--or` | `#FF9F0A` | `systemOrange` (dark) | `#8A5000` | |
| `--rd` | `#FF453A` | `systemRed` (dark) | `#C21B12` | |
| `--l1` | `#FFFFFF` | `label` | `#000000` | texto primario |
| `--l2` | `rgba(235,235,245,.62)` | ≈ `secondaryLabel` (.60) | `rgba(0,0,0,.66)` | calibrado a mano |
| `--l3` | `rgba(235,235,245,.50)` | ≈ terciario | `rgba(0,0,0,.58)` | calibrado a mano |
| `--hair` | `rgba(84,84,88,.46)` | ≈ `separator` | `rgba(0,0,0,.22)` | |
| `--on-ac` | `#FFFFFF` | — | `#FFFFFF` | texto sobre relleno de acento, blanco en **ambos** temas |

Los cuatro semánticos se pueden sustituir por `Color.blue/.green/.orange/.red` y
el resultado es idéntico. Los grises están *cerca* de los de Apple pero calibrados
a mano; la diferencia es invisible, así que usa los del sistema y ganas adaptación
automática.

**El tema claro no es un inverso automático.** Está calibrado sobre `#F2F2F2` con
los semánticos oscurecidos para superar 4,5:1 sobre blanco. Se llama «papel», no
«claro», porque su trabajo es leerse e imprimirse. En iOS es `light`, pero los
valores son estos, no los de sistema.

### Tipografía

La pila declarada es `-apple-system, 'SF Pro Display', 'SF Pro Text'` con
`ui-monospace / SF Mono` para etiquetas y datos. En iOS eso es, literalmente,
`.body`, `.title` y `.monospaced()`.

| Clase | Peso · tamaño / interlínea | Tracking | Uso |
|---|---|---|---|
| `.h1` | 700 · 44px / 1.06 | −.04em | titular de pantalla |
| `.h3` | 600 · 15px / 1.3 | — | subtítulo |
| `.p` | 400 · 16px / 1.5 | — | cuerpo, color `--l2` |
| `.s` | 400 · 13px / 1.45 | — | secundario, color `--l3` |
| `.lbl` | 500 · 10px mono, versalitas | .18em | etiqueta ambiental |
| `.eb` | 600 · 10px mono, versalitas | .22em | eyebrow, color acento |

**Ojo con el salto.** De 44px a 15px no hay escalón intermedio. En web funciona
porque hay ancho; en 390pt de iPhone, 44px con `−.04em` deja tres palabras por
línea. Vas a necesitar un peldaño entre `.h1` y `.h3` que hoy no existe. **Es la
única pieza de la escala que hay que inventar.**

### Medidas de control

| Componente | Alto | Notas que se conservan |
|---|---:|---|
| `.btn` | 44px | Radio 6px. Etiqueta mono 11px, versalitas, tracking .1em |
| `.chip` | 46px mín. | Sin radio. Activo: borde de acento + relleno |
| `.input` | 44px | Fondo `--fill`; el foco cambia el borde a acento |
| `.card` | — | Relleno 22px, borde 1px, **sin radio y sin sombra** |

44px es exactamente el suelo táctil de Apple: el diseño web ya se hizo pensando en
el dedo.

**Decisión estética a respetar: no hay esquinas redondeadas ni sombras.** Bordes de
un píxel y superficies planas. Choca de frente con el iOS de serie, lleno de
`cornerRadius` y materiales. Si lo redondeas «para que parezca nativo», dejas de
parecerte al producto. Consérvalo.

---

## La superficie interactiva

El número que decide el tamaño del proyecto no es 36. Es **6**.

Hay 36 labs pero solo seis mecánicas. Medido en la base de producción
(`SELECT kind, count(*) FROM labs GROUP BY kind`):

| `kind` | Labs | Nota |
|---|---:|---|
| `choice` | 16 | |
| `build` | 8 | |
| `order` | 8 | |
| `hotcold` | 2 | |
| `knob` | 1 | un solo ejercicio |
| `cut` | 1 | un solo ejercicio |

`knob` y `cut` aparecen **una sola vez cada uno**. Antes de construirlos como
vistas propias, pregunta si esa lección puede reutilizar otra mecánica: son dos
componentes completos al servicio de un ejercicio cada uno.

Los 36 se reparten en tres niveles exactos — 12 `facil`, 12 `medio`, 12 `dificil`,
uno por lección. Esa regularidad es real y sirve para la navegación.

### Las 13 escenas animadas

`web/src/lib/scenes/` — 1.435 líneas de TypeScript sobre un kit propio
(`makeScene`, `stageFrame`, `veil`, `appear`) que anima DOM y SVG. Cada lección
abre con una escena que actúa lo que dice el título: `word-splits`,
`error-closes`, `window-fills`, `dials-settle`, `cutoff-line`,
`fluent-then-doubt`…

No se portan solas. Dos caminos:

| Camino | Coste | Ganas | Pierdes |
|---|---|---|---|
| Rehacer en SwiftUI | 13 animaciones desde cero | 60 fps, gestos, accesibilidad real | Dos implementaciones que mantener |
| Alojar en `WKWebView` | Un contenedor | Una sola fuente de verdad | Se nota al tacto; el arranque pesa |

**Recomendación: vista web para las escenas, nativo para todo lo demás.** Las
escenas son explicativas y no reciben entrada del usuario. Los labs sí, y esos
tienen que ser nativos.

---

## Contrato con el servidor

La API ya devuelve JSON en casi todo. No hay que construir un backend para móvil.

### Sesión

`auth/src/core.ts:263,277` — cookie `sid`, firmada, `httpOnly`, `sameSite=lax`,
`secure` en producción. Carga `{ sub, role, v }`.

`URLSession` la maneja sola con su `HTTPCookieStorage`: **no hace falta inventar un
esquema de tokens.** `httpOnly` y `sameSite` son restricciones de navegador y no
afectan a una app nativa. La API no declara CORS, y da igual: CORS es cosa del
navegador.

**Apunta a la web, no a la API.** El prefijo de versión (`v3`) lo pone el proxy de
la web (`web/src/pages/api/[...path].ts:12`), no la API. Si la app llama al
servicio directo tiene que añadirlo a mano y se desincroniza en la próxima
versión. Pide `https://aifromscratch.shop/api/…` y heredas versionado y dominio de
cookie sin escribir nada.

### Rutas principales

| Ruta | Qué da | Pantalla |
|---|---|---|
| `POST /api/auth/login` | Abre sesión, emite `sid` | Entrar |
| `POST /api/auth/register` | Crea cuenta, sin tarjeta | Registro |
| `POST /api/auth/recover` · `/reset` | Recuperación por correo | Entrar |
| `GET /api/me` | Usuario, rol, idioma, tema, si pagó | Arranque |
| `PATCH /api/settings` | Idioma y tema en la cuenta | Cuenta |
| `GET /api/lessons` | Índice de las 12 | Curso |
| `GET /api/lessons/:n` | Lección + labs + tus intentos | Lección |
| `POST /api/labs/:id/attempt` | Corrige en servidor | Lab |
| `GET /api/exams` · `/api/exams/:n` | Exámenes de bloque | Examen |
| `POST /api/questions/:id/attempt` | Quiz | Lección |
| `GET /api/progress` | Avance por lección | Panel · Perfil |
| `GET /api/logros` | Logros y rango | Progreso |
| `GET /api/ranking` · `POST/DELETE /optin` | Clasificación, alta voluntaria | Progreso |
| `GET /api/ligas` | Liga semanal | Progreso |
| `POST /api/chat` · `GET /api/chat/history` | Agente, sin streaming | Chat |
| `GET /api/coach` | Sugerencia de siguiente paso | Panel |
| `GET /api/subscriptions/me` · `POST /cancel` | Estado de suscripción | Cuenta |
| `GET /api/pdf/:lang` | El curso en PDF | Cuenta |

`/api/admin/*` y `/api/tutor/*` existen pero no van en la v1 de iOS.

### El muro de pago, exacto

`api/src/server.ts:140-142`:

```ts
export const FREE_LESSONS = 1;
const hasAccess = (u, n) =>
  !!u.paid || u.role !== 'student' || Number(n) <= FREE_LESSONS;
```

Tienes acceso si **pagaste**, o si **no eres estudiante** (tutor, admin, root), o
si la lección es la **número 1**. La lección 1 y sus 3 labs son gratis; las otras
11 y sus 33 labs piden suscripción.

**Y una lección cerrada no devuelve un error seco.** `api/src/server.ts:173`
responde `402 requiere_compra` **con la ficha de la lección y la lista de sus labs
bloqueados**. Está pensado para que el muro sea un escaparate.

Diséñalo así: la pantalla de lección bloqueada tiene título, resumen, su tarjeta de
matemática y las tres piezas grises que se van a abrir. No pongas un candado y un
botón.

---

## Pantallas

22 páginas en web. No son 22 en iOS. El detalle de cada una está en
`PLATFORM.md`; aquí solo el mapeo.

| Web | iOS | Por qué |
|---|---|---|
| `panel` · `curso` · `leccion/[n]` · `examen/[n]` | Pestaña **Curso** | El núcleo |
| `chat` | Pestaña **Chat** | Agente con acceso solo a tus datos |
| `logros` · `ranking` · `ligas` | Pestaña **Progreso** | Tres vistas de cómo vas |
| `perfil` · `ajustes` | Pestaña **Cuenta** | Ajustes de iOS absorbe idioma y tema |
| `login` · `registro` · `recuperar` | Antes de la sesión | Fuera de las pestañas |
| `pago` · `pago/gracias` · `pago/error` | **Por decidir** | Depende de la decisión 1 |
| `index` (landing) | No va | La App Store *es* la landing |
| `terminos` · `privacidad` · `soporte` | Enlaces | Apple exige que estén alcanzables |
| `admin` · `tutor` | No va | Herramientas de escritorio |

**Cuatro pestañas y un flujo previo a la sesión.** De 22 páginas, 3 no viajan, 3
son enlaces externos y 2 son de administración.

---

## Voz

Las reglas están escritas y se han sostenido en 12 lecciones (`CLAUDE.md`,
sección *Content voice*). No las reinventes en la app.

- **Lenguaje hablado, frases cortas**, cero jerga sin traducción inmediata.
- **La IA habla en primera persona** dentro de los ejemplos: «No guardé tus fotos.
  Me quedó el ajuste.»
- **Solo cifras honestas.** Nunca una estadística inventada. Esto ya obligó a
  corregir una tarjeta que decía «3 palabras = 4 tokens» cuando el tokenizador de
  la propia página calculaba 5.
- **Un concepto por lección.** Y por pantalla.
- **Traducir es adaptar.** El ejemplo de tokens se re-tokeniza por idioma
  (`Carta|gena` / `Cart|agena`), los juegos se localizan («frío y caliente» → «hot
  and cold») y las escalas numéricas cambian.

Con el precio ocurre lo mismo y es más grave. `$35.000` en español son treinta y
cinco mil pesos; en inglés `$35,000` se lee treinta y cinco mil **dólares**, mil
veces el precio. En inglés se escribe `35,000 COP`. La regla vive en
`web/src/lib/price.ts` (`PRECIO_VISUAL`) y **también aplica en iOS**.

---

## Qué no pude comprobar

Para que nadie lo dé por verificado.

- **Las respuestas reales de la API con sesión.** No hay `SEED_DEMO_PASSWORD`
  configurada en este entorno, así que los contratos de arriba salen de leer los
  manejadores y los tipos (`api/src/server.ts`, `api/src/grading.ts`,
  `api/src/db.ts`), no de una respuesta viva. Las formas son correctas; los
  nombres exactos de campos anidados, confírmalos contra una llamada real.
- **Los 12 rangos.** No existe tabla de definiciones en la base; viven en el
  código de la web (`web/src/lib/badges.ts`). No los inventarié.
- **La comisión de Mercado Pago en Colombia.** Ver el aviso de la decisión 1.
- **El comportamiento del `402` contra un cliente.** Está leído del servidor, no
  probado desde una app.

## Un documento que quedó desfasado

`REGIONS.md:23` todavía registra como objeción real *«why in dollars? — a price in
USD reads as a gringo's price»*. Desde el cambio a COP (commit `e12c1a5`) esa
objeción está respondida. No lo edité: lo señalo aquí para que quien lo lea no
diseñe contra una objeción que ya no existe.
