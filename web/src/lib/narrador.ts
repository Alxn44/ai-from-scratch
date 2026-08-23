// Texto narrado. Lee en voz alta los bloques marcados con data-narra, en orden,
// resaltando la frase que va sonando.
//
// LO QUE NO CONTROLAMOS: la voz es del sistema operativo del alumno, no nuestra.
// En macOS el español suena decente; en Chrome sobre Linux sin voces instaladas
// getVoices() devuelve [] y no hay narración posible. Por eso la barra DEGRADA
// VISIBLE con el motivo escrito, en vez de quedarse muda y parecer roto. La
// alternativa es TTS de servidor, que se paga por carácter.
//
// CUATRO DECISIONES CONTRA LA IMPLEMENTACIÓN OBVIA:
//
// 1. UNA FRASE POR UTTERance, ENCADENADAS CON onend. Lo obvio es meter el texto
//    entero en un SpeechSynthesisUtterance. Chrome lo corta alrededor de los 15
//    segundos y te quedas a medias sin ningún error. Además, encolar de una en
//    una es lo que permite saber en qué frase vamos y poder parar en seco.
//
// 2. EL RESALTADO SALE DE LOS TROZOS, NO DE LOS EVENTOS 'boundary'. Lo obvio es
//    escuchar boundary y subrayar palabra por palabra. Firefox no dispara
//    boundary con muchas voces, así que ese resaltado se queda quieto en media
//    Internet. Con una frase por utterance, el índice de frase es exacto en todos
//    los navegadores sin depender de ningún evento opcional.
//
// 3. SIN LOOKBEHIND EN EL PARTIDOR DE FRASES. Un /(?<=[.!?])\s+/ es más corto,
//    pero Safari anterior a 16.4 lanza SyntaxError al PARSEAR el módulo, o sea
//    que rompe todo el bundle, no solo la narración. El recorrido a mano es feo
//    y funciona en todas partes.
//
// 4. NUNCA ARRANCA SOLO. Una voz que empieza a hablar sin que la llames es
//    hostil, y en una pestaña de fondo es peor.
//
// Y se cancela al salir de la página: sin eso la voz sigue hablando encima de la
// pantalla siguiente.

const CLAVE_VEL = 'curso.narra.vel';

export type NarradorTxt = {
  leer: string; pausa: string; seguir: string; parar: string;
  vel: string; deN: string; voz: string; preparando: string;
  sinVoz: string; sinVozB: string; sinSoporte: string;
};

// Abreviaturas que llevan punto y NO terminan frase. Es una lista, no una regla
// lista: no hay heuristica que distinga «art. 5» de «Repite eso. 100 veces» sin
// saber que art es una abreviatura. Corta y explicita antes que lista y falsa.
const ABREV = new Set(['art', 'núm', 'num', 'no', 'pág', 'pag', 'fig', 'etc', 'ej',
                       'p', 'pp', 'cap', 'vol', 'sr', 'sra', 'dr', 'dra', 'aprox',
                       'vs', 'ss', 'ed', 'trad']);

