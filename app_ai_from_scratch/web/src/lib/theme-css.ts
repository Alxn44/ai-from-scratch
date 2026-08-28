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
body{margin:0;background:var(--bg);color:var(--l1);font-family:var(--f);-webkit-font-smoothing:antialiased;transition:background .2s,color .2s}
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
.fver{background:none;border:0;padding:0;color:var(--ac);font:500 11px/1 var(--m);letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
.fver:hover{color:var(--ac-solid)}
.mark{width:26px;height:26px;border:1px solid var(--hair);display:grid;place-items:center;font:700 12px/1 var(--f)}
#toasts{position:fixed;right:24px;bottom:calc(24px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:10px;width:372px;z-index:50}
.toast{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border:1px solid var(--hair);background:var(--panel)}
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
  .input,.coupon input{font-size:16px}
  .h1{font-size:clamp(28px,8vw,44px)}
  .pay-split{grid-template-columns:1fr}
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
