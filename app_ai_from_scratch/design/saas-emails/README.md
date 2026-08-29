# Correos SaaS

Esta carpeta define las comunicaciones que puede enviar IA desde cero. `templates.ts` contiene el HTML compatible con clientes de correo, texto alternativo y los campos dinámicos. `preview.html` permite inspeccionar cada estado y sus vistas Mostrar/Cerrar sin conectar ningún proveedor.

## Catálogo y disparador

| Grupo | Plantillas | Disparador autorizado |
|---|---|---|
| Cuenta | `welcome`, `verify_email` | Registro exitoso y verificación solicitada. |
| Seguridad | `password_reset`, `password_changed`, `sign_in_alert`, `account_locked` | Eventos de `/auth`. Nunca adjuntar contraseñas, tokens o IPs completas. |
| Pago | `purchase_receipt`, `payment_pending`, `payment_failed`, `refund_confirmed`, `dispute_received` | Estado confirmado por webhook de Mercado Pago. No enviar un recibo por el retorno del navegador. |
| Suscripción | `subscription_started`, `renewal_notice`, `subscription_receipt`, `subscription_cancelled`, `access_expiring` | Cambios de estado confirmados por el proveedor y tareas programadas. |
| Soporte | `support_opened`, `support_reply`, `support_closed` | Sistema de tickets. Conservar el identificador del caso en los campos. |
| Producto | `product_update` | Solo con consentimiento de comunicaciones de producto. No mezclarlo con los correos transaccionales. |

## Integración segura

1. Conectar un proveedor de correo transaccional en un adaptador nuevo. No usar el proceso web como cola de envíos.
2. Duplicar el patrón durable de pagos: registrar el evento, deduplicar por evento y reintentar de forma acotada.
3. Para recibos, conservar en los `fields` el identificador del proveedor, importe, moneda, producto, fecha y estado. El importe solo se toma del webhook confirmado.
4. Definir una dirección remitente con SPF, DKIM y DMARC antes de enviar correo real.
5. Registrar consentimiento, baja y categorías de marketing por separado. `product_update` nunca se entrega por defecto.

No hay proveedor de email conectado todavía. Estas plantillas son listas de diseño y de contenido, no una afirmación de que ya se estén enviando.