/** Trocea en frases sin lookbehind: Safari < 16.4 no lo parsea. */
function frases(t: string): string[] {
  const cierra = new Set(['.', '!', '?', '…', ';']);
  const abre = new Set(['¿', '¡', '«', '"', '(', "'"]);
  const out: string[] = [];
  let ini = 0;
  for (let i = 0; i < t.length; i++) {
    if (!cierra.has(t[i])) continue;
    // los puntos seguidos («…» escrito como ...) cuentan como uno
    let j = i;
    while (j + 1 < t.length && cierra.has(t[j + 1])) j++;
    const sig = t[j + 1];
    if (sig !== ' ' && sig !== '\n' && sig !== undefined) { i = j; continue; }
    const luego = t.slice(j + 2, j + 3);
    // La palabra justo antes del punto decide si es abreviatura. Sin esto,
    // «según el art. 5 de la ley» se partia en dos y la voz cortaba en seco:
    // medido en el banco de pruebas, no supuesto.
    const antes = t.slice(0, j).match(/([\p{L}]+)$/u)?.[1]?.toLowerCase() ?? '';
    if (t[j] === '.' && ABREV.has(antes)) { i = j; continue; }
    // corta solo si lo que viene abre frase de verdad: mayúscula, número o signo
    // de apertura. «S.A. y otros» no se parte porque lo que sigue es minúscula.
    const cortaAqui = sig === undefined || luego === '' ||
      abre.has(luego) || luego === luego.toUpperCase() && luego !== luego.toLowerCase() ||
      /[0-9]/.test(luego);
    if (!cortaAqui) { i = j; continue; }
    const trozo = t.slice(ini, j + 1).trim();
    if (trozo) out.push(trozo);
    ini = j + 1;
    i = j;
  }
  const resto = t.slice(ini).trim();
  if (resto) out.push(resto);
  // frases de una o dos letras son basura de puntuación: se pegan a la anterior
  return out.reduce<string[]>((a, f) => {
    if (f.length <= 2 && a.length) a[a.length - 1] += ' ' + f;
    else a.push(f);
    return a;
  }, []);
}

// El curso usa →, ≈, ≠, ·, ∞ a propósito en la pantalla. La voz los lee como
// nada o como «flecha derecha». Como el texto que se HABLA es independiente del
// que se MUESTRA, aquí se traducen y en pantalla siguen igual.
// La flecha va a COMA, no a «entonces». Primero puse «entonces» y el texto real
// dice «bigotes → entonces gato»: salia «entonces entonces». Una coma funciona en
// los dos casos, y en «94 → 23 → 4» se lee como la lista que es.
const VOZ: [RegExp, string][] = [
  [/\s*→\s*/g, ', '],
  [/\s*≈\s*/g, ' aproximadamente '],
  [/\s*≠\s*/g, ' no es lo mismo que '],
  [/\s*=\s*/g, ' igual a '],
  [/\s*∞\s*/g, ' infinitas '],
  [/\s*·\s*/g, ', '],
  [/\s*\+\s*/g, ' más '],
  [/«|»/g, ''],
];
const paraVoz = (t: string) => VOZ.reduce((a, [re, x]) => a.replace(re, x), t).replace(/\s+/g, ' ').trim();

// Un trozo de 24 palabras son unos 9 segundos a velocidad 1; Chrome corta la
// utterance alrededor de los 15. Medido en la lección 1: hay una frase REAL de 37
// palabras que ningún partidor de frases puede dividir, porque es una sola frase.
// Se parte por los cortes secundarios (guion largo, punto y coma, dos puntos,
// coma) buscando el más cercano a la mitad, para no dejar un trozo de dos
// palabras. Si no hay ninguno, se deja larga: antes eso que partir a media palabra.
const LARGO = 24;
function acorta(t: string): string[] {
  if (t.split(' ').length <= LARGO) return [t];
  for (const sep of [' — ', ' – ', '; ', ': ', ', ']) {
    const trozos: number[] = [];
    let k = t.indexOf(sep);
    while (k !== -1) { trozos.push(k); k = t.indexOf(sep, k + 1); }
    if (!trozos.length) continue;
    const medio = t.length / 2;
    const corte = trozos.reduce((a, x) => (Math.abs(x - medio) < Math.abs(a - medio) ? x : a));
    const izq = t.slice(0, corte).trim(), der = t.slice(corte + sep.length).trim();
    if (izq.split(' ').length < 4 || der.split(' ').length < 4) continue;
    return [...acorta(izq), ...acorta(der)];
  }
  return [t];
}

