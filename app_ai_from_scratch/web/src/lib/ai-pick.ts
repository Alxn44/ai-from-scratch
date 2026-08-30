// Elección de modelo y de esfuerzo para el modo IA.
//
// SE ELIGE UN CARRIL, NO UNA MARCA. Antes este fichero llevaba su propia tabla:
//
//   { id: 'sonnet',   marca: 'Anthropic', modelo: 'claude-sonnet-5' }
//   { id: 'together', marca: 'Together',  modelo: 'moonshotai/Kimi-K2.7-Code' }
//   …
//
// Esa tabla es una COPIA de ai/src/course_ai/agent/providers.py, y las copias se
// quedan viejas en silencio: el comentario de providers.py:129 ya documenta un
// cambio de modelo en Together, y aquí no se enteró nadie. El día que un id
// desaparece, el botón sigue pintado, el alumno lo pulsa y el servidor recibe un
// proveedor que no existe. Eso es exactamente lo que prohíbe la regla 4 de la
// casa: generar desde la fuente de verdad, nunca desde una copia.
//
// Ahora la fuente es el servidor. `/api/chat/estado` devuelve, por proveedor, su
// id, su modelo y su CARRIL — `flash` (rápido y barato) o `razon`. El carril sale
// de Provider.lane en providers.py, que es quien lo decide de verdad.
//
// Y lo que se guarda es el CARRIL, no el id. Un id guardado caduca cuando cambia
// la tabla del servidor; un carril no. Si el carril no se puede resolver contra
// la lista de hoy, no se manda `proveedor` y elige el servidor — que es mejor que
// mandar un id muerto.
//
// LO QUE NO SE OCULTA: qué proveedor respondió de hecho. El selector dice
// «Rápido» / «Razona» porque eso es lo que se elige, pero el pie de cada
// respuesta sigue diciendo «Responde {p} · modelo {m}» (i18n `proveedorPie`).
// La política de privacidad publicada lo promete con estas palabras: «te diremos
// en la misma pantalla qué proveedor atiende tu mensaje» (i18n.ts, priv).
// Quitarlo no es una decisión de diseño, es incumplir esa frase.

export type Esfuerzo = 'bajo' | 'medio' | 'alto';
export type Carril = 'flash' | 'razon';

/** Una fila de `/api/chat/estado` → `proveedores[]`. */
export type Prov = { id: string; modelo?: string | null; carril?: string | null };

export const ESFUERZOS: Esfuerzo[] = ['bajo', 'medio', 'alto'];
export const CARRILES: Carril[] = ['flash', 'razon'];

const K_C = 'ia.carril';
const K_E = 'ia.esfuerzo';
const watchers = new Set<() => void>();

const esCarril = (v: unknown): v is Carril => CARRILES.includes(v as Carril);
const esEsfuerzo = (v: unknown): v is Esfuerzo => ESFUERZOS.includes(v as Esfuerzo);

export function leerCarril(): Carril {
  try {
    const c = localStorage.getItem(K_C);
    return esCarril(c) ? c : 'flash';
  } catch { return 'flash'; }
}

export function leerEsfuerzo(): Esfuerzo {
  try {
    const e = localStorage.getItem(K_E);
    return esEsfuerzo(e) ? e : 'medio';
  } catch { return 'medio'; }
}

/**
 * Lo que se manda por el cable antes de montar nada. `proveedor` va en null a
 * propósito: sin la lista del servidor no se puede resolver un carril, y un id
 * inventado es peor que dejar elegir al servidor.
 */
export function leerPick(): { proveedor: string | null; esfuerzo: Esfuerzo } {
  return { proveedor: null, esfuerzo: leerEsfuerzo() };
}

export function escribirPick(next: { carril?: Carril; esfuerzo?: Esfuerzo }): void {
  try {
    if (next.carril) localStorage.setItem(K_C, next.carril);
    if (next.esfuerzo) localStorage.setItem(K_E, next.esfuerzo);
  } catch { /* modo privado */ }
  for (const fn of watchers) fn();
}

/** Primer proveedor vivo de ese carril, o null si hoy no hay ninguno. */
export function resolver(carril: Carril, provs: Prov[]): string | null {
  return provs.find((p) => p.carril === carril)?.id ?? null;
}

/** Carriles que el servidor puede atender ahora mismo. */
export function carrilesVivos(provs: Prov[]): Carril[] {
  return CARRILES.filter((c) => provs.some((p) => p.carril === c));
}

export type PickLabels = {
  modelo: string;
  esfuerzo: string;
  bajo: string;
  medio: string;
  alto: string;
  carrilFlash: string;
  carrilRazon: string;
};

/**
 * Monta los dos grupos de botones y devuelve un lector de lo elegido, ya
 * resuelto a lo que espera el cable.
 */
