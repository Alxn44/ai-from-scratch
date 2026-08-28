/**
 * Plantillas transaccionales de IA desde cero.
 *
 * Este módulo no envía correo. Es el contrato de presentación para el adaptador
 * de email que se conecte después. Mantener el envío fuera de payments evita
 * que una caída de correo retrase el webhook de Mercado Pago o un entitlement.
 */

export type EmailKind =
  | 'welcome' | 'verify_email' | 'password_reset' | 'password_changed'
  | 'sign_in_alert' | 'account_locked' | 'purchase_receipt' | 'payment_pending'
  | 'payment_failed' | 'subscription_started' | 'renewal_notice'
  | 'subscription_receipt' | 'subscription_cancelled' | 'access_expiring'
  | 'refund_confirmed' | 'dispute_received' | 'support_opened' | 'support_reply'
  | 'support_closed' | 'product_update';

export interface EmailInput {
  kind: EmailKind;
  name: string;
  actionUrl?: string;
  fields?: Array<{ label: string; value: string }>;
  supportEmail?: string;
}

type Spec = {
  category: 'Cuenta' | 'Seguridad' | 'Pago' | 'Suscripción' | 'Soporte' | 'Producto';
  subject: string;
  preheader: string;
  title: string;
  paragraphs: readonly string[];
  cta?: string;
  footer: string;
  marketing?: boolean;
};

