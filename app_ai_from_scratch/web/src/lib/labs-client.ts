// Labs interactivos. La corrección la hace el servidor: aquí solo se recoge la respuesta.
import { exito, fallo } from './fx';
import { sonar, prepararSonido } from './sound';
import { asomarGato } from './cat';
import { desbloquear } from './unlock';
import { abrirRoadmap, type RoadmapTxt } from './roadmap';

type Payload = Record<string, any>;
type Lab = { id: string; kind: string; payload: Payload; solved: boolean; draft: boolean };

// El id de un lab es "N.M": la lección es la parte de delante. Se usa para
// colocar el sonido en la escala, así que la 9 suena más arriba que la 2.
const leccionDe = (id: string) => Math.min(12, Math.max(1, Number(id.split('.')[0]) || 1));

// Racha de la sesion. No va al servidor a proposito: una racha es "ahora mismo
// vas seguido", no una estadistica historica. Un fallo la corta. Suena a partir
// de tres porque dos seguidos pasan por casualidad.
let racha = 0;

declare global { interface Window { toast: (k: string, t: string, b: string, key?: string) => void } }

// Cadenas y catálogo de rangos, puestos por la página (así el lab habla el idioma
// de la cuenta en vez de llevar español incrustado).
type LabTxt = {
  sinResp: string; sinRespB: string; noGuardo: string; correcto: string; todaviaNo: string;
  resuelto: string; resueltoB: string; sinResolver: string; sinResolverB: string;
  sinRed: string; sinRedB: string; enIntentos: string; errDe: string; rangoRep: string;
  logroEb: string; logroTitulo: string; logroSub: string; logroCerrar: string; logroSeguir: string;
  logroParada: string; rangos: string[]; grados: Record<string, string>;
  nuevoLogro: string; nuevoLogroB: string; tusIntentos: string; gatoMaestro?: string;
  db: Record<string, string>;
};
const TXT: LabTxt = (() => {
  const el = document.getElementById('lab-txt');
  return el ? JSON.parse(el.textContent ?? '{}') : ({} as LabTxt);
})();
const fill = (s: string, v: Record<string, string | number>) =>
  Object.entries(v).reduce((acc, [k, x]) => acc.replaceAll(`{${k}}`, String(x)), s ?? '');

/** Logros que llegan con el intento: aviso siempre, roadmap solo al subir rango. */
function celebrar(nuevos: { code: string; kind: string; lesson_n: number | null }[]) {
  if (!nuevos?.length) return;
  const rango = nuevos.filter((n) => n.kind === 'rango').map((n) => Number(n.code.slice(6))).sort((a, b) => b - a)[0];
  const deLeccion = nuevos.filter((n) => n.kind === 'leccion');
  if (deLeccion.length) {
    const ultimo = deLeccion[deLeccion.length - 1];
    const clave = ultimo.code.split('.')[1];
    const grado = TXT.grados?.[clave] ?? ultimo.code;
    // Los tres grados de una leccion estan ORDENADOS: aprendiz, oficiante,
    // maestro. La posicion es el progreso, asi que la barra sale del propio
    // codigo del logro y no hace falta pedir el recuento al servidor.
    const k = ['aprendiz', 'oficiante', 'maestro'].indexOf(clave) + 1;
    desbloquear({
      tipo: 'grado',
      titulo: `${grado} · ${TXT.db.leccionAbrev ?? 'Lección'} ${String(ultimo.lesson_n ?? 1).padStart(2, '0')}`,
      cuerpo: fill(TXT.nuevoLogroB ?? '', { grado, n: ultimo.lesson_n ?? '' }),
      meta: k > 0 ? { lbl: TXT.db.gradosDe, num: `${k} / 3`, pct: (k / 3) * 100 } : undefined,
    }, TXT.db.grado);
    // El grado suena distinto del lab: el lab pasa 36 veces, el grado 36 tambien
    // pero solo una por grado. El paso coloca la nota en la escala.
    // Y cerrar la leccion (el grado 'maestro') suena distinto de los otros dos
    // grados: es un cierre, no un avance, y el hito 'leccion' remata en quinta.
    if (ultimo.code.endsWith('.maestro')) {
      sonar('leccion', ultimo.lesson_n ?? 1);
      asomarGato(TXT.gatoMaestro ?? '¡Lección cerrada!');
    } else {
      sonar('estrella', ultimo.lesson_n ?? 1);
    }
  }
  if (rango) {
    const txt: RoadmapTxt = {
      eb: TXT.logroEb, titulo: TXT.logroTitulo, sub: TXT.logroSub,
      cerrar: TXT.logroCerrar, seguir: TXT.logroSeguir,
      rangos: TXT.rangos ?? [], paradaN: TXT.logroParada,
    };
    if (rango >= 12) sonar('final');   // las doce cerradas: se gana una vez
    else sonar('rango', rango);        // el cofre
    // CAMBIO DE COMPORTAMIENTO: antes el roadmap se abria solo a los 620ms. Un
    // modal que aparece encima mientras acabas de resolver un lab interrumpe, y
    // el camino tambien esta en /logros: nada se pierde por no forzarlo. Ahora
    // el aviso de desbloqueo entrega la insignia y el camino se abre si lo pides.
    desbloquear({
      tipo: 'rango', rango,
      titulo: TXT.rangos?.[rango - 1] ?? `${TXT.db.rango} ${rango}`,
      cuerpo: TXT.logroSub,
      meta: { lbl: TXT.db.camino, num: `${String(rango).padStart(2, '0')} / 12`, pct: (rango / 12) * 100 },
      accion: { txt: TXT.db.verCamino, fn: () => abrirRoadmap(rango, txt) },
    }, TXT.db.rango);
  }
}

