// Pre-built graphic workflows for the questions people actually type in chat.
// Same visual family as the achievement cards (unlock.ts): a delivered object,
// not a toast. Chat is a second MODE of the platform — these cards DO the
// thing (open the lesson, start checkout, replay the tutorial) and the
// traditional pages stay where they are.
import { trazoEntregar } from './trazo';

export type FlujoId =
  | 'empezar' | 'leccion' | 'lab' | 'pagar' | 'renovar' | 'idioma'
  | 'pdf' | 'logros' | 'ranking' | 'ayuda' | 'tutorial'
  | 'cerrada' | 'devolucion' | 'clave';

export type PasoFlujo = { n: string; t: string; b: string; href?: string; acc?: string; ir?: string };
export type Cta = { txt: string; href?: string; acc?: string };
export type Flujo = { id: FlujoId; eb: string; t: string; b: string; pasos: PasoFlujo[]; cta?: Cta };

export type BloqueFlujo = { t: string; b: string; p1t: string; p1b: string; p2t?: string; p2b?: string; p3t?: string; p3b?: string };
export type FlujoTxt = {
  eb: string;
  ir: string;
  hacer: string;
} & Record<string, string | BloqueFlujo>;

function tiene(s: string, ...ws: string[]): boolean {
  return ws.some((w) => s.includes(w));
}

/** Pick the workflow that answers this question. Null = just talk. */
export function flujoDe(q: string): FlujoId | null {
  const s = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (tiene(s, 'tutorial', 'como se usa', 'how to use', 'recorrido', 'tour')) return 'tutorial';
  if (tiene(s, 'empezar', 'empiezo', 'start', 'from scratch', 'primera vez')) return 'empezar';
  if (tiene(s, 'renovar', 'renew', 'otra vez el pago', 'volver a pagar')) return 'renovar';
  if (tiene(s, 'devolver', 'devolucion', 'reembolso', 'refund', 'garantia', 'guarantee')) return 'devolucion';
  if (tiene(s, 'contrasena', 'password', 'olvide', 'forgot', 'no puedo entrar', "can't log")) return 'clave';
  if (tiene(s, 'cerrada', 'candado', 'bloqueada', 'locked', 'padlock', 'no puedo abrir')) return 'cerrada';
  if (tiene(s, 'pagar', 'comprar', 'precio', 'checkout', 'buy', 'pay', 'mercadopago')) return 'pagar';
  if (tiene(s, 'pdf', 'descargar', 'download', 'imprimir', 'print')) return 'pdf';
  if (tiene(s, 'idioma', 'language', 'tema', 'theme', 'oscuro', 'papel', 'dark')) return 'idioma';
  if (tiene(s, 'logro', 'rango', 'achiev', 'badge', 'camino')) return 'logros';
  if (tiene(s, 'ranking', 'puesto', 'leaderboard', 'alias')) return 'ranking';
  if (tiene(s, 'lab', 'ejercicio', 'exercise', 'comprobar')) return 'lab';
  if (tiene(s, 'leccion', 'lesson', 'leer', 'hacer la')) return 'leccion';
  if (tiene(s, 'ayuda', 'help', 'que puedes', 'what can you', 'atajo')) return 'ayuda';
  return null;
}

function bloque(T: FlujoTxt, id: string): BloqueFlujo {
  const raw = T[id];
  if (raw && typeof raw === 'object') return raw;
  return { t: '', b: '', p1t: '', p1b: '' };
}

function paso(bl: BloqueFlujo, ir: string, n: number, href?: string, acc?: string): PasoFlujo {
  return {
    n: String(n).padStart(2, '0'),
    t: bl[`p${n}t` as 'p1t'] ?? '',
    b: bl[`p${n}b` as 'p1b'] ?? '',
    href, acc, ir,
  };
}

