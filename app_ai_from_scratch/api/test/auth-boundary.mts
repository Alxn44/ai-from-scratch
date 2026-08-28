import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAuth } from '../../auth/src/index.ts';
import { get, run, pool } from '../src/db.ts';
import { many, one, write, writeAuthorized } from '../src/data.ts';

const log = { info: () => {}, warn: () => {} };
const auth = createAuth({ one, many, write, writeAuthorized,
  origin: 'http://localhost', production: false, log });
const email = `auth-boundary-${randomUUID()}@example.test`;
const user = await get<{ id: number; token_version: number }>(
  `INSERT INTO users (email,name,pass_hash,role,paid,lang,theme)
   VALUES (?,?,?,'student',0,'auto','auto') RETURNING id,token_version`,
  [email, 'Boundary', 'test-only-not-a-password-hash']);
assert.ok(user);

try {
  const first = await auth.applyEntitlement({ eventKey: `grant:${user.id}`, userId: user.id,
    active: true, source: 'test.subscription', externalId: 'sub-1', occurredAt: new Date().toISOString() });
  assert.deepEqual(first, { accepted: true, active: true });

  const duplicate = await auth.applyEntitlement({ eventKey: `grant:${user.id}`, userId: user.id,
    active: true, source: 'test.subscription', externalId: 'sub-1', occurredAt: new Date().toISOString() });
  assert.deepEqual(duplicate, { accepted: false, active: true });

  const revoke = await auth.applyEntitlement({ eventKey: `revoke:${user.id}`, userId: user.id,
    active: false, source: 'test.subscription', externalId: 'sub-1',
    occurredAt: new Date(Date.now() + 1_000).toISOString() });
  assert.deepEqual(revoke, { accepted: true, active: false });

  const throttle = await auth.applyDefenseAction({ kind: 'throttle_identity', target: String(user.id),
    ttlSeconds: 120, why: 'integration test' });
  assert.equal(throttle.applied, true);
  assert.ok(await get('SELECT user_id FROM auth_throttles WHERE user_id = ? AND expires_at > now()', [user.id]));

  const revokeSession = await auth.applyDefenseAction({ kind: 'revoke_session', target: String(user.id),
    ttlSeconds: 120 });
  assert.equal(revokeSession.applied, true);
  const after = await get<{ token_version: number }>('SELECT token_version FROM users WHERE id = ?', [user.id]);
  assert.equal(after?.token_version, user.token_version + 1);

  assert.deepEqual(await auth.applyDefenseAction({ kind: 'review_subscription', target: String(user.id),
    ttlSeconds: 120 }), { applied: false });
  console.log('auth boundary: entitlement idempotency and defense controls ok');
} finally {
  await run('DELETE FROM users WHERE id = ?', [user.id]);
  await pool.end();
}
