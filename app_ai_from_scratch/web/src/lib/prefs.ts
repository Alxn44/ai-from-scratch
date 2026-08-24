// Preferencias antes de tener cuenta: viven en cookies legibles por el servidor,
// así el SSR ya sale con el idioma y el tema correctos (sin parpadeo).
export type Lang = 'es' | 'en';
export type ThemePref = 'dark' | 'paper' | 'auto';
export type LangPref = Lang | 'auto';

export const COOKIE_LANG = 'pref_lang';
export const COOKIE_THEME = 'pref_theme';

export function cookies(request: Request): Record<string, string> {
  const raw = request.headers.get('cookie') ?? '';
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function deviceLang(request: Request): Lang {
  const accept = request.headers.get('accept-language') ?? '';
  return /^en\b|,\s*en\b/i.test(accept) ? 'en' : 'es';
}

/** Preferencias del visitante: cookie si la puso, si no el idioma del equipo y tema auto. */
export function publicPrefs(request: Request): { lang: Lang; langPref: LangPref; theme: ThemePref } {
  const c = cookies(request);
  const cl = c[COOKIE_LANG];
  const ct = c[COOKIE_THEME];
  const langPref: LangPref = cl === 'es' || cl === 'en' || cl === 'auto' ? cl : 'auto';
  const theme: ThemePref = ct === 'dark' || ct === 'paper' || ct === 'auto' ? ct : 'auto';
  return { lang: langPref === 'auto' ? deviceLang(request) : langPref, langPref, theme };
}
