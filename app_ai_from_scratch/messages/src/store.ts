import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

const MAX_CONTENT = 4000;
const MAX_TURNS = 500;
const SOURCES = new Set(['chat', 'panel']);
const ROLES = new Set(['user', 'assistant']);
const KINDS = new Set(['thread', 'turn']);

export type Source = 'chat' | 'panel';
export type Role = 'user' | 'assistant';

export interface TurnDoc {
  kind: 'turn';
  userId: number;
  threadId: string;
  role: Role;
  content: string;
  lang: string;
  source: Source;
  provider?: string;
  model?: string;
  trace?: unknown;
  at: string;
}

export interface ThreadDoc {
  kind: 'thread';
  userId: number;
  threadId: string;
  source: Source;
  lang: string;
  startedAt: string;
}

export interface Stored {
  id: string;
  createdAt: string;
  body: TurnDoc | ThreadDoc;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

/** Build a document the CHECK constraints will accept, or throw. */
export function documentOf(input: Record<string, unknown>): TurnDoc | ThreadDoc {
  const userId = Number(input.userId);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new Error('document_missing_user');
  }
  const kind = String(input.kind ?? '');
  if (!KINDS.has(kind)) throw new Error('document_bad_kind');
  const source = SOURCES.has(String(input.source)) ? String(input.source) as Source : 'chat';
  const lang = text(input.lang, 8) || 'es';
  const threadId = text(input.threadId, 64) || randomUUID();
  if (kind === 'thread') {
    return {
      kind: 'thread', userId, threadId, source, lang,
      startedAt: text(input.startedAt, 40) || new Date().toISOString(),
    };
  }
  const role = String(input.role ?? '');
  if (!ROLES.has(role)) throw new Error('document_bad_role');
  const content = text(input.content, MAX_CONTENT);
  if (!content) throw new Error('document_empty_content');
  const doc: TurnDoc = {
    kind: 'turn', userId, threadId, role: role as Role, content, lang, source,
    at: text(input.at, 40) || new Date().toISOString(),
  };
  if (typeof input.provider === 'string' && input.provider.trim()) {
    doc.provider = text(input.provider, 64);
  }
  if (typeof input.model === 'string' && input.model.trim()) {
    doc.model = text(input.model, 80);
  }
  if (input.trace !== undefined) doc.trace = input.trace;
  return doc;
}

export class Store {
  readonly pool: pg.Pool;
  constructor(url: string) { this.pool = new Pool({ connectionString: url, max: 8 }); }

  async migrate(): Promise<void> {
    // One table. The document is JSONB. No person tables, no foreign keys.
    // The CHECKs refuse a row that cannot be scoped to one user: that row
    // would be un-returnable, which is how other people's chats leak.
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS docs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        body JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT docs_body_object CHECK (jsonb_typeof(body) = 'object'),
        CONSTRAINT docs_has_user CHECK ((body->>'userId') ~ '^[1-9][0-9]*$'),
        CONSTRAINT docs_has_kind CHECK (body->>'kind' IN ('thread', 'turn'))
      );
      CREATE INDEX IF NOT EXISTS docs_user_created
        ON docs ((body->>'userId'), created_at DESC);
      CREATE INDEX IF NOT EXISTS docs_thread_created
        ON docs ((body->>'threadId'), created_at ASC)
        WHERE body->>'kind' = 'turn';
      CREATE UNIQUE INDEX IF NOT EXISTS docs_one_thread
        ON docs ((body->>'userId'), (body->>'source'))
        WHERE body->>'kind' = 'thread';
      CREATE INDEX IF NOT EXISTS docs_gin ON docs USING GIN (body jsonb_path_ops);
    `);
  }

  async insert(doc: TurnDoc | ThreadDoc): Promise<Stored> {
    const result = await this.pool.query(
      `INSERT INTO docs (body) VALUES ($1::jsonb)
       RETURNING id::text AS id, created_at, body`,
      [JSON.stringify(doc)]);
    const row = result.rows[0] as { id: string; created_at: Date; body: TurnDoc | ThreadDoc };
    return { id: row.id, createdAt: row.created_at.toISOString(), body: row.body };
  }

  async threadFor(userId: number, source: Source, lang: string): Promise<ThreadDoc> {
    const found = await this.pool.query(
      `SELECT body FROM docs
        WHERE body->>'kind' = 'thread'
          AND body->>'userId' = $1
          AND body->>'source' = $2
        LIMIT 1`,
      [String(userId), source]);
    const existing = asObject(found.rows[0]?.body);
    if (existing) return documentOf(existing) as ThreadDoc;
    try {
      const created = await this.insert(documentOf({
        kind: 'thread', userId, source, lang, threadId: randomUUID(),
      }) as ThreadDoc);
      return created.body as ThreadDoc;
    } catch (err) {
      // Unique race: another turn created the thread first.
      const again = await this.pool.query(
        `SELECT body FROM docs
          WHERE body->>'kind' = 'thread'
            AND body->>'userId' = $1
            AND body->>'source' = $2
          LIMIT 1`,
        [String(userId), source]);
      const body = asObject(again.rows[0]?.body);
      if (body) return documentOf(body) as ThreadDoc;
      throw err;
    }
  }

  async appendTurn(userId: number, input: Record<string, unknown>): Promise<Stored> {
    const source = SOURCES.has(String(input.source)) ? String(input.source) as Source : 'chat';
    const lang = text(input.lang, 8) || 'es';
    const thread = await this.threadFor(userId, source, lang);
    const doc = documentOf({
      ...input,
      kind: 'turn',
      userId,
      threadId: thread.threadId,
      source,
      lang,
    });
    return this.insert(doc);
  }

  async turns(userId: number, source: Source, limit = MAX_TURNS): Promise<{ threadId: string; turns: Stored[] }> {
    const thread = await this.pool.query(
      `SELECT body FROM docs
        WHERE body->>'kind' = 'thread'
          AND body->>'userId' = $1
          AND body->>'source' = $2
        LIMIT 1`,
      [String(userId), source]);
    const body = asObject(thread.rows[0]?.body);
    if (!body) return { threadId: '', turns: [] };
    const threadId = String(body.threadId ?? '');
    const cap = Math.min(MAX_TURNS, Math.max(1, limit));
    const rows = await this.pool.query(
      `SELECT id::text AS id, created_at, body FROM docs
        WHERE body->>'kind' = 'turn'
          AND body->>'userId' = $1
          AND body->>'threadId' = $2
        ORDER BY created_at ASC, id ASC
        LIMIT $3`,
      [String(userId), threadId, cap]);
    return {
      threadId,
      turns: rows.rows.map((row: { id: string; created_at: Date; body: TurnDoc }) => ({
        id: row.id, createdAt: row.created_at.toISOString(), body: row.body,
      })),
    };
  }

  async close(): Promise<void> { await this.pool.end(); }
}