const el = (tag: string, css = '', html = '') => {
  const n = document.createElement(tag);
  if (css) n.setAttribute('style', css);
  if (html) n.innerHTML = html;
  return n;
};

function softmax(logits: number[], T: number) {
  const xs = logits.map((l) => Math.exp(l / T));
  const s = xs.reduce((a, b) => a + b, 0);
  return xs.map((x) => x / s);
}

export function mountLabs() {
  // Desbloquea el audio con el primer gesto: si el AudioContext se crea fuera de
  // un gesto el navegador lo deja suspendido y el primer hito se pierde.
  prepararSonido();
  const boot = (fn: () => void) => { try { fn(); } catch (e) { console.error('lab no montado', e); } };
  document.querySelectorAll<HTMLElement>('[data-lab]').forEach((root) => {
    // Los labs en borrador no traen datos ni controles: no hay nada que montar.
    const data = root.querySelector<HTMLScriptElement>('script[type="application/json"]');
    if (!data || !root.querySelector('[data-stage]')) return;
    const lab: Lab = JSON.parse(data.textContent ?? '{}');
    const stage = root.querySelector<HTMLElement>('[data-stage]')!;
    const out = root.querySelector<HTMLElement>('[data-out]')!;
    const btn = root.querySelector<HTMLButtonElement>('[data-check]')!;
    const reset = root.querySelector<HTMLButtonElement>('[data-reset]')!;
    let answer: any = null;
    let render = () => {};
    let custom = false; // mecánicas que gestionan su propio envío

    const send = async () => {
      if (answer === null || answer === undefined) {
        window.toast('warn', fill(TXT.sinResp, { id: lab.id }), TXT.sinRespB, `lab-${lab.id}`);
        return;
      }
      btn.disabled = true;
      try {
        const res = await fetch(`/api/labs/${lab.id}/attempt`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ answer }),
        });
        const d = await res.json();
        if (!res.ok) {
          window.toast('bad', `Lab ${lab.id}`, d.msg ?? TXT.noGuardo, `lab-${lab.id}`);
          return;
        }
        root.dataset.result = d.correct ? 'ok' : 'bad';
        const color = d.correct ? 'var(--ok)' : 'var(--rd)';
        const extra = d.hint?.word ? ' ' + fill(TXT.errDe, { err: d.hint.err, word: d.hint.word })
                    : d.hint?.range ? ' ' + fill(TXT.rangoRep, { a: d.hint.range[0], b: d.hint.range[1] }) : '';
        out.innerHTML = `<div style="border-top:1px solid var(--hair2);padding-top:16px;display:flex;flex-direction:column;gap:7px">
            <div class="h3" style="color:${color}">${d.correct ? TXT.correcto : TXT.todaviaNo}</div>
            <p class="p" style="font-size:15px">${d.explanation}${extra}</p></div>`;
        // Resolver es un LOGRO (aviso de desbloqueo, con la insignia y el carril
        // verde); no resolver es informacion (toast normal). No es el mismo
        // objeto con otro color.
        if (!d.correct) {
          window.toast('bad', fill(TXT.sinResolver, { id: lab.id }), TXT.sinResolverB, `lab-${lab.id}`);
        }
        // el botón es el punto de la acción: de ahí salen las chispas
        if (d.correct) {
          desbloquear({ tipo: 'lab', titulo: fill(TXT.resuelto, { id: lab.id }), cuerpo: TXT.db.labCuerpo },
                       TXT.db.lab);
          racha++;
          if (racha >= 3) sonar('racha', Math.min(12, racha));
          else sonar('lab', leccionDe(lab.id));
          exito(root, btn);
          celebrar(d.nuevos);
        } else { racha = 0; sonar('fallo'); fallo(root); }
        render();
      } catch {
        window.toast('bad', TXT.sinRed, TXT.sinRedB, `lab-${lab.id}`);
      } finally {
        btn.disabled = false;
      }
    };

    // ---- mecánicas ----
    if (lab.kind === 'choice') {
      const opts: string[] = lab.payload.options ?? [];
      render = () => {
        stage.innerHTML = '';
        const row = el('div', 'display:flex;gap:10px;flex-wrap:wrap');
        opts.forEach((o) => {
          const c = el('button', 'min-width:78px', String(o));
          c.className = 'chip';
          if (answer === o) c.setAttribute(root.dataset.result === 'ok' ? 'data-ok' : root.dataset.result === 'bad' ? 'data-bad' : 'data-on', '');
          c.addEventListener('click', () => { answer = o; delete root.dataset.result; out.innerHTML = ''; render(); });
          row.append(c);
        });
        stage.append(row);
      };
    }

    if (lab.kind === 'cut') {
      const words: string[] = lab.payload.words ?? [];
      const cuts = new Set<string>();
      render = () => {
        stage.innerHTML = '';
        const row = el('div', 'display:flex;gap:44px;flex-wrap:wrap;align-items:center;padding:10px 0'); // 44px: el hueco entre palabras debe leerse más ancho que los cortes de 16px
        words.forEach((w, wi) => {
          const wrap = el('div', 'display:flex;align-items:center');
          w.split('').forEach((ch, i) => {
            wrap.append(el('div', 'font:500 26px/1 var(--m);padding:6px 1px', ch));
            if (i < w.length - 1) {
              const key = `${wi}-${i}`;
              const gap = el('button', `width:16px;height:44px;display:grid;place-items:center;background:none;border:0;cursor:pointer;padding:0`);
              gap.setAttribute('aria-label', `cortar tras ${ch}`);
              gap.append(el('div', `width:2px;height:30px;background:${cuts.has(key) ? 'var(--ac)' : 'rgba(84,84,88,.46)'}`));
              gap.addEventListener('click', () => {
                cuts.has(key) ? cuts.delete(key) : cuts.add(key);
                answer = [...cuts]; delete root.dataset.result; out.innerHTML = ''; render();
              });
              wrap.append(gap);
            }
          });
          row.append(wrap);
        });
        stage.append(row);
        stage.append(el('p', '', `<span class="s num">${cuts.size} cortes puestos</span>`));
      };
      reset.addEventListener('click', () => { cuts.clear(); answer = []; });
    }

    if (lab.kind === 'order') {
      const steps: { id: string; text: string }[] = lab.payload.steps ?? [];
      let seq: string[] = [];
      render = () => {
        stage.innerHTML = '';
        const grid = el('div', 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px');
        const pool = el('div', 'display:flex;flex-direction:column;gap:9px');
        pool.append(el('p', '', '<span class="lbl">Pasos disponibles</span>'));
        steps.filter((s) => !seq.includes(s.id)).forEach((s) => {
          const c = el('button', 'justify-content:flex-start;text-align:left;font:400 15px/1.4 var(--f);padding:12px 14px;min-height:52px', s.text);
          c.className = 'chip';
          c.addEventListener('click', () => { seq = [...seq, s.id]; answer = seq; delete root.dataset.result; out.innerHTML = ''; render(); });
          pool.append(c);
        });
        const mine = el('div', 'display:flex;flex-direction:column;gap:9px');
        mine.append(el('p', '', '<span class="lbl">Tu orden</span>'));
        if (!seq.length) mine.append(el('div', 'border:1px dashed var(--hair);padding:16px;text-align:center', '<p class="s">Haz clic en un paso para empezar.</p>'));
        seq.forEach((id, i) => {
          const s = steps.find((x) => x.id === id)!;
          // This used to compare steps[i].id against the placed id, i.e. against
          // the PAYLOAD's own order. That only looked right while seeding stored
          // the steps in solution order; the payload is now shuffled precisely so
          // it stops leaking the answer, and the client never receives
          // solution.order, so there is nothing here to self-check against.
          // The server returns one verdict for the whole sequence, so every row
          // shows that overall verdict instead of a made-up per-row one.
          const color = !root.dataset.result ? 'var(--hair)'
                      : root.dataset.result === 'ok' ? 'var(--ok)' : 'var(--rd)';
          mine.append(el('div', `display:flex;align-items:center;gap:12px;border:1px solid ${color};background:rgba(120,120,128,.10);padding:12px 14px;min-height:52px`,
            `<span class="num" style="font:600 13px/1 var(--m);color:${color}">${i + 1}</span><span style="font:400 15px/1.4 var(--f)">${s.text}</span>`));
        });
        grid.append(pool, mine);
        stage.append(grid);
      };
      reset.addEventListener('click', () => { seq = []; answer = null; });
    }

    if (lab.kind === 'build') {
      const slots: string[] = lab.payload.slots ?? [];
      const tiles: { slot: number; text: string }[] = lab.payload.tiles ?? [];
      const filled: (string | null)[] = slots.map(() => null);
      render = () => {
        stage.innerHTML = '';
        const box = el('div', 'display:flex;flex-direction:column;gap:10px');
        slots.forEach((label, i) => {
          const done = !!filled[i];
          const color = root.dataset.result ? (done ? 'var(--ok)' : 'var(--rd)') : done ? 'var(--ac)' : 'var(--hair)';
          box.append(el('div', 'display:flex;align-items:center;gap:12px',
            `<span class="lbl" style="width:92px;flex:none">${label}</span>
             <div style="flex:1;border:1px solid ${color};min-height:44px;display:flex;align-items:center;padding:0 14px;background:rgba(120,120,128,.10)">
               <span style="font:400 15px/1.4 var(--f);color:${done ? 'var(--l1)' : 'var(--l3)'}">${filled[i] ?? 'vacío'}</span></div>`));
        });
        const pool = el('div', 'display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--hair2);padding-top:14px;margin-top:4px');
        tiles.filter((t) => filled[t.slot] !== t.text).forEach((t) => {
          const c = el('button', 'min-height:40px;font:400 14px/1.2 var(--f)', t.text);
          c.className = 'chip';
          c.addEventListener('click', () => { filled[t.slot] = t.text; answer = { ...filled }; delete root.dataset.result; out.innerHTML = ''; render(); });
          pool.append(c);
        });
        stage.append(box, pool);
      };
      reset.addEventListener('click', () => { filled.fill(null); answer = null; });
    }

    if (lab.kind === 'knob') {
      const cands: { name: string; logit: number }[] = lab.payload.cands ?? [];
      let t = 20;
      answer = t;
      render = () => {
        stage.innerHTML = '';
        const T = 0.12 + (t / 100) * 1.5;
        const ps = softmax(cands.map((c) => c.logit), T);
        const top = ps.indexOf(Math.max(...ps));
        const slider = el('div', 'display:flex;align-items:center;gap:16px');
        slider.innerHTML = `<span class="num" style="font:600 13px/1 var(--m);color:var(--l3)">FRÍA</span>
          <input type="range" min="0" max="100" value="${t}">
          <span class="num" style="font:600 13px/1 var(--m);color:var(--l3)">CREATIVA</span>`;
        slider.querySelector('input')!.addEventListener('input', (e) => {
          t = Number((e.target as HTMLInputElement).value); answer = t; delete root.dataset.result; out.innerHTML = ''; render();
        });
        const head = el('div', 'display:flex;align-items:baseline;gap:10px',
          `<span class="num" style="font:700 26px/1 var(--f);letter-spacing:-.03em">T = ${T.toFixed(2)}</span>
           <span class="s">gana <b style="color:var(--l1);font-weight:600">${cands[top].name}</b> con ${Math.round(ps[top] * 100)} de 100</span>`);
        const bars = el('div', 'display:flex;flex-direction:column;gap:9px');
        cands.forEach((c, i) => bars.append(el('div', 'display:flex;align-items:center;gap:12px',
          `<span class="s" style="width:108px;flex:none;color:var(--l2)">${c.name}</span>
           <div style="flex:1;height:10px;background:rgba(120,120,128,.18)"><div style="height:10px;width:${(ps[i] * 100).toFixed(1)}%;background:${i === top ? 'var(--ac)' : 'var(--l3)'}"></div></div>
           <span class="num s" style="width:42px;text-align:right">${Math.round(ps[i] * 100)}</span>`)));
        stage.append(slider, head, bars);
      };
      reset.addEventListener('click', () => { t = 20; answer = t; });
    }

    if (lab.kind === 'hotcold') {
      let g = 50;
      const tries: { n: number; err: number; word: string }[] = [];
      answer = g;
      const orig = send;
      render = () => {
        stage.innerHTML = '';
        const row = el('div', 'display:flex;align-items:center;gap:16px');
        row.innerHTML = `<input type="range" min="${lab.payload.min ?? 1}" max="${lab.payload.max ?? 100}" value="${g}">
          <span class="num" style="font:700 26px/1 var(--f);letter-spacing:-.03em;width:58px;text-align:right">${g}</span>`;
        row.querySelector('input')!.addEventListener('input', (e) => { g = Number((e.target as HTMLInputElement).value); answer = g; render(); });
        const list = el('div', 'display:flex;flex-direction:column;gap:8px;margin-top:8px');
        list.append(el('p', '', `<span class="lbl">${TXT.tusIntentos ?? 'Tus intentos · error'}</span>`));
        tries.forEach((x, i) => {
          const color = x.err === 0 ? 'var(--ok)' : x.err <= 5 ? 'var(--or)' : x.err <= 20 ? 'var(--l2)' : 'var(--ac)';
          list.append(el('div', 'display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--hair2);padding-bottom:7px',
            `<span class="num s" style="width:30px;color:var(--l3)">${i + 1}</span>
             <span class="num" style="font:500 15px/1 var(--m);width:44px">${x.n}</span>
             <span class="s" style="color:${color};flex:1">${x.word}</span>
             <span class="num" style="font:600 15px/1 var(--m);color:${color}">${x.err}</span>`));
        });
        stage.append(row, list);
      };
      custom = true;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const res = await fetch(`/api/labs/${lab.id}/attempt`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer: g }),
          });
          const d = await res.json();
          if (!res.ok) { window.toast('bad', `Lab ${lab.id}`, d.msg ?? TXT.noGuardo, `lab-${lab.id}`); return; }
          tries.push({ n: g, err: d.hint.err, word: d.hint.word });
          render();
          if (d.correct) {
            root.dataset.result = 'ok';
            out.innerHTML = `<div style="border-top:1px solid var(--hair2);padding-top:16px;display:flex;flex-direction:column;gap:7px">
              <div class="h3" style="color:var(--ok)">${TXT.correcto}</div><p class="p" style="font-size:15px">${d.explanation}</p></div>`;
            desbloquear({ tipo: 'lab', titulo: fill(TXT.resuelto, { id: lab.id }),
                          cuerpo: fill(TXT.enIntentos, { n: tries.length }) }, TXT.db.lab);
            racha++;
            if (racha >= 3) sonar('racha', Math.min(12, racha));
            else sonar('lab', leccionDe(lab.id));
            exito(root, btn);
            celebrar(d.nuevos);
          } else {
            racha = 0;
            sonar('fallo');
            fallo(root);
          }
        } catch {
          window.toast('bad', TXT.sinRed, TXT.sinRedB, `lab-${lab.id}`);
        } finally { btn.disabled = false; }
      });
      void orig;
    }

    if (!custom) btn.addEventListener('click', send);
    reset.addEventListener('click', () => { delete root.dataset.result; out.innerHTML = ''; render(); });
    boot(render);
  });
}
