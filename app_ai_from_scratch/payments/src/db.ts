import pg from 'pg';

const { Pool } = pg;

export interface WebhookEvent {
  id: number;
  providerId: string;
  resourceType: string;
  attempts: number;
}

export interface CouponOffer {
  id: number;
  code: string;
  percent: number;
  discountCents: number;
  totalCents: number;
}

export interface CouponReservation {
  id: number;
  offer: CouponOffer;
}

const PRICE_CENTS = 999;
const normalizeCode = (value: string): string => value.trim().toUpperCase().replace(/\s+/g, '');

export class Store {
  readonly pool: pg.Pool;
  constructor(url: string) { this.pool = new Pool({ connectionString: url, max: 8 }); }

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS payment_webhook_events (
        id BIGSERIAL PRIMARY KEY,
        event_key TEXT NOT NULL UNIQUE,
        provider_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','done','dead')),
        attempts SMALLINT NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_error TEXT,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        processed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS payment_events_ready
        ON payment_webhook_events (state, next_attempt_at) WHERE state = 'pending';
      CREATE INDEX IF NOT EXISTS payment_events_reclaimable
        ON payment_webhook_events (next_attempt_at)
        WHERE state IN ('pending','processing');
      CREATE TABLE IF NOT EXISTS payments (
        provider TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        user_id BIGINT,
        status TEXT NOT NULL,
        amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        raw JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (provider, provider_id)
      );
      CREATE INDEX IF NOT EXISTS payments_user_status ON payments (user_id, status);
      CREATE TABLE IF NOT EXISTS subscriptions (
        provider TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        user_id BIGINT,
        status TEXT NOT NULL,
        current_period_end TIMESTAMPTZ,
        cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
        raw JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (provider, provider_id)
      );
      CREATE INDEX IF NOT EXISTS subscriptions_user_status ON subscriptions (user_id, status);
      CREATE TABLE IF NOT EXISTS coupons (
        id BIGSERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE CHECK (code <> ''),
        percent SMALLINT NOT NULL CHECK (percent BETWEEN 1 AND 100),
        max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
        active BOOLEAN NOT NULL DEFAULT true,
        starts_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS coupon_redemptions (
        id BIGSERIAL PRIMARY KEY,
        coupon_id BIGINT NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
        user_id BIGINT NOT NULL,
        provider_id TEXT UNIQUE,
        state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','redeemed','released')),
        reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        redeemed_at TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS coupon_user_redeemed
        ON coupon_redemptions (coupon_id, user_id) WHERE state = 'redeemed';
      CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_state
        ON coupon_redemptions (coupon_id, state);
      INSERT INTO coupons (code, percent, max_redemptions, active)
        VALUES ('ALXN-100', 100, NULL, true)
        ON CONFLICT (code) DO NOTHING;
      CREATE TABLE IF NOT EXISTS entitlement_deliveries (
        event_key TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        active BOOLEAN NOT NULL,
        delivered_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  async recordEvent(eventKey: string, providerId: string, resourceType: string): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO payment_webhook_events (event_key,provider_id,resource_type)
       VALUES ($1,$2,$3) ON CONFLICT (event_key) DO NOTHING`, [eventKey, providerId, resourceType]);
    return result.rowCount === 1;
  }

  async takeEvent(): Promise<WebhookEvent | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT id, provider_id, resource_type, attempts
           FROM payment_webhook_events
          WHERE state IN ('pending','processing') AND next_attempt_at <= now()
          ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`);
      const row = result.rows[0];
      if (!row) { await client.query('COMMIT'); return null; }
      await client.query(
        `UPDATE payment_webhook_events
            SET state='processing', attempts=attempts+1,
                next_attempt_at=now() + interval '5 minutes'
          WHERE id=$1`, [row.id]);
      await client.query('COMMIT');
      return { id: Number(row.id), providerId: String(row.provider_id),
        resourceType: String(row.resource_type), attempts: Number(row.attempts) + 1 };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async finishEvent(id: number): Promise<void> {
    await this.pool.query(
      `UPDATE payment_webhook_events SET state='done', processed_at=now(), last_error=NULL WHERE id=$1`, [id]);
  }

  async failEvent(id: number, attempts: number, error: unknown): Promise<void> {
    const dead = attempts >= 8;
    const seconds = Math.min(1800, 2 * 4 ** Math.max(0, attempts - 1));
    await this.pool.query(
      `UPDATE payment_webhook_events
          SET state=$2, last_error=$3,
              next_attempt_at=now() + ($4 * interval '1 second'),
              processed_at=CASE WHEN $2='dead' THEN now() ELSE NULL END
        WHERE id=$1`, [id, dead ? 'dead' : 'pending', String(error).slice(0, 500), seconds]);
  }

  async upsertPayment(data: { providerId: string; userId: number | null; status: string;
    amount: number; currency: string; raw: unknown }): Promise<void> {
    await this.pool.query(
      `INSERT INTO payments (provider,provider_id,user_id,status,amount,currency,raw)
       VALUES ('mercadopago',$1,$2,$3,$4,$5,$6)
       ON CONFLICT (provider,provider_id) DO UPDATE SET
         user_id=excluded.user_id,status=excluded.status,amount=excluded.amount,
         currency=excluded.currency,raw=excluded.raw,updated_at=now()`,
      [data.providerId, data.userId, data.status, data.amount, data.currency, data.raw]);
  }

  async upsertSubscription(data: { providerId: string; userId: number | null; status: string;
    periodEnd: string | null; raw: unknown }): Promise<void> {
    await this.pool.query(
      `INSERT INTO subscriptions (provider,provider_id,user_id,status,current_period_end,raw)
       VALUES ('mercadopago',$1,$2,$3,$4,$5)
       ON CONFLICT (provider,provider_id) DO UPDATE SET
         user_id=excluded.user_id,status=excluded.status,current_period_end=excluded.current_period_end,
         raw=excluded.raw,updated_at=now()`,
      [data.providerId, data.userId, data.status, data.periodEnd, data.raw]);
  }

  async reserveCoupon(code: string, userId: number): Promise<CouponReservation | null> {
    const normalized = normalizeCode(code);
    if (!normalized || normalized.length > 64) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE coupon_redemptions SET state='released'
        WHERE state='reserved' AND reserved_at < now() - interval '30 minutes'`);
      const result = await client.query(
        `SELECT id, code, percent, max_redemptions, active, starts_at, ends_at
           FROM coupons WHERE code=$1 FOR UPDATE`, [normalized]);
      const row = result.rows[0];
      const now = Date.now();
      if (!row || !row.active || (row.starts_at && new Date(row.starts_at).getTime() > now) ||
          (row.ends_at && new Date(row.ends_at).getTime() <= now)) {
        await client.query('ROLLBACK'); return null;
      }
      const prior = await client.query(
        `SELECT 1 FROM coupon_redemptions WHERE coupon_id=$1 AND user_id=$2 AND state='redeemed' LIMIT 1`,
        [row.id, userId]);
      if (prior.rowCount) { await client.query('ROLLBACK'); return null; }
      const used = await client.query(
        `SELECT COUNT(*)::int AS count FROM coupon_redemptions WHERE coupon_id=$1 AND state IN ('reserved','redeemed')`,
        [row.id]);
      if (row.max_redemptions !== null && Number(used.rows[0]?.count ?? 0) >= Number(row.max_redemptions)) {
        await client.query('ROLLBACK'); return null;
      }
      const inserted = await client.query(
        `INSERT INTO coupon_redemptions (coupon_id,user_id) VALUES ($1,$2) RETURNING id`, [row.id, userId]);
      await client.query('COMMIT');
      const discountCents = Math.floor(PRICE_CENTS * Number(row.percent) / 100);
      return { id: Number(inserted.rows[0].id), offer: {
        id: Number(row.id), code: String(row.code), percent: Number(row.percent), discountCents,
        totalCents: PRICE_CENTS - discountCents,
      } };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async attachCoupon(id: number, providerId: string): Promise<void> {
    await this.pool.query(`UPDATE coupon_redemptions SET provider_id=$2 WHERE id=$1 AND state='reserved'`, [id, providerId]);
  }

  async redeemCoupon(providerId: string): Promise<void> {
    await this.pool.query(`UPDATE coupon_redemptions SET state='redeemed', redeemed_at=now()
      WHERE provider_id=$1 AND state='reserved'`, [providerId]);
  }

  async redeemCouponReservation(id: number, providerId: string): Promise<void> {
    await this.pool.query(`UPDATE coupon_redemptions SET state='redeemed', provider_id=$2, redeemed_at=now()
      WHERE id=$1 AND state='reserved'`, [id, providerId]);
  }

  async releaseCoupon(id: number): Promise<void> {
    await this.pool.query(`UPDATE coupon_redemptions SET state='released' WHERE id=$1 AND state='reserved'`, [id]);
  }

  async entitlement(userId: number): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM payments WHERE user_id=$1 AND status='approved'
         UNION ALL
         SELECT 1 FROM subscriptions WHERE user_id=$1 AND status='authorized'
           AND (current_period_end IS NULL OR current_period_end > now())
       ) AS active`, [userId]);
    return Boolean(result.rows[0]?.active);
  }

  async markDelivered(key: string, userId: number, active: boolean): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO entitlement_deliveries (event_key,user_id,active) VALUES ($1,$2,$3)
       ON CONFLICT (event_key) DO NOTHING`, [key, userId, active]);
    return result.rowCount === 1;
  }

  async listPayments(limit = 100): Promise<unknown[]> {
    return (await this.pool.query(
      `SELECT provider,provider_id,user_id,status,amount,currency,updated_at
         FROM payments ORDER BY updated_at DESC LIMIT $1`, [Math.min(500, Math.max(1, limit))])).rows;
  }

  async subscription(userId: number): Promise<unknown | null> {
    return (await this.pool.query(
      `SELECT provider,provider_id,status,current_period_end,cancel_at_period_end,updated_at
         FROM subscriptions WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1`, [userId])).rows[0] ?? null;
  }

  async close(): Promise<void> { await this.pool.end(); }
}
