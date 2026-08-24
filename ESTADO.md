# Estado · 2026-08-24

Almacén de medios cableado al API. Lo de abajo, del 21 de agosto, sigue vigente
salvo donde esta sección lo corrija.

## Hecho hoy

| punto | estado | con qué se comprueba |
|---|---|---|
| `api` hace de proxy de los medios | hecho | `api/src/medios.js` (permisos), `media-bridge.js` (cable), `medios-rutas.js` (rutas) · `pnpm --dir api test:medios` → **87 comprobaciones, sin fallos** |
| Autorización antes de proxear | hecho | cuatro cubos con muro propio; `lecciones` usa el muro lección a lección. `media` no decide nada |
| Errores del almacén traducidos | hecho | un solo `switch` para la web; tabla en `MEDIOS.md` |
| Subida y bajada en streaming | hecho | ni el API ni Astro juntan el fichero en memoria; una comprobación manda 900 KiB y los compara byte a byte |
| El muro salió de `server.js` | hecho | `api/src/muro.js`: lo consultan el índice, los labs y los medios |
| `media` en compose | hecho | `media:8792`, **sin puerto publicado**, volumen `media-data`, detrás del perfil `medios` |
| `/api/pdf/:lang` desde el almacén | hecho | busca en el cubo `libros` y usa `api/files/` como respaldo |
| Convenio de cubos y claves | hecho | `MEDIOS.md`. Falta subir los medios: en este repositorio no hay ninguno |

## Arreglado de paso

| qué | dónde | por qué importaba |
|---|---|---|
| `/api/lessons` derramaba dos columnas de pago | `api/src/server.js:220` | Hacía `SELECT *` y volcaba `{...l}` de las doce lecciones sin muro, con `locked` como bandera para el cliente. Hoy `lessons.technical` y `lessons.analogy` están vacías, así que no se escapaba nada — pero la ontología dice «puede estar vacía mientras se redacta», o sea que la intención de escribirlas existe. Ahora las columnas van nombradas |
| El proxy de Astro corrompía cualquier binario | `web/src/pages/api/[...path].ts` | Reenviaba el cuerpo con `await request.text()`, que decodifica como UTF-8: un PNG o un PDF salía con los bytes inválidos sustituidos por U+FFFD. Ahora va como stream |
| CORS sin `PUT` ni `DELETE` | `api/src/server.js:23` | `access-control-allow-methods` no los listaba. Latente desde antes: `DELETE /api/ranking/optin` ya existía |
| Una subida grande cortaba el socket | `api/src/medios-rutas.js` | Al pasarse del techo se destruía la conexión y el cliente recibía `ECONNRESET` en vez del 413. Lo encontró la prueba de subida sin `content-length` |

## Bloqueado, y no por ti

`media-store` es **otro repositorio** y no está en GitHub: sólo existe en tu
portátil, y según su propio handoff todavía sin un commit. Desde aquí no se puede
publicar su imagen, ni escribir su workflow de despliegue, ni añadirle peticiones
por rango, ni darle copia de seguridad al volumen. Los cuatro puntos están
listados en `MEDIOS.md` · «Lo que falta».

Mientras la imagen no exista, el servicio `media` queda detrás de un perfil de
compose y `/api/medios/*` responde 503. El resto del curso funciona igual.

---

# Estado · 2026-08-21

Cuatro encargos, 28 puntos. **24 hechos y verificados · 2 esperando a Luna · 1 descartado con
motivo · 8 bloqueados en llaves o archivos que no puedo poner yo.**

Versión visual del mismo tablero: `Libro de obra · IA desde cero` (artifact publicado).

## Encargo 1 · pantallas, logros, animaciones, regiones