export function armarFlujo(id: FlujoId, T: FlujoTxt, ctx: { next?: number; pagado?: boolean }): Flujo {
  const n = ctx.next ?? 1;
  const bl = bloque(T, id);
  const P = (k: number, href?: string, acc?: string) => paso(bl, T.ir, k, href, acc);
  const base: Pick<Flujo, 'id' | 'eb' | 't' | 'b'> = {
    id, eb: T.eb, t: bl.t, b: bl.b,
  };
  switch (id) {
    case 'empezar':
      return { ...base, pasos: [
        P(1, `/leccion/${n}`), P(2, `/leccion/${n}`), P(3, '/pago'),
      ], cta: { txt: T.hacer, href: `/leccion/${n}` } };
    case 'leccion':
      return { ...base, pasos: [
        P(1, `/leccion/${n}`), P(2, `/leccion/${n}`), P(3, `/leccion/${n}`),
      ], cta: { txt: T.hacer, href: `/leccion/${n}` } };
    case 'lab':
      return { ...base, pasos: [
        P(1, `/leccion/${n}`), P(2, `/leccion/${n}`), P(3, '/logros'),
      ], cta: { txt: T.hacer, href: `/leccion/${n}` } };
    case 'pagar':
      return { ...base, pasos: [
        P(1, '/registro'), P(2, '/pago'), P(3, '/curso'),
      ], cta: { txt: T.hacer, href: ctx.pagado ? '/curso' : '/pago' } };
    case 'renovar':
      return { ...base, pasos: [
        P(1, '/pago'), P(2, '/curso'), P(3, '/perfil'),
      ], cta: { txt: T.hacer, href: ctx.pagado ? '/curso' : '/pago' } };
    case 'idioma':
      return { ...base, pasos: [
        P(1, '/ajustes'), P(2, '/ajustes'), P(3, '/ajustes'),
      ], cta: { txt: T.hacer, href: '/ajustes' } };
    case 'pdf':
      return { ...base, pasos: [
        P(1, '/perfil'), P(2, '/perfil'),
      ], cta: { txt: T.hacer, href: '/perfil' } };
    case 'logros':
      return { ...base, pasos: [
        P(1, `/leccion/${n}`), P(2, '/logros'), P(3, '/logros'),
      ], cta: { txt: T.ir, href: '/logros' } };
    case 'ranking':
      return { ...base, pasos: [
        P(1, '/ranking'), P(2, '/ligas'),
      ], cta: { txt: T.ir, href: '/ranking' } };
    case 'tutorial':
      return { ...base, pasos: [
        P(1, undefined, 'tutorial'), P(2, '/leccion/1', 'tutorial'), P(3, '/chat', 'tutorial'),
      ], cta: { txt: T.hacer, acc: 'tutorial' } };
    case 'cerrada':
      return { ...base, pasos: [
        P(1, '/leccion/1'), P(2, '/pago'), P(3, '/soporte'),
      ], cta: { txt: T.hacer, href: ctx.pagado ? '/curso' : '/pago' } };
    case 'devolucion':
      return { ...base, pasos: [
        P(1, '/terminos'), P(2, '/soporte'),
      ], cta: { txt: T.ir, href: '/soporte' } };
    case 'clave':
      return { ...base, pasos: [
        P(1, '/recuperar'), P(2, '/login'),
      ], cta: { txt: T.hacer, href: '/recuperar' } };
    default:
      return { ...base, pasos: [
        P(1, '/panel'), P(2, '/chat'), P(3, '/leccion/1'),
      ], cta: { txt: T.ir, href: '/panel' } };
  }
}

