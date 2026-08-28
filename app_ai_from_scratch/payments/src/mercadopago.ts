import type { Config } from './config.ts';
import { CURRENCY, PRICE_MINOR, providerAmount } from './price.ts';

export interface CheckoutActor { userId: number; email: string }
export interface CheckoutOffer { totalMinor: number; couponRedemptionId?: number }
export type CheckoutMode = 'one_time' | 'subscription';

/**
 * Un rechazo de Mercado Pago, con su codigo y su cuerpo separados del mensaje.
 *
 * Antes esto era un `Error` con todo concatenado, la ruta lo relanzaba y
 * Fastify lo servia como 500 con el texto del proveedor dentro: el navegador
 * recibia literalmente `mercadopago 400: {"message":"Cannot pay an amount lower
 * than $ 1600.00"}`. Ni el codigo era nuestro ni ese detalle es del publico.
 */
export class MercadoPagoError extends Error {
  readonly status: number;
  readonly body: string;
  /** Lo que enviamos, para que el rechazo se pueda diagnosticar sin adivinar. */
  readonly sent: string;
  constructor(status: number, body: string, sent = '') {
    super(`mercadopago ${status}`);
    this.name = 'MercadoPagoError';
    this.status = status;
    this.body = body;
    this.sent = sent;
  }
}

export class MercadoPago {
  // Campo explicito, no parameter property. `node --experimental-strip-types`
  // (el propio script `dev` de este servicio) no compila `constructor(private
  // readonly config: Config)`: aborta con ERR_INVALID_TYPESCRIPT_SYNTAX y el
  // servicio no arranca, asi que el checkout entero quedaba muerto.
  private readonly config: Config;
  constructor(config: Config) { this.config = config; }

  private async request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    if (!this.config.mpAccessToken) throw new Error('MP_ACCESS_TOKEN is not configured');
    const response = await fetch(`https://api.mercadopago.com${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.config.mpAccessToken}`,
        'content-type': 'application/json', ...init.headers },
    });
    if (!response.ok) {
      throw new MercadoPagoError(response.status, (await response.text()).slice(0, 400),
        typeof init.body === 'string' ? init.body.slice(0, 600) : '');
    }
    return await response.json() as Record<string, unknown>;
  }

  async checkout(actor: CheckoutActor, mode: CheckoutMode, offer?: CheckoutOffer): Promise<Record<string, unknown>> {
    const webhook = this.config.publicOrigin.startsWith('https://')
      ? { notification_url: `${this.config.publicOrigin}/api/payments/mercadopago/webhook?source_news=webhooks` }
      : {};
    if (mode === 'subscription') {
      const result = await this.request('/preapproval', { method: 'POST', body: JSON.stringify({
        reason: 'IA desde cero · membresía mensual', external_reference: String(actor.userId),
        payer_email: actor.email,
        back_url: `${this.config.publicOrigin}/pago/gracias`,
        // El importe y la moneda salen de price.ts. Con USD 9.99 este endpoint
        // respondia 400 «Cannot pay an amount lower than $ 1600.00»: MP Colombia
        // tasa el preapproval contra el minimo en COP y no honra el USD, aunque
        // /checkout/preferences si lo acepte. Medido contra la cuenta real.
        auto_recurring: { frequency: 1, frequency_type: 'months',
          transaction_amount: providerAmount(PRICE_MINOR), currency_id: CURRENCY },
        status: 'pending',
        ...webhook,
      }) });
      return { mode, subscriptionId: result.id ?? null, initPoint: result.init_point ?? null };
    }
    const result = await this.request('/checkout/preferences', { method: 'POST', body: JSON.stringify({
      items: [{ title: 'IA desde cero · Fundamentos Vol. 1', quantity: 1,
        unit_price: providerAmount(offer?.totalMinor ?? PRICE_MINOR), currency_id: CURRENCY }],
      payer: { email: actor.email }, metadata: { user_id: actor.userId,
        ...(offer?.couponRedemptionId ? { coupon_redemption_id: offer.couponRedemptionId } : {}) },
      external_reference: String(actor.userId),
      back_urls: { success: `${this.config.publicOrigin}/pago/gracias`,
        pending: `${this.config.publicOrigin}/pago/gracias?estado=pendiente`,
        failure: `${this.config.publicOrigin}/pago/error` },
      ...(this.config.publicOrigin.startsWith('https://') ? { auto_return: 'approved' } : {}),
      ...webhook,
    }) });
    return { mode, preferenceId: result.id ?? null, initPoint: result.init_point ?? null,
      sandboxInitPoint: result.sandbox_init_point ?? null, publicKey: this.config.mpPublicKey };
  }

  payment(id: string): Promise<Record<string, unknown>> { return this.request(`/v1/payments/${encodeURIComponent(id)}`); }
  subscription(id: string): Promise<Record<string, unknown>> { return this.request(`/preapproval/${encodeURIComponent(id)}`); }
  cancelSubscription(id: string): Promise<Record<string, unknown>> {
    return this.request(`/preapproval/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
  }
}