// Un trozo tiene el texto que se HABLA y el elemento que se RESALTA. No son lo
// mismo: en un bloque de solo texto el resaltado es un <span> creado aquí; en un
// bloque con estructura es la hoja original, que no se puede partir sin romperla.
type Trozo = {
  texto: string;                 // lo que se HABLA (normalizado)
  el: HTMLElement | null;        // lo que se RESALTA
  bloque: HTMLElement;
  visible: string;               // lo que se MUESTRA, para partir en palabras
};

/** Hojas de un bloque: elementos sin hijos elemento y con texto. */
function hojas(b: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const anda = (e: HTMLElement) => {
    const hijos = Array.from(e.children) as HTMLElement[];
    if (!hijos.length) { if ((e.textContent ?? '').trim()) out.push(e); return; }
    for (const h of hijos) anda(h);
  };
  anda(b);
  return out;
}

// ---------------------------------------------------------------------------
// ELECCIÓN DE VOZ
//
// «Suena robótica» casi nunca es culpa de este código: la voz es del sistema
// operativo. Lo único honesto que se puede hacer aquí es (a) dejar de elegirla yo
// a ciegas y ofrecer las que hay, y (b) no poner por defecto las que sabemos que
// son las malas. Voz neural de calidad uniforme = TTS de servidor, y eso se paga
// por carácter.
//
// Las penalizadas, por qué:
//   eSpeak / espeak-ng  sintetizador de formantes de los 90. ES el sonido robot.
//   ...Compact          voces comprimidas de iOS/macOS, la versión mala de la buena.
//   Microsoft ...Desktop SAPI5 antigua; la de «Online (Natural)» es otra cosa.
//   Mónica / Jorge      Apple clásicas, muy anteriores a las de 2022.
// Y se premia lo que suele ser neural: Natural, Premium, Enhanced, Siri, Google.
const CASTIGO = [/espeak/i, /compact/i, /\bdesktop\b/i, /^m[oó]nica$/i, /^jorge$/i, /pico/i];
const PREMIO = [/natural/i, /premium/i, /enhanced/i, /siri/i, /google/i, /neural/i, /wavenet/i];

function puntua(v: SpeechSynthesisVoice): number {
  let p = 0;
  for (const re of PREMIO) if (re.test(v.name)) p += 10;
  for (const re of CASTIGO) if (re.test(v.name)) p -= 25;
  if (v.localService) p += 3;      // no depende de red y no se corta a mitad
  if (v.default) p += 1;
  return p;
}

const CLAVE_VOZ = 'curso.narra.voz';

// ---------------------------------------------------------------------------

