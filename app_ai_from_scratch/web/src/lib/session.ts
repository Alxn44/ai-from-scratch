const API = import.meta.env.API_URL ?? process.env.API_URL ?? 'http://127.0.0.1:8787';

// Todas las rutas se piden por /api/v3/*. La superficie sin version sigue viva
// como v2 legacy y responde igual, pero con cabeceras Deprecation y Sunset: si
// este front vuelve a pedir /api/* directo, el contador de golpes legacy sube y
// se ve en /api/version. Asi el numero dice la verdad sobre quien usa lo viejo.
const V = 'v3';
const conVersion = (path: string) =>
  path.startsWith('/api/') && !path.startsWith(`/api/${V}/`)
    ? `/api/${V}/` + path.slice('/api/'.length)
    : path;

export type Role = 'student' | 'tutor' | 'admin' | 'root';

/**
 * Jerarquia de roles para el SSR. Copia deliberada de CONTIENE en
 * auth/src/core.ts: web y api son procesos distintos y web ya duplicaba `Role`.
 * root cumple cualquier exigencia; los otros tres siguen siendo planos.
 */
const CONTIENE: Record<string, readonly string[]> = {
  root: ['root', 'admin', 'tutor', 'student'],
  admin: ['admin'],
  tutor: ['tutor'],
  student: ['student'],
};

/** ¿`role` cumple con alguno de los roles `exigidos`? */
export function satisface(role: string, exigidos: readonly string[]): boolean {
  const propios = CONTIENE[role] ?? [role];
  return exigidos.some((r) => propios.includes(r));
}

/** ¿`role` manda en la plataforma? admin y root. */
export const mandaPlataforma = (role: string): boolean => satisface(role, ['admin']);
export type LangPref = 'es' | 'en' | 'auto';
export type ThemePref = 'dark' | 'paper' | 'auto';
export interface User { id: number; email: string; name: string; role: Role; lang: LangPref; theme: ThemePref; paid: boolean; cohort: string | null; }

/** Llama al API reenviando la cookie de la petición. Devuelve null si no hay sesión. */
export async function apiFetch<T>(path: string, request: Request, init: RequestInit = {}): Promise<T | null> {
  const cookie = request.headers.get('cookie') ?? '';
  const res = await fetch(`${API}${conVersion(path)}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie, 'content-type': 'application/json' },
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

/** Igual que apiFetch pero devuelve el código: hace falta para distinguir un 402
 *  (la lección existe pero está detrás del muro de pago) de un 404. */
export async function apiTry<T>(path: string, request: Request, init: RequestInit = {}): Promise<{ status: number; data: T | null }> {
  const cookie = request.headers.get('cookie') ?? '';
  const res = await fetch(`${API}${conVersion(path)}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie, 'content-type': 'application/json' },
  });
  const data = res.headers.get('content-type')?.includes('json') ? ((await res.json()) as T) : null;
  return { status: res.status, data };
}

export async function getUser(request: Request): Promise<User | null> {
  const d = await apiFetch<{ user: User }>('/api/me', request);
  return d?.user ?? null;
}

/** Puerta de rol para páginas SSR: devuelve el usuario o una Response de redirección. */
export async function gate(request: Request, roles: Role[] = ['student', 'tutor', 'admin']) {
  const user = await getUser(request);
  if (!user) return { user: null, redirect: '/login' as const };
  // satisface, no includes: una pagina que exige ['admin'] no tiene que
  // acordarse de nombrar a root para dejarlo pasar.
  if (!satisface(user.role, roles)) return { user, redirect: '/panel' as const };
  return { user, redirect: null };
}

export function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase();
}
