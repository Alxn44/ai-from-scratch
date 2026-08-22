// Variante A del cambio de idioma: la bandera voltea junto al toggle y la página
// se atenúa mientras llega el render nuevo. El cambio de idioma SIEMPRE recarga
// (las cadenas se resuelven en el servidor), así que la animación va antes de la
// recarga; si no, no se vería.
import { flagFor, LANG_NAMES } from './flags';

const MS = 620;   // duración del volteo
const ESPERA = 780; // cuánto se ve el sello antes de recargar

/** Respeta a quien pidió menos movimiento: no anima, resuelve de una. */
const sinMovimiento = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function animarIdioma(ancla: HTMLElement, lang: string): Promise<void> {
  if (sinMovimiento()) return Promise.resolve();

  const f = flagFor(lang, 20);
  const sello = document.createElement('div');
  sello.className = 'lang-flip';
  sello.setAttribute('aria-live', 'polite');
  sello.innerHTML = `${f ? f.svg : ''}<span class="lbl" style="color:var(--l1)">${LANG_NAMES[lang] ?? lang}${f ? ' · ' + f.cc : ''}</span>`;

  const grupo = ancla.closest('.seg') ?? ancla;
  grupo.parentElement?.insertBefore(sello, grupo);
  document.body.classList.add('lang-saliendo');

  return new Promise((resolve) => setTimeout(resolve, MS + ESPERA - 260));
}
