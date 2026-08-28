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
// LOS OJOS SON AMARILLOS, y hay que saber lo que cuesta.
//
// Estuvieron en --ac (azul) a propósito: el oro/ámbar es la moneda de
// recompensa de todo el producto — trofeos, estrellas, medallas — y la mascota
// está en pantalla el 95% del tiempo, así que dos ojos ámbar permanentes
// devalúan esa señal. Se decidió amarillo de todas formas, porque un tuxedo con
// ojos azules no es un tuxedo. Si algún día los trofeos dejan de destacar, esta
// es la causa y este el comentario que lo explica.
//
// Tono fijo, no var(--or): el ojo de un gato es amarillo en los dos temas, y
// --or cambia de #FF9F0A a #8A5000 al pasar a papel. Sobre la cabeza (#191A1F)
// el amarillo va siempre sobre tinta oscura, así que el contraste no depende
// del fondo de la página.

export type Pose = 'sentado' | 'saluda' | 'duerme' | 'carga' | 'anda';

const BLANCO = '#F8F9FB';   // fijo: la mancha del smoking no gira con el tema
const CUERPO = '#191A1F';   // tinta propia, no --bg y no negro puro
const LINEA = 'var(--l2)';
const OJO = '#F2C14E';     // fijo: el ojo del gato no gira con el tema
const OJO_HOND = '#C9922B';   // el borde del iris, para que no sea una mancha plana

/**
 * Conito de PERFIL, caminando. Un lienzo aparte del de frente, y no por gusto.
 *
 * POR QUÉ NO SE PODÍA ANIMAR EL DIBUJO QUE YA HABÍA. El gato de frente tiene la
 * cabeza centrada, bigotes a los dos lados y DOS patas. Un ciclo de marcha
 * necesita cuatro apoyos y desplazamiento horizontal; de frente no hay dónde
 * ponerlos, y balancear dos patas como un péndulo es un trote de dibujo animado,
 * no un gato. La pose `carga` hacía exactamente eso.
 *
 * EL PASO, QUE ES LO QUE SE PIDIÓ. El gato doméstico camina en SECUENCIA
 * LATERAL: posterior izquierda, anterior izquierda, posterior derecha, anterior
 * derecha, cada una a un cuarto de ciclo de la anterior. Eso es todo el truco, y
 * está en los `animation-delay` de gatoCSS: 0, -0.75D, -0.50D, -0.25D. Un delay
 * negativo ADELANTA, así que adelantar 0.75 es retrasar 0.25, que es lo que hace
 * falta.
 *
 * REGISTRO DIRECTO. La pata trasera pisa la huella que la delantera del mismo
 * lado acaba de dejar. No hay que dibujarlo: sale solo de las fases. Con apoyo
 * del 74% del ciclo, la anterior izquierda despega en 0.25+0.74 = 0.99, un pelo
 * antes de que la posterior izquierda apoye en 1.00.
 *
 * TRES APOYOS. Ese 74% no es estético: con cuatro patas a un cuarto de ciclo,
 * los apoyos simultáneos son 4 × apoyo = 2.96, o sea tres casi siempre. Es la
 * diferencia entre caminar y trotar, y la aritmética está en gatoCSS.
 */
