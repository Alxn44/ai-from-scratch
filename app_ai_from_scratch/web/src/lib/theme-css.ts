// Fuente única de los tokens de color. La usan el layout de la app y las páginas
// públicas (login, registro, pago). Los valores de papel se declaran UNA vez y se
// emiten en dos sitios: preferencia explícita y tema del equipo.
const PAPER = `--bg:#F2F2F2;--panel:#fff;color-scheme:light;
  --l1:#000;--l2:rgba(0,0,0,.66);--l3:rgba(0,0,0,.58);
  --hair:rgba(0,0,0,.22);--hair2:rgba(0,0,0,.08);--fill:rgba(120,120,128,.20);
  --ac:#0A5AD6;--ac-solid:#0A5AD6;--ok:#0C6B3E;--or:#8A5000;--rd:#C21B12;
  --btn-bg:#000;--btn-fg:#fff;`;

export const TOKENS = `
:root{
  --f:-apple-system,'SF Pro Display','SF Pro Text','Helvetica Neue',system-ui,sans-serif;
  --m:ui-monospace,'SF Mono',SFMono-Regular,Menlo,monospace;
  --bg:#000;--panel:#0B0B0C;color-scheme:dark;
  --l1:#fff;--l2:rgba(235,235,245,.62);--l3:rgba(235,235,245,.50);
  --hair:rgba(84,84,88,.46);--hair2:rgba(84,84,88,.16);--fill:rgba(120,120,128,.22);
  --ac:#0A84FF;--ac-solid:#0A6CFF;--ok:#30D158;--or:#FF9F0A;--rd:#FF453A;
  --btn-bg:#fff;--btn-fg:#000;
  /* Text on top of an accent fill. White in BOTH themes — --btn-fg cannot stand
     in for it, that one is black in dark — and until now it was written as a
     literal #fff in .btn:hover and .segb[aria-pressed]. Paper does not redefine
     it: the value is the same there. */
  --on-ac:#fff;
}
/* papel: calibrado a mano sobre #F2F2F2, >=4.5:1 medido en texto de 10px */
html[data-theme="paper"]{${PAPER}}
/* tema del equipo cuando la preferencia es 'auto' */
@media (prefers-color-scheme: light){html[data-theme="auto"]{${PAPER}}}
`;

// Animación del cambio de idioma (variante A: el sello voltea junto al toggle).
// El cambio de idioma recarga, así que la página se atenúa mientras llega el
// render nuevo y eso tapa el parpadeo de la recarga.
export const LANG_FX = `
@keyframes lang-voltea {
  0% { transform: rotateY(0); opacity: 0 }
  18% { opacity: 1 }
  46% { transform: rotateY(90deg) }
  54% { transform: rotateY(90deg) }
  100% { transform: rotateY(0); opacity: 1 }
}
.lang-flip{display:inline-flex;align-items:center;gap:8px;padding:5px 10px;border:1px solid var(--hair);background:var(--panel);
  animation:lang-voltea .62s cubic-bezier(.4,0,.2,1) both;transform-origin:center}
body.lang-saliendo{opacity:.4;transition:opacity .42s ease-out}
@media (prefers-reduced-motion: reduce){
  .lang-flip{animation:none}
  body.lang-saliendo{opacity:1;transition:none}
}
`;

