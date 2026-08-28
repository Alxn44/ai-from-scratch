// Landing content — typed source of truth (TS 7 / Go-native compiler).
export interface Module { n: string; eb: string; h: string; d: string; k: string; kc: string; }
export interface Candidate { name: string; logit: number; }
export interface Faq { q: string; a: string; }

export const MODULES: Module[] = [
  { n:"01", eb:"LA IA", h:"Aprende con ejemplos", d:"No recibe reglas escritas: encuentra patrones entre miles de ejemplos etiquetados.", k:"100.000", kc:"fotos de gatos ayudan a aprender qué distingue a un gato. A ti te bastan unas pocas para reconocerlo." },
  { n:"02", eb:"CÓMO MEJORA", h:"Juega frío y caliente", d:"Mejorar, para ella, es una sola cosa: que el número de “qué tan lejos quedé” baje.", k:"94 → 23 → 4", kc:"así baja el error con la práctica. Entrenar = hacerlo bajar." },
  { n:"03", eb:"DÓNDE LO GUARDA", h:"Todo queda en perillas", d:"Lo aprendido no son fotos ni frases: son millones de números ajustados.", k:"70.000.000.000", kc:"perillas puede tener un modelo grande. Cada una, por sí sola, es solo un número." },
  { n:"04", eb:"POR QUÉ NO CAMBIA", h:"Contigo no aprende", d:"Estudiar y responder son dos momentos separados. Cuando le hablas, el estudio ya terminó.", k:"1 vez", kc:"se entrena, y cuesta millones. Responder cuesta centavos." },
  { n:"05", eb:"CÓMO LEE", h:"Lee pedacitos: tokens", d:"No ve palabras ni letras. Parte tu texto en trozos y trabaja con esos.", k:"3 palabras = 5 tokens", kc:"todo se mide y se cobra en tokens." },
  { n:"06", eb:"CÓMO ESCRIBE", h:"Elige el siguiente token", d:"Calcula opciones, elige un token y vuelve a calcular con el texto nuevo.", k:"31 de 100", kc:"las probabilidades de todas las opciones suman 100." },
  { n:"07", eb:"CÓMO PEDIRLE", h:"La fórmula del buen pedido", d:"No adivina lo que tienes en la cabeza. Tu explicación es todo lo que recibe.", k:"qué + para quién + cómo", kc:"esa es toda la fórmula. Lo que no digas, lo rellena genérico." },
  { n:"08", eb:"SU MEMORIA", h:"La mesa se llena", d:"Solo puede mantener presente una cantidad limitada de conversación a la vez.", k:"CONTEXTO", kc:"se mide en tokens y cambia según el modelo. Lo más antiguo puede quedar fuera." },
  { n:"09", eb:"SU PERILLA", h:"Seria o creativa: tú eliges", d:"La temperatura decide cuánto azar acepta al elegir entre sus opciones.", k:"TEMPERATURA", kc:"baja para respuestas consistentes; más alta para explorar ideas." },
  { n:"10", eb:"SU PELIGRO", h:"Puede inventar con seguridad", d:"Si le falta un dato, puede completar con algo que suena convincente, pero es falso.", k:"suena ≠ cierto", kc:"una respuesta fluida no demuestra que sea cierta: verifica la fuente." },
  { n:"11", eb:"SU FECHA", h:"Su conocimiento tiene fecha", d:"Aprendió hasta un día concreto. Para saber lo reciente necesita una fuente actual.", k:"FUENTE ACTUAL", kc:"la aplicación puede buscarla y entregársela como contexto." },
  { n:"12", eb:"EMPIEZA HOY", h:"Copia, pega y listo", d:"Es una herramienta para pensar y producir más rápido. No decide por ti.", k:"5 min al día", kc:"bastan para agarrarle la mano." }
];

export const CANDS: Candidate[] = [
  { name:"Max", logit:5.2 }, { name:"Luna", logit:4.7 }, { name:"Rocky", logit:3.9 },
  { name:"Coco", logit:3.4 }, { name:"Sr. Mostacho", logit:1.1 }, { name:"Nube", logit:0.7 }
];

