# SaaS readiness

## Resultado

El producto ya tiene el núcleo técnico para vender: registro y login, paywall,
checkout real, pagos únicos, suscripciones, revocación por reembolso/cancelación,
persistencia separada de pagos, despliegue reproducible y controles de seguridad.

## Listo en código

- `/auth` es el único dueño de contraseñas, JWT/cookies, sesiones, recuperación,
  roles, borrado de cuenta, throttling y entitlements.
- `/payments` no importa código del curso y puede vivir en otro repositorio. Usa
  TypeScript 7 con `tsgo`, una base propia y un secreto de servicio.
- Checkout de Mercado Pago para pago único y suscripción; el navegador redirige
  al `init_point` alojado por el proveedor.
- Webhook HMAC con ventana anti-replay, deduplicación por entrega firmada,
  reintentos con backoff y conservación de eventos muertos para auditoría.
- Los estados `approved`, `refunded`, `authorized` y `cancelled` recalculan el
  acceso de forma idempotente; un reembolso ya no deja el curso abierto.
- Defense observa login, bloqueo, inicio de suscripción y revocación. Puede
  invalidar sesiones o limitar una identidad; nunca cancela cobros automáticamente.
- Migraciones, CI, imágenes, Compose, rollback y secretos incluyen pagos y auth.
- Términos, privacidad, soporte, borrado de cuenta y garantía de 14 días existen
  y la comunicación comercial usa el mismo plazo.

## Falta para cobrar en producción

Estas tareas dependen de cuentas o infraestructura externa, no de más lógica del
repositorio:

1. Crear el repositorio remoto de `payments/` y desplegarlo como servicio privado;
   conservar sólo su URL pública de webhook y su contrato interno autenticado.
2. Cargar `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` y, si se usa, `MP_PUBLIC_KEY`.
   Registrar el webhook público en Mercado Pago hacia
   `/api/payments/mercadopago/webhook` o directamente
   `/v1/webhooks/mercadopago` si `payments` tiene dominio propio.
3. Configurar `DEPLOY_TARGET`, dominio, DNS/TLS y todos los secretos enumerados
   en `RUNBOOK.md`; ejecutar una compra sandbox completa antes de activar dinero real.
4. Conectar un proveedor de correo transaccional. Los tokens de recuperación son
   seguros y de un uso, pero en producción aún no existe un remitente que entregue
   el enlace al usuario.
5. Definir el procedimiento operativo de reembolsos. El webhook ya revoca acceso,
   pero iniciar el reembolso se hace hoy desde Mercado Pago y soporte, no desde el admin.
6. Configurar backups externos para ambas bases, alertas de healthchecks/webhooks
   muertos y revisión periódica de los eventos de Defense.
7. Confirmar obligaciones fiscales y de facturación para los países donde se venda;
   el software registra el cobro, pero no sustituye el proceso contable del vendedor.

## Criterio de lanzamiento

No abrir tráfico de pago hasta completar los puntos 2, 3 y una compra sandbox de
extremo a extremo. Correo transaccional y backups deben estar activos antes de
aceptar usuarios que no puedan ser atendidos manualmente.