function perfilAnda(id: string): string {
  // CANON DE PROPORCIÓN DE PERFIL. Suelo en y=88. La pata mide 30 unidades
  // (pivote 56 → almohadilla 86) contra un tronco de 26 de alto: 1.15:1, que es
  // lo que hace que parezca un gato y no un perro salchicha. El primer intento
  // tenía patas de 14 sobre un tronco de 50 y se leía exactamente así.
  // El cuello NO es una pieza: el tronco llega hasta x=70 por arriba y la cabeza
  // se solapa encima. Dibujados como dos bultos separados, la cabeza flota.
  const tronco = 'M18 62 C12 55 13 43 22 39 C34 34 56 33 68 38 C74 41 76 52 72 62 Z';
  // El smoking de perfil: pechera alta delante, y de ahí una franja de vientre
  // que se estrecha hacia la grupa. No es un óvalo bajo la barriga.
  // Cuña de pechera DELANTE, más una franja fina de vientre que muere en la
  // grupa. La primera versión iba de x=24 a x=69 por todo el bajo y salía un
  // gato blanco con la espalda negra: un tuxedo lleva blanco de la barbilla al
  // pecho, no una barriga entera.
  const pechera = 'M58 41 C65 43 69 48 69 53 C69 59 65 62 59 62 L51 62 C49 55 52 45 58 41 Z';
  const vientre = 'M51 62 L31 61.6 C27 61 25 59.4 26 57.6 C33 60.4 43 61.4 51 60.6 Z';
  const cabeza = 'M62 28 C62 20 68 14 76 14 C84 14 89 20 89 28 C89 36 84 41 76 41 C68 41 62 36 62 28 Z';
  const orejaI = 'M65 19 L62 4 L75 11 Z';
  const orejaD = 'M84 18 L89 5 L78 10 Z';
  const cola = 'M19 52 C8 49 3 37 8 28 C11 22 17 20 22 22';

  // Una pata: barra ahusada del pivote a la almohadilla, con calcetín blanco.
  // `cerca` decide la tinta: la del lado opuesto va más oscura y sin contorno,
  // que es lo que la manda detrás del cuerpo sin dibujar una sola línea extra.
  const pata = (clase: string, x: number, cerca: boolean) => {
    const tinta = cerca ? CUERPO : '#0E1014';
    const calcetin = cerca ? BLANCO : '#39404E';
    const borde = cerca ? `stroke="${LINEA}" stroke-width="1.3" stroke-linejoin="round"` : '';
    return `<g class="${clase}" style="transform-origin:${x}px 56px">
      <path d="M${x - 3.8} 56 C${x - 4} 66 ${x - 3.4} 74 ${x - 3.1} 81 L${x + 3.1} 81
               C${x + 3.4} 74 ${x + 4} 66 ${x + 3.8} 56 Z" fill="${tinta}" ${borde}/>
      <path d="M${x - 3.4} 80 h6.8 a2.8 2.8 0 0 1 2.8 2.8 v1.4 a2.8 2.8 0 0 1 -2.8 2.8
               h-6.8 a2.8 2.8 0 0 1 -2.8 -2.8 v-1.4 a2.8 2.8 0 0 1 2.8 -2.8 z"
        fill="${calcetin}" ${cerca ? `stroke="${LINEA}" stroke-width="1.1"` : ''}/>
    </g>`;
  };

  return `<svg viewBox="0 0 96 96" width="__PX__" height="__PX__" role="img" aria-hidden="true"
    style="display:block;overflow:visible" data-gato="anda">
    <g class="${id}-cola" style="transform-origin:19px 52px">
      <path d="${cola}" fill="none" stroke="${LINEA}" stroke-width="7" stroke-linecap="round"/>
      <path d="${cola}" fill="none" stroke="${CUERPO}" stroke-width="4.4" stroke-linecap="round"/>
      <circle cx="22" cy="22" r="3.1" fill="${BLANCO}" stroke="${LINEA}" stroke-width="1.1"/>
    </g>
    ${pata(`${id}-pTD`, 28, false)}
    ${pata(`${id}-pAD`, 60, false)}
    <g class="${id}-tronco">
      <path d="${tronco}" fill="${CUERPO}" stroke="${LINEA}" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="${pechera}" fill="${BLANCO}" opacity=".95"/>
      <path d="${vientre}" fill="${BLANCO}" opacity=".9"/>
      ${pata(`${id}-pTI`, 24, true)}
      ${pata(`${id}-pAI`, 64, true)}
      <g class="${id}-cabeza" style="transform-origin:70px 38px">
        <path d="${orejaI}" fill="${CUERPO}" stroke="${LINEA}" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="${orejaD}" fill="${CUERPO}" stroke="${LINEA}" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M66.5 16.5 L64.5 7.5 L71.5 11.5 Z" fill="${LINEA}" opacity=".35"/>
        <path d="M83.6 15.5 L86.5 8 L80.5 11 Z" fill="${LINEA}" opacity=".35"/>
        <path d="${cabeza}" fill="${CUERPO}" stroke="${LINEA}" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M82.6 31.6 C86.4 31 89.2 31.8 89.5 33.4 C88.9 37.6 86.4 40.2 82.4 40.2
          C80.8 37.6 80.9 33.6 82.6 31.6 Z" fill="${BLANCO}" opacity=".95"/>
        <g class="${id}-ojos" style="transform-origin:79px 26px">
          <ellipse cx="79" cy="26" rx="3.4" ry="3.9" fill="${OJO}"/>
          <ellipse cx="79" cy="26" rx="3.4" ry="3.9" fill="none" stroke="${OJO_HOND}" stroke-width=".9"/>
          <ellipse cx="79" cy="26" rx="1" ry="3" fill="${CUERPO}"/>
          <circle cx="80.4" cy="24.4" r=".95" fill="${BLANCO}" opacity=".92"/>
        </g>
        <path d="M89.6 33.2 l-1.9 1.6 h3.6 Z" fill="${LINEA}"/>
        <path d="M89.4 34.8 v1.6 M89.4 36.4 C88 37.5 86.6 37.2 86 36.1"
          fill="none" stroke="${LINEA}" stroke-width="1.05" stroke-linecap="round"/>
        <g stroke="${LINEA}" stroke-width=".9" stroke-linecap="round" opacity=".7">
          <path d="M88 34 L96 31"/><path d="M88.5 36.5 L96 37"/>
        </g>
      </g>
    </g>
  </svg>`;
}


