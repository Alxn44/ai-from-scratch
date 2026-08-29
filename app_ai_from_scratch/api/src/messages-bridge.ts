// Bridge to the messages document store.
//
// AI turns do not live in the course database. That database is the ontology
// surface (P1–P4); mixing chat logs into it would put other people's words
// one SELECT away from a tool. The store is its own Postgres, JSONB-only,
// and the person identifier is injected HERE from the session cookie.

export type ChatSource = 'chat' | 'panel';

export interface StoredTurn {
  id: string;
  createdAt: string;
  role: string;
  content: string;
  lang?: string;
  provider?: string;
  model?: string;
  at?: string;
}

const env = (k: string): string | null => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : null;
};

export const MESSAGES_URL = (env('MESSAGES_URL') ?? '').replace(/\/+$/, '');
export const MESSAGES_SECRET = env('MESSAGES_SECRET');

const headers = (): Record<string, string> => ({
  authorization: `Bearer ${MESSAGES_SECRET ?? ''}`,
  'content-type': 'application/json',
});

function loud(msg: string, extra?: unknown): void {
  console.error(`[messages] ${msg}`, extra ?? '');
}

export async function rememberTurn(input: {
  userId: number;
  source: ChatSource;
  lang: string;
  user?: { content: string };
  assistant?: { content: string; provider?: string; model?: string; trace?: unknown };
}): Promise<void> {
  if (!MESSAGES_URL || !MESSAGES_SECRET) {
    loud('MESSAGES_URL or MESSAGES_SECRET missing: the turn was not stored');
    return;
  }
  const write = async (body: Record<string, unknown>): Promise<void> => {
    const res = await fetch(`${MESSAGES_URL}/v1/turns`, {
      method: 'POST', headers: headers(), body: JSON.stringify(body),
    });
    if (!res.ok) {
      loud(`store answered ${res.status}`, (await res.text()).slice(0, 200));
    }
  };
  try {
    if (input.user?.content) {
      await write({
        userId: input.userId, source: input.source, lang: input.lang,
        role: 'user', content: input.user.content,
      });
    }
    if (input.assistant?.content) {
      await write({
        userId: input.userId, source: input.source, lang: input.lang,
        role: 'assistant', content: input.assistant.content,
        provider: input.assistant.provider, model: input.assistant.model,
        trace: input.assistant.trace,
      });
    }
  } catch (err) {
    loud('store unreachable', err instanceof Error ? err.message : err);
  }
}

export async function loadTurns(userId: number, source: ChatSource, limit = 200):
    Promise<{ threadId: string; turns: StoredTurn[] } | { error: string }> {
  if (!MESSAGES_URL || !MESSAGES_SECRET) {
    return { error: 'messages_unavailable' };
  }
  try {
    const q = new URLSearchParams({ userId: String(userId), source, limit: String(limit) });
    const res = await fetch(`${MESSAGES_URL}/v1/turns?${q}`, { headers: headers() });
    if (!res.ok) return { error: `messages_${res.status}` };
    const raw: unknown = await res.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { error: 'messages_bad_body' };
    }
    const data = raw as { threadId?: unknown; turns?: unknown };
    const turns = Array.isArray(data.turns) ? data.turns : [];
    return {
      threadId: typeof data.threadId === 'string' ? data.threadId : '',
      turns: turns.flatMap((t) => {
        if (!t || typeof t !== 'object') return [];
        const row = t as { id?: unknown; createdAt?: unknown; body?: Record<string, unknown> };
        const body = row.body ?? {};
        const content = typeof body.content === 'string' ? body.content : '';
        const role = body.role === 'assistant' ? 'assistant' : 'user';
        if (!content) return [];
        return [{
          id: String(row.id ?? ''),
          createdAt: String(row.createdAt ?? ''),
          role, content,
          lang: typeof body.lang === 'string' ? body.lang : undefined,
          provider: typeof body.provider === 'string' ? body.provider : undefined,
          model: typeof body.model === 'string' ? body.model : undefined,
          at: typeof body.at === 'string' ? body.at : undefined,
        }];
      }),
    };
  } catch (err) {
    loud('store unreachable on read', err instanceof Error ? err.message : err);
    return { error: 'messages_unreachable' };
  }
}
