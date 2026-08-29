import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface MercadoPagoSignatureInput {
  dataId: string;
  requestId: string;
  signature: string;
  secret: string;
  nowSeconds?: number;
  windowSeconds?: number;
}

const safeHexEqual = (left: string, right: string): boolean => {
  if (!/^[a-f\d]+$/i.test(left) || !/^[a-f\d]+$/i.test(right)) return false;
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

export function verifyMercadoPagoSignature(input: MercadoPagoSignatureInput):
  { ok: true; timestamp: number; eventKey: string } | { ok: false; reason: 'invalid' | 'expired' } {
  const parts = Object.fromEntries(input.signature.split(',').map((part) => {
    const [key, ...rest] = part.trim().split('=');
    return [key, rest.join('=')];
  }));
  const manifest = `id:${input.dataId};request-id:${input.requestId};ts:${parts.ts};`;
  const expected = createHmac('sha256', input.secret).update(manifest).digest('hex');
  if (!parts.v1 || !safeHexEqual(parts.v1, expected)) return { ok: false, reason: 'invalid' };

  const raw = Number(parts.ts);
  const timestamp = raw > 1e12 ? raw / 1000 : raw;
  const age = Math.abs((input.nowSeconds ?? Date.now() / 1000) - timestamp);
  if (!Number.isFinite(timestamp) || age > (input.windowSeconds ?? 300)) {
    return { ok: false, reason: 'expired' };
  }
  // A provider resource may change status several times. The event identity is
  // the signed delivery, not the payment id; deduping forever by payment id
  // drops approved -> refunded and pending -> approved transitions.
  const eventKey = createHash('sha256')
    .update(`${input.dataId}\0${input.requestId}\0${parts.ts}\0${parts.v1}`)
    .digest('hex');
  return { ok: true, timestamp, eventKey };
}

export function serviceAuthorized(header: unknown, secret: string): boolean {
  const got = String(header ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
