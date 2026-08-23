// Lo que el agente sabe del PRODUCTO y no está en ninguna tabla: cuánto cuesta,
// dónde se cambia el tema, qué hacer si el pago quedó aprobado y la lección
// sigue cerrada, cómo se responde un lab de tipo «knob».
//
// POR QUÉ DECLARADO Y NO EN EL PROMPT. Casi la mitad de lo que se pregunta por
// chat es de esta clase, y es justo donde un modelo improvisa: se inventa un
// precio, una ruta o una garantía de 7 días. Aquí está escrito una sola vez, el
// servidor lo sirve como resultado de herramienta y la respuesta queda anclada a
// un dato que alguien puede corregir. El precio, además, lo lee también el
// checkout: si cambia, cambia en los dos lados a la vez.
//
// Bilingüe es/en con respaldo a es. El idioma sale de la sesión, no del texto que
// escriba la persona.

export const PRECIO = {
  monto: 9.99,
  moneda: 'USD',
  tipo: 'pago_unico',
  garantiaDias: 14,      // 7 estaba por debajo del mínimo de la UE
  pasarela: 'mercadopago',
  leccionesLibres: 1,
  incluye: {
    es: ['Las 12 lecciones con su explicación técnica, su analogía y dos ejemplos resueltos',
         'Los 36 labs con corrección en el servidor', 'Logros, rangos, ranking y ligas semanales',
         'El PDF del curso', 'Actualizaciones futuras sin pagar otra vez'],
    en: ['All 12 lessons with their technical explanation, analogy and two worked examples',
         'All 36 labs, graded on the server', 'Achievements, ranks, ranking and weekly leagues',
         'The course PDF', 'Future updates at no extra cost'],
  },
};

// Mapa de navegación. `busca` son las palabras por las que se pregunta; `que` es
// lo que hay allí. Sin esto el agente manda a la gente a rutas que no existen.
export const RUTAS = [
  { ruta: '/panel', busca: ['panel', 'inicio', 'dashboard', 'home'],
    que: { es: 'El resumen: por dónde vas y qué sigue.', en: 'The summary: where you are and what comes next.' } },
  { ruta: '/curso', busca: ['curso', 'lecciones', 'temario', 'course', 'lessons', 'syllabus'],
    que: { es: 'Las 12 lecciones con su avance y sus candados.', en: 'The 12 lessons with your progress and their locks.' } },
  { ruta: '/leccion/{n}', busca: ['leccion', 'lección', 'lesson', 'lab', 'ejercicio', 'exercise'],
    que: { es: 'Una lección: técnica, analogía, dos ejemplos y sus tres labs.', en: 'One lesson: technical text, analogy, two examples and its three labs.' } },
  { ruta: '/chat', busca: ['chat', 'asistente', 'assistant', 'ayuda ia', 'ai help'],
    que: { es: 'Esta conversación. Modo normal sin costo y modo IA con traza.', en: 'This conversation. Free normal mode and AI mode with a visible trace.' } },
  { ruta: '/logros', busca: ['logros', 'rango', 'insignias', 'achievements', 'rank', 'badges'],
    que: { es: 'Los 48 logros y los 12 rangos, con el camino animado.', en: 'The 48 achievements and 12 ranks, with the animated path.' } },
  { ruta: '/ranking', busca: ['ranking', 'tabla', 'puesto', 'alias', 'leaderboard', 'position'],
    que: { es: 'La tabla pública. Solo apareces si te apuntas, y solo con alias.', en: 'The public table. You only appear if you opt in, and only by alias.' } },
  { ruta: '/ligas', busca: ['liga', 'ligas', 'bronce', 'plata', 'oro', 'league', 'leagues', 'metal'],
    que: { es: 'La liga de la semana: bronce, plata u oro por caudal semanal.', en: 'This week’s league: bronze, silver or gold by weekly flow.' } },
  { ruta: '/perfil', busca: ['perfil', 'pdf', 'descargar', 'profile', 'download'],
    que: { es: 'Tus datos, el PDF del curso y el borrado de cuenta.', en: 'Your data, the course PDF and account deletion.' } },
  { ruta: '/ajustes', busca: ['ajustes', 'idioma', 'tema', 'oscuro', 'claro', 'settings', 'language', 'theme', 'dark', 'light'],
    que: { es: 'Idioma, tema, sonido y movimiento reducido.', en: 'Language, theme, sound and reduced motion.' } },
  { ruta: '/pago', busca: ['pago', 'comprar', 'precio', 'pagar', 'pay', 'buy', 'price', 'checkout'],
    que: { es: 'La compra: pago único, 14 días de garantía.', en: 'Checkout: one-time payment, 14-day guarantee.' } },
  { ruta: '/soporte', busca: ['soporte', 'contacto', 'humano', 'problema', 'support', 'contact', 'human', 'bug'],
    que: { es: 'Escribirle a una persona cuando esto no alcanza.', en: 'Reaching a human when this is not enough.' } },
  { ruta: '/privacidad', busca: ['privacidad', 'datos', 'privacy', 'data', 'gdpr'],
    que: { es: 'Qué se guarda, cuánto y qué sale del servidor.', en: 'What is stored, for how long, and what leaves the server.' } },
  { ruta: '/terminos', busca: ['terminos', 'términos', 'legal', 'terms', 'refund', 'devolucion'],
    que: { es: 'Los términos y la garantía de 14 días.', en: 'The terms and the 14-day guarantee.' } },
  { ruta: '/recuperar', busca: ['contraseña', 'clave', 'olvide', 'password', 'forgot', 'reset'],
    que: { es: 'Enlace de un uso para cambiar la contraseña, válido 30 minutos.', en: 'One-time link to change your password, valid for 30 minutes.' } },
];

