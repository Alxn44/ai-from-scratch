// One toast API for the app and the public pages. Trazo walks the card in;
// reduced-motion skips the walk and plants the card in #toasts.
import { trazoEntregar } from './trazo';

const ICONS: Record<string, string> = {
  ok: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.6l4.4 4.4L19 7.2"/></svg>',
  bad: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.4 2.8 19.6h18.4zM12 9.6v4.2M12 16.4v.1"/></svg>',
  warn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.4 2.8 19.6h18.4zM12 9.6v4.2M12 16.4v.1"/></svg>',
  info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.2a8.2 8.2 0 1 0 0-16.4 8.2 8.2 0 0 0 0 16.4zM12 11v5.4M12 8.1v.1"/></svg>',
};
const COLOR: Record<string, string> = { ok: 'var(--ok)', bad: 'var(--rd)', warn: 'var(--or)', info: 'var(--ac)' };

declare global {
  interface Window { toast: (kind: string, title: string, body: string, key?: string) => void }
}

const seen = new Map<string, HTMLElement>();

function caja(): HTMLElement {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.append(box);
  }
  return box;
}

function tarjeta(kind: string, title: string, body: string, cerrar: string, id: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.borderColor = COLOR[kind] ?? 'var(--hair)';
  el.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  const icono = document.createElement('div');
  icono.setAttribute('style', `color:${COLOR[kind]};margin-top:1px;flex:none`);
  icono.innerHTML = ICONS[kind] ?? '';
  const col = document.createElement('div');
  col.setAttribute('style', 'display:flex;flex-direction:column;gap:4px;flex:1;min-width:0');
  const h = document.createElement('div');
  h.className = 'h3';
  h.textContent = title;
  const p = document.createElement('p');
  p.className = 's';
  p.setAttribute('style', 'color:var(--l2)');
  p.textContent = body;
  col.append(h, p);
  const x = document.createElement('button');
  x.setAttribute('aria-label', cerrar);
  x.setAttribute('style', 'background:none;border:0;color:var(--l3);cursor:pointer;padding:0;flex:none');
  x.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8"/></svg>';
  x.onclick = () => { el.remove(); seen.delete(id); };
  el.append(icono, col, x);
  return el;
}

export function montarAvisos(cerrar = 'Cerrar'): void {
  const box = caja();
  window.toast = (kind: string, title: string, body: string, key?: string) => {
    const id = key || title;
    if (seen.has(id)) { seen.get(id)!.remove(); seen.delete(id); }
    const el = tarjeta(kind, title, body, cerrar, id);
    seen.set(id, el);
    while (box.children.length > 2) {
      const old = box.firstElementChild as HTMLElement | null;
      if (old) { seen.forEach((v, k) => { if (v === old) seen.delete(k); }); old.remove(); }
    }
    void trazoEntregar({ cargo: el, dest: box });
    if (kind === 'ok' || kind === 'info') {
      setTimeout(() => { el.remove(); seen.delete(id); }, 5200);
    }
  };
}