export const FAQS: Faq[] = [
  { q:"¿Necesito saber programar?", a:"No. El curso no tiene una sola línea de código ni una fórmula. Todo se explica con cosas que ya usas: chats, perillas de sonido, una mesa que se llena." },
  { q:"¿Qué recibo exactamente?", a:"12 lecciones ilustradas en formato carrusel (las mismas del índice), en español e inglés, más los 9 prompts que uso a diario para copiar y pegar." },
  { q:"¿Cuánto tiempo me toma?", a:"La lectura completa toma alrededor de 40 minutos. Puedes recorrerla de una vez o avanzar una lección al día; cada una presenta una idea y tres labs para practicarla." },
  { q:"¿Sirve si ya uso ChatGPT todos los días?", a:"Sí, y quienes ya la usan suelen aprovecharlo más. Usar la IA no es lo mismo que entenderla: aquí vas a ver por qué se inventa datos, por qué se pone rara a mitad del chat y por qué el mismo pedido a veces sale genérico." },
  { q:"¿Y si no me sirve?", a:"Tienes 14 días para escribirme y recibir un reembolso completo de los $9.99. Sin formularios ni preguntas." },
  { q:"¿Qué es el harness que incluyes?", a:"Es mi entorno de trabajo con Claude Code, el mismo que uso: la configuración (skills, hooks, slash commands y settings), los agentes y workflows que tengo armados, y los 9 prompts con sus plantillas. Va en un repo al que tienes acceso: cuando lo actualizo, vuelves a descargarlo sin pagar de nuevo. No necesitas saber programar para usar los prompts; la parte de configuración es para cuando quieras dar el siguiente paso." },
  { q:"¿Es pago único o suscripción?", a:"Suscripción de $9.99 USD al mes. Se renueva sola hasta que la canceles, y mientras esté activa tienes todo el Vol. 1 con sus actualizaciones incluidas. Cancelas en un clic desde tu perfil: sigues entrando hasta el final del mes que ya pagaste." },
  { q:"¿El curso se queda viejo?", a:"No: lo actualizo. Cuando la IA cambia lo suficiente para que una lección deje de ser cierta, la reescribo y te llega la versión nueva gratis. Las actualizaciones aplican solo al Vol. 1 — los volúmenes siguientes se venden aparte. Aplican términos y condiciones." }
];

export const MICRO: string[] = ["01·LA IA","TOKENS","+","70.000.000.000","ES/EN","×","94→23→4","$9.99","//","T=0.30","12/12","CONTEXTO","suena ≠ cierto","·","100.000","FRÍO","CALIENTE","→","perillas","05·CÓMO LEE","31/100","IA","∞","1 vez","carta|gena","AD","09·PERILLA","memoria: ayer","•","internet: hoy","qué+quién+cómo","○","4:5","1080×1350","12 LECCIONES","−","error↓","no sé","□","5 min/día","06·ESCRIBE","suave 12","azul ~0","△","ES","EN","+","bueno 31","Max","Sr. Mostacho","／","3 palabras","5 tokens","·","10·PELIGRO","verifícalo","◇","08·MESA","se llena","lo viejo cae","×","07·PEDIRLE","genérico","≠","04·NO CAMBIA","libro impreso","·","02·MEJORA","frío/caliente","+","03·PERILLAS","70B","○","11·FECHA","corte","hoy","→","12·EMPIEZA","copia","pega","·","40 min","garantía 14d","+","$9.99/mes","cancelas cuando quieras","×","@alxn_dev_ai","IA fácil","·","2160×2700","PNG 2×","○","carrusel","·","VOL. 1","fundamentos","+","AD"];

export const TICKER: string[] = ["12 LECCIONES","·","ES / EN","·","40 MIN DE LECTURA","·","1080 × 1350","·","$9.99 AL MES","·","GARANTÍA 14 DÍAS","·","9 PROMPTS INCLUIDOS","·","MI HARNESS DE CLAUDE CODE","·","SIN CÓDIGO","·","SIN FÓRMULAS","·","CANCELAS CUANDO QUIERAS","·","ACTUALIZACIONES DEL VOL. 1","·","FUNDAMENTOS · VOL. 1","·","@ALXN_DEV_AI","·"];

/* La marca vive en public/logo.png, no en base64 dentro del bundle.
   Antes era un data-URI cuyo IDAT declaraba 5613 bytes y traia 0: la cadena se
   corto al pegarla, asi que el PNG no tenia ni una scanline y NINGUN img.lg
   decodificaba. Eso dejaba el loader de index.astro:122 pintando el cuadrado
   rosado de screen(#FF453A, #0A84FF), y el muestreador de particulas de
   index.astro:619 cayendo siempre al anillo de reserva.
   El fichero es RGBA con alfa real (el rig de aberracion la necesita para
   enmascarar los tintes) y cuadrado, porque index.astro:604 lo dibuja en un
   lienzo 104x104 y un wordmark 1.82:1 sin rellenar saldria achatado.
   Mismo origen, asi que getImageData no contamina el lienzo. */
export const LOGO = "/logo.png";