// Cómo se responde cada mecánica. El agente lo necesita para explicar el lab sin
// tocar la respuesta: explicar la mecánica no es dar la solución.
export const MECANICAS = {
  choice:  { es: 'Elegir una opción entre varias. Una sola es correcta.',
             en: 'Pick one option out of several. Exactly one is correct.' },
  cut:     { es: 'Cortar un texto en pedazos: marcas dónde va cada corte.',
             en: 'Cut a text into pieces: you mark where each cut goes.' },
  order:   { es: 'Poner los pasos en orden, arrastrando de arriba a abajo.',
             en: 'Put the steps in order, dragging from top to bottom.' },
  build:   { es: 'Armar un pedido llenando las casillas que faltan. Se corrige que ninguna quede vacía.',
             en: 'Build a prompt by filling the empty slots. Grading checks that none is left blank.' },
  knob:    { es: 'Mover una perilla hasta un rango. Acierta cualquier valor dentro del rango.',
             en: 'Move a dial into a range. Any value inside the range counts.' },
  hotcold: { es: 'Adivinar un número: la respuesta te dice si vas frío, tibio o caliente.',
             en: 'Guess a number: the answer tells you if you are cold, warm or hot.' },
};

// Término → lección que lo explica. La definición corta es para responder de una;
// la lección es para mandar a leer. Los alias incluyen inglés porque la gente
// pregunta «what is a token» aunque el curso esté en español.
export const GLOSARIO = [
  { termino: 'aprendizaje', alias: ['aprender', 'entrenar con ejemplos', 'machine learning', 'learning'], leccion: 1,
    que: { es: 'Ajustar números a fuerza de ejemplos marcados, en vez de escribir reglas.',
           en: 'Nudging numbers using labelled examples instead of writing rules.' } },
  { termino: 'entrenamiento', alias: ['entrenar', 'training', 'train'], leccion: 2,
    que: { es: 'El proceso de bajar el error ejemplo por ejemplo. Pasa una vez, antes de que tú llegues.',
           en: 'The process of pushing the error down example by example. It happens once, before you arrive.' } },
  { termino: 'error', alias: ['perdida', 'pérdida', 'loss', 'funcion de perdida'], leccion: 2,
    que: { es: 'La distancia entre lo que respondió y lo correcto. Entrenar es hacerla bajar.',
           en: 'The distance between its answer and the right one. Training is making it drop.' } },
  { termino: 'perilla', alias: ['parametro', 'parámetro', 'peso', 'pesos', 'parameter', 'weights', 'knob'], leccion: 3,
    que: { es: 'Uno de los miles de millones de números del modelo. Sola no significa nada.',
           en: 'One of the model’s billions of numbers. On its own it means nothing.' } },
  { termino: 'inferencia', alias: ['responder', 'costo por respuesta', 'inference'], leccion: 4,
    que: { es: 'Usar el modelo ya entrenado. Cuesta centavos; entrenarlo costó millones.',
           en: 'Using the already-trained model. It costs cents; training it cost millions.' } },
  { termino: 'token', alias: ['tokens', 'tokenizar', 'tokenización', 'tokenize', 'tokenization'], leccion: 5,
    que: { es: 'El pedacito en que parte el texto para leerlo. Se mide y se cobra en tokens.',
           en: 'The small piece it splits text into. Everything is measured and billed in tokens.' } },
  { termino: 'probabilidad', alias: ['puntaje', 'puntajes', 'logits', 'probability', 'scores', 'siguiente palabra'], leccion: 6,
    que: { es: 'El puntaje que le da a cada opción de continuación. Todos juntos suman 100.',
           en: 'The score it gives each possible continuation. Together they add up to 100.' } },
  { termino: 'prompt', alias: ['pedido', 'instruccion', 'instrucción', 'pregunta', 'prompting'], leccion: 7,
    que: { es: 'Lo que le pides. La fórmula es qué + para quién + cómo; lo que no digas lo rellena genérico.',
           en: 'What you ask for. The formula is what + for whom + how; whatever you leave out comes back generic.' } },
  { termino: 'contexto', alias: ['ventana', 'ventana de contexto', 'memoria de la conversacion', 'context', 'context window'], leccion: 8,
    que: { es: 'La mesa donde caben la conversación y tus archivos. Al llenarse, lo viejo se cae.',
           en: 'The table that holds the conversation and your files. When it fills up, the oldest falls off.' } },
  { termino: 'temperatura', alias: ['perilla creativa', 'creatividad', 'temperature', 'top-p'], leccion: 9,
    que: { es: 'La perilla entre repetir la opción más probable y arriesgar una menos obvia.',
           en: 'The dial between repeating the likeliest option and risking a less obvious one.' } },
  { termino: 'alucinacion', alias: ['alucinación', 'inventar', 'se lo inventa', 'hallucination', 'made up'], leccion: 10,
    que: { es: 'Una respuesta que suena bien y es falsa. El puntaje mide cómo suena, no si es cierto.',
           en: 'An answer that sounds right and is false. The score measures how it sounds, not whether it is true.' } },
  { termino: 'fecha de corte', alias: ['corte de conocimiento', 'cutoff', 'knowledge cutoff', 'buscar en internet', 'rag'], leccion: 11,
    que: { es: 'Hasta cuándo llega lo que aprendió. Conectado a internet deja de adivinar el presente.',
           en: 'How far its learning reaches. Connected to the internet it stops guessing about today.' } },
  { termino: 'habito', alias: ['hábito', 'practica', 'práctica', 'rutina', 'habit', 'practice'], leccion: 12,
    que: { es: 'Cinco minutos al día. Es lo único que separa saber de esto a usarlo.',
           en: 'Five minutes a day. It is the only thing between knowing this and using it.' } },
  { termino: 'modelo', alias: ['llm', 'model', 'red neuronal', 'neural network'], leccion: 3,
    que: { es: 'El archivo de números que quedó del entrenamiento. No guarda textos ni fotos.',
           en: 'The file of numbers left over from training. It stores no texts and no photos.' } },
  { termino: 'lab', alias: ['labs', 'ejercicio', 'ejercicios', 'exercise'], leccion: 1,
    que: { es: 'El ejercicio que cierra cada lección. Tres por lección, 36 en total, corregidos en el servidor.',
           en: 'The exercise that closes each lesson. Three per lesson, 36 in all, graded on the server.' } },
];

