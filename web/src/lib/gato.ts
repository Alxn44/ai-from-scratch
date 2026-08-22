// Trazo, el gato del curso. Smoking (tuxedo): negro con pecho, hocico, calcetines
// y punta de cola blancos.
//
// EL PROBLEMA CENTRAL: un gato negro sobre fondo negro no existe. Primer intento:
// cuerpo en --bg y contorno en --l2, o sea un recorte del fondo. Funciona en
// oscuro y FALLA en papel: --bg pasa a #F2F2F2 y --l1 a casi negro, así que el
// smoking se invierte y sale un gato blanco con el pecho negro. Verificado en la
// hoja de contacto.
// Un gato tuxedo es negro con blanco en los DOS temas, así que el cuerpo lleva una
// tinta oscura propia (#191A1F, no negro puro) y las manchas un blanco propio. El
// contorno en --l2 es lo que lo separa del fondo negro; sobre papel la tinta ya se
// separa sola.
//
// CANON DE PROPORCIÓN, para que no se deforme al reescalarlo. Módulo M = 8u sobre
// un lienzo de 96x96u; los tres círculos que definen el animal:
//   C1 cabeza  centro (34,34)  r 15  = 1.875 M
//   C2 masa    centro (40,66)  r 22  = 2.75  M
//   C3 anca    centro (52,74)  r 13  = 1.625 M
// Cualquier ajuste posterior se mide contra estos tres, no a ojo.
//
// LOS OJOS VAN EN --ac, NO EN ÁMBAR. El ámbar es el color natural del gato y fue
// mi primera elección, pero el oro/ámbar es la moneda de recompensa de todo el
// producto (trofeos, estrellas, medallas) y la mascota está en pantalla el 95%
// del tiempo. Dos ojos ámbar permanentes devalúan la recompensa. El azul de la
// casa la deja intacta.

export type Pose = 'sentado' | 'saluda' | 'duerme';

const BLANCO = '#F8F9FB';   // fijo: la mancha del smoking no gira con el tema
const CUERPO = '#191A1F';   // tinta propia, no --bg y no negro puro
const LINEA = 'var(--l2)';
const OJO = 'var(--ac)';

/**
 * Trazo en SVG. `px` es el lado; el lienzo es cuadrado.
 * `id` único por instancia (los recortes y la animación se referencian por id).
 */
