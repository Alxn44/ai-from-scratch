// Collapsed sidebar is a MODE of the chrome, not an account setting.
//
// WHY COOKIES AND NOT localStorage. App.astro renders the rail on the server.
// With the state in localStorage the 248px rail would paint first and then snap
// to 64px after hydration — the same flicker language, theme and AI mode already
// refuse (see lib/prefs.ts and lib/ai-mode.ts).
//
// WHY THE DEVICE AND NOT THE ACCOUNT. A collapsed rail is about the screen in
// front of you. The same student may want icons on a laptop and the full labels
// on a phone; the overlay on a phone always shows labels and never writes this
// cookie. Clearing cookies resets it. A new device starts expanded.
import { cookies } from './prefs';

export const COOKIE_SIDEBAR = 'sidebar_collapsed';

/** One year. The preference is not a session decision. */
const MAX_AGE = 60 * 60 * 24 * 365;

/** SSR: collapsed rail for this request, so the first paint is already correct. */
export function sidebarCollapsed(request: Request): boolean {
  return cookies(request)[COOKIE_SIDEBAR] === '1';
}

/**
 * The same cookie read as THREE states instead of two.
 *
 * `sidebarCollapsed` folds "no cookie" and "cookie=0" into the same `false`,
 * which is right for painting but loses the distinction the tablet band needs:
 * between 901 and 1180 px the rail should START collapsed, and a media query
 * cannot set a default without also overriding somebody who explicitly expanded
 * it. So 'auto' means the viewer has never touched the toggle on this device —
 * the width decides — and 'collapsed' / 'expanded' mean they did, and win.
 *
 * `writeSidebarCollapsed` always writes '1' or '0', so the first toggle leaves
 * 'auto' for good.
 */
export type SidebarRail = 'auto' | 'collapsed' | 'expanded';

export function sidebarRail(request: Request): SidebarRail {
  const v = cookies(request)[COOKIE_SIDEBAR];
  if (v === '1') return 'collapsed';
  if (v === '0') return 'expanded';
  return 'auto';
}

/**
 * Browser: persist the desktop rail.
 *
 * `SameSite=Lax` and no `Secure`, matching lib/ai-mode.ts. It carries no identity
 * — one boolean about a column of icons — so it is not a credential.
 */
export function writeSidebarCollapsed(on: boolean): void {
  document.cookie = `${COOKIE_SIDEBAR}=${on ? '1' : '0'}; path=/; max-age=${MAX_AGE}; SameSite=Lax`;
}