// Lo que se pregunta cuando algo no funciona. `busca` son las palabras del
// problema tal como las escribe la gente.
export const FAQ = [
  { id: 'leccion_cerrada', busca: ['cerrada', 'candado', 'no puedo abrir', 'bloqueada', 'locked', 'padlock', '402'],
    p: { es: '¿Por qué no puedo abrir una lección?', en: 'Why can’t I open a lesson?' },
    r: { es: 'La lección 1 y sus tres labs son libres. De la 2 a la 12 se abren con la compra: pago único, 14 días de garantía.',
         en: 'Lesson 1 and its three labs are free. Lessons 2 to 12 open with the purchase: one-time payment, 14-day guarantee.' } },
  { id: 'pague_sigue_cerrado', busca: ['pagué', 'pague', 'ya pagué', 'sigue cerrado', 'no se abrio', 'paid', 'still locked'],
    p: { es: 'Pagué y sigue cerrado.', en: 'I paid and it is still locked.' },
    r: { es: 'La compra se abre cuando Mercado Pago confirma el pago, no cuando vuelves a la página; si quedó pendiente puede tardar. Recarga y, si en un rato sigue igual, escribe por /soporte con la fecha y el medio de pago.',
         en: 'Access opens when Mercado Pago confirms the payment, not when you land back on the page; a pending payment can take a while. Reload, and if it stays the same, write via /soporte with the date and payment method.' } },
  { id: 'contrasena', busca: ['contraseña', 'clave', 'olvide', 'no puedo entrar', 'password', 'forgot', 'login'],
    p: { es: 'No puedo entrar / olvidé la contraseña.', en: 'I can’t log in / I forgot my password.' },
    r: { es: 'En /recuperar pides un enlace de un uso, válido 30 minutos. Cambiar la contraseña cierra las sesiones abiertas en otros equipos. Cinco intentos fallidos bloquean la cuenta 15 minutos.',
         en: 'At /recuperar you request a one-time link, valid for 30 minutes. Changing the password closes sessions on other devices. Five failed attempts lock the account for 15 minutes.' } },
  { id: 'lab_no_guarda', busca: ['no guarda', 'no me cuenta', 'no se registro', 'not saved', 'not counted', 'borrador'],
    p: { es: 'Respondí un lab y no me lo contó.', en: 'I answered a lab and it did not count.' },
    r: { es: 'Cuenta el primer acierto: repetir un lab resuelto no suma otra vez. Si el lab está en borrador, responderlo devuelve un aviso y no se guarda. Si fallaste, el intento sí queda guardado.',
         en: 'The first correct answer is what counts: re-solving a lab does not add again. A draft lab returns a notice and is not saved. A wrong attempt is still recorded.' } },
  { id: 'sin_liga', busca: ['no tengo liga', 'liga vacia', 'no aparezco', 'no league', 'not in league'],
    p: { es: 'No aparezco en la liga.', en: 'I am not in the league.' },
    r: { es: 'Hacen falta tres cosas: haber comprado, estar apuntado al ranking con alias, y que haya al menos cinco personas esa semana. Por debajo de cinco no hay liga: una liga de dos no compara nada.',
         en: 'Three things are needed: having purchased, being opted into the ranking with an alias, and at least five people that week. Below five there is no league: a league of two compares nothing.' } },
  { id: 'pdf', busca: ['pdf', 'descargar', 'imprimir', 'download', 'print'],
    p: { es: '¿Puedo descargar el curso en PDF?', en: 'Can I download the course as a PDF?' },
    r: { es: 'Sí, con la compra, desde /perfil, en español o inglés. Si el archivo todavía no está generado el botón lo dice en vez de fallar en silencio.',
         en: 'Yes, with the purchase, from /perfil, in Spanish or English. If the file has not been generated yet, the button says so instead of failing silently.' } },
  { id: 'borrar_cuenta', busca: ['borrar cuenta', 'eliminar cuenta', 'darme de baja', 'delete account', 'gdpr'],
    p: { es: '¿Cómo borro mi cuenta?', en: 'How do I delete my account?' },
    r: { es: 'En /perfil, con tu contraseña. El correo queda libre para volver a registrarte y tus intentos se conservan sin nombre, para que las cuentas de la cohorte sigan cuadrando.',
         en: 'From /perfil, with your password. The email is freed so you can register again, and your attempts are kept without a name so cohort figures still add up.' } },
  { id: 'devolucion', busca: ['devolucion', 'devolución', 'reembolso', 'garantia', 'refund', 'money back'],
    p: { es: '¿Hay devolución?', en: 'Is there a refund?' },
    r: { es: '14 días desde la compra, sin explicar por qué. Se pide por /soporte.',
         en: '14 days from purchase, no reason needed. Request it via /soporte.' } },
];

