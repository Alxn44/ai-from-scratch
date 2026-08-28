// El aviso de DESBLOQUEO: lo que aparece cuando ganas algo, no cuando el sistema
// te informa de algo.
//
// Por que no reusa `window.toast`: un toast es una notificacion — icono de 18px,
// titulo, cuerpo, y se va. Sirve para "no se guardo el tema". No sirve para
// "subiste de rango", porque no ENTREGA nada: no ves el objeto que ganaste.
// Aqui la insignia real (la misma de insignias.ts, no un icono) aterriza en un
// carril propio, la luz la cruza una vez y la barra corre hasta lo que falta.
//
// Cuatro decisiones que no son estilo:
//
//  1. LA ESCALA ES EL DISENO. Resolver un lab pasa 36 veces; cerrar el curso,
//     una. Si el lab sonara y brillara igual, ninguno de los dos significaria
//     nada. Por eso el lab NO lleva insignia — solo un carril de 3px — y el
//     rango es el unico que trae a Trazo y anillo. Es la misma escala del kit de
//     sonido (sonido.ts): lab a -20 dBFS, rango a -8.
//  2. UN MOMENTO, NO CUATRO EFECTOS. Entrada 240ms -> insignia con inercia 460ms
//     -> brillo que cruza 780ms -> barra 950ms. Encadenados leen como abrir algo;
//     repartidos leen como ruido.
//  3. LA LINEA DE ARRIBA es el tiempo que queda. Un contador numerico obliga a
//     leer; una barra que se vacia se ve de reojo.
//  4. prefers-reduced-motion apaga TODO y deja la barra en su valor final. El
//     dato no puede depender de la animacion.
//
// Comparte carril con los toasts (#toasts) a proposito: dos carriles fijos
// abajo-derecha se solapan, y el que perderia es el aviso de error.
import { estrella, trofeo, medalla, RANGO_METAL, RANGO_FORMA, TINTA, type Metal, type MetalLiga } from './badges';
import { gato } from './cat';
import { trazoEntregar } from './trazo';

type Meta = { lbl: string; num: string; pct: number };

/** Accion opcional del aviso: un enlace en el cuerpo, y el cuerpo entero clicable. */
type Accion = { txt: string; fn: () => void };

export type Hito =
  | { tipo: 'lab'; titulo: string; cuerpo?: string; accion?: Accion }
  | { tipo: 'grado'; titulo: string; cuerpo?: string; leccion?: number; meta?: Meta; accion?: Accion }
  | { tipo: 'rango'; titulo: string; cuerpo?: string; rango: number; meta?: Meta; gato?: string; accion?: Accion }
  | { tipo: 'liga'; titulo: string; cuerpo?: string; metal: MetalLiga; meta?: Meta; accion?: Accion };

const MS: Record<Hito['tipo'], number> = { lab: 2600, grado: 3400, liga: 4400, rango: 5600 };
const ANCHO: Record<Hito['tipo'], number> = { lab: 372, grado: 372, liga: 400, rango: 436 };
const CARRIL: Record<Hito['tipo'], number> = { lab: 0, grado: 76, liga: 86, rango: 104 };
const TIPO: Record<Hito['tipo'], string> = {
  lab: '600 15px/1.2', grado: '600 17px/1.2', liga: '600 19px/1.15', rango: '700 22px/1.1',
};

let n = 0;
let puesto = false;