export function gato(px = 120, pose: Pose = 'sentado', id = 'trazo'): string {
  // Cuerpo: masa (C2) + anca (C3) fundidas en un contorno continuo.
  const cuerpo = 'M22 88 C16 76 18 62 26 52 C30 47 36 44 42 44 C52 44 62 48 68 56 '
               + 'C74 64 76 76 74 88 Z';
  // Pecho blanco: la mancha del smoking. Cae desde la garganta.
  const pecho = 'M38 50 C44 48 52 50 55 57 C57 66 55 78 50 88 L38 88 C34 76 34 60 38 50 Z';
  // Cabeza (C1) con orejas triangulares
  const cabeza = 'M20 34 C20 24 26 17 34 16 C42 17 48 24 48 34 C48 43 42 49 34 49 C26 49 20 43 20 34 Z';
  const orejaI = 'M21 24 L18 9 L30 17 Z';
  const orejaD = 'M47 24 L50 9 L38 17 Z';
  // Cola: parte del anca y sube. Es lo que da vida al bicho, así que va aparte
  // para poder animarla desde su nacimiento.
  const cola = 'M72 82 C84 80 90 68 86 56 C84 50 79 47 75 48';

  const durmiendo = pose === 'duerme';
  const saluda = pose === 'saluda';

  const ojos = durmiendo
    ? `<path d="M26 33 C28.5 35.5 31.5 35.5 34 33" fill="none" stroke="${LINEA}" stroke-width="1.6" stroke-linecap="round"/>
       <path d="M38 33 C40 35 42.5 35 44.5 33" fill="none" stroke="${LINEA}" stroke-width="1.6" stroke-linecap="round"/>`
    : `<g class="${id}-ojos">
         <ellipse cx="29" cy="33" rx="3.1" ry="3.9" fill="${OJO}"/>
         <ellipse cx="41" cy="33" rx="3.1" ry="3.9" fill="${OJO}"/>
         <circle cx="30.1" cy="31.6" r="1.05" fill="${BLANCO}" opacity=".9"/>
         <circle cx="42.1" cy="31.6" r="1.05" fill="${BLANCO}" opacity=".9"/>
       </g>`;

  // La pata que saluda sustituye al calcetín IZQUIERDO. Primero la puse a la
  // derecha y choca con la cola: dos formas curvas del mismo grosor cruzándose se
  // leen como una aleta. El lado izquierdo está libre.
  const patas = saluda
    ? `<path d="M45 79 h9 a3 3 0 0 1 3 3 v3 a3 3 0 0 1 -3 3 h-9 a3 3 0 0 1 -3 -3 v-3 a3 3 0 0 1 3 -3 z"
         fill="${BLANCO}" stroke="${LINEA}" stroke-width="1.2"/>
       <g class="${id}-mano" style="transform-origin:30px 72px">
         <path d="M26 74 C24 64 22 56 20 50 C22 47 27 47 29 51 C31 58 32 66 32 74 Z"
           fill="${CUERPO}" stroke="${LINEA}" stroke-width="1.4" stroke-linejoin="round"/>
         <ellipse cx="24.5" cy="48.5" rx="4.2" ry="3.3" transform="rotate(16 24.5 48.5)"
           fill="${BLANCO}" stroke="${LINEA}" stroke-width="1.1"/>
       </g>`
    : `<path d="M27 77 h12 a3 3 0 0 1 3 3 v5 a3 3 0 0 1 -3 3 h-12 a3 3 0 0 1 -3 -3 v-5 a3 3 0 0 1 3 -3 z"
         fill="${BLANCO}" stroke="${LINEA}" stroke-width="1.2"/>
       <path d="M45 79 h9 a3 3 0 0 1 3 3 v3 a3 3 0 0 1 -3 3 h-9 a3 3 0 0 1 -3 -3 v-3 a3 3 0 0 1 3 -3 z"
         fill="${BLANCO}" stroke="${LINEA}" stroke-width="1.2"/>`;

  return `<svg viewBox="0 0 96 96" width="${px}" height="${px}" role="img" aria-hidden="true"
    style="display:block;overflow:visible" data-gato="${pose}">
    <g class="${id}-cola" style="transform-origin:74px 82px">
      <path d="${cola}" fill="none" stroke="${LINEA}" stroke-width="6.5" stroke-linecap="round"/>
      <path d="${cola}" fill="none" stroke="${CUERPO}" stroke-width="4" stroke-linecap="round"/>
      <circle cx="75" cy="48" r="3.2" fill="${BLANCO}" stroke="${LINEA}" stroke-width="1.1"/>
    </g>
    <path d="${cuerpo}" fill="${CUERPO}" stroke="${LINEA}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="${pecho}" fill="${BLANCO}" opacity=".95"/>
    ${patas}
    <path d="${orejaI}" fill="${CUERPO}" stroke="${LINEA}" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="${orejaD}" fill="${CUERPO}" stroke="${LINEA}" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M22.5 21 L20.5 12 L26.5 16.5 Z" fill="${LINEA}" opacity=".35"/>
    <path d="M45.5 21 L47.5 12 L41.5 16.5 Z" fill="${LINEA}" opacity=".35"/>
    <g class="${id}-cabeza" style="transform-origin:34px 44px">
      <path d="${cabeza}" fill="${CUERPO}" stroke="${LINEA}" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M27 38 C30 36 38 36 41 38 C41 44 37.5 47 34 47 C30.5 47 27 44 27 38 Z" fill="${BLANCO}" opacity=".95"/>
      ${ojos}
      <path d="M34 39.5 l-1.9 1.6 h3.8 Z" fill="${LINEA}"/>
      <path d="M34 41.4 v1.7 M34 43.1 C32.6 44.2 31 43.9 30.4 42.8 M34 43.1 C35.4 44.2 37 43.9 37.6 42.8"
        fill="none" stroke="${LINEA}" stroke-width="1.05" stroke-linecap="round"/>
      <g stroke="${LINEA}" stroke-width=".9" stroke-linecap="round" opacity=".7">
        <path d="M25 40 L14 38"/><path d="M25 42 L15 43"/>
        <path d="M43 40 L54 38"/><path d="M43 42 L53 43"/>
      </g>
    </g>
  </svg>`;
}