export const COMO_FUNCIONA = {
  es: [
    '12 lecciones. Cada una trae el mecanismo explicado, una analogía cotidiana y dos ejemplos resueltos.',
    'Después de leer, tres labs por lección: fácil, medio y difícil. La corrección ocurre en el servidor, así que la respuesta no está en el navegador.',
    'Resolver labs abre logros: tres grados por lección (48 en total) y un rango por cada lección cerrada (12).',
    'El ranking es opcional y con alias: nadie ve tu nombre ni tu correo.',
    'La liga semanal mide el caudal de la semana —labs resueltos por primera vez, lunes a domingo— y no el total acumulado, para que quien entra hoy también pueda ganar.',
    'La lección 1 es libre. El resto se abre con un pago único.',
  ],
  en: [
    '12 lessons. Each one has the mechanism explained, an everyday analogy and two worked examples.',
    'After reading, three labs per lesson: easy, medium and hard. Grading happens on the server, so the answer is never in the browser.',
    'Solving labs unlocks achievements: three grades per lesson (48 in all) and one rank per closed lesson (12).',
    'The ranking is optional and alias-only: nobody sees your name or your email.',
    'The weekly league measures that week’s flow — labs solved for the first time, Monday to Sunday — not your running total, so someone starting today can still win.',
    'Lesson 1 is free. The rest opens with a one-time payment.',
  ],
};