export function montarNarrador(host: HTMLElement, raiz: HTMLElement, lang: string, T: NarradorTxt) {
  const sint = window.speechSynthesis;
  const barra = document.createElement('div');
  barra.className = 'card';
  barra.setAttribute('style',
    'position:sticky;bottom:14px;z-index:30;background:var(--bg);display:flex;align-items:center;'
    + 'gap:12px;flex-wrap:wrap;padding:12px 14px;border-left:2px solid var(--ac)');
  host.append(barra);

  const etiqueta = document.createElement('p');
  etiqueta.className = 'lbl';

  if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) {
    etiqueta.textContent = T.sinSoporte;
    barra.append(etiqueta);
    return;
  }
  estilos();

  // ---- recolección --------------------------------------------------------
  const trozos: Trozo[] = [];
  for (const b of Array.from(raiz.querySelectorAll<HTMLElement>('[data-narra]'))) {
    const texto = (b.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!texto) continue;
    if (b.children.length === 0) {
      const fs = frases(texto);
      b.textContent = '';
      fs.forEach((f, k) => {
        const sp = document.createElement('span');
        sp.textContent = (k ? ' ' : '') + f;
        b.append(sp);
        for (const c of acorta(paraVoz(f))) trozos.push({ texto: c, el: sp, bloque: b, visible: f });
      });
    } else {
      const hs = hojas(b);
      let pend = '', ancla: HTMLElement | null = null;
      const suelta = (t: string, el: HTMLElement) => {
        for (const f of frases(t)) for (const c of acorta(paraVoz(f)))
          trozos.push({ texto: c, el, bloque: b, visible: f });
      };
      for (const h of hs) {
        const t = (h.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!t) continue;
        if (t.split(' ').length <= 3 && !pend) { pend = t; ancla = h; continue; }
        if (pend) { suelta(pend + ': ' + t, ancla ?? h); pend = ''; ancla = null; }
        else suelta(t, h);
      }
      if (pend) suelta(pend, ancla ?? b);
    }
  }
  if (!trozos.length) return;

  // ---- voces --------------------------------------------------------------
  let voces: SpeechSynthesisVoice[] = [];
  let voz: SpeechSynthesisVoice | null = null;
  const pilla = () => {
    const vs = sint.getVoices();
    if (!vs.length) return false;
    voces = vs.filter((v) => v.lang.toLowerCase().startsWith(lang))
              .sort((a, b2) => puntua(b2) - puntua(a) || a.name.localeCompare(b2.name));
    const guardada = localStorage.getItem(CLAVE_VOZ);
    voz = voces.find((v) => v.name === guardada) ?? voces[0] ?? null;
    return true;
  };
  pilla();
  sint.addEventListener?.('voiceschanged', () => { pilla(); llenaVoces(); pinta(); });

  // ---- estado -------------------------------------------------------------
  let i = 0, hablando = false, pausado = false, arrancando = false;
  // Contador de generacion. Un onend viejo puede llegar DESPUES de cancel()
  // (Chrome lo hace en algunas versiones), y si entre medias ya volviste a pulsar
  // Leer, la guarda `!hablando` ya no lo para: arrancaria una segunda cadena
  // encima de la primera y se oirian dos frases a la vez. Medido: 46 frases
  // habladas en una leccion de 24. Cada arranque sube gen y cada callback
  // comprueba la suya; los de generaciones viejas se caen solos.
  let gen = 0;
  let vel = Number(localStorage.getItem(CLAVE_VEL) ?? '1') || 1;
  const VELS = [0.8, 1, 1.25, 1.5];
  // Caracteres por segundo, para estimar cuánto dura una frase. Arranca en 15
  // (medido a ojo en español a velocidad 1) y se auto-calibra con lo que tarda
  // de verdad cada frase: al tercer trozo ya va ajustado a la voz del equipo.
  let cps = 15;
  let palabras: HTMLElement[] = [];
  let raf = 0, t0 = 0, dur = 0, fracEvento = 0;

  // ---- resaltado ----------------------------------------------------------
  const limpia = () => {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    for (const t of trozos) {
      t.el?.classList.remove('nr-act');
      if (t.bloque.dataset.nrOn) { t.bloque.style.borderColor = ''; delete t.bloque.dataset.nrOn; }
    }
    // las palabras vuelven a ser texto plano: dejar 40 <span> por frase leída
    // hincha el DOM de la lección entera sin que nadie los use
    for (const p of palabras) p.replaceWith(document.createTextNode(p.textContent ?? ''));
    palabras = [];
    for (const t of trozos) t.el?.normalize();
  };

  // Palabra por palabra, pero SIN depender de charIndex.
  // El texto hablado está normalizado (flechas a comas, «+» a «más»), así que el
  // índice de carácter del evento boundary NO corresponde al texto mostrado. Lo
  // que sí corresponde es la FRACCIÓN: charIndex/largo hablado aplicado sobre el
  // número de palabras mostradas. Inmune al desajuste de tokens.
  const marca = (k: number) => {
    limpia();
    const t = trozos[k];
    if (!t?.el) return;
    t.el.classList.add('nr-act');
    t.bloque.style.borderColor = 'var(--ac)';
    t.bloque.dataset.nrOn = '1';
    // se parte en palabras solo la frase activa
    const txt = t.el.textContent ?? '';
    const partes = txt.split(/(\s+)/);
    t.el.textContent = '';
    for (const p of partes) {
      if (!p.trim()) { t.el.append(document.createTextNode(p)); continue; }
      const w = document.createElement('span');
      w.className = 'nr-w';
      w.textContent = p;
      t.el.append(w);
      palabras.push(w);
    }
    const r = t.bloque.getBoundingClientRect();
    if (r.top < 70 || r.bottom > window.innerHeight - 130)
      t.bloque.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const avanza = () => {
    raf = 0;
    if (!palabras.length || !hablando || pausado) return;
    const pasado = (performance.now() - t0) / 1000;
    // TECHO 0.92: la duracion es una ESTIMACION. Si se queda corta, el barrido
    // llega al final antes que la voz y la ultima palabra se ilumina sin haberse
    // dicho — el seguimiento adelanta a la lectura, que es peor que no tenerlo.
    // En Chrome y Safari los eventos boundary corrigen el reloj; en Firefox no
    // existen y el error se acumula sin nada que lo frene. Con el techo, el
    // adelanto maximo es la ultima palabra, y onend la enciende al terminar.
    const f = Math.max(0, Math.min(0.92, dur ? pasado / dur : 0));
    const n = Math.min(palabras.length, Math.floor(f * palabras.length + 0.0001));
    for (let k = 0; k < palabras.length; k++)
      palabras[k].classList.toggle('nr-dicha', k < n);
    if (n < palabras.length) palabras[n]?.classList.add('nr-ahora');
    for (let k = 0; k < palabras.length; k++) if (k !== n) palabras[k].classList.remove('nr-ahora');
    raf = requestAnimationFrame(avanza);
  };

  // ---- habla --------------------------------------------------------------
  const PAUSA_FRASE = 140;   // respirar entre frases: sin esto suena a metralleta
  const PAUSA_BLOQUE = 340;  // y más al cambiar de tarjeta, que es cambiar de idea

  const di = (k: number) => {
    if (k >= trozos.length) { parar(); return; }
    const mia = gen;
    const vigente = () => mia === gen && hablando && !pausado;
    i = k;
    marca(k);
    const u = new SpeechSynthesisUtterance(trozos[k].texto);
    try { if (voz) u.voice = voz; } catch { voz = null; }
    u.lang = voz?.lang ?? (lang === 'en' ? 'en-US' : 'es-ES');
    u.rate = vel;
    dur = trozos[k].texto.length / (cps * vel);
    t0 = performance.now();
    fracEvento = 0;
    // boundary corrige el reloj cuando el navegador lo dispara (Chrome, Safari).
    // Firefox no lo manda con muchas voces: por eso el reloj es la vía principal
    // y esto solo lo ajusta, en vez de al contrario.
    u.onboundary = (e) => {
      if (mia !== gen) return;
      const largo = trozos[k].texto.length || 1;
      const f = Math.max(0, Math.min(1, (e.charIndex ?? 0) / largo));
      if (f <= fracEvento) return;
      fracEvento = f;
      // se mueve el origen para que el reloj coincida con el evento: el avance
      // sigue siendo suave, pero anclado a lo que de verdad va sonando
      if (f > 0.02) t0 = performance.now() - f * dur * 1000;
    };
    u.onstart = () => { if (mia !== gen) return; arrancando = false; t0 = performance.now(); pinta(); };
    u.onend = () => {
      if (!vigente()) return;
      const real = (performance.now() - t0) / 1000;
      // calibración: media móvil, solo con frases largas (las cortas están
      // dominadas por la latencia de arranque del motor y falsean la medida)
      if (real > 0.6 && trozos[k].texto.length > 24) {
        const obs = trozos[k].texto.length / (real * vel);
        if (obs > 5 && obs < 40) cps = cps * 0.7 + obs * 0.3;
      }
      for (const p of palabras) { p.classList.add('nr-dicha'); p.classList.remove('nr-ahora'); }
      const cambia = trozos[k + 1] && trozos[k + 1].bloque !== trozos[k].bloque;
      setTimeout(() => { if (vigente()) di(k + 1); }, cambia ? PAUSA_BLOQUE : PAUSA_FRASE);
    };
    u.onerror = () => { if (vigente()) di(k + 1); };
    try { sint.speak(u); } catch { parar(); return; }
    if (!raf) raf = requestAnimationFrame(avanza);
    pinta();
  };

  const arranca = () => {
    if (!voz && !pilla()) { pinta(); return; }
    gen++;
    sint.cancel();
    hablando = true; pausado = false;
    arrancando = true;          // el motor tarda 200-500ms: hay que decirlo YA
    pinta();
    di(i >= trozos.length ? 0 : i);
  };
  const pausa = () => {
    pausado = true;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    sint.pause();
    setTimeout(() => { if (!sint.paused) sint.cancel(); pinta(); }, 60);
    pinta();
  };
  const sigue = () => {
    pausado = false;
    if (sint.paused) { sint.resume(); t0 = performance.now() - fracEvento * dur * 1000; if (!raf) raf = requestAnimationFrame(avanza); pinta(); }
    else di(i);
  };
  const parar = () => {
    gen++;
    hablando = false; pausado = false; arrancando = false; i = 0;
    sint.cancel();
    limpia();
    pinta();
  };

  // ---- barra --------------------------------------------------------------
  // Indicador de que ESTÁ leyendo. Antes solo cambiaba el texto de un botón, y
  // con la latencia de arranque del motor la persona clicaba y no pasaba nada
  // visible durante medio segundo: se lee como que no funciona.
  const luz = document.createElement('span');
  luz.className = 'nr-eq';
  luz.setAttribute('aria-hidden', 'true');
  luz.innerHTML = '<i></i><i></i><i></i>';

  const bt = (txt: string, fn: () => void, fantasma = true) => {
    const b = document.createElement('button');
    b.className = fantasma ? 'btn ghost' : 'btn';
    b.setAttribute('style', 'height:34px;font-size:10px;flex:none');
    b.textContent = txt;
    b.addEventListener('click', fn);
    barra.append(b);
    return b;
  };

  etiqueta.textContent = T.leer;
  barra.append(etiqueta, luz);
  const bPlay = bt(T.leer, () => (hablando ? (pausado ? sigue() : pausa()) : arranca()), false);
  const bStop = bt(T.parar, parar);
  const bVel = bt(`${vel}×`, () => {
    vel = VELS[(VELS.indexOf(vel) + 1) % VELS.length] ?? 1;
    localStorage.setItem(CLAVE_VEL, String(vel));
    if (hablando && !pausado) { gen++; sint.cancel(); di(i); }
    pinta();
  });
  bVel.title = T.vel;

  const sel = document.createElement('select');
  sel.className = 'input';
  sel.setAttribute('style', 'height:34px;width:auto;max-width:180px;font-size:11px;padding:0 8px;flex:none;text-overflow:ellipsis');
  sel.title = T.voz;
  sel.addEventListener('change', () => {
    voz = voces.find((v) => v.name === sel.value) ?? voz;
    if (voz) localStorage.setItem(CLAVE_VOZ, voz.name);
    // se oye el cambio en el sitio, sin volver a empezar la lección
    if (hablando && !pausado) { gen++; sint.cancel(); di(i); }
  });
  const llenaVoces = () => {
    sel.innerHTML = '';
    for (const v of voces) {
      const o = document.createElement('option');
      o.value = v.name;
      // El nombre va COMPLETO. Antes lo recortaba quitando los parentesis y
      // «Eddy (Spanish (Mexico))» quedaba en «Eddy )» — parentesis anidados con
      // un .*? no greedy. Peor: «Eddy (Spain)» y «Eddy (Mexico)» salian iguales,
      // o sea el selector no dejaba distinguir las dos voces que ofrecia. El
      // ancho se controla con CSS, no destruyendo el dato.
      o.textContent = v.name;
      if (voz && v.name === voz.name) o.selected = true;
      sel.append(o);
    }
    sel.style.display = voces.length > 1 ? '' : 'none';
  };
  llenaVoces();
  barra.append(sel);

  const cuenta = document.createElement('span');
  cuenta.className = 'num s';
  cuenta.style.color = 'var(--l3)';
  const aviso = document.createElement('span');
  aviso.className = 's';
  aviso.style.color = 'var(--or)';
  barra.append(cuenta, aviso);

  function pinta() {
    const hayVoz = !!voz;
    bPlay.disabled = !hayVoz;
    bStop.disabled = !hablando;
    bVel.textContent = `${vel}×`;
    bPlay.textContent = arrancando ? T.preparando : hablando ? (pausado ? T.seguir : T.pausa) : T.leer;
    barra.classList.toggle('nr-on', hablando && !pausado);
    luz.dataset.estado = arrancando ? 'espera' : hablando && !pausado ? 'lee' : '';
    cuenta.textContent = hablando && !arrancando
      ? T.deN.replace('{i}', String(i + 1)).replace('{n}', String(trozos.length)) : '';
    aviso.textContent = hayVoz ? '' : T.sinVoz;
    aviso.title = hayVoz ? '' : T.sinVozB;
  }
  pinta();

  window.addEventListener('pagehide', parar);
  window.addEventListener('beforeunload', parar);
  document.addEventListener('visibilitychange', () => { if (document.hidden && hablando) pausa(); });
}

