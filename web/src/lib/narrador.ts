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
  vel: string; deN: string;
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
type Trozo = { texto: string; span: HTMLElement | null; bloque: HTMLElement };

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

/**
 * Monta la barra de narración al final de `host`.
 * Lee los `[data-narra]` que haya dentro de `raiz`, en orden de documento.
 */
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
  const cuenta = document.createElement('span');
  cuenta.className = 'num s';
  cuenta.style.color = 'var(--l3)';

  if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) {
    etiqueta.textContent = T.sinSoporte;
    barra.append(etiqueta);
    return;
  }

  // ---- recolección de texto ------------------------------------------------
  // Los bloques de solo texto se re-escriben en <span> por frase para poder
  // resaltar en el sitio. Si un bloque tiene hijos elemento no se toca: partirlo
  // rompería su maquetación, así que ese se narra entero sin resaltado.
  const trozos: Trozo[] = [];
  for (const b of Array.from(raiz.querySelectorAll<HTMLElement>('[data-narra]'))) {
    const texto = (b.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!texto) continue;
    const soloTexto = b.children.length === 0;
    if (soloTexto) {
      const fs = frases(texto);
      b.textContent = '';
      fs.forEach((f, i) => {
        const s = document.createElement('span');
        s.textContent = (i ? ' ' : '') + f;
        b.append(s);
        for (const c of acorta(paraVoz(f))) trozos.push({ texto: c, span: s, bloque: b });
      });
    } else {
      // NO se usa el textContent del bloque entero: las tarjetas de ejemplo no
      // llevan puntos entre etiqueta y valor, así que salía un trozo de ~40
      // palabras, unos 15 segundos, que es donde Chrome corta la utterance. Por
      // hojas cada parte es su propio trozo.
      // Una hoja de tres palabras o menos es una etiqueta («LE PIDES»): se pega a
      // la siguiente para que suene «le pides foto más la marca gato» y no dos
      // frases sueltas.
      const hs = hojas(b);
      let pend = '';
      let anclaje: HTMLElement | null = null;
      const suelta = (t: string, el: HTMLElement) => {
        for (const f of frases(t)) for (const c of acorta(paraVoz(f)))
          trozos.push({ texto: c, span: el, bloque: b });
      };
      for (const h of hs) {
        const t = (h.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!t) continue;
        if (t.split(' ').length <= 3 && !pend) { pend = t; anclaje = h; continue; }
        if (pend) { suelta(pend + ': ' + t, anclaje ?? h); pend = ''; anclaje = null; }
        else suelta(t, h);
      }
      if (pend) suelta(pend, anclaje ?? b);
    }
  }
  if (!trozos.length) return;

  // ---- voz ----------------------------------------------------------------
  // getVoices() suele venir vacío en la primera llamada: el navegador las carga
  // aparte y avisa con voiceschanged. Sin esperar ese evento, la primera vez que
  // le das a Leer suena con la voz por defecto del sistema, que puede ser inglés
  // leyendo español.
  let voz: SpeechSynthesisVoice | null = null;
  const pilla = () => {
    const vs = sint.getVoices();
    if (!vs.length) return false;
    const pref = vs.filter((v) => v.lang.toLowerCase().startsWith(lang));
    // las locales suenan sin red y no se cortan; las de servidor a veces sí
    voz = pref.find((v) => v.localService) ?? pref[0] ?? null;
    return true;
  };
  pilla();
  sint.addEventListener?.('voiceschanged', () => { pilla(); pinta(); });

  // ---- estado -------------------------------------------------------------
  let i = 0, hablando = false, pausado = false;
  let vel = Number(localStorage.getItem(CLAVE_VEL) ?? '1') || 1;
  const VELS = [0.8, 1, 1.25, 1.5];

  const resalta = (k: number) => {
    trozos.forEach((t, n) => {
      if (t.span) {
        t.span.style.background = n === k ? 'var(--fill)' : '';
        t.span.style.color = n === k ? 'var(--l1)' : '';
      }
      if (n === k) t.bloque.style.borderColor = 'var(--ac)';
      else if (t.bloque.style.borderColor === 'var(--ac)') t.bloque.style.borderColor = '';
    });
    if (k >= 0 && trozos[k]) {
      const r = trozos[k].bloque.getBoundingClientRect();
      if (r.top < 60 || r.bottom > window.innerHeight - 120)
        trozos[k].bloque.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  const di = (k: number) => {
    if (k >= trozos.length) { parar(); return; }
    i = k;
    resalta(k);
    const u = new SpeechSynthesisUtterance(trozos[k].texto);
    // Asignar .voice puede lanzar: Chrome invalida los objetos de voz tras un
    // voiceschanged y entonces la conversión falla. Si eso ocurriera sin proteger,
    // la excepción sube por di() y la narración MUERE EN SILENCIO con el botón
    // sin cambiar, que es el peor fallo posible aquí. Con lang solo, el navegador
    // elige él la voz del idioma: peor control, pero suena.
    try { if (voz) u.voice = voz; } catch { voz = null; }
    u.lang = voz?.lang ?? (lang === 'en' ? 'en-US' : 'es-ES');
    u.rate = vel;
    u.onend = () => { if (hablando && !pausado) di(k + 1); };
    // si una frase falla, no se cae la narración entera: sigue con la siguiente
    u.onerror = () => { if (hablando && !pausado) di(k + 1); };
    try { sint.speak(u); } catch { parar(); return; }
    pinta();
  };

  const arranca = () => {
    if (!voz && !pilla()) { pinta(); return; }
    sint.cancel();               // limpia cola de una lectura anterior
    hablando = true; pausado = false;
    di(i >= trozos.length ? 0 : i);
  };

  // La pausa nativa no es de fiar: en Firefox y en algún WebKit pause() no toma
  // efecto y la voz sigue. Se comprueba y, si no tomó, se cancela y se recuerda
  // la frase para seguir desde ahí.
  const pausa = () => {
    pausado = true;
    sint.pause();
    setTimeout(() => { if (!sint.paused) sint.cancel(); pinta(); }, 60);
    pinta();
  };
  const sigue = () => {
    pausado = false;
    if (sint.paused) { sint.resume(); pinta(); }
    else di(i);                  // no había pausa real: se relee la frase actual
  };
  const parar = () => {
    hablando = false; pausado = false; i = 0;
    sint.cancel();
    resalta(-1);
    pinta();
  };

  // ---- botones ------------------------------------------------------------
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
  barra.append(etiqueta);
  const bPlay = bt(T.leer, () => (hablando ? (pausado ? sigue() : pausa()) : arranca()), false);
  const bStop = bt(T.parar, parar);
  const bVel = bt(`${vel}×`, () => {
    vel = VELS[(VELS.indexOf(vel) + 1) % VELS.length] ?? 1;
    localStorage.setItem(CLAVE_VEL, String(vel));
    // el cambio se oye ya: se relee la frase en curso a la nueva velocidad
    if (hablando && !pausado) { sint.cancel(); di(i); }
    pinta();
  });
  bVel.title = T.vel;
  barra.append(cuenta);
  const aviso = document.createElement('span');
  aviso.className = 's';
  aviso.style.color = 'var(--or)';
  barra.append(aviso);

  function pinta() {
    const hayVoz = !!voz;
    bPlay.disabled = !hayVoz;
    bStop.disabled = !hablando;
    bVel.textContent = `${vel}×`;
    bPlay.textContent = hablando ? (pausado ? T.seguir : T.pausa) : T.leer;
    cuenta.textContent = hablando ? T.deN.replace('{i}', String(i + 1)).replace('{n}', String(trozos.length)) : '';
    // el motivo se escribe: una barra muda sin explicación se lee como bug
    aviso.textContent = hayVoz ? '' : T.sinVoz;
    aviso.title = hayVoz ? '' : T.sinVozB;
  }
  pinta();

  // Sin esto la voz sigue hablando encima de la pantalla siguiente.
  window.addEventListener('pagehide', parar);
  window.addEventListener('beforeunload', parar);
  document.addEventListener('visibilitychange', () => { if (document.hidden && hablando) pausa(); });
}