// Los textos usan {{nombre}}. Los datos financieros entran por fields, nunca
// se inventan en la plantilla. Todo correo de producto exige consentimiento.
export const EMAIL_SPECS: Record<EmailKind, Spec> = {
  welcome: {
    category: 'Cuenta', subject: 'Bienvenida a IA desde cero',
    preheader: 'Tu cuenta ya está lista para empezar.', title: 'Tu cuenta está lista.',
    paragraphs: ['Hola, {{nombre}}.', 'Ya puedes entrar y comenzar por la primera lección. La plataforma guarda tu progreso para que retomes cuando quieras.'],
    cta: 'Entrar a la plataforma', footer: 'Este correo confirma la creación de una cuenta.'
  },
  verify_email: {
    category: 'Cuenta', subject: 'Confirma tu correo', preheader: 'Confirma que este correo es tuyo.',
    title: 'Confirma tu correo.', paragraphs: ['Hola, {{nombre}}.', 'Usa el botón para confirmar este correo y mantener seguras las notificaciones de tu cuenta.'],
    cta: 'Confirmar correo', footer: 'Si no creaste esta cuenta, puedes ignorar este mensaje.'
  },
  password_reset: {
    category: 'Seguridad', subject: 'Restablece tu contraseña', preheader: 'Solicitaste una contraseña nueva.',
    title: 'Restablece tu contraseña.', paragraphs: ['Hola, {{nombre}}.', 'Recibimos una solicitud para cambiar tu contraseña. El enlace vence pronto por seguridad.'],
    cta: 'Crear contraseña nueva', footer: 'Si no hiciste esta solicitud, ignora este correo. Tu contraseña actual seguirá vigente.'
  },
  password_changed: {
    category: 'Seguridad', subject: 'Tu contraseña fue actualizada', preheader: 'Confirmamos el cambio de contraseña.',
    title: 'Contraseña actualizada.', paragraphs: ['Hola, {{nombre}}.', 'La contraseña de tu cuenta se cambió correctamente.'],
    cta: 'Revisar seguridad', footer: 'Si no reconoces este cambio, restablece tu contraseña de inmediato y contacta a soporte.'
  },
  sign_in_alert: {
    category: 'Seguridad', subject: 'Nuevo acceso a tu cuenta', preheader: 'Te avisamos de un inicio de sesión nuevo.',
    title: 'Revisa este acceso.', paragraphs: ['Hola, {{nombre}}.', 'Detectamos un inicio de sesión nuevo en tu cuenta. Revisa los detalles para confirmar que fuiste tú.'],
    cta: 'Revisar seguridad', footer: 'No incluimos direcciones IP ni datos sensibles en este correo.'
  },
  account_locked: {
    category: 'Seguridad', subject: 'Tu cuenta fue bloqueada temporalmente', preheader: 'Protegimos tu cuenta tras varios intentos fallidos.',
    title: 'Protegimos tu cuenta.', paragraphs: ['Hola, {{nombre}}.', 'Bloqueamos temporalmente los nuevos inicios de sesión después de varios intentos fallidos.'],
    cta: 'Recuperar acceso', footer: 'Si fuiste tú, espera el tiempo indicado o usa recuperación de contraseña.'
  },
  purchase_receipt: {
    category: 'Pago', subject: 'Recibo de tu compra', preheader: 'Tu pago fue confirmado y tu acceso está activo.',
    title: 'Pago confirmado.', paragraphs: ['Hola, {{nombre}}.', 'Confirmamos tu pago. Tu acceso al curso está activo y este mensaje funciona como tu recibo de compra.'],
    cta: 'Abrir el curso', footer: 'Guarda este recibo. Para reembolsos o dudas, responde desde soporte.'
  },
  payment_pending: {
    category: 'Pago', subject: 'Tu pago está pendiente', preheader: 'Esperamos la confirmación del medio de pago.',
    title: 'Aún esperamos confirmación.', paragraphs: ['Hola, {{nombre}}.', 'Tu compra fue iniciada, pero el medio de pago todavía no la confirmó. No necesitas pagar de nuevo.'],
    cta: 'Ver estado de compra', footer: 'El acceso se habilita solo cuando el proveedor confirma el pago.'
  },
  payment_failed: {
    category: 'Pago', subject: 'No pudimos confirmar tu pago', preheader: 'Tu acceso no fue cobrado ni habilitado.',
    title: 'No confirmamos el pago.', paragraphs: ['Hola, {{nombre}}.', 'El proveedor no confirmó esta compra. Tu acceso no cambió y no debes hacer nada si no quieres intentar de nuevo.'],
    cta: 'Intentar otra vez', footer: 'Si ves un cargo confirmado, no repitas el pago. Contacta a soporte con el comprobante.'
  },
  subscription_started: {
    category: 'Suscripción', subject: 'Tu suscripción está activa', preheader: 'Confirmamos tu membresía.',
    title: 'Tu membresía está activa.', paragraphs: ['Hola, {{nombre}}.', 'Tu suscripción fue confirmada. Conservas el acceso mientras se mantenga activa.'],
    cta: 'Administrar suscripción', footer: 'Recibirás un aviso antes de cada cobro y podrás cancelar desde tu cuenta.'
  },
  renewal_notice: {
    category: 'Suscripción', subject: 'Próximo cobro de tu suscripción', preheader: 'Te avisamos antes de renovar.',
    title: 'Tu renovación se acerca.', paragraphs: ['Hola, {{nombre}}.', 'Te avisamos antes del siguiente cobro. Revisa el importe y la fecha en los detalles.'],
    cta: 'Administrar suscripción', footer: 'Puedes cancelar antes de la renovación desde tu cuenta.'
  },
  subscription_receipt: {
    category: 'Suscripción', subject: 'Recibo de renovación', preheader: 'Tu renovación fue confirmada.',
    title: 'Renovación confirmada.', paragraphs: ['Hola, {{nombre}}.', 'Confirmamos la renovación de tu suscripción. Tu acceso continúa activo.'],
    cta: 'Ver suscripción', footer: 'Guarda este recibo para tus registros.'
  },
  subscription_cancelled: {
    category: 'Suscripción', subject: 'Tu suscripción fue cancelada', preheader: 'Confirmamos la cancelación.',
    title: 'Cancelación confirmada.', paragraphs: ['Hola, {{nombre}}.', 'La renovación automática fue cancelada. Conservas tu acceso hasta el final del periodo ya pagado, si aplica.'],
    cta: 'Ver suscripción', footer: 'No se realizarán nuevos cobros después de la fecha indicada.'
  },
  access_expiring: {
    category: 'Suscripción', subject: 'Tu acceso está por vencer', preheader: 'Tu periodo actual termina pronto.',
    title: 'Tu acceso termina pronto.', paragraphs: ['Hola, {{nombre}}.', 'Tu periodo actual está por terminar. Actualiza tu medio de pago o reactiva la suscripción si quieres conservar el acceso.'],
    cta: 'Reactivar suscripción', footer: 'No se cobra nada hasta que confirmes una nueva suscripción.'
  },
  refund_confirmed: {
    category: 'Pago', subject: 'Tu reembolso fue confirmado', preheader: 'Iniciamos el reembolso con el mismo medio de pago.',
    title: 'Reembolso confirmado.', paragraphs: ['Hola, {{nombre}}.', 'Confirmamos el reembolso. El tiempo en que aparece depende de tu banco o del medio de pago.'],
    cta: 'Ver detalles', footer: 'El acceso asociado a esta compra fue revocado al procesar el reembolso.'
  },
  dispute_received: {
    category: 'Pago', subject: 'Recibimos una disputa de pago', preheader: 'Te explicamos qué sigue.',
    title: 'Estamos revisando una disputa.', paragraphs: ['Hola, {{nombre}}.', 'El proveedor nos avisó de una disputa relacionada con un pago. Nuestro equipo revisará la información y te contactará si necesita algo.'],
    cta: 'Contactar soporte', footer: 'No envíes información de tarjetas por correo.'
  },
  support_opened: {
    category: 'Soporte', subject: 'Recibimos tu solicitud de soporte', preheader: 'Tu caso ya está registrado.',
    title: 'Recibimos tu solicitud.', paragraphs: ['Hola, {{nombre}}.', 'Tu solicitud llegó a soporte. Usaremos este mismo hilo para mantener el contexto de la conversación.'],
    cta: 'Ver solicitud', footer: 'No respondas con contraseñas, códigos de recuperación ni datos de tarjeta.'
  },
  support_reply: {
    category: 'Soporte', subject: 'Soporte respondió tu solicitud', preheader: 'Hay una actualización en tu caso.',
    title: 'Hay una respuesta para ti.', paragraphs: ['Hola, {{nombre}}.', 'El equipo de soporte actualizó tu solicitud. Puedes leer y responder desde la plataforma.'],
    cta: 'Abrir conversación', footer: 'Este correo mantiene tu caso en un único hilo.'
  },
  support_closed: {
    category: 'Soporte', subject: 'Tu solicitud de soporte fue cerrada', preheader: 'Confirmamos el cierre de tu caso.',
    title: 'Tu caso fue cerrado.', paragraphs: ['Hola, {{nombre}}.', 'Cerramos tu solicitud de soporte. Si el problema continúa, abre una nueva solicitud con los detalles actuales.'],
    cta: 'Ir a soporte', footer: 'Conservamos el historial del caso para dar continuidad si vuelves a contactarnos.'
  },
  product_update: {
    category: 'Producto', subject: 'Novedades de IA desde cero', preheader: 'Hay contenido nuevo disponible.',
    title: 'Hay novedades en el curso.', paragraphs: ['Hola, {{nombre}}.', 'Publicamos una actualización de producto o contenido que puede interesarte.'],
    cta: 'Ver novedades', footer: 'Este correo se envía solo a personas que aceptaron comunicaciones de producto.', marketing: true
  },
};

