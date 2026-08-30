import { createHash } from 'node:crypto';
import { COOKIE, ROLES, TOKEN_MINUTES, cookieOpts, hashPassword, hashToken, mandaPlataforma,
  newToken, satisface, sign, spendKdf, verify, verifyPassword } from './core.ts';

export * from './core.ts';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  pass_hash: string;
  role: string;
  lang: string;
  theme: string;
  paid: number;
  cohort: string | null;
  created_at: string;
  failed: number;
  locked_until: string | null;
  deleted_at: string | null;
  token_version: number;
}

export interface AuthDependencies {
  one<T>(operation: string, args?: Record<string, unknown>, actor?: number): Promise<T | null>;
  many<T>(operation: string, args?: Record<string, unknown>, actor?: number): Promise<T[]>;
  write(operation: string, args?: Record<string, unknown>, actor?: number): Promise<number>;
  writeAuthorized(operation: string, args: Record<string, unknown>, actor: number, authority: number): Promise<number>;
  origin: string;
  production: boolean;
  log: { info(...args: unknown[]): void; warn(...args: unknown[]): void };
  signal?: (name: string, payload: Record<string, unknown>) => Promise<void> | void;
}

export interface RequestLike { cookies?: Record<string, string>; headers?: Record<string, unknown>; body?: any }
export interface ReplyLike {
  code(status: number): ReplyLike;
  send(value: unknown): unknown;
  setCookie(name: string, value: string, options: unknown): void;
  clearCookie(name: string, options: unknown): void;
}

export const LANGS: readonly string[] = ['es', 'en', 'fr', 'pt', 'auto'];
export const THEMES: readonly string[] = ['dark', 'paper', 'auto'];
const LOGIN_NO = { error: 'credenciales' };
const MAX_FAILED = 5;
const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;
const isLocked = (user: AuthUser | null | undefined): boolean =>
  Boolean(user?.locked_until && Date.parse(user.locked_until) > Date.now());
const pref = (value: unknown, allowed: readonly string[]): string =>
  typeof value === 'string' && allowed.includes(value) ? value : 'auto';
const subject = (email: unknown): string =>
  `account:${createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 20)}`;

export const shapeUser = (user: AuthUser) => ({
  id: user.id, email: user.email, name: user.name, role: user.role,
  lang: user.lang, theme: user.theme, paid: Boolean(user.paid), cohort: user.cohort,
});

