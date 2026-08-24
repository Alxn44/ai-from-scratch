// AI mode is a MODE, not a page.
//
// The sidebar used to carry a «Chat» entry, so talking to the assistant meant
// LEAVING the lesson you were reading. AI mode instead stays on while you move
// between tabs, and the assistant appears as a floating panel over whatever page
// you are on. That only works if the state survives a navigation, and every page
// here is server-rendered, so it has to survive on the SERVER's side of the
// request too.
//
// WHY COOKIES AND NOT localStorage. Astro renders the sidebar on the server. With
// the state in localStorage the toggle would paint OFF and then flip ON after
// hydration on every single page load — the same flicker the language and theme
// preferences avoid by living in cookies (see lib/prefs.ts, which owns the
// parser this file reuses).
//
// WHY THE DEVICE AND NOT THE ACCOUNT. /api/settings persists `lang` and `theme`
// because those are decisions about the CONTENT. This is a decision about the
// screen in front of you: the same student may want the panel open on the desktop
// where they study and closed on the phone. It is the same call already made for
// the milestone sounds ("se guarda en este equipo, no en tu cuenta"). The cost,
// stated: clearing cookies resets it, and a new device starts with the default.
import { cookies } from './prefs';

export const COOKIE_MODE = 'ai_mode';
export const COOKIE_NUDGES = 'ai_nudges';
export const COOKIE_OPEN = 'ai_open';

/** One year. The preference is not a session decision. */
const MAX_AGE = 60 * 60 * 24 * 365;

export interface AiFlags {
  /** AI mode on: the panel is mounted on every page. */
  mode: boolean;
  /** The proactive nudges are allowed to speak first. */
  nudges: boolean;
  /** The panel is expanded rather than collapsed to its launcher. */
  open: boolean;
}

/**
 * Defaults, and why.
 *
 *  mode:   OFF. Turning a chat panel on for somebody who never asked for it is
 *          the behaviour this feature is supposed to be better than.
 *  nudges: ON. «Proactive» is the whole point, and the student can switch it off
 *          from inside the panel; a proactive assistant that defaults to silent
 *          would never be discovered.
 *  open:   ON. It only matters once `mode` is on, and switching the mode on is a
 *          request to see the panel.
 */
export const DEFAULTS: AiFlags = { mode: false, nudges: true, open: true };

const read = (raw: string | undefined, fallback: boolean): boolean =>
  raw === '1' ? true : raw === '0' ? false : fallback;

/** SSR: the flags for this request, so the first paint is already correct. */
export function aiFlags(request: Request): AiFlags {
  const c = cookies(request);
  return {
    mode: read(c[COOKIE_MODE], DEFAULTS.mode),
    nudges: read(c[COOKIE_NUDGES], DEFAULTS.nudges),
    open: read(c[COOKIE_OPEN], DEFAULTS.open),
  };
}

/** Browser: the same read, from document.cookie. */
export function readFlags(): AiFlags {
  const jar: Record<string, string> = {};
  for (const part of document.cookie.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    jar[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return {
    mode: read(jar[COOKIE_MODE], DEFAULTS.mode),
    nudges: read(jar[COOKIE_NUDGES], DEFAULTS.nudges),
    open: read(jar[COOKIE_OPEN], DEFAULTS.open),
  };
}

/**
 * Browser: persist one flag.
 *
 * `SameSite=Lax` and no `Secure`, matching how this app is served over plain HTTP
 * in development. It carries no identity — three booleans about a panel — so it is
 * not a credential; the session cookie is set by the API and is unaffected.
 */
export function writeFlag(name: string, on: boolean): void {
  document.cookie = `${name}=${on ? '1' : '0'}; path=/; max-age=${MAX_AGE}; SameSite=Lax`;
}