export function montarPick(
  host: HTMLElement,
  labels: PickLabels,
  provs: Prov[],
): () => { proveedor: string | null; esfuerzo: Esfuerzo } {
  const vivos = carrilesVivos(provs);
  let carril = leerCarril();
  // Si el carril guardado hoy no lo sirve nadie, se cae al otro en vez de
  // quedarse en un botón que no hace nada.
  if (vivos.length && !vivos.includes(carril)) {
    carril = vivos[0];
    escribirPick({ carril });
  }
  let esfuerzo = leerEsfuerzo();

  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'ia-pick';

  const mkLab = (txt: string) => {
    const p = document.createElement('p');
    p.className = 'lbl';
    p.textContent = txt;
    return p;
  };

  const pinta = () => {
    wrap.querySelectorAll<HTMLButtonElement>('.ia-pickb[data-carril]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.carril === carril));
    });
    wrap.querySelectorAll<HTMLButtonElement>('.ia-pickb[data-eff]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.eff === esfuerzo));
    });
  };

  wrap.append(mkLab(labels.modelo));
  const grid = document.createElement('div');
  grid.className = 'ia-picks';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', labels.modelo);
  const nombreCarril: Record<Carril, string> = {
    flash: labels.carrilFlash, razon: labels.carrilRazon,
  };
  for (const c of CARRILES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ia-pickb';
    b.dataset.carril = c;
    // Deshabilitado cuando el servidor no tiene ninguna llave de ese carril. El
    // dato viene del servidor, no de una lista escrita aquí.
    b.disabled = !vivos.includes(c);
    b.textContent = nombreCarril[c];
    b.addEventListener('click', () => {
      if (b.disabled) return;
      carril = c;
      escribirPick({ carril: c });
      pinta();
    });
    grid.append(b);
  }

  wrap.append(grid, mkLab(labels.esfuerzo));
  const row = document.createElement('div');
  row.className = 'ia-eff';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', labels.esfuerzo);
  const nombreEsf: Record<Esfuerzo, string> = {
    bajo: labels.bajo, medio: labels.medio, alto: labels.alto,
  };
  for (const e of ESFUERZOS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ia-pickb';
    b.dataset.eff = e;
    b.textContent = nombreEsf[e];
    b.addEventListener('click', () => {
      esfuerzo = e;
      escribirPick({ esfuerzo: e });
      pinta();
    });
    row.append(b);
  }
  wrap.append(row);
  host.append(wrap);

  const sync = () => { carril = leerCarril(); esfuerzo = leerEsfuerzo(); pinta(); };
  watchers.add(sync);
  pinta();

  return () => ({ proveedor: resolver(carril, provs), esfuerzo });
}

/**
 * La variante COMPACTA, la que vive dentro del composer del chat: un grupo
 * segmentado para el carril y una pista con tirador para el esfuerzo.
 *
 * El handoff pedía un `<select>` nativo. No se usa: el producto no tiene ni un
 * solo select nativo, y los dos toggles que están justo encima en la misma barra
 * (idioma y tema, App.astro:477-489) son grupos `.seg`. Un desplegable del
 * sistema ahí sería el único control con la caja del navegador en toda la
 * pantalla. La misma anatomía, más consistente.
 *
 * El esfuerzo sí es una pista con tirador, como en la maqueta, pero montada
 * sobre un `<input type="range">` de verdad: así funciona con teclado y lo lee
 * un lector de pantalla, cosa que un div con un punto encima no hace.
 */
export function montarPickCompacto(
  host: HTMLElement,
  labels: PickLabels,
  provs: Prov[],
): () => { proveedor: string | null; esfuerzo: Esfuerzo } {
  const vivos = carrilesVivos(provs);
  let carril = leerCarril();
  if (vivos.length && !vivos.includes(carril)) { carril = vivos[0]; escribirPick({ carril }); }
  let esfuerzo = leerEsfuerzo();

  host.innerHTML = '';
  host.className = 'ch-pick';

  const seg = document.createElement('div');
  seg.className = 'seg';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', labels.modelo);
  const nombreCarril: Record<Carril, string> = { flash: labels.carrilFlash, razon: labels.carrilRazon };
  for (const c of CARRILES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'segb';
    b.dataset.carril = c;
    b.disabled = !vivos.includes(c);
    b.textContent = nombreCarril[c];
    b.addEventListener('click', () => {
      if (b.disabled) return;
      carril = c; escribirPick({ carril: c }); pinta();
    });
    seg.append(b);
  }

  const eff = document.createElement('div');
  eff.className = 'ch-eff';
  const rango = document.createElement('input');
  rango.type = 'range';
  rango.min = '0'; rango.max = '2'; rango.step = '1';
  rango.value = String(ESFUERZOS.indexOf(esfuerzo));
  rango.setAttribute('aria-label', labels.esfuerzo);
  const nombreEsf: Record<Esfuerzo, string> = { bajo: labels.bajo, medio: labels.medio, alto: labels.alto };
  const eco = document.createElement('span');
  eco.className = 'ch-eff-t';
  rango.addEventListener('input', () => {
    esfuerzo = ESFUERZOS[Number(rango.value)] ?? 'medio';
    escribirPick({ esfuerzo });
    pinta();
  });
  eff.append(rango, eco);

  const pinta = () => {
    seg.querySelectorAll<HTMLButtonElement>('.segb[data-carril]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.carril === carril));
    });
    rango.value = String(ESFUERZOS.indexOf(esfuerzo));
    eco.textContent = nombreEsf[esfuerzo];
    // El relleno de la pista se pinta con una variable, no con un div extra
    // superpuesto: así el tirador nativo sigue siendo el tirador.
    rango.style.setProperty('--pc', `${(ESFUERZOS.indexOf(esfuerzo) / 2) * 100}%`);
  };

  host.append(seg, eff);
  watchers.add(() => { carril = leerCarril(); esfuerzo = leerEsfuerzo(); pinta(); });
  pinta();
  return () => ({ proveedor: resolver(carril, provs), esfuerzo });
}