/** El CSS va una vez y usa los tokens del tema; ningun hex vive en el markup. */
function ponCSS() {
  if (puesto) return;
  puesto = true;
  const metales = (Object.keys(TINTA) as Metal[]);
  const osc = metales.map((m) => `.db-${m}{--tin:${TINTA[m].osc}}`).join('');
  // Papel se declara con el selector completo por metal, no con un prefijo
  // compartido: `html[data-theme="paper"] .db-a{}.db-b{}` solo califica la
  // PRIMERA regla y las demas se quedan con la tinta de oscuro.
  const pap = metales.map((m) => `html[data-theme="paper"] .db-${m}{--tin:${TINTA[m].papel}}`).join('');
  const auto = metales.map((m) => `html[data-theme="auto"] .db-${m}{--tin:${TINTA[m].papel}}`).join('');
  const s = document.createElement('style');
  s.id = 'db-css';
  s.textContent = `
${osc}
.db-lab{--tin:var(--ok)}
${pap}
@media (prefers-color-scheme: light){${auto}}
.db{position:relative;box-sizing:border-box;background:var(--panel);border:1px solid var(--tin);overflow:hidden;
    animation:db-ent .24s cubic-bezier(.16,1,.3,1) both}
.db-cuenta{position:absolute;left:0;top:0;height:2px;width:100%;background:var(--tin);opacity:.55;
    transform-origin:left;animation:db-ct linear both}
.db-fila{display:flex;align-items:stretch}
.db-carril{flex:none;position:relative;display:grid;place-items:center;background:var(--fill);
    border-right:1px solid var(--hair2);overflow:hidden}
.db-ins{position:relative;animation:db-cae .46s cubic-bezier(.16,1,.3,1) .05s both}
.db-brillo{position:absolute;inset:-40% -60%;pointer-events:none;
    background:linear-gradient(100deg,transparent 38%,rgba(255,255,255,.42) 50%,transparent 62%);
    animation:db-br .78s cubic-bezier(.4,0,.2,1) .18s both}
.db-anillo{position:absolute;width:74px;height:74px;border:1px solid var(--tin);
    animation:db-an .72s cubic-bezier(.22,1,.36,1) .06s both}
.db-raya{width:3px;flex:none;background:var(--tin)}
.db-cuerpo{flex:1;min-width:0;box-sizing:border-box;padding:14px 16px;display:flex;flex-direction:column;gap:6px}
.db-eb{font:600 10px/1 var(--m);letter-spacing:.16em;text-transform:uppercase;color:var(--tin)}
.db-x{background:none;border:0;padding:0;cursor:pointer;color:var(--l3);margin-left:auto;display:grid;place-items:center}
.db-x:hover{color:var(--l1)}
.db-ac{background:none;border:0;padding:0;cursor:pointer;color:var(--tin);
    font:600 10px/1 var(--m);letter-spacing:.14em;text-transform:uppercase;text-decoration:underline;
    text-underline-offset:3px}
.db-pista{height:3px;background:var(--fill);position:relative;overflow:hidden}
.db-fill{position:absolute;left:0;top:0;bottom:0;width:0;background:var(--tin);
    transition:width .95s cubic-bezier(.16,1,.3,1) .22s}
.db-gato{flex:none;align-self:flex-end;padding:0 8px 10px 0;animation:db-gt .5s cubic-bezier(.16,1,.3,1) .3s both}
@keyframes db-ent{from{opacity:0;transform:translate3d(14px,10px,0)}to{opacity:1;transform:none}}
@keyframes db-cae{0%{transform:scale(.82)}62%{transform:scale(1.045)}100%{transform:scale(1)}}
@keyframes db-br{from{transform:translateX(-130%)}to{transform:translateX(130%)}}
@keyframes db-an{from{transform:scale(.45);opacity:.85}to{transform:scale(2.1);opacity:0}}
@keyframes db-gt{from{opacity:0;transform:translateX(22px)}to{opacity:1;transform:none}}
@keyframes db-ct{from{transform:scaleX(1)}to{transform:scaleX(0)}}
@media (prefers-reduced-motion: reduce){
  .db,.db-ins,.db-anillo,.db-gato,.db-cuenta{animation:none}
  .db-brillo{display:none}
  .db-fill{transition:none}
}`;
  document.head.append(s);
}

function carril(h: Hito, id: string): string {
  if (h.tipo === 'grado') return estrella(true, id, 46);
  if (h.tipo === 'liga') return medalla(h.metal, id, 52);
  const r = Math.min(12, Math.max(1, (h as any).rango || 1));
  return trofeo(RANGO_FORMA(r), RANGO_METAL(r), id, 72);
}

/** El metal manda la tinta; el lab no tiene metal y usa el verde de acierto. */
function clase(h: Hito): string {
  if (h.tipo === 'lab') return 'db-lab';
  if (h.tipo === 'grado') return 'db-oro';
  if (h.tipo === 'liga') return `db-${h.metal}`;
  return `db-${RANGO_METAL(Math.min(12, Math.max(1, h.rango)))}`;
}

const CERRAR = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8"/></svg>';