/**
 * Trazo en SVG. `px` es el lado; el lienzo es cuadrado.
 * `id` único por instancia (los recortes y la animación se referencian por id).
 */
export function gato(px = 120, pose: Pose = 'sentado', id = 'trazo'): string {
  // La marcha es OTRO dibujo, de perfil, no una variante de este. Ver perfilAnda.
  if (pose === 'anda') return perfilAnda(id).replaceAll('__PX__', String(px));
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
  const carga = pose === 'carga';

  const ojos = durmiendo
    ? `<path d="M26 33 C28.5 35.5 31.5 35.5 34 33" fill="none" stroke="${LINEA}" stroke-width="1.6" stroke-linecap="round"/>
       <path d="M38 33 C40 35 42.5 35 44.5 33" fill="none" stroke="${LINEA}" stroke-width="1.6" stroke-linecap="round"/>`
    : `<g class="${id}-ojos">
         <ellipse cx="29" cy="33" rx="3.1" ry="3.9" fill="${OJO}"/>
         <ellipse cx="41" cy="33" rx="3.1" ry="3.9" fill="${OJO}"/>
         <ellipse cx="29" cy="33" rx="3.1" ry="3.9" fill="none" stroke="${OJO_HOND}" stroke-width=".9"/>
         <ellipse cx="41" cy="33" rx="3.1" ry="3.9" fill="none" stroke="${OJO_HOND}" stroke-width=".9"/>
         <!-- La pupila vertical. Sin ella el ojo amarillo es una mancha; con
              ella se lee gato a 26px, que es el tamaño del panel de IA. -->
         <ellipse cx="29" cy="33" rx=".95" ry="2.9" fill="${CUERPO}"/>
         <ellipse cx="41" cy="33" rx=".95" ry="2.9" fill="${CUERPO}"/>
         <circle cx="30.3" cy="31.4" r=".95" fill="${BLANCO}" opacity=".92"/>
         <circle cx="42.3" cy="31.4" r=".95" fill="${BLANCO}" opacity=".92"/>
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
    : carga
    ? `<g class="${id}-pataI" style="transform-origin:32px 84px">
         <path d="M24 74 h12 a3 3 0 0 1 3 3 v5 a3 3 0 0 1 -3 3 h-12 a3 3 0 0 1 -3 -3 v-5 a3 3 0 0 1 3 -3 z"
           fill="${BLANCO}" stroke="${LINEA}" stroke-width="1.2"/>
       </g>
       <g class="${id}-pataD" style="transform-origin:50px 84px">
         <path d="M45 77 h9 a3 3 0 0 1 3 3 v3 a3 3 0 0 1 -3 3 h-9 a3 3 0 0 1 -3 -3 v-3 a3 3 0 0 1 3 -3 z"
           fill="${BLANCO}" stroke="${LINEA}" stroke-width="1.2"/>
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
      ${carga
        ? `<ellipse cx="34" cy="45.2" rx="3.4" ry="1.5" fill="${CUERPO}" stroke="${LINEA}" stroke-width="1.05"/>`
        : `<path d="M34 41.4 v1.7 M34 43.1 C32.6 44.2 31 43.9 30.4 42.8 M34 43.1 C35.4 44.2 37 43.9 37.6 42.8"
        fill="none" stroke="${LINEA}" stroke-width="1.05" stroke-linecap="round"/>`}
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
@keyframes ${id}-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes ${id}-pata{0%,100%{transform:rotate(8deg)}50%{transform:rotate(-14deg)}}
@keyframes ${id}-pata2{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(12deg)}}
.trazo-anda svg[data-gato="carga"]{animation:${id}-bob .34s ease-in-out infinite}
.trazo-anda .${id}-pataI{animation:${id}-pata .34s ease-in-out infinite}
.trazo-anda .${id}-pataD{animation:${id}-pata2 .34s ease-in-out infinite}
.trazo-anda .${id}-cola{animation:${id}-sway .34s ease-in-out infinite}