function css(): void {
  if (document.getElementById('wf-css')) return;
  const s = document.createElement('style');
  s.id = 'wf-css';
  s.textContent = `
.wf{position:relative;box-sizing:border-box;background:var(--panel);border:1px solid var(--ac);
  overflow:hidden;width:min(400px,100%);animation:wf-ent .24s cubic-bezier(.16,1,.3,1) both}
.wf-fila{display:flex;align-items:stretch}
.wf-raya{width:3px;flex:none;background:var(--ac)}
.wf-cuerpo{flex:1;min-width:0;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.wf-eb{font:600 10px/1 var(--m);letter-spacing:.16em;text-transform:uppercase;color:var(--ac);margin:0}
.wf-t{font:600 17px/1.2 var(--f);margin:0}
.wf-b{font:400 13px/1.45 var(--f);color:var(--l2);margin:0}
.wf-paso{display:grid;grid-template-columns:32px 1fr auto;gap:10px;align-items:start;padding:8px 0;
  border-top:1px solid var(--hair2)}
.wf-n{font:600 11px/1 var(--m);color:var(--ac);padding-top:2px}
.wf-pt{font:600 13px/1.3 var(--f);margin:0}
.wf-pb{font:400 12px/1.4 var(--f);color:var(--l3);margin:4px 0 0}
.wf-ir,.wf-cta{background:none;border:0;padding:0;cursor:pointer;color:var(--ac);
  font:600 10px/1 var(--m);letter-spacing:.14em;text-transform:uppercase;text-decoration:underline;
  text-underline-offset:3px}
.wf-cta{margin-top:4px;align-self:start}
@keyframes wf-ent{from{opacity:0;transform:translate3d(14px,10px,0)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.wf{animation:none}}`;
  document.head.append(s);
}

export function ejecutarAccion(acc: string): void {
  if (acc === 'tutorial') {
    window.abrirTutorial?.();
    return;
  }
  if (acc.startsWith('leccion:')) {
    location.assign(`/leccion/${acc.slice(8)}`);
    return;
  }
}

function enlazar(el: HTMLElement, href?: string, acc?: string): void {
  if (acc) el.addEventListener('click', (e) => { e.preventDefault(); ejecutarAccion(acc); });
  else if (href) el.addEventListener('click', () => { location.assign(href); });
}

/** Paint the card into `dest`. Trazo walks it in on desktop. */
export function pintarFlujo(flujo: Flujo, dest: HTMLElement, entregar = true): HTMLElement {
  css();
  const wrap = document.createElement('div');
  wrap.className = 'wf';
  wrap.setAttribute('data-flujo', flujo.id);
  const fila = document.createElement('div');
  fila.className = 'wf-fila';
  const raya = document.createElement('div');
  raya.className = 'wf-raya';
  const cuerpo = document.createElement('div');
  cuerpo.className = 'wf-cuerpo';
  const eb = document.createElement('p');
  eb.className = 'wf-eb';
  eb.textContent = flujo.eb;
  const t = document.createElement('div');
  t.className = 'wf-t';
  t.textContent = flujo.t;
  const b = document.createElement('p');
  b.className = 'wf-b';
  b.textContent = flujo.b;
  cuerpo.append(eb, t, b);
  for (const p of flujo.pasos.filter((x) => x.t)) {
    const row = document.createElement('div');
    row.className = 'wf-paso';
    const n = document.createElement('span');
    n.className = 'wf-n';
    n.textContent = p.n;
    const col = document.createElement('div');
    const pt = document.createElement('p');
    pt.className = 'wf-pt';
    pt.textContent = p.t;
    const pb = document.createElement('p');
    pb.className = 'wf-pb';
    pb.textContent = p.b;
    col.append(pt, pb);
    row.append(n, col);
    if (p.href || p.acc) {
      const a = document.createElement(p.href && !p.acc ? 'a' : 'button');
      a.className = 'wf-ir';
      if (a instanceof HTMLAnchorElement && p.href) a.href = p.href;
      else a.setAttribute('type', 'button');
      a.textContent = p.ir ?? '→';
      enlazar(a, p.href, p.acc);
      row.append(a);
    }
    cuerpo.append(row);
  }
  if (flujo.cta) {
    const cta = document.createElement(flujo.cta.href && !flujo.cta.acc ? 'a' : 'button');
    cta.className = 'wf-cta';
    if (cta instanceof HTMLAnchorElement && flujo.cta.href) cta.href = flujo.cta.href;
    else cta.setAttribute('type', 'button');
    cta.textContent = flujo.cta.txt;
    enlazar(cta, flujo.cta.href, flujo.cta.acc);
    cuerpo.append(cta);
  }
  fila.append(raya, cuerpo);
  wrap.append(fila);
  if (entregar) void trazoEntregar({ cargo: wrap, dest, size: 88 });
  else dest.append(wrap);
  return wrap;
}