// Una sola inyección por documento. El seguimiento va con transición de color,
// no con salto: un cambio instantáneo de fondo palabra a palabra parpadea y
// cansa; 90ms de transición se lee como que la luz se mueve.
function estilos() {
  if (document.getElementById('nr-css')) return;
  const e = document.createElement('style');
  e.id = 'nr-css';
  e.textContent = `
.nr-act{background:var(--fill);border-radius:3px;box-shadow:0 0 0 3px var(--fill)}
.nr-w{transition:color .09s linear,opacity .09s linear}
/* Las que faltan van a --l2, el MISMO tono del texto normal. Estaban en --l3 y
   la frase que suena se veia mas apagada que los parrafos que nadie esta
   leyendo: exactamente al reves de lo que el resaltado tiene que decir. */
.nr-act .nr-w{color:var(--l2)}
.nr-act .nr-w.nr-dicha{color:var(--l1)}
.nr-act .nr-w.nr-ahora{color:var(--ac);font-weight:600}
.nr-on{box-shadow:0 0 0 1px var(--ac), 0 0 22px -6px var(--ac)}
.nr-eq{display:none;align-items:flex-end;gap:2px;height:14px;flex:none}
.nr-eq[data-estado]{display:inline-flex}
.nr-eq i{width:3px;height:4px;background:var(--ac);display:block;border-radius:1px}
.nr-eq[data-estado="lee"] i{animation:nr-b .62s ease-in-out infinite}
.nr-eq[data-estado="lee"] i:nth-child(2){animation-delay:.16s}
.nr-eq[data-estado="lee"] i:nth-child(3){animation-delay:.32s}
.nr-eq[data-estado="espera"] i{animation:nr-p 1s ease-in-out infinite}
.nr-eq[data-estado="espera"] i:nth-child(2){animation-delay:.18s}
.nr-eq[data-estado="espera"] i:nth-child(3){animation-delay:.36s}
@keyframes nr-b{0%,100%{height:4px}50%{height:14px}}
@keyframes nr-p{0%,100%{opacity:.25}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){
  .nr-eq i{animation:none!important;height:9px}
  .nr-w{transition:none}
}`;
  document.head.append(e);
}
