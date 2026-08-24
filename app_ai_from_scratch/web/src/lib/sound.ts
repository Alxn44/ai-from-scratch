// Sonido de los hitos. Web Audio sintetizado, cero archivos: 8 hitos en ~4 KB de
// código pesan menos que un solo mp3 y no hay nada que precargar.
//
// TRES REGLAS QUE SALIERON DE MEDIR, no de gusto:
//
// 1. NADA POR DEBAJO DE 300 Hz. Medido con un pasabanda de 300-3500 Hz (el
//    altavoz de un portátil): la primera versión del hito de rango perdía 4,6 dB
//    porque la mitad de su energía estaba en el bombo de 90 Hz. Lo que no suena
//    en un portátil no existe: el 80% del curso se ve en uno.
//
// 2. ATAQUE DE 75 ms COMO TECHO. Por encima de eso el sonido llega DESPUÉS de la
//    animación y el cerebro los lee como dos sucesos, no como uno.
//
// 3. EL VOLUMEN ESCALA CON LA IMPORTANCIA, y el fallo NO castiga. Resolver un lab
//    (h1) suena a -20 dBFS; cerrar el curso (h8) a -8. El fallo es lo más bajo de
//    todo y va hacia abajo en tercera menor: informa, no regaña.
//
// EL CURSO ES UNA ESCALA. Las doce lecciones recorren una pentatónica mayor sobre
// Do, así que cerrar la lección 1 suena grave y la 12 suena arriba: la escala es
// el progreso, sin necesidad de explicarlo.

const CLAVE = 'curso.sonido';

// Pentatónica mayor de Do, dos octavas y pico. Todas por encima de 300 Hz.
const ESCALA = [523.25, 587.33, 659.25, 783.99, 880.0,
                1046.5, 1174.66, 1318.51, 1567.98, 1760.0, 2093.0, 2349.32];

let ctx: AudioContext | null = null;
let maestro: GainNode | null = null;

/** ¿Tiene el sonido encendido? Por omisión sí; la preferencia vive en el equipo. */
export function suena(): boolean {
  try { return localStorage.getItem(CLAVE) !== 'off'; } catch { return true; }
}

export function silenciar(off: boolean) {
  try { localStorage.setItem(CLAVE, off ? 'off' : 'on'); } catch { /* modo privado */ }
  if (maestro && ctx) maestro.gain.setTargetAtTime(off ? 0 : 1, ctx.currentTime, 0.02);
}

// El AudioContext solo arranca dentro de un gesto del usuario: si se crea antes,
// el navegador lo deja suspendido y el primer hito se pierde en silencio.
function arranca(): AudioContext | null {
  if (!suena()) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    maestro = ctx.createGain();
    maestro.gain.value = 1;
    maestro.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

const dB = (x: number) => Math.pow(10, x / 20);

/** Un parcial: onda, frecuencia, pico en dBFS, ataque y caída en segundos. */
function tono(c: AudioContext, t0: number, hz: number, pico: number,
              atq: number, caida: number, onda: OscillatorType = 'sine', desliz = 0) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = onda;
  o.frequency.setValueAtTime(hz, t0);
  if (desliz) o.frequency.exponentialRampToValueAtTime(hz * desliz, t0 + caida);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(dB(pico), t0 + Math.min(atq, 0.075));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + caida);
  o.connect(g).connect(maestro!);
  o.start(t0);
  o.stop(t0 + caida + 0.02);
}

/**
 * El golpe material: ruido filtrado corto. Es lo que hace que un cofre suene a
 * madera y metal y no a pitido. El pasabanda está centrado en 1,1 kHz a
 * propósito: ahí lo reproduce cualquier altavoz.
 */
function golpe(c: AudioContext, t0: number, pico: number, dur = 0.09, centro = 1100) {
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  // ruido con caída propia: sin ella el filtro deja una cola que arrastra
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
  const s = c.createBufferSource();
  s.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = centro; bp.Q.value = 1.1;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 320;   // regla 1
  const g = c.createGain();
  g.gain.value = dB(pico);
  s.connect(bp).connect(hp).connect(g).connect(maestro!);
  s.start(t0);
}

export type Hito =
  | 'lab'        // h1 un lab resuelto
  | 'leccion'    // h2 lección cerrada
  | 'rango'      // h3 rango nuevo: el cofre
  | 'estrella'   // h4 grado/estrella
  | 'racha'      // h5 varios seguidos
  | 'liga'       // h6 ascenso de liga
  | 'fallo'      // h7 no acertó
  | 'final';     // h8 curso terminado