/* ------------------------------------------------------------------ */
/* LA MARCHA DE PERFIL. Un ciclo = una zancada completa de las cuatro. */
/*                                                                     */
/* Un solo juego de fotogramas para las cuatro patas; lo unico que las */
/* distingue es el desfase. 0 a 74% es el APOYO: la pata esta clavada  */
/* en el suelo y es el cuerpo el que la deja atras, asi que gira de    */
/* +17 a -19 grados a velocidad CONSTANTE — linear, porque un pie      */
/* apoyado no acelera. De 74 a 100% es el VUELO: despega, se recoge y  */
/* vuelve adelante, y ahi si va suave (ease-out al salir, ease-in al   */
/* aterrizar). El timing va POR fotograma, no en la propiedad, que es  */
/* la unica forma de que apoyo y vuelo tengan curvas distintas.        */
/*                                                                     */
/* POR QUE 74 Y NO 62. Con cuatro patas a un cuarto de ciclo, el       */
/* numero de apoyos simultaneos es 4 x apoyo. Con 0.62 eso da 2.48:    */
/* la mitad del tiempo hay solo dos patas en el suelo, y dos apoyos en */
/* diagonal es un TROTE. Con 0.74 da 2.96 — tres apoyos practicamente  */
/* siempre, que es la definicion de paso. Lo tuve en 62 y el comentario */
/* prometia tres apoyos que la aritmetica no daba.                     */
/*                                                                     */
/* Y de paso arregla el registro directo: la anterior izquierda apoya  */
/* en 0.25 y despega en 0.25+0.74 = 0.99, un pelo antes de que la      */
/* posterior izquierda apoye en 1.00. Deja la huella justo cuando la   */
/* otra llega a pisarla.                                              */
@keyframes ${id}-zancada{
  0%{transform:rotate(17deg) translateY(0);animation-timing-function:linear}
  74%{transform:rotate(-19deg) translateY(0);animation-timing-function:ease-out}
  83%{transform:rotate(-10deg) translateY(-2.4px)}
  93%{transform:rotate(6deg) translateY(-2.6px);animation-timing-function:ease-in}
  100%{transform:rotate(17deg) translateY(0)}
}
/* El cuerpo sube y baja DOS veces por zancada, no una: un pico por cada
   par de apoyos. Amplitud 1px sobre 96 — se nota y no marea. */
@keyframes ${id}-vaiven{0%,50%,100%{transform:translateY(0)}25%,75%{transform:translateY(-1px)}}
/* La cabeza va en contrafase y la mitad de recorrido: compensa el vaiven
   del tronco, que es lo que hace un gato para no botar la mirada. */
@keyframes ${id}-testa{0%,50%,100%{transform:translateY(0) rotate(0)}25%,75%{transform:translateY(.5px) rotate(-1.2deg)}}
/* La cola NO se sincroniza con las patas. En un gato real oscila mas
   lenta y por su cuenta; atarla al paso lo vuelve un juguete de cuerda.
   Periodo 1.7x el de la zancada, que ademas evita que las dos animaciones
   coincidan y se lea un bucle. */
.trazo-anda svg[data-gato="anda"] .${id}-tronco{animation:${id}-vaiven .92s ease-in-out infinite}
.trazo-anda svg[data-gato="anda"] .${id}-cabeza{animation:${id}-testa .92s ease-in-out infinite}
.trazo-anda svg[data-gato="anda"] .${id}-cola{animation:${id}-sway 1.56s ease-in-out infinite}
/* SECUENCIA LATERAL: posterior izq -> anterior izq -> posterior der ->
   anterior der, a un cuarto de ciclo cada una. Un delay negativo ADELANTA,
   asi que -0.75D es retrasar 0.25D, -0.50D retrasar 0.50D, etc. */
.trazo-anda svg[data-gato="anda"] .${id}-pTI,
.trazo-anda svg[data-gato="anda"] .${id}-pAI,
.trazo-anda svg[data-gato="anda"] .${id}-pTD,
.trazo-anda svg[data-gato="anda"] .${id}-pAD{
  animation:${id}-zancada .92s linear infinite}
.trazo-anda svg[data-gato="anda"] .${id}-pTI{animation-delay:0s}
.trazo-anda svg[data-gato="anda"] .${id}-pAI{animation-delay:-.69s}
.trazo-anda svg[data-gato="anda"] .${id}-pTD{animation-delay:-.46s}
.trazo-anda svg[data-gato="anda"] .${id}-pAD{animation-delay:-.23s}
@media (prefers-reduced-motion: reduce){
  .${id}-cola,.${id}-ojos,.${id}-cabeza,.${id}-mano,.trazo-anda svg[data-gato="carga"],
  .trazo-anda .${id}-pataI,.trazo-anda .${id}-pataD,
  .trazo-anda svg[data-gato="anda"] .${id}-tronco,
  .trazo-anda svg[data-gato="anda"] .${id}-cabeza,
  .trazo-anda svg[data-gato="anda"] .${id}-pTI,.trazo-anda svg[data-gato="anda"] .${id}-pAI,
  .trazo-anda svg[data-gato="anda"] .${id}-pTD,.trazo-anda svg[data-gato="anda"] .${id}-pAD{animation:none}
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
    // bottom con env(): en un iPhone con indicador, 22px deja el gato debajo de el.
    'position:fixed;right:22px;bottom:calc(22px + env(safe-area-inset-bottom));z-index:70;display:flex;align-items:flex-end;gap:10px;'
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