/**
 * Muestra el aviso. `eb` es el sombrero ("RANGO NUEVO"), que lo pone quien llama
 * porque el modulo no sabe el idioma de la cuenta.
 */
export function desbloquear(h: Hito, eb: string): () => void {
  ponCSS();
  let caja = document.getElementById('toasts');
  if (!caja) {
    caja = document.createElement('div');
    caja.id = 'toasts';
    document.body.append(caja);
  }
  const id = `db${++n}`;
  const el = document.createElement('div');
  el.className = `db ${clase(h)}`;
  el.style.width = `${ANCHO[h.tipo]}px`;
  el.setAttribute('role', 'status');

  const ins = h.tipo === 'lab' ? '<span class="db-raya"></span>' :
    `<div class="db-carril" style="width:${CARRIL[h.tipo]}px">
       ${h.tipo === 'rango' ? '<div class="db-anillo"></div>' : ''}
       <div class="db-ins">${carril(h, id)}</div>
       <div class="db-brillo"></div>
     </div>`;
  const meta = (h as any).meta as Meta | undefined;
  const barra = meta ? `
    <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
        <span style="font:600 10px/1 var(--m);letter-spacing:.14em;text-transform:uppercase;color:var(--l3)">${meta.lbl}</span>
        <span style="font:600 12px/1 var(--m);color:var(--l1);font-variant-numeric:tabular-nums">${meta.num}</span>
      </div>
      <div class="db-pista"><div class="db-fill"></div></div>
    </div>` : '';
  const ac = (h as any).accion as Accion | undefined;
  const gt = h.tipo === 'rango'
    ? `<div class="db-gato" style="width:78px">${gato(72, 'saluda', `${id}-g`)}</div>` : '';

  el.innerHTML = `
    <div class="db-cuenta" style="animation-duration:${MS[h.tipo]}ms"></div>
    <div class="db-fila">
      ${ins}
      <div class="db-cuerpo">
        <div style="display:flex;align-items:baseline;gap:10px">
          <span class="db-eb">${eb}</span>
          <button class="db-x" aria-label="Cerrar" style="width:18px;height:18px">${CERRAR}</button>
        </div>
        <div style="font:${TIPO[h.tipo]} var(--f);letter-spacing:-.02em;color:var(--l1)">${h.titulo}</div>
        ${h.cuerpo ? `<div style="font:400 13px/1.45 var(--f);color:var(--l2)">${h.cuerpo}</div>` : ''}
        ${barra}
        ${ac ? `<button class="db-ac" style="align-self:flex-start;margin-top:6px">${ac.txt}</button>` : ''}
      </div>
      ${gt}
    </div>`;

  let t = 0;
  const quita = () => { window.clearTimeout(t); el.remove(); };
  el.querySelector<HTMLButtonElement>('.db-x')!.onclick = quita;
  if (ac) {
    // El aviso entero es clicable, no solo el enlace: el objetivo real es la
    // tarjeta. Pero el boton de cerrar para el evento antes (stopPropagation en
    // su handler no hace falta porque `quita` corre y el nodo ya no existe
    // cuando el click sube — asi que se comprueba el objetivo explicitamente).
    const dispara = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.db-x')) return;
      quita(); ac.fn();
    };
    el.style.cursor = 'pointer';
    el.addEventListener('click', dispara);
  }
  // Trazo walks the card in. Rank cards still carry a sitting Trazo on the
  // right; the walking one is the delivery, then he leaves.
  void trazoEntregar({ cargo: el, dest: caja, size: h.tipo === 'rango' ? 128 : 108 }).then(() => {
    while (caja.children.length > 3) caja.firstElementChild!.remove();
  });

  // La barra sale de 0 y corre. El valor final va en el fotograma SIGUIENTE: si
  // se pone en el mismo, no hay estado anterior del que transicionar y aparece
  // ya lleno. Con reduced-motion la transicion esta apagada y el salto es el
  // valor correcto de una vez.
  if (meta) {
    const fill = el.querySelector<HTMLElement>('.db-fill')!;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fill.style.width = `${Math.max(0, Math.min(100, meta.pct))}%`;
    }));
  }
  t = window.setTimeout(quita, MS[h.tipo]);
  return quita;
}