export function createAuth(deps: AuthDependencies) {
  const emit = async (name: string, payload: Record<string, unknown>): Promise<void> => {
    try { await deps.signal?.(name, payload); }
    catch (error) { deps.log.warn({ error, signal: name }, 'auth signal was not published'); }
  };

  async function resolveSession(token: unknown): Promise<AuthUser | null> {
    const claims = verify(token);
    if (!claims?.sub) return null;
    const user = await deps.one<AuthUser>('auth.user', {}, claims.sub);
    return user && (claims.v ?? 0) === user.token_version ? user : null;
  }

  const currentUser = (request: RequestLike): Promise<AuthUser | null> => {
    const bearer = String(request.headers?.['x-user-session'] ?? '').replace(/^Bearer\s+/i, '');
    return resolveSession(request.cookies?.[COOKIE] ?? bearer);
  };

  async function requireUser(request: RequestLike, reply: ReplyLike): Promise<AuthUser | null> {
    const user = await currentUser(request);
    if (!user) { reply.code(401).send({ error: 'no_session' }); return null; }
    const throttle = await deps.one<{ expires_at: string }>('auth.throttle', {}, user.id);
    if (throttle) {
      const retryAfter = Math.max(1, Math.ceil((Date.parse(throttle.expires_at) - Date.now()) / 1000));
      reply.code(429).send({ error: 'identity_throttled', retryAfter });
      return null;
    }
    return user;
  }

  async function requireRole(request: RequestLike, reply: ReplyLike,
    roles: readonly string[]): Promise<AuthUser | null> {
    const user = await requireUser(request, reply);
    if (!user) return null;
    // satisface, no includes: root cumple cualquier exigencia sin que las
    // veintitres llamadas tengan que nombrarlo. Ver CONTIENE en core.ts.
    if (!satisface(user.role, roles)) { reply.code(403).send({ error: 'forbidden', need: roles }); return null; }
    return user;
  }

  function registerRoutes(app: any): void {
    app.post('/api/auth/login', async (request: RequestLike, reply: ReplyLike) => {
      const { email, password, lang, theme } = request.body ?? {};
      if (!email || !password) return reply.code(400).send({ error: 'faltan_datos' });
      const plain = String(password);
      const user = await deps.one<AuthUser>('auth.user_by_email', { login: String(email).toLowerCase() });
      const ok = user ? await verifyPassword(plain, user.pass_hash) : await spendKdf(plain);
      if (!ok) {
        if (user && !isLocked(user)) {
          const failed = user.failed + 1;
          await deps.write('auth.login_failure', { failed, locked: failed >= MAX_FAILED }, user.id);
        }
        await emit('auth.login_failed', { subject: subject(email), target: user ? String(user.id) : undefined,
          accountKnown: Boolean(user) });
        return reply.code(401).send(LOGIN_NO);
      }
      if (isLocked(user)) {
        await emit('auth.login_locked', { subject: subject(email), target: String(user!.id) });
        return reply.code(423).send({ error: 'bloqueada', until: user!.locked_until });
      }
      await deps.write('auth.login_clear', {}, user!.id);
      if (user!.lang === 'auto' && typeof lang === 'string' && LANGS.includes(lang as any) && lang !== 'auto') {
        await deps.write('auth.set_language', { lang }, user!.id);
      }
      if (user!.theme === 'auto' && typeof theme === 'string' && THEMES.includes(theme as any) && theme !== 'auto') {
        await deps.write('auth.set_theme', { theme }, user!.id);
      }
      reply.setCookie(COOKIE, sign({ sub: user!.id, role: user!.role, v: user!.token_version }), cookieOpts);
      const fresh = await deps.one<AuthUser>('auth.user', {}, user!.id);
      await emit('auth.login_succeeded', { subject: String(user!.id), target: String(user!.id) });
      return { user: shapeUser(fresh!) };
    });

    app.post('/api/auth/logout', async (_request: RequestLike, reply: ReplyLike) => {
      reply.clearCookie(COOKIE, { path: '/' });
      return { ok: true };
    });

    app.post('/api/auth/register', async (request: RequestLike, reply: ReplyLike) => {
      const { email, name, password, lang, theme } = request.body ?? {};
      const mail = String(email ?? '').trim().toLowerCase();
      if (!EMAIL_RE.test(mail)) return reply.code(400).send({ error: 'correo_invalido' });
      if (String(name ?? '').trim().length < 2) return reply.code(400).send({ error: 'nombre_corto' });
      if (String(password ?? '').length < 8) return reply.code(400).send({ error: 'clave_corta', msg: 'Mínimo 8 caracteres.' });
      if (await deps.one<AuthUser>('auth.user_by_email', { login: mail })) {
        return reply.code(409).send({ error: 'correo_en_uso' });
      }
      const user = await deps.one<AuthUser>('auth.register', {
        login: mail, name: String(name).trim(), password: await hashPassword(String(password)),
        lang: pref(lang, LANGS), theme: pref(theme, THEMES),
      });
      reply.setCookie(COOKIE, sign({ sub: user!.id, role: user!.role, v: user!.token_version }), cookieOpts);
      await emit('auth.account_registered', { subject: String(user!.id), target: String(user!.id) });
      return reply.code(201).send({ user: shapeUser(user!) });
    });

    app.post('/api/auth/recover', async (request: RequestLike, reply: ReplyLike) => {
      const mail = String(request.body?.email ?? '').trim().toLowerCase();
      const answer = { ok: true, msg: 'Si ese correo tiene cuenta, el enlace ya salió.' };
      if (!EMAIL_RE.test(mail)) return reply.code(400).send({ error: 'correo_invalido' });
      const user = await deps.one<Pick<AuthUser, 'id' | 'name'>>(
        'auth.recovery_by_email', { login: mail });
      if (!user) return answer;
      const rate = await deps.one<{ c: number }>('auth.reset_rate', {}, user.id);
      if ((rate?.c ?? 0) >= 3) {
        deps.log.warn({ userId: user.id }, 'recover: hourly limit reached');
        await emit('auth.recovery_rate_limited', { subject: String(user.id), target: String(user.id) });
        return answer;
      }
      const token = newToken();
      await deps.write('auth.reset_create', { token: hashToken(token), minutes: TOKEN_MINUTES }, user.id);
      const link = `${deps.origin}/recuperar?t=${token}`;
      deps.log.info({ link }, 'recover: link generated (no mail provider configured)');
      return deps.production ? answer : { ...answer, dev_enlace: link };
    });

    app.post('/api/auth/reset', async (request: RequestLike, reply: ReplyLike) => {
      const { token, password } = request.body ?? {};
      if (String(password ?? '').length < 8) {
        return reply.code(400).send({ error: 'clave_corta', msg: 'Mínimo 8 caracteres.' });
      }
      const row = await deps.one<{ id: number; user_id: number; used_at: string | null; expired: boolean }>(
        'auth.reset_lookup', { token: hashToken(String(token ?? '')) });
      if (!row) return reply.code(400).send({ error: 'enlace_invalido', msg: 'Ese enlace no sirve. Pide uno nuevo.' });
      if (row.used_at) return reply.code(409).send({ error: 'enlace_usado', msg: 'Ese enlace ya se usó. Pide uno nuevo.' });
      if (row.expired) return reply.code(410).send({ error: 'enlace_vencido', msg: `El enlace dura ${TOKEN_MINUTES} minutos. Pide uno nuevo.` });
      const user = await deps.one<AuthUser>(
        'auth.password_reset', { password: await hashPassword(String(password)) }, row.user_id);
      await deps.write('auth.reset_mark_used', { token: row.id });
      await deps.write('auth.reset_invalidate', {}, row.user_id);
      reply.setCookie(COOKIE, sign({ sub: user!.id, role: user!.role, v: user!.token_version }), cookieOpts);
      await emit('auth.password_reset', { subject: String(user!.id), target: String(user!.id) });
      return { user: shapeUser(user!), sesionesCerradas: true };
    });

    app.post('/api/account/delete', async (request: RequestLike, reply: ReplyLike) => {
      const user = await requireUser(request, reply); if (!user) return;
      if (!await verifyPassword(String(request.body?.password ?? ''), user.pass_hash)) {
        return reply.code(401).send({ error: 'clave_incorrecta', msg: 'Confirma con tu contraseña actual.' });
      }
      if (mandaPlataforma(user.role)) {
        const admins = await deps.one<{ c: number }>('auth.admin_count');
        if ((admins?.c ?? 0) <= 1) return reply.code(409).send({ error: 'ultimo_admin', msg: 'No puedes dejar la plataforma sin admins.' });
      }
      await deps.write('auth.account_delete', { replacement: `borrado+${user.id}@alpadev.local` }, user.id);
      await deps.write('ranking.delete', {}, user.id);
      reply.clearCookie(COOKIE, { path: '/' });
      await emit('auth.account_deleted', { subject: String(user.id), target: String(user.id) });
      return { ok: true, deleted: user.id };
    });

    app.get('/api/me', async (request: RequestLike, reply: ReplyLike) => {
      const user = await requireUser(request, reply); if (!user) return;
      return { user: shapeUser(user) };
    });

    app.patch('/api/settings', async (request: RequestLike, reply: ReplyLike) => {
      const user = await requireUser(request, reply); if (!user) return;
      const { lang, theme } = request.body ?? {};
      if (lang && (typeof lang !== 'string' || !LANGS.includes(lang as any))) return reply.code(400).send({ error: 'lang' });
      if (theme && (typeof theme !== 'string' || !THEMES.includes(theme as any))) return reply.code(400).send({ error: 'theme' });
      if (lang) await deps.write('auth.set_language', { lang }, user.id);
      if (theme) await deps.write('auth.set_theme', { theme }, user.id);
      const saved = await deps.one<AuthUser>('auth.user', {}, user.id);
      return { user: shapeUser(saved!) };
    });

    // Roles are authorization state, so their mutation belongs here too. Course
    // administration may consume the result but does not implement RBAC.
    app.get('/api/admin/users', async (request: RequestLike, reply: ReplyLike) => {
      const actor = await requireRole(request, reply, ['admin']); if (!actor) return;
      return { users: await deps.many('auth.admin_users') };
    });

    app.patch('/api/admin/users/:id/role', async (request: RequestLike & { params?: { id?: unknown } }, reply: ReplyLike) => {
      const actor = await requireRole(request, reply, ['admin']); if (!actor) return;
      const targetId = Number(request.params?.id);
      const target = Number.isSafeInteger(targetId) && targetId > 0
        ? await deps.one<AuthUser>('auth.user', {}, targetId) : null;
      const role = request.body?.role;
      if (!target) return reply.code(404).send({ error: 'no_existe' });
      if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) {
        return reply.code(400).send({ error: 'rol_invalido' });
      }
      // «quedarse sin admins» incluye a root: degradar al ultimo root deja la
      // plataforma igual de huerfana que degradar al ultimo admin.
      if (mandaPlataforma(target.role) && !mandaPlataforma(role)) {
        if (target.id === actor.id) return reply.code(409).send({ error: 'auto_degradacion',
          msg: 'No puedes quitarte a ti mismo el mando de la plataforma. Pídeselo a otro admin.' });
        const admins = await deps.one<{ c: number }>('auth.admin_count');
        if ((admins?.c ?? 0) <= 1) return reply.code(409).send({ error: 'ultimo_admin', msg: 'No puedes dejar la plataforma sin admins.' });
      }
      await deps.write('auth.role_change', { role }, target.id);
      await deps.writeAuthorized('auth.role_audit', {
        from_role: target.role, to_role: role,
      }, target.id, actor.id);
      const fresh = await deps.one<AuthUser>('auth.user', {}, target.id);
      await emit('auth.role_changed', { subject: String(target.id), target: String(target.id),
        actor: String(actor.id), from: target.role, to: role });
      return { user: shapeUser(fresh!) };
    });
  }

  // `periodEnd` es lo que separa una compra de una suscripcion. Vacio significa
  // "sin vencimiento", que es como se comportaba TODO evento antes de este
  // cambio: quien compro el curso bajo el modelo de pago unico conserva su
  // acceso, porque su fila tiene period_end NULL y la derivacion la respeta.
  async function applyEntitlement(event: { eventKey: string; userId: number; active: boolean;
    source: string; externalId: string; occurredAt: string; periodEnd?: string }): Promise<{ accepted: boolean; active: boolean }> {
    const inserted = await deps.write('auth.entitlement_record', {
      event: event.eventKey, active: event.active, source: event.source,
      external: event.externalId, occurred: event.occurredAt, period: event.periodEnd ?? '',
    }, event.userId);
    const latest = await deps.one<{ paid: number }>('auth.entitlement_apply', {}, event.userId);
    const active = Boolean(latest?.paid);
    await emit(active ? 'subscription.entitlement_granted' : 'subscription.entitlement_revoked',
      { subject: String(event.userId), target: String(event.userId), source: event.source,
        externalId: event.externalId, duplicate: inserted === 0 });
    return { accepted: inserted > 0, active };
  }

  async function applyDefenseAction(action: { kind: string; target: string; ttlSeconds: number;
    why?: string }): Promise<{ applied: boolean }> {
    const userId = Number(action.target);
    if (!Number.isSafeInteger(userId) || userId < 1) return { applied: false };
    if (action.kind === 'revoke_session') {
      const changed = await deps.write('auth.revoke_session', {}, userId);
      return { applied: changed > 0 };
    }
    if (action.kind === 'throttle_identity') {
      const ttl = Math.min(6 * 60 * 60, Math.max(60, Math.floor(action.ttlSeconds || 900)));
      const changed = await deps.write('auth.throttle_upsert', {
        seconds: ttl, reason: String(action.why ?? 'security containment').slice(0, 500),
      }, userId);
      return { applied: changed > 0 };
    }
    return { applied: false };
  }

  return { currentUser, requireUser, requireRole, registerRoutes, applyEntitlement, applyDefenseAction,
    shape: shapeUser, langs: LANGS, themes: THEMES };
}