| punto | estado | con qué se comprueba |
|---|---|---|
| Pantalla para cada endpoint que no tenía | hecho | `/curso /recuperar /terminos /privacidad /soporte /pago/gracias /pago/error 404` |
| Técnica + analogía en las 12 lecciones | hecho | `api/src/contenido.js`, tabla `lesson_text` (24 filas), 99–118 palabras |
| Ejemplos resueltos antes del lab | hecho | 2 por lección; orden mecanismo → analogía → ejemplos → labs |
| Toasts en todo, traducidos | hecho | `window.toast`, 540 claves i18n sin deriva (`pnpm i18n`) |
| Ranking por lecciones | hecho | `/ranking`, opt-in con alias, respuesta sin nombre ni correo |
| Logros por lección, nombres de culto | hecho | `api/src/logros.js`, 48 logros, 12 rangos |
| Animación de acierto y de fallo | hecho | `web/src/lib/fx.ts`, GSAP + WAAPI, respeta reduced-motion |
| Roadmap animado al subir rango | hecho | `web/src/lib/roadmap.ts`, verificado en navegador |
| Narrativa por región | hecho | `REGIONES.md`, `region.ts`, `narrativa.ts`; CO/MX/US/ES comprobados |
| Medios de pago por país | hecho | PSE y Efecty solo en CO |
| Revisión de gramática | **Luna** | `CONTENIDO-LECCIONES.md`, encargo B |
| three.js / shaders / Framer Motion | **descartado** | Framer Motion es solo React (no hay React); three.js son ~150 KB gz para un mapa 2D que GSAP ya hace |

## Encargo 2 · ontología, agente, chat, visibilidad

| punto | estado | con qué se comprueba |
|---|---|---|
| Ontología por tabla | hecho | `api/src/ontology.js`, `ONTOLOGIA.md` generado del módulo |
| Nadie sabe de nadie por el agente | hecho | `pnpm --dir api test` → 31 + 17 comprobaciones, sin fallos |
| Chat que integra todo | hecho | `/chat`, 5 atajos verificados |
| Modo IA junto al normal | hecho | modo normal sin costo; modo IA con traza visible |
| Harness / bucle / grafo | hecho | `api/src/harness.js`, tope 4 vueltas, `api/test/harness.mjs` |
| Seis proveedores cableados | hecho, faltan llaves | `api/src/proveedores.js`: anthropic, openrouter, deepseek, kimi, huggingface, opencode |
| SEO / AEO / crawlers de IA | hecho | `/robots.txt` (18 agentes), `/llms.txt`, `/sitemap.xml`, JSON-LD con FAQ de 7 |
| Francés y portugués | **Luna** | cableado listo (`IDIOMAS = Object.keys(STR)`), faltan diccionarios |
| Bandera al cambiar idioma | hecho | `lang-anim.ts` + `flags.ts` en SVG |

## Encargo 3 · lo que una SaaS de verdad tiene

| punto | estado | con qué se comprueba |
|---|---|---|
| Muro de pago real | hecho | sin pagar: lección 2–12 y lab 7.1 → 402; lección 1 y lab 1.1 → 200 |
| Garantía de 14 días (era 7, ilegal en UE) | hecho | i18n, `/pago`, landing y Ajustes |
| Términos y privacidad | hecho | 14 y 12 secciones, es + en |
| Retorno de pago | hecho | `back_urls`, `/pago/gracias` (3 estados), `/pago/error` |
| Recuperar contraseña | hecho | token de un uso, 30 min, reuso → 409, sesión vieja → 401 |
| `astro check` volvió a servir | hecho | TS 6 fijado; aparecieron 42 errores, hoy 0 en 38 archivos |

## Bloqueado en ti

1. `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET` — sin esto nadie paga.
2. Una llave de proveedor para el modo IA (`ANTHROPIC_API_KEY` u `OPENROUTER_API_KEY` cubren más).
3. Stripe para EE. UU. y UE — Mercado Pago no opera allí (ver `REGIONES.md`).
4. Proveedor de correo — hoy el enlace de recuperación solo sale en el log.
5. `api/files/curso-es.pdf` y `curso-en.pdf` — el botón responde 503 con el motivo.
6. Entrega de Luna: fr, pt y la revisión de es/en.
7. Límite por IP en `/api/auth/recover` — hay límite por cuenta (3/hora); el de IP necesita CDN o `@fastify/rate-limit`.
8. Apagar la siembra en producción — crea tres cuentas con contraseña conocida y una es admin.

## Comandos

```bash
pnpm dev                 # Postgres en contenedor + API + web, siembra y verifica
pnpm --dir api test      # aislamiento del agente (31) + harness (17)
pnpm --dir web i18n      # deriva de claves entre idiomas
pnpm --dir web exec astro check
```
