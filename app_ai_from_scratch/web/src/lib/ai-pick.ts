// Model and effort buttons for AI mode. The ids are the allowlist Node and
// Python share (sonnet, deepseek, kimi, together). Anthropic in the UI is
// the sonnet lane: claude-sonnet-5, not Haiku.

export type Esfuerzo = 'bajo' | 'medio' | 'alto';

export const MODELOS = [
  { id: 'sonnet', marca: 'Anthropic', modelo: 'claude-sonnet-5' },
  { id: 'deepseek', marca: 'DeepSeek', modelo: 'deepseek-chat' },
  { id: 'kimi', marca: 'Kimi', modelo: 'kimi-k3' },
  { id: 'together', marca: 'Together', modelo: 'moonshotai/Kimi-K2.7-Code' },
] as const;

export const ESFUERZOS: Esfuerzo[] = ['bajo', 'medio', 'alto'];

const K_P = 'ia.proveedor';
const K_E = 'ia.esfuerzo';
const watchers = new Set<() => void>();

export function leerPick(): { proveedor: string | null; esfuerzo: Esfuerzo } {
  try {
    const p = localStorage.getItem(K_P);
    const e = localStorage.getItem(K_E);
    return {
      proveedor: MODELOS.some((m) => m.id === p) ? p : null,
      esfuerzo: ESFUERZOS.includes(e as Esfuerzo) ? (e as Esfuerzo) : 'medio',
    };
  } catch {
    return { proveedor: null, esfuerzo: 'medio' };
  }
}

export function escribirPick(next: { proveedor?: string | null; esfuerzo?: Esfuerzo }): void {
  try {
    if ('proveedor' in next) {
      if (next.proveedor) localStorage.setItem(K_P, next.proveedor);
      else localStorage.removeItem(K_P);
    }
    if (next.esfuerzo) localStorage.setItem(K_E, next.esfuerzo);
  } catch { /* private mode */ }
  for (const fn of watchers) fn();
}

export type PickLabels = {
  modelo: string;
  esfuerzo: string;
  bajo: string;
  medio: string;
  alto: string;
};

export function montarPick(
  host: HTMLElement,
  labels: PickLabels,
  available: string[],
): () => { proveedor: string | null; esfuerzo: Esfuerzo } {
  const state = leerPick();
  // Anthropic's flash lane is `anthropic` (Haiku). The button is the sonnet
  // lane: if the key is there, both ids come back, but older responses only
  // listed `anthropic`. Treat that as sonnet available.
  const ids = available.includes('anthropic') && !available.includes('sonnet')
    ? [...available, 'sonnet'] : available;
  if (state.proveedor && !ids.includes(state.proveedor)) state.proveedor = null;
  if (!state.proveedor) {
    const flash = ['deepseek', 'kimi', 'together'].find((id) => ids.includes(id));
    state.proveedor = flash ?? (ids.includes('sonnet') ? 'sonnet' : null);
    if (state.proveedor) escribirPick({ proveedor: state.proveedor });
  }

  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'ia-pick';

  const mkLab = (txt: string) => {
    const p = document.createElement('p');
    p.className = 'lbl';
    p.textContent = txt;
    return p;
  };
  wrap.append(mkLab(labels.modelo));

  const grid = document.createElement('div');
  grid.className = 'ia-picks';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', labels.modelo);

  const paint = () => {
    grid.querySelectorAll<HTMLButtonElement>('.ia-pickb[data-id]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.id === state.proveedor));
    });
    wrap.querySelectorAll<HTMLButtonElement>('.ia-pickb[data-eff]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.eff === state.esfuerzo));
    });
  };

  for (const m of MODELOS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ia-pickb';
    b.dataset.id = m.id;
    b.disabled = !ids.includes(m.id);
    b.innerHTML = `<span class="marca">${m.marca}</span><span class="mod">${m.modelo}</span>`;
    b.addEventListener('click', () => {
      if (b.disabled) return;
      state.proveedor = m.id;
      escribirPick({ proveedor: m.id });
      paint();
    });
    grid.append(b);
  }
  wrap.append(grid, mkLab(labels.esfuerzo));

  const row = document.createElement('div');
  row.className = 'ia-eff';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', labels.esfuerzo);
  const names: Record<Esfuerzo, string> = {
    bajo: labels.bajo, medio: labels.medio, alto: labels.alto,
  };
  for (const e of ESFUERZOS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ia-pickb';
    b.dataset.eff = e;
    b.textContent = names[e];
    b.addEventListener('click', () => {
      state.esfuerzo = e;
      escribirPick({ esfuerzo: e });
      paint();
    });
    row.append(b);
  }
  wrap.append(row);
  host.append(wrap);
  const sync = () => {
    const next = leerPick();
    state.proveedor = next.proveedor;
    state.esfuerzo = next.esfuerzo;
    paint();
  };
  watchers.add(sync);
  paint();
  return () => ({ proveedor: state.proveedor, esfuerzo: state.esfuerzo });
}
