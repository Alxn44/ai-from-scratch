import Fastify from 'fastify';
import { loadConfig } from './config.ts';
import { actorId, serviceAuthorized } from './security.ts';
import { Store, type Source } from './store.ts';

const config = loadConfig();
const store = new Store(config.databaseUrl);
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

const authorized = (request: { headers: Record<string, unknown> }): boolean =>
  serviceAuthorized(request.headers.authorization, config.serviceSecret);

app.get('/health', async () => ({ ok: true, compiler: 'tsgo', service: 'messages' }));

app.post<{ Body: Record<string, unknown> }>('/v1/turns', async (request, reply) => {
  if (!authorized(request)) return reply.code(401).send({ error: 'unauthorized' });
  const userId = actorId(request.body?.userId);
  if (!userId) return reply.code(400).send({ error: 'invalid_actor' });
  try {
    const stored = await store.appendTurn(userId, request.body ?? {});
    return { id: stored.id, createdAt: stored.createdAt, body: stored.body };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'insert_failed';
    if (msg.startsWith('document_')) return reply.code(400).send({ error: msg });
    throw err;
  }
});

app.get<{ Querystring: { userId?: string; source?: string; limit?: string } }>(
  '/v1/turns', async (request, reply) => {
    if (!authorized(request)) return reply.code(401).send({ error: 'unauthorized' });
    const userId = actorId(request.query?.userId);
    if (!userId) return reply.code(400).send({ error: 'invalid_actor' });
    const source: Source = request.query?.source === 'panel' ? 'panel' : 'chat';
    const limit = Number(request.query?.limit ?? 500);
    return store.turns(userId, source, Number.isFinite(limit) ? limit : 500);
  });

await store.migrate();
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, async () => {
  await app.close(); await store.close(); process.exit(0);
});
await app.listen({ host: config.host, port: config.port });