/**
 * Suena un hito. `paso` (1..12) coloca el sonido en la escala: sirve para que
 * cerrar la lección 9 suene más arriba que cerrar la 2.
 * Silencioso y sin excepciones si el sonido está apagado o no hay Web Audio.
 */
export function sonar(hito: Hito, paso = 1) {
  const c = arranca();
  if (!c || !maestro) return;
  const t = c.currentTime + 0.005;
  const g = ESCALA[Math.max(0, Math.min(11, paso - 1))];

  switch (hito) {
    case 'lab':
      // dos notas cortas, quinta arriba. Lo más discreto del set: pasa 36 veces.
      tono(c, t, g, -20, 0.006, 0.1, 'triangle');
      tono(c, t + 0.055, g * 1.5, -22, 0.006, 0.14, 'sine');
      break;

    case 'estrella':
      // arpegio de tres, brillante pero sin cola
      tono(c, t, g, -19, 0.005, 0.09, 'triangle');
      tono(c, t + 0.05, g * 1.25, -20, 0.005, 0.1, 'triangle');
      tono(c, t + 0.1, g * 1.5, -18, 0.006, 0.24, 'sine');
      golpe(c, t, -30, 0.04, 2600);
      break;

    case 'leccion':
      // cuarta ascendente y una quinta que se queda: cierre, no continuación
      tono(c, t, g, -16, 0.008, 0.16, 'triangle');
      tono(c, t + 0.09, g * 1.335, -15, 0.008, 0.2, 'triangle');
      tono(c, t + 0.19, g * 2, -14, 0.01, 0.5, 'sine');
      golpe(c, t, -26, 0.06, 1800);
      break;

    case 'rango': {
      // EL COFRE. Golpe material primero, y encima una tríada mayor abierta.
      // Aquí estaba el fallo de los 4,6 dB: el peso lo daba un bombo de 90 Hz.
      // Ahora el peso lo da un golpe de ruido a 700 Hz, que sí sale del portátil.
      golpe(c, t, -14, 0.13, 700);
      golpe(c, t + 0.02, -20, 0.07, 2200);
      const b = ESCALA[Math.max(0, Math.min(11, paso - 1))];
      tono(c, t + 0.03, b, -13, 0.012, 0.7, 'triangle');
      tono(c, t + 0.06, b * 1.26, -16, 0.012, 0.62, 'sine');
      tono(c, t + 0.09, b * 1.5, -15, 0.012, 0.8, 'sine');
      tono(c, t + 0.12, b * 2, -18, 0.014, 1.0, 'sine');
      break;
    }

    case 'racha':
      // tres iguales que suben medio tono: acumulación
      for (let i = 0; i < 3; i++)
        tono(c, t + i * 0.07, g * Math.pow(1.0595, i * 2), -19 + i, 0.006, 0.13, 'triangle');
      break;

    case 'liga': {
      // ascenso: barrido de nota, no de filtro, para que se oiga en móvil
      tono(c, t, g, -14, 0.01, 0.42, 'triangle', 1.5);
      tono(c, t + 0.2, g * 2, -15, 0.01, 0.5, 'sine');
      golpe(c, t + 0.18, -22, 0.09, 1500);
      break;
    }

    case 'fallo':
      // tercera menor HACIA ABAJO y lo más bajo del set. No castiga: informa.
      tono(c, t, 660, -26, 0.008, 0.11, 'sine');
      tono(c, t + 0.075, 554, -25, 0.008, 0.17, 'sine');
      break;

    case 'final': {
      // el único con cola larga. Se gana una vez.
      const raiz = ESCALA[0];
      [0, 2, 4, 7, 9, 11].forEach((k, i) =>
        tono(c, t + i * 0.085, raiz * Math.pow(1.0595, k), -12 + i * 0.5, 0.014, 1.4 - i * 0.1,
             i % 2 ? 'sine' : 'triangle'));
      golpe(c, t, -12, 0.16, 800);
      golpe(c, t + 0.5, -22, 0.12, 2000);
      break;
    }
  }
}

/**
 * Engancha el primer gesto del usuario para desbloquear el audio, así el primer
 * hito real ya suena. Sin esto el navegador se come el primero.
 */
export function prepararSonido() {
  const una = () => {
    arranca();
    window.removeEventListener('pointerdown', una);
    window.removeEventListener('keydown', una);
  };
  window.addEventListener('pointerdown', una, { once: true });
  window.addEventListener('keydown', una, { once: true });
}
