# Auditoría por región · qué cambia y qué está roto

Fecha: 2026-08-21. Cuatro mercados: Colombia, Estados Unidos, LATAM y Unión Europea.
Cada sección dice qué se implementó, qué objeción trae ese mercado y **qué bloquea la venta hoy**.

Detección: `web/src/lib/region.ts`. Orden de fiabilidad: cabecera geo del CDN
(`cf-ipcountry`, `x-vercel-ip-country`, …) → región del `Accept-Language` → neutra.
**El sistema operativo no reporta país.** Por eso la narrativa nunca depende de acertar:
si no se sabe, sale la variante `global`, que no promete nada específico de un país.

Copy: `web/src/lib/narrativa.ts`, cuatro mercados × dos idiomas.
Se usa en `/` (banda en §05 precio) y en `/pago` (banda de confianza, medios de pago,
texto de garantía).

---

## 1. Colombia — mercado principal

| | |
|---|---|
| Narrativa | «Hecho en Medellín». Cercanía y nombre propio: quien vende tiene cara. |
| Objeción real | «¿por qué en dólares?» — el precio en USD parece de gringo. |
| Cómo se responde | Se dice explícito que el banco convierte al cambio del día y puede sumar comisión. |
| Medios | Tarjeta · PSE · Efectivo (Efecty) · wallet Mercado Pago |
| Estado | **Funciona.** Es el único mercado con los cuatro medios. |

## 2. LATAM (MX, AR, CL, PE, EC, BR…)

| | |
|---|---|
| Narrativa | «Entender la IA sin que te la expliquen en inglés». El idioma es el argumento. |
| Objeción real | Rechazo del cobro internacional por parte del banco emisor. |
| Cómo se responde | Se avisa antes de pagar: si rechaza, llamar al banco y autorizar. |
| Medios | Tarjeta · wallet. **PSE y Efecty son solo de Colombia** y ya no se muestran fuera. |
| Estado | Funciona con reservas: la tasa de rechazo de tarjeta cross-border en LATAM es alta. |
| Pendiente | Precio en moneda local (MXN, ARS, CLP) subiría conversión, pero exige otra pasarela. |

## 3. Estados Unidos

| | |
|---|---|
| Narrativa | «Cinco horas, no un bootcamp de seis semanas». Contra el mercado de cursos inflados. |
| Objeción real | Invertida: **el precio es tan bajo que da desconfianza.** |
| Cómo se responde | «No es gancho: no hay plan pro» + cero analítica + devolución de 14 días. |
| Medios | Solo tarjeta internacional. |
| **Bloqueo** | **Mercado Pago no opera en EE. UU.** El cobro sale de un comercio colombiano: el banco emisor puede rechazarlo y no hay Apple Pay ni ACH. |
| Arreglo | Stripe como segunda pasarela (`/api/payments/stripe/*` en paralelo, misma tabla `payments`). Hasta entonces la página dice la verdad: si rechaza, escribir y se manda enlace alterno. |

## 4. Unión Europea (+ Reino Unido, Noruega, Suiza)

| | |
|---|---|
| Narrativa | «Sin analítica y sin banner de cookies». Privacidad como producto, no como aviso legal. |
| Objeción real | ¿Quién es este vendedor, qué hace con mis datos y puedo devolverlo? |
| Cómo se responde | Retracto de 14 días citando la Directiva 2011/83/UE, tres cookies necesarias, borrado de cuenta desde Ajustes. |
| Medios | Solo tarjeta internacional. |
| **Bloqueo 1** | **Mercado Pago no opera en la UE.** Mismo problema que EE. UU. |
| **Bloqueo 2 (resuelto)** | La garantía decía **7 días**: por debajo del mínimo legal de 14. Corregido en `i18n.ts`, `/pago`, la landing y Ajustes. |
| Pendiente | IVA: hoy se declara que corre por cuenta del comprador. Con volumen real hay que decidir OSS/IOSS o vender vía un merchant of record (Paddle, Lemon Squeezy). |
| Pendiente | Región de hosting: si los servidores quedan fuera del EEE hay transferencia internacional. Ya está declarado en `/privacidad`; hay que nombrar al proveedor cuando se fije. |

---

## Lo que cuesta dinero, en orden

1. **Stripe** (o un merchant of record). Sin esto, EE. UU. y la UE no pueden pagar de forma fiable, y son los dos mercados que pagan en dólares sin dolerles.
2. **Precio local en LATAM.** Reduce el rechazo de tarjeta más que cualquier cambio de copy.
3. **Decidir el IVA de la UE** antes de que el volumen lo vuelva un problema retroactivo.

## Lo que NO se hizo a propósito

- Cambiar el precio por región. Discriminar precio por IP sin base legal ni fiscal es un problema, no una optimización.
- Traducir la landing al inglés por región. La landing sigue en español; la plataforma sí es bilingüe. Cuando entre inglés, el mercado `us` es el primero que lo justifica.
- Geobloquear. Nadie queda fuera: quien no encaja en un mercado ve la narrativa neutra.
