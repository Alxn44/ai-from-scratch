// Trazo en escena. El SVG quieto del panel de IA sigue quieto a proposito
// (cat.ts): una mascota que se mueve mientras lees compite con la leccion.
// Este modulo es el momento contrario — ENTRA ANDANDO trayendo la cosa. Toasts,
// tarjetas de desbloqueo, el tour y el tutorial pasan por aqui para que la
// marcha, el punto de carga y la mirada sean una sola implementacion.
//
// El actor es el rig 3D de cat3d.ts. El transporte lo sigue moviendo GSAP desde
// aqui, igual que antes; lo que cambio es que el rig MIDE ese movimiento y saca
// de ahi la cadencia de las patas. Antes el cuerpo iba con `power2.out` (0.92 s)
// y las patas con un keyframe CSS de `.92s linear infinite`: dos relojes
// distintos, y las almohadillas patinaban sobre el suelo. Ver la cabecera de
// cat3d.ts para por que ahora eso es imposible.
import { gsap } from 'gsap';
import { montarConito, type Conito, type Gesto } from './cat3d';

const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export type Entrega = {
  cargo: HTMLElement;
  dest?: HTMLElement | null;
  holdMs?: number;
  size?: number;
};

let cola: Promise<void> = Promise.resolve();
let cssOn = false;

/**
 * Estilos del ESCENARIO. Los del gato los inyecta el propio rig. Aqui solo
 * queda lo que es de la puesta en escena: el tour a pantalla completa.
 */
function css() {
  if (cssOn) return;
  cssOn = true;
  const s = document.createElement('style');
  s.id = 'trazo-css-stage';
  s.textContent = `
#trazo-tour{position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;justify-content:flex-start;background:rgba(8,10,18,.88)}
#trazo-tour canvas{position:absolute;inset:0;width:100%;height:100%}
#trazo-tour .tour-ui{position:relative;z-index:1;display:flex;flex-direction:column;gap:14px;align-items:center;text-align:center;
  padding:64px 28px 0;max-width:560px;margin:0 auto;pointer-events:none;color:#F4F6FB}
#trazo-tour .tour-ui > *{pointer-events:auto}
#trazo-tour .tour-ui .p,#trazo-tour .tour-ui .s{color:rgba(244,246,251,.78)}
#trazo-tour .tour-skip,#trazo-tour .tour-next{min-height:44px;height:auto;padding:12px 14px;border:1px solid rgba(255,255,255,.28);
  background:transparent;color:#F4F6FB;font:600 10px/1 var(--m);letter-spacing:.14em;text-transform:uppercase;cursor:pointer}
#trazo-tour .tour-next{background:#3355FF;border-color:#3355FF;color:#fff}
#trazo-tour .tour-skip{position:absolute;top:calc(12px + env(safe-area-inset-top));right:calc(12px + env(safe-area-inset-right));z-index:3;background:rgba(8,10,18,.72)}
@media (max-width:720px){
  #trazo-tour .tour-ui{padding:72px 18px 0}
  #trazo-tour .tour-ui .h1{font-size:26px!important}
  #trazo-tour .tour-drop{width:min(280px,calc(100vw - 32px))!important}
}
#trazo-tour .tour-skip:hover{color:#fff}
#trazo-tour .tour-drop{position:absolute;z-index:2;pointer-events:auto;cursor:pointer}`;
  document.head.append(s);
}

function g() {
  const G = (window as any).gsap ?? gsap;
  return G as typeof gsap;
}

// El tour y el tutorial reciben el ELEMENTO, no el rig, y no hace falta
// cambiarlos: este mapa da el rig a partir del elemento. Es debil, asi que
// cuando el nodo muere el rig se recoge con el.
const rigs = new WeakMap<HTMLElement, Conito>();

/**
 * Monta a Trazo y devuelve su elemento. Quien llama lo coloca (GSAP), el rig
 * deduce la marcha del desplazamiento. Hay que llamarlo despues de tenerlo en
 * el documento, cosa que `montarConito` no hace: aqui se hace y se arranca.
 */
function actor(size: number): HTMLElement {
  css();
  const c = montarConito(size);
  document.body.append(c.el);
  c.vive();
  rigs.set(c.el, c);
  return c.el;
}

/** Mirar al puntero. La cabeza gira en Y de verdad, en perspectiva. */
function mira(el: HTMLElement, on: boolean): () => void {
  const c = rigs.get(el);
  if (!c || reduce()) return () => {};
  c.mirar(on);
  return () => c.mirar(false);
}

/** Un gesto suelto. Los de fondo ya salen solos, en Poisson. */
export function trazoGesto(el: HTMLElement, gesto: Gesto) { rigs.get(el)?.gesto(gesto); }
/** Sentarse / levantarse. */
export function trazoSentar(el: HTMLElement, on = true) { rigs.get(el)?.sentarse(on); }

/**
 * Trazo entra andando por la derecha con `cargo`, lo deja en `dest` (o donde
 * este), se sienta un momento, se levanta, se da la vuelta y se va. De uno en uno.
 */
