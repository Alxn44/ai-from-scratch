import assert from 'node:assert/strict';
import test from 'node:test';
import { actorId, serviceAuthorized } from '../src/security.ts';
import { documentOf } from '../src/store.ts';

test('accepts a bearer secret of matching length', () => {
  const secret = 'x'.repeat(32);
  assert.equal(serviceAuthorized(`Bearer ${secret}`, secret), true);
});

test('rejects a shorter or longer secret without throwing', () => {
  const secret = 'x'.repeat(32);
  assert.equal(serviceAuthorized('Bearer short', secret), false);
  assert.equal(serviceAuthorized(`Bearer ${secret}y`, secret), false);
  assert.equal(serviceAuthorized(undefined, secret), false);
});

test('actorId refuses zero, negatives and non-integers', () => {
  assert.equal(actorId(12), 12);
  assert.equal(actorId('12'), 12);
  assert.equal(actorId(0), null);
  assert.equal(actorId(-1), null);
  assert.equal(actorId(1.5), null);
  assert.equal(actorId('nope'), null);
});

test('documentOf refuses a body with no userId', () => {
  assert.throws(() => documentOf({ kind: 'turn', role: 'user', content: 'hola' }),
    /document_missing_user/);
});

test('documentOf refuses an empty turn', () => {
  assert.throws(() => documentOf({ kind: 'turn', userId: 1, role: 'user', content: '   ' }),
    /document_empty_content/);
});

test('documentOf builds a scoped turn', () => {
  const doc = documentOf({
    kind: 'turn', userId: 7, threadId: 't1', role: 'assistant',
    content: 'listo', source: 'chat', lang: 'es', provider: 'anthropic',
  });
  assert.equal(doc.kind, 'turn');
  if (doc.kind !== 'turn') throw new Error('expected turn');
  assert.equal(doc.userId, 7);
  assert.equal(doc.role, 'assistant');
  assert.equal(doc.provider, 'anthropic');
});

test('documentOf truncates content to 4000', () => {
  const doc = documentOf({
    kind: 'turn', userId: 1, role: 'user', content: 'a'.repeat(5000),
  });
  if (doc.kind !== 'turn') throw new Error('expected turn');
  assert.equal(doc.content.length, 4000);
});
