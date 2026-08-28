import Fastify from 'fastify';
import { loadConfig } from './config.ts';
import { Store } from './db.ts';
import { MercadoPago, MercadoPagoError } from './mercadopago.ts';
import { CURRENCY } from './price.ts';
import { serviceAuthorized, verifyMercadoPagoSignature } from './security.ts';

const config = loadConfig();
const store = new Store(config.databaseUrl);
const provider = new MercadoPago(config);
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

const authorized = (request: { headers: Record<string, unknown> }): boolean =>
  serviceAuthorized(request.headers.authorization, config.serviceSecret);

async function sendEntitlement(userId: number, source: string, externalId: string, deliveryId: number): Promise<void> {
  const active = await store.entitlement(userId);
  // Stable across retries of this delivery, distinct across real state changes.
  const eventKey = `${source}:${externalId}:${deliveryId}:${active}`;
  const response = await fetch(config.entitlementsUrl, {
    method: 'POST', headers: { authorization: `Bearer ${config.serviceSecret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ eventKey, userId, active, source, externalId, occurredAt: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`entitlement callback ${response.status}: ${(await response.text()).slice(0, 300)}`);
  await store.markDelivered(eventKey, userId, active);
}

const userIdFrom = (resource: Record<string, unknown>): number | null => {
  const metadata = resource.metadata as Record<string, unknown> | undefined;
  const candidate = metadata?.user_id ?? resource.external_reference;
  const value = Number(candidate);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};

async function processOne(): Promise<boolean> {
  const event = await store.takeEvent();
  if (!event) return false;
  try {
    if (event.resourceType.includes('subscription') || event.resourceType.includes('preapproval')) {
      const item = await provider.subscription(event.providerId);
      const userId = userIdFrom(item);
      await store.upsertSubscription({ providerId: event.providerId, userId,
        status: String(item.status ?? 'unknown'),
        periodEnd: typeof item.next_payment_date === 'string' ? item.next_payment_date : null, raw: item });
      if (userId) await sendEntitlement(userId, 'mercadopago.subscription', event.providerId, event.id);
    } else {
      const item = await provider.payment(event.providerId);
      const userId = userIdFrom(item);
      await store.upsertPayment({ providerId: event.providerId, userId,
        status: String(item.status ?? 'unknown'), amount: Number(item.transaction_amount ?? 0),
        currency: String(item.currency_id ?? CURRENCY), raw: item });
      const metadata = item.metadata as Record<string, unknown> | undefined;
      const redemptionId = Number(metadata?.coupon_redemption_id);
      if (String(item.status) === 'approved' && Number.isSafeInteger(redemptionId) && redemptionId > 0) {
        await store.redeemCouponReservation(redemptionId, event.providerId);
      }
      if (userId) await sendEntitlement(userId, 'mercadopago.payment', event.providerId, event.id);
    }
    await store.finishEvent(event.id);
  } catch (error) {
    app.log.error({ error, event }, 'payment event failed');
    await store.failEvent(event.id, event.attempts, error);
  }
  return true;
}

app.get('/health', async () => ({ ok: true, compiler: 'tsgo', service: 'payments' }));

app.post<{ Body: { userId?: unknown; email?: unknown; mode?: unknown; couponCode?: unknown } }>('/v1/checkout', async (request, reply) => {
  if (!authorized(request)) return reply.code(401).send({ error: 'unauthorized' });
  const userId = Number(request.body?.userId);
  const email = String(request.body?.email ?? '').trim().toLowerCase();
  const mode = request.body?.mode === 'subscription' ? 'subscription' : 'one_time';
  const couponCode = typeof request.body?.couponCode === 'string' ? request.body.couponCode : '';
  if (!Number.isSafeInteger(userId) || userId < 1 || !email.includes('@')) {
    return reply.code(400).send({ error: 'invalid_actor' });
  }
  if (couponCode && mode === 'subscription') return reply.code(400).send({ error: 'coupon_not_applicable' });
  const reservation = couponCode ? await store.reserveCoupon(couponCode, userId) : null;
  if (couponCode && !reservation) return reply.code(422).send({ error: 'invalid_coupon' });
  try {
    if (reservation?.offer.totalMinor === 0) {
      const providerId = `coupon:${reservation.id}`;
      await store.upsertPayment({ providerId, userId, status: 'approved', amount: 0,
        currency: CURRENCY, raw: { source: 'coupon', coupon: reservation.offer.code } });
      await store.redeemCouponReservation(reservation.id, providerId);
      await sendEntitlement(userId, 'coupon', providerId, reservation.id);
      return { mode, coupon: reservation.offer.code, discountPercent: reservation.offer.percent,
        discountMinor: reservation.offer.discountMinor, totalMinor: 0, granted: true };
    }
    if (!config.mpAccessToken) {
      if (reservation) await store.releaseCoupon(reservation.id);
      return reply.code(501).send({ error: 'provider_not_configured' });
    }
    const result = await provider.checkout({ userId, email }, mode, reservation ? {
      totalMinor: reservation.offer.totalMinor, couponRedemptionId: reservation.id,
    } : undefined);
    const providerId = String(result.preferenceId ?? result.subscriptionId ?? '');
    if (reservation && providerId) await store.attachCoupon(reservation.id, providerId);
    return { ...result, ...(reservation ? { discountPercent: reservation.offer.percent,
      discountMinor: reservation.offer.discountMinor, totalMinor: reservation.offer.totalMinor } : {}) };
  } catch (error) {
    if (reservation) await store.releaseCoupon(reservation.id);
    // Un 4xx de Mercado Pago no es un fallo nuestro de 500: es el proveedor
    // rechazando el cobro (cuenta en otra moneda, monto por debajo del minimo,
    // token sin permiso). El detalle va al log, al cliente va un codigo.
    if (error instanceof MercadoPagoError) {
      app.log.error({ status: error.status, body: error.body, sent: error.sent, userId, mode },
        'mercadopago rejected checkout');
      return reply.code(502).send({ error: 'provider_rejected' });
    }
    throw error;
  }
});

app.post<{ Body: { data?: { id?: unknown }; type?: unknown; action?: unknown };
  Querystring: Record<string, string> }>('/v1/webhooks/mercadopago', async (request, reply) => {
  const dataId = String(request.query?.['data.id'] ?? request.body?.data?.id ?? '');
  // Mercado Pago signs the resource id, request id and timestamp, but not the
  // body `type`. Never let an unsigned field choose which provider endpoint we
  // call: numeric ids are payments; preapproval ids are UUID-like strings.
  const resourceType = /^\d+$/.test(dataId) ? 'payment' : 'subscription_preapproval';
  if (!config.mpWebhookSecret) return reply.code(501).send({ error: 'provider_not_configured' });
  if (!dataId) return reply.code(400).send({ error: 'missing_data_id' });
  const checked = verifyMercadoPagoSignature({ dataId,
    requestId: String(request.headers['x-request-id'] ?? ''),
    signature: String(request.headers['x-signature'] ?? ''), secret: config.mpWebhookSecret,
    windowSeconds: config.webhookWindowSeconds });
  if (!checked.ok) return reply.code(401).send({ error: checked.reason === 'expired' ? 'expired_signature' : 'invalid_signature' });
  const inserted = await store.recordEvent(checked.eventKey, dataId, resourceType);
  setImmediate(() => { void processOne(); });
  return reply.code(202).send({ ok: true, accepted: inserted });
});

app.get<{ Params: { userId: string } }>('/v1/subscriptions/:userId', async (request, reply) => {
  if (!authorized(request)) return reply.code(401).send({ error: 'unauthorized' });
  const userId = Number(request.params.userId);
  if (!Number.isSafeInteger(userId) || userId < 1) return reply.code(400).send({ error: 'invalid_user' });
  return { subscription: await store.subscription(userId), active: await store.entitlement(userId) };
});

app.post<{ Params: { userId: string } }>('/v1/subscriptions/:userId/cancel', async (request, reply) => {
  if (!authorized(request)) return reply.code(401).send({ error: 'unauthorized' });
  const userId = Number(request.params.userId);
  if (!Number.isSafeInteger(userId) || userId < 1) return reply.code(400).send({ error: 'invalid_user' });
  const current = await store.subscription(userId) as { provider_id?: string } | null;
  if (!current?.provider_id) return reply.code(404).send({ error: 'subscription_not_found' });
  const changed = await provider.cancelSubscription(current.provider_id);
  await store.upsertSubscription({ providerId: current.provider_id, userId,
    status: String(changed.status ?? 'cancelled'), periodEnd: null, raw: changed });
  await sendEntitlement(userId, 'mercadopago.subscription', current.provider_id, Date.now());
  return { subscription: await store.subscription(userId), active: await store.entitlement(userId) };
});

app.get('/v1/admin/payments', async (request, reply) => {
  if (!authorized(request)) return reply.code(401).send({ error: 'unauthorized' });
  return { payments: await store.listPayments() };
});

await store.migrate();
const timer = setInterval(() => { void processOne(); }, 1_000);
timer.unref();
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, async () => {
  clearInterval(timer); await app.close(); await store.close(); process.exit(0);
});

await app.listen({ host: config.host, port: config.port });