export function trazoEntregar(job: Entrega): Promise<void> {
  const run = () => entregarUno(job);
  cola = cola.then(run, run);
  return cola;
}

async function entregarUno(job: Entrega): Promise<void> {
  const dest = job.dest ?? document.getElementById('toasts');
  const size = job.size ?? 112;
  // El tour manda sobre Trazo. Un toast que entrara andando por encima del tour
  // serian dos gatos a la vez, asi que se planta la tarjeta y se espera.
  // En movil el paseo tapa el formulario: se planta y no hay marcha.
  if (reduce() || document.getElementById('trazo-tour') || window.innerWidth < 720) {
    dest?.append(job.cargo);
    return;
  }
  const el = actor(size);
  const c = rigs.get(el)!;
  const hold = c.hold;
  const cargo = job.cargo;
  cargo.style.width = cargo.style.width || (cargo.classList.contains('toast') ? '280px' : '');
  cargo.style.transformOrigin = 'left bottom';
  hold.append(cargo);
  const stopMira = mira(el, true);
  const gs = g();

  const endX = dest
    ? Math.max(16, window.innerWidth - (dest.getBoundingClientRect().width || 372) - size - 36)
    : window.innerWidth - size - 32;
  const endY = dest
    ? Math.max(8, window.innerHeight - dest.getBoundingClientRect().height - size - 28)
    : window.innerHeight - size - 24;

  // Entra desde 460 px, no desde el borde de un monitor de 2560. Cruzar la
  // pantalla entera en un segundo son ~30 zancadas: un gato no da 30 zancadas
  // para recorrer un salon. Acotar el viaje es lo que deja que el paso sea
  // creible sin que el aviso tarde una eternidad.
  gs.set(el, { x: Math.min(window.innerWidth + 24, endX + 460), y: window.innerHeight - size - 18 });
  c.rumbo(180);                       // entra por la derecha: ya viene mirando a la izquierda
  gs.set(hold, { scale: 0.52, y: 8, x: 10, rotation: -8 });
  // 0.92 → 1.7 s. Con el viaje acotado arriba, esto da ~270 px/s de media, que
  // con zancada de gato son dos o tres zancadas por segundo. A 0.92 s eran
  // dieciocho, y por eso se veia como un juguete de cuerda.
  await gs.to(el, { x: endX, y: endY, duration: 1.7, ease: 'power2.out' });

  // Llega, se para y se ASIENTA. El rig devuelve las cuatro patas al reposo solo
  // (antes se quedaban congeladas a media zancada). Estos 180 ms son eso mas el
  // rebote de la cola, que llega con retraso porque es un resorte.
  await new Promise((r) => setTimeout(r, 180));
  c.gesto('cola');
  await gs.to(hold, { scale: 1, x: size * 0.08, y: -12, rotation: 0, duration: 0.38, ease: 'back.out(1.6)' });

  if (dest) {
    const slot = cargo.getBoundingClientRect();
    dest.append(cargo);
    const to = dest.getBoundingClientRect();
    gs.set(cargo, { x: slot.left - to.left, y: slot.top - to.top });
    await gs.to(cargo, { x: 0, y: 0, duration: 0.42, ease: 'power3.out' });
  }

  // Se sienta y parpadea LENTO. Antes esto era un bote de 6 px con yoyo, que es
  // un asentimiento de dibujo animado; un gato que ha dejado algo se sienta.
  c.sentarse(true);
  c.gesto('parpadeoLento');
  await new Promise((r) => setTimeout(r, job.holdMs ? job.holdMs + 420 : 620));

  // Se levanta y SIGUE DE LARGO, saliendo por la izquierda. Antes se interpolaba
  // solo x hacia la derecha y se iba de espaldas, haciendo el moonwalk.
  //
  // La otra opcion era darse la vuelta, y se probo: no funciona. El rig es un
  // plano en 3D, y al cruzar los 90 grados un plano se ve de canto — ancho cero.
  // Ninguna transformacion lo desaplana (el scaleX se aplica ANTES de la
  // rotacion), asi que el gato desaparecia un par de fotogramas. Y de todas
  // formas un gato no hace un cambio de sentido parado: entra por un lado y
  // sale por el otro.
  c.sentarse(false);
  await new Promise((r) => setTimeout(r, 380));
  await gs.to(el, { x: -size - 40, duration: 1.25, ease: 'power2.in' });
  stopMira();
  c.destruir();
}

/** Trazo entra con un globo de texto. Se usa al cerrar una leccion. */
export function trazoDice(texto: string, ms = 4200): () => void {
  const globo = document.createElement('div');
  globo.className = 'card';
  globo.setAttribute('style', 'background:var(--bg);max-width:230px;padding:11px 13px;pointer-events:none');
  const p = document.createElement('p');
  p.className = 's';
  p.style.color = 'var(--l1)';
  p.textContent = texto;
  globo.append(p);
  void trazoEntregar({ cargo: globo, dest: null, holdMs: Math.max(800, ms - 1800), size: 96 });
  return () => globo.remove();
}

export { actor as montarActor, mira as trazoMira, css as trazoCSS, reduce as trazoQuieto, g as trazoGsap };