const html = (value: string): string => value.replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[char] ?? char);

const fill = (value: string, name: string): string => value.replaceAll('{{nombre}}', html(name));

/** Rinde una tabla compatible con clientes de correo, sin CSS remoto ni scripts. */
export function renderEmailHtml(input: EmailInput): { subject: string; html: string; text: string } {
  const spec = EMAIL_SPECS[input.kind];
  const support = input.supportEmail ?? 'soporte@aifromscratch.shop';
  const details = (input.fields ?? []).map(({ label, value }) => `
    <tr><td style="padding:10px 0;border-top:1px solid #2C2C2E;color:#A1A1AA;font:12px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${html(label)}</td><td align="right" style="padding:10px 0;border-top:1px solid #2C2C2E;color:#F5F8FF;font:600 12px/18px ui-monospace,SFMono-Regular,Menlo,monospace">${html(value)}</td></tr>`).join('');
  const button = spec.cta && input.actionUrl ? `<tr><td style="padding-top:26px"><a href="${html(input.actionUrl)}" style="display:inline-block;background:#F5F8FF;color:#070B14;padding:13px 18px;font:700 12px/16px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-decoration:none">${html(spec.cta)}</a></td></tr>` : '';
  const paragraphs = spec.paragraphs.map((p) => `<p style="margin:0 0 14px;color:#C7C7CC;font:16px/24px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${fill(p, input.name)}</p>`).join('');
  const result = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(spec.subject)}</title></head><body style="margin:0;background:#070B14"><span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0">${html(spec.preheader)}</span><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#070B14"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#0B0B0C;border:1px solid #2C2C2E"><tr><td style="padding:28px 30px 18px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="width:30px;height:30px;border:1px solid #57575D;color:#F5F8FF;text-align:center;font:700 13px/30px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">IA</td><td style="padding-left:10px;color:#F5F8FF;font:600 13px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">IA desde cero</td></tr></table></td></tr><tr><td style="padding:22px 30px 30px"><p style="margin:0 0 10px;color:#0A84FF;font:600 10px/14px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1.4px;text-transform:uppercase">${html(spec.category)}</p><h1 style="margin:0 0 18px;color:#F5F8FF;font:700 28px/32px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.6px">${html(spec.title)}</h1>${paragraphs}${details ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:22px">${details}</table>` : ''}<table role="presentation" cellspacing="0" cellpadding="0">${button}</table></td></tr><tr><td style="padding:18px 30px 28px;border-top:1px solid #2C2C2E"><p style="margin:0;color:#8E8E93;font:12px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${html(spec.footer)}</p><p style="margin:12px 0 0;color:#8E8E93;font:12px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">¿Necesitas ayuda? <a href="mailto:${html(support)}" style="color:#0A84FF">${html(support)}</a></p></td></tr></table></td></tr></table></body></html>`;
  const text = [spec.title, ...spec.paragraphs.map((p) => p.replaceAll('{{nombre}}', input.name)), ...(input.fields ?? []).map((f) => `${f.label}: ${f.value}`), spec.cta && input.actionUrl ? `${spec.cta}: ${input.actionUrl}` : '', spec.footer, `Soporte: ${support}`].filter(Boolean).join('\n\n');
  return { subject: spec.subject, html: result, text };
}