// Componentes compartidos por las páginas públicas.
export const PUBLIC_BASE = LANG_FX + `
*{box-sizing:border-box}
/* overflow-wrap:break-word en el cuerpo entero.
   Una direccion de correo no ofrece ningun punto de corte que 'normal' acepte,
   asi que founder.alpadev@gmail.com medía 301px dentro de una columna de 256 en
   /soporte y sacaba 37px de scroll horizontal a TODA la pagina a 320px. El
   sintoma era raro de leer: ningun elemento se salia del viewport -- la caja si
   encogia -- y aun asi documentElement.scrollWidth era 357, porque lo que se
   derramaba era el texto, no la caja.
   break-word y no anywhere: solo parte una palabra cuando de otro modo se
   desbordaria, y no cambia el calculo de min-content del resto del texto. */
body{margin:0;background:var(--bg);color:var(--l1);font-family:var(--f);-webkit-font-smoothing:antialiased;overflow-wrap:break-word;transition:background .2s,color .2s}
a{color:var(--ac);text-decoration:none}
a:hover{color:var(--ac-solid)}
.lbl{font:500 10px/1 var(--m);letter-spacing:.18em;text-transform:uppercase;color:var(--l3);margin:0}
.eb{font:600 10px/1 var(--m);letter-spacing:.22em;text-transform:uppercase;color:var(--ac);margin:0}
.h1{font:700 44px/1.06 var(--f);letter-spacing:-.04em;margin:0}
.h3{font:600 15px/1.3 var(--f);margin:0}
.p{font:400 16px/1.5 var(--f);color:var(--l2);margin:0}
.s{font:400 13px/1.45 var(--f);color:var(--l3);margin:0}
.num{font-variant-numeric:tabular-nums}
.card{border:1px solid var(--hair2);padding:22px}
/* Un hijo de flex o grid trae min-width:auto: NO puede encoger por debajo de su
   max-content, asi que una linea larga infla al padre en vez de partirse. En
   /soporte eso daba un hijo de 301px dentro de una tarjeta de 256 y 37px de
   desborde a 320. Es el mismo fallo que una pista 1fr desnuda en rejilla, en su
   version flex. Solo hijos directos, para no tocar nada que necesite su minimo. */
.card > *{min-width:0}
.btn{height:44px;display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:0 20px;border:0;border-radius:6px;background:var(--btn-bg);color:var(--btn-fg);font:600 11px/1 var(--m);letter-spacing:.1em;text-transform:uppercase;cursor:pointer;transition:background .2s,color .2s}
.btn:hover{background:var(--ac);color:#fff}
.btn:disabled{opacity:.5;cursor:default}
.btn.ghost{background:transparent;border:1px solid var(--hair);color:var(--l1)}
.btn.ghost:hover{background:var(--fill);color:var(--l1)}
.btn.block{width:100%}
.chip{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 14px;border:1px solid var(--hair);background:transparent;color:var(--l1);font:500 12px/1.2 var(--m);cursor:pointer;transition:background .15s,border-color .15s}
.chip:hover{background:var(--fill)}
.chip[data-on]{border-color:var(--ac);background:var(--fill)}
.input{height:44px;width:100%;padding:0 14px;background:var(--fill);border:1px solid var(--hair2);color:var(--l1);font:400 15px/1 var(--f)}
.input:focus{outline:none;border-color:var(--ac)}
/* el gris por defecto del navegador da 3.29:1; --l3 esta medido >=4.5 en ambos temas */
.input::placeholder{color:var(--l3);opacity:1}
.meter{height:4px;background:var(--fill)}
.meter > i{display:block;height:100%;width:0;background:var(--rd);transition:width .2s,background .2s}
/* Primitivas de formulario.
   Vivian como estilos en linea repetidos en login y registro, y ahi cabe una
   columna con hueco pero no un error por campo: para eso hace falta un selector
   ([data-mal]) que pinte a la vez el borde del campo y su mensaje, y un atributo
   no puede reaccionar a un estado. El registro necesitaba las dos cosas. */
.field{display:flex;flex-direction:column;gap:7px}
/* .lbl da 10px mayusculas monoespaciadas con .18em de tracking. Sirve para una
   etiqueta ambiental; para la que dice QUE ESCRIBIR en un campo es demasiado
   pequena y demasiado separada. Esta se lee. */
.flbl{font:600 12px/1.2 var(--f);color:var(--l1);margin:0}
.fgrupo{display:flex;flex-direction:column;gap:15px;padding:16px 16px 18px;border:1px solid var(--hair2)}
.fgrupo-t{display:flex;align-items:baseline;gap:9px;margin:0 0 1px}
.fgrupo-n{display:grid;place-items:center;width:19px;height:19px;flex:none;border:1px solid var(--hair);font:600 10px/1 var(--m);color:var(--l2)}
/* Reservado siempre: sin esto la tarjeta salta 18px cada vez que aparece un
   error y el boton se mueve bajo el dedo justo cuando se va a pulsar. */
.fnota{font:400 12px/1.35 var(--f);color:var(--l3);margin:0;min-height:16px}
.fnota[data-est="mal"]{color:var(--rd)}
.fnota[data-est="bien"]{color:var(--ok)}
.field[data-mal] .input{border-color:var(--rd)}
.field[data-mal] .input:focus{border-color:var(--rd)}
.fver{background:none;border:0;padding:0 6px;color:var(--ac);font:500 11px/1 var(--m);letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
.fver:hover{color:var(--ac-solid)}
.mark{width:26px;height:26px;border:1px solid var(--hair);display:grid;place-items:center;font:700 12px/1 var(--f)}
#toasts{position:fixed;right:24px;bottom:calc(24px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:10px;width:372px;z-index:50}
.toast{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border:1px solid var(--hair);background:var(--panel)}
/* Cabecera de las paginas publicas.
   Vivia ENTERA en un atributo style, con height:64px fijo y sin flex-wrap. Un
   estilo en linea no lo puede pisar una media query, asi que la marca y los seis
   botones de preferencias estaban condenados a compartir una sola fila: a 390px
   sumaban ~530 y se salian 59px por la derecha en /terminos, /privacidad, /404,
   /pago/gracias y /pago/error. El ancho maximo sigue en linea porque es dinamico
   (lo decide cada pagina); la geometria que depende del viewport, no. */
.pub-head{height:64px;display:flex;align-items:center;justify-content:space-between;gap:20px}
@media (max-width:900px){
  .pub-head{height:auto;min-height:56px;flex-wrap:wrap;gap:8px 14px;padding-top:10px;padding-bottom:10px}
}
.pub-split{display:flex;min-height:100dvh}
.pub-pane{width:620px;flex:none;border-right:1px solid var(--hair2);padding:54px 48px;display:flex;flex-direction:column;gap:30px}
.pub-main{flex:1;min-width:0;display:flex;flex-direction:column;padding:26px 40px 40px}
.pub-card{width:420px;max-width:100%;display:flex;flex-direction:column}
.or-txt{font:500 12px/1 var(--f);color:var(--l3);text-transform:lowercase}
@media (max-width:900px){.or-txt{display:none}}
.pay-grid{display:grid;grid-template-columns:1fr 560px;min-height:calc(100dvh - 64px)}
.pay-head{height:64px;border-bottom:1px solid var(--hair2);display:flex;align-items:center;justify-content:space-between;padding:0 32px;gap:20px}
/* pago/gracias y pago/error la llevaban escrita en linea, sin media query. */
.pay-split{display:grid;grid-template-columns:1fr 300px;gap:24px;align-items:start}
/* 900 y no 800: es el mismo umbral que App.astro. Con 800, iPad vertical
   (820 px) seguia recibiendo el split de escritorio y el formulario de login
   se quedaba con 120 px utiles para una tarjeta de 420. */
@media (max-width:900px){
  .pub-split{flex-direction:column}
  .pub-pane{width:auto;border-right:0;border-top:1px solid var(--hair2);padding:28px 22px 22px;order:2}
  .pub-main{order:1;padding:8px 22px 36px}
  .pub-pane .h1{font-size:32px}
  .pub-card{width:100%}
  .pay-grid{grid-template-columns:1fr}
  .pay-head{height:auto;min-height:56px;padding:10px 16px;flex-wrap:wrap}
  .pay-note{display:none!important}
  .pay-copy{order:2;border-right:0}
  .pay-box{order:1}
  .pay-grid > section{padding:24px 18px!important}
  #toasts{left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));width:auto}
  .toast{width:auto}
  /* EL SUELO TACTIL, POR ENCIMA DE TODO LO DEMAS.
     44px no es una preferencia de diseno, es el minimo con el que un dedo
     acierta. El problema no era declararlo -- .btn y .input ya dicen 44 --
     sino que once sitios lo pisan con height:36px o height:34px ESCRITO EN
     EL ATRIBUTO style, y uno mas lo inyecta desde JavaScript. Una media
     query no le gana a un estilo en linea, asi que la unica forma de que
     esos doce respeten el suelo es esta.
     !important es un martillo y aqui es el correcto: la afirmacion es
     justamente que en un telefono NADA puede bajar de 44, ni un ajuste
     local ni codigo que escriba estilos en caliente. Lo que se cede es
     poder fijar a mano una altura menor en movil, que es exactamente lo
     que se quiere impedir.
     height:auto junto a min-height para que un boton de dos lineas crezca
     en vez de recortar su texto. */
  .btn,.chip,.segb,button,[role="button"]{min-height:44px!important;height:auto!important}
  /* 16px es el umbral por debajo del cual Safari en iOS hace zoom al
     enfocar el campo, y ese zoom no se deshace solo: el usuario se queda
     con la pagina ampliada y desplazada. */
  .input,input.input,select.input,textarea.input{min-height:44px!important;height:auto!important;font-size:16px!important}
  /* El cupon de /pago es un <input> pelado dentro de .coupon, sin clase .input,
     asi que la regla de arriba no lo alcanza. Lo cubria una linea aparte que yo
     mismo borre al insertar este bloque; sin ella Safari volvia a ampliar la
     pagina al tocar el campo, que es justo lo que este suelo evita. */
  .coupon input{min-height:44px;font-size:16px}
  /* Enlaces que son destino y no prosa: la marca de la cabecera y los del pie.
     No entran en la regla de button porque son <a>, y no se puede dar 44px a
     todo <a> sin convertir cada enlace dentro de un parrafo en un bloque. */
  .pub-head > a,.lk{display:inline-flex;align-items:center;min-height:44px}
  /* El enlace de marca, dondequiera que este. Se identifica por lo que
     CONTIENE -- el cuadro .mark -- y no por una clase que cada una de las cinco
     paginas tendria que acordarse de poner. Medía 26px de alto, la altura de
     .mark, en /login, /registro, /recuperar y /pago. */
  a:has(.mark){display:inline-flex;align-items:center;min-height:44px}
  /* Acciones sueltas de 11px junto a una etiqueta, del tipo «¿La olvidaste?».
     NO se toca un enlace dentro de una frase: WCAG 2.5.8 los exime justamente
     porque estirarlos a 44px parte el parrafo. Este va aparte, no en prosa. */
  .accion-lbl{display:inline-flex;align-items:center;min-height:44px;padding-left:8px}
  .h1{font-size:clamp(28px,8vw,44px)}
  .pay-split{grid-template-columns:1fr}
}
/* EL SUELO TACTIL NO DEPENDE DEL ANCHO, DEPENDE DEL DEDO.
   Las reglas de arriba viven en max-width:900px, que es el umbral correcto para
   el LAYOUT y equivocado para esto: un iPad Pro son 1024px CSS y se toca con el
   pulgar, y iPadOS amplia igual al enfocar un campo de menos de 16px. Medido a
   1024 sin esta regla, /login y /registro volvian a 15px y .segb a 30px de alto.
   pointer:coarse es la pregunta que de verdad importa -- «¿el puntero de este
   aparato es impreciso?» -- y responde que si en cualquier pantalla tactil sea
   cual sea su ancho, y que no en un escritorio con raton a 800px.
   NO VERIFICADO EN ESTA MAQUINA: Chrome headless declara pointer:fine y browse
   no expone emulacion de dispositivo, asi que esta regla esta escrita a partir
   de la definicion de la media query, no de una medicion. Lo que si esta medido
   es el fallo que arregla. */
@media (pointer: coarse){
  .btn,.chip,.segb,button,[role="button"]{min-height:44px!important;height:auto!important}
  .input,input.input,select.input,textarea.input,.coupon input{min-height:44px!important;height:auto!important;font-size:16px!important}
}
.seg{display:flex;border:1px solid var(--hair2)}
.segb{height:30px;padding:0 10px;background:transparent;border:0;border-right:1px solid var(--hair2);color:var(--l3);font:600 10px/1 var(--m);letter-spacing:.12em;text-transform:uppercase;cursor:pointer;transition:background .15s,color .15s}
.segb:last-child{border-right:0}
.segb:hover{color:var(--l1);background:var(--fill)}
.segb[aria-pressed="true"]{background:var(--ac-solid);color:#fff}
/* Va DESPUES de la declaracion base de .segb a proposito: misma especificidad,
   gana la ultima, y .seg/.segb se declaran al final de esta hoja. Metida dentro
   del bloque de 900 de arriba quedaba pisada por el height:30px de abajo.
   30px incumple el suelo tactil de 44 que .btn, .chip y .input ya respetan. */
@media (max-width:900px){
  .segb{height:44px;padding:0 16px;font-size:11px}
}
`;
