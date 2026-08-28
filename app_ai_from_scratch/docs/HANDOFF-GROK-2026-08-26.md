# Handoff — AI From Scratch

Fecha: 2026-08-26  
Objetivo: continuar el lanzamiento de la plataforma de curso como SaaS, sin romper el despliegue actual ni exponer credenciales.

## Estado actual

- Repositorio de la aplicación: `app_ai_from_scratch/`.
- El repositorio de pagos está separado en `payments/`; la integración se basa en Mercado Pago y el acceso se abre únicamente después de la confirmación del webhook.
- Autenticación y suscripciones están aisladas en `auth/` y `defense/`, respectivamente.
- La aplicación está desplegada en una Raspberry Pi 4B, mediante Docker Compose.
- Directorio remoto: `/home/anton_alxn_boy/aifromscratch`.
- Puertos internos: web `127.0.0.1:14321`, API `127.0.0.1:18787`.
- URL pública temporal de Cloudflare Quick Tunnel: `https://parcel-casey-spring-cited.trycloudflare.com`.
  - Es temporal: no usarla como URL definitiva de Mercado Pago.
- Dominio objetivo: `aifromscratch.shop`.
- El dominio todavía necesita una zona DNS activa y un Cloudflare Tunnel nombrado. No se debe modificar el túnel existente de otros servicios de la Raspberry Pi.

## Usuarios y pagos

El superpanel reportó:

- 1 cuenta activa: `founder.alpadev@gmail.com`, rol `admin`.
- 0 pagos registrados.

No incluir ni pedir contraseñas, tokens de Mercado Pago, llaves SSH ni secretos de webhook en tickets, commits o mensajes.

## Cambios recientes ya realizados

- Se añadió el favicon en `web/public/favicon.svg` y se enlazó en los layouts y páginas públicas.
- Se corrigió la reconexión del broker de cola para el health check.
- Se crearon 20 plantillas de correo SaaS en `design/saas-emails/`, con vista previa, tema oscuro/papel y acciones Show/Close.
- El checkout usa una preferencia hospedada de Mercado Pago; no se deben considerar las preferencias creadas como un pago confirmado. La fuente de verdad es el webhook firmado.

## Auditoría editorial en curso

Se mejoraron textos de interfaz, marketing y lecciones en:

- `api/src/content.ts`
- `api/src/seed.ts`
- `web/src/data/landing.ts`
- `web/src/lib/narrative.ts`
- `web/src/lib/i18n.ts`
- `web/src/pages/index.astro`
- `web/src/pages/ajustes.astro`
- `web/src/pages/admin.astro`

Cambios de aprendizaje importantes:

- La lección 6 ahora explica que el modelo genera tokens, no palabras completas.
- La lección 8 ya no promete una ventana fija de “120.000 palabras”; explica que el contexto depende del modelo y se mide en tokens.
- Las lecciones 9 a 11 distinguen temperatura, incertidumbre, fuentes actuales y fecha de corte sin afirmaciones absolutas.
- La lección 12 cierra con una práctica observable: pedir objetivo, audiencia y formato; verificar datos con consecuencias.
- Se eliminó la contradicción comercial entre “cinco horas” y “40 minutos”, y se unificó la garantía visual a 14 días.

La validación actual quedó cerrada:

- El catálogo contiene 54 preguntas y los quizzes/exámenes HTTP y de datos pasan.
- Se completaron los 21/21 gates de verificación, incluyendo aislamiento, paywall y ausencia de `solution` en las respuestas.
- La QA browser pasó en desktop (1440×900) y mobile (390×844): login, quiz de lección 1 (wrong/reset/correct/reload), paywall free, lección premium paid, examen 1 con 5/6 aprobado y persistencia tras reload, curso y sidebar.
- El sidebar desktop expande/colapsa con `aria-expanded`; en mobile abre/cierra con backdrop y responde a Escape. La consola browser terminó sin errores ni warnings.
- Evidencia visual: `output/playwright/free-lesson1-quiz.png`, `free-paywall.png`, `paid-lesson2.png`, `paid-exam1-5of6.png`, `desktop-sidebar-collapsed.png`, `mobile-menu-open.png` y `mobile-course.png`.

## Trabajo pendiente, en orden

1. Mantener como comprobaciones reproducibles antes de una release:

   ```bash
   pnpm --dir web build
   git diff --check
   ```

2. Ejecutar la verificación completa desde la raíz con cachés temporales si el entorno local lo necesita:

   ```bash
   UV_CACHE_DIR=/tmp/aifs-uv GOCACHE=/tmp/aifs-go pnpm verify
   ```

2. El despliegue y la configuración comercial siguen pendientes, separados de la validación local:
   - Desplegar solo después de que las verificaciones pasen. Confirmar que todos los contenedores estén saludables y que el favicon responda `200`.

3. Configurar el dominio definitivo:
   - Activar o delegar la zona DNS de `aifromscratch.shop` en Cloudflare.
   - Crear un Cloudflare Tunnel nombrado independiente para `aifromscratch.shop -> http://127.0.0.1:14321`.
   - Mantener sin tocar el túnel de `anton.alpadev.xyz`, Home Assistant y `anton-web`.
   - Cuando TLS y DNS funcionen, actualizar el origen público de la aplicación a `https://aifromscratch.shop`.
   - Configurar en Mercado Pago el webhook definitivo: `https://aifromscratch.shop/api/payments/mercadopago/webhook`.
   - Hacer una compra de prueba de sandbox y comprobar la cadena completa: navegador -> Mercado Pago -> webhook -> entitlement -> acceso.

4. Completar la operación SaaS: monitoreo, backups, soporte y reembolsos. La compra sandbox, Cloudflare y el dominio no se consideran validados por esta QA local.

## Reglas de seguridad y operación

- No publicar ni registrar secretos en el repositorio.
- No marcar un pago como aprobado desde el navegador ni desde la URL de retorno.
- No abrir el acceso por crear una preferencia de pago: solo por webhook verificado.
- Preservar cambios locales no relacionados: el árbol de trabajo ya contiene trabajo del usuario.
- No usar comandos destructivos ni reiniciar servicios ajenos en la Raspberry Pi.
- Las promesas legales, tributarias, de reembolso y privacidad solo deben cambiarse tras revisión específica; la auditoría actual se limitó a claridad y gramática donde no alteraba el compromiso.

## Criterio de terminado

La siguiente entrega queda lista cuando:

- la compilación y la verificación pasan;
- el sidebar se abre y cierra en escritorio y móvil;
- la copia de las lecciones es consistente en ES/EN y pedagógicamente correcta;
- el dominio definitivo sirve HTTPS;
- una compra sandbox abre el acceso vía webhook firmado;
- existe monitoreo básico, backups y una forma operativa de atender reembolsos y soporte.
