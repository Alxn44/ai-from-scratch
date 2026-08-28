import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { serviceAuthorized, verifyMercadoPagoSignature } from '../src/security.ts';

test('accepts a current Mercado Pago signature and creates delivery identity', () => {
  const secret = 'x'.repeat(32);
  const ts = 1_800_000_000;
  const manifest = `id:pay-7;request-id:req-9;ts:${ts};`;
  const signature = `ts=${ts},v1=${createHmac('sha256', secret).update(manifest).digest('hex')}`;
  const result = verifyMercadoPagoSignature({ dataId: 'pay-7', requestId: 'req-9', signature, secret,
    nowSeconds: ts, windowSeconds: 300 });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.eventKey.length, 64);
});

test('rejects replay outside the signed time window', () => {
  const secret = 'x'.repeat(32);
  const ts = 1_800_000_000;
  const manifest = `id:pay-7;request-id:req-9;ts:${ts};`;
  const signature = `ts=${ts},v1=${createHmac('sha256', secret).update(manifest).digest('hex')}`;
  assert.deepEqual(verifyMercadoPagoSignature({ dataId: 'pay-7', requestId: 'req-9', signature, secret,
    nowSeconds: ts + 301, windowSeconds: 300 }), { ok: false, reason: 'expired' });
});

test('does not collapse two provider deliveries for the same payment', () => {
  const secret = 'x'.repeat(32);
  const ts = 1_800_000_000;
  const sign = (requestId: string) => {
    const manifest = `id:pay-7;request-id:${requestId};ts:${ts};`;
    const signature = `ts=${ts},v1=${createHmac('sha256', secret).update(manifest).digest('hex')}`;
    return verifyMercadoPagoSignature({ dataId: 'pay-7', requestId, signature, secret,
      nowSeconds: ts, windowSeconds: 300 });
  };
  const pending = sign('delivery-pending');
  const approved = sign('delivery-approved');
  assert.equal(pending.ok, true);
  assert.equal(approved.ok, true);
  if (pending.ok && approved.ok) assert.notEqual(pending.eventKey, approved.eventKey);
});

test('service authentication is constant-time shaped and fail closed', () => {
  const secret = 'a'.repeat(32);
  assert.equal(serviceAuthorized(`Bearer ${secret}`, secret), true);
  assert.equal(serviceAuthorized('Bearer wrong', secret), false);
  assert.equal(serviceAuthorized(undefined, secret), false);
});
