# Payments

Servicio de pagos independiente del curso. No importa código de `api/`, `web/`
ni `auth/`; por eso la carpeta se puede convertir en un repositorio propio sin
reescribir la integración.

- TypeScript 7 con `tsgo` (`@typescript/native-preview`).
- Checkout único y suscripción mensual con Mercado Pago.
- Webhooks HMAC con ventana anti-replay.
- Cada entrega firmada se deduplica, pero un mismo pago puede cambiar de estado.
- Base de datos propia y callback idempotente de acceso hacia la plataforma.

La API del curso lo llama con `Authorization: Bearer $PAYMENTS_SECRET`. Mercado
Pago llama directamente a `/v1/webhooks/mercadopago`; no se exponen credenciales
del proveedor en el repositorio principal.