/**
 * CSS de la animación de reposo. Se inyecta UNA vez por documento.
 * Cola y parpadeo, nada más: una mascota que se mueve mucho compite con el
 * contenido, y esto va a estar en pantalla mientras la persona lee.
 */
export function gatoCSS(id = 'trazo'): string {
  return `@keyframes ${id}-sway{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(9deg)}}
@keyframes ${id}-blink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.12)}}
@keyframes ${id}-tilt{0%,100%{transform:rotate(-1.5deg)}50%{transform:rotate(1.5deg)}}
@keyframes ${id}-wave{0%,100%{transform:rotate(6deg)}50%{transform:rotate(-22deg)}}
.${id}-cola{animation:${id}-sway 3.4s ease-in-out infinite}
.${id}-ojos{animation:${id}-blink 5.2s ease-in-out infinite;transform-origin:35px 33px}
.${id}-cabeza{animation:${id}-tilt 6.1s ease-in-out infinite}
.${id}-mano{animation:${id}-wave .62s ease-in-out 4}
@media (prefers-reduced-motion: reduce){
  .${id}-cola,.${id}-ojos,.${id}-cabeza,.${id}-mano{animation:none}
}`;
}

/**
 * Monta a Trazo en una esquina, saluda y se queda. Devuelve cómo quitarlo.
 * `una` evita duplicados si dos sitios lo piden a la vez.
 */
export function asomarGato(texto: string, ms = 5200): () => void {
  if (document.getElementById('trazo-asoma')) return () => {};
  // El CSS va aquí, una vez por documento: si quien llama tiene que acordarse de
  // inyectarlo, el día que se olvide el gato aparece congelado y nadie se entera.
  if (!document.getElementById('trazo-css')) {
    const e = document.createElement('style');
    e.id = 'trazo-css';
    e.textContent = gatoCSS();
    document.head.append(e);
  }
  const caja = document.createElement('div');
  caja.id = 'trazo-asoma';
  caja.setAttribute('style',
    'position:fixed;right:22px;bottom:22px;z-index:70;display:flex;align-items:flex-end;gap:10px;'
    + 'pointer-events:none;transform:translateY(14px);opacity:0;transition:transform .42s cubic-bezier(.16,1,.3,1),opacity .42s');
  const globo = document.createElement('div');
  globo.className = 'card';
  globo.setAttribute('style', 'background:var(--bg);max-width:230px;padding:11px 13px');
  globo.innerHTML = `<p class="s" style="color:var(--l1)"></p>`;
  globo.querySelector('p')!.textContent = texto;   // texto plano: nunca innerHTML de fuera
  const fig = document.createElement('div');
  fig.innerHTML = gato(96, 'saluda');
  caja.append(globo, fig);
  document.body.append(caja);
  requestAnimationFrame(() => { caja.style.transform = 'translateY(0)'; caja.style.opacity = '1'; });
  const fuera = () => {
    caja.style.transform = 'translateY(14px)';
    caja.style.opacity = '0';
    setTimeout(() => caja.remove(), 460);
  };
  const t = setTimeout(fuera, ms);
  return () => { clearTimeout(t); fuera(); };
}