export const SOPORTE = {
  ruta: '/soporte',
  que: {
    es: 'Una persona lee lo que escribas ahí. Cuenta qué intentabas, qué viste y en qué página: con eso se resuelve en un mensaje en vez de tres.',
    en: 'A human reads what you write there. Say what you were trying to do, what you saw and on which page: that solves it in one message instead of three.',
  },
  antesDeEscribir: {
    es: ['La ruta exacta (por ejemplo /leccion/5)', 'Qué esperabas y qué pasó', 'Si es de pago: la fecha y el medio'],
    en: ['The exact route (for example /leccion/5)', 'What you expected and what happened', 'For payments: the date and the method'],
  },
};

const norm = (s) => String(s ?? '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s.]/g, ' ').replace(/\s+/g, ' ').trim();

/** Elige idioma con respaldo a español. Nunca devuelve undefined. */
export const enIdioma = (campo, lang) => (campo && (campo[lang] ?? campo.es)) ?? null;

/** Cuántas palabras de `busca` aparecen en la consulta. 0 = no aplica. */
function puntaje(consulta, busca) {
  const q = norm(consulta);
  if (!q) return 0;
  let p = 0;
  for (const b of busca) {
    const t = norm(b);
    if (t && q.includes(t)) p += t.includes(' ') ? 3 : 2;
  }
  return p;
}

/** Rutas que responden a «¿dónde está…?», de más a menos probable. */
export function rutasPara(consulta, lang, tope = 3) {
  const con = RUTAS.map((r) => ({ ruta: r.ruta, que: enIdioma(r.que, lang), p: puntaje(consulta, r.busca) }))
    .filter((r) => r.p > 0).sort((a, b) => b.p - a.p).slice(0, tope);
  return con.map(({ p, ...r }) => r);
}

/** Entradas del FAQ que responden al problema descrito. */
export function faqPara(consulta, lang, tope = 3) {
  const con = FAQ.map((f) => ({ id: f.id, pregunta: enIdioma(f.p, lang), respuesta: enIdioma(f.r, lang), p: puntaje(consulta, f.busca) }))
    .filter((f) => f.p > 0).sort((a, b) => b.p - a.p).slice(0, tope);
  return con.map(({ p, ...f }) => f);
}

/** Términos del glosario que casan con lo preguntado. */
export function glosarioPara(consulta, lang, tope = 4) {
  const con = GLOSARIO.map((g) => ({
    termino: g.termino, leccion: g.leccion, que: enIdioma(g.que, lang),
    p: puntaje(consulta, [g.termino, ...g.alias]),
  })).filter((g) => g.p > 0).sort((a, b) => b.p - a.p).slice(0, tope);
  return con.map(({ p, ...g }) => g);
}

/** Todos los términos, para cuando se pregunta «qué puedo preguntarte». */
export const terminos = () => GLOSARIO.map((g) => g.termino);
