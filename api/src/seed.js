import { migrate, pool, run } from './db.js';
import { CONTENIDO } from './contenido.js';
import { hashPassword } from './auth.js';

const LESSONS = [
  [1,'LA IA','Aprende viendo ejemplos','Nadie le escribe reglas: encuentra el parecido entre miles de ejemplos, sola.','100.000','fotos de gato para aprender qué es un gato. A ti te bastan 3.'],
  [2,'CÓMO MEJORA','Juega frío y caliente','Mejorar, para ella, es una sola cosa: que el número de «qué tan lejos quedé» baje.','94 → 23 → 4','así baja el error con la práctica. Entrenar = hacerlo bajar.'],
  [3,'DÓNDE LO GUARDA','Todo queda en perillas','Lo aprendido no son fotos ni frases: son millones de numeritos ajustados.','70.000.000.000','perillas tiene un modelo grande. Cada una es solo un número.'],
  [4,'POR QUÉ NO CAMBIA','Contigo no aprende','Estudiar y responder son dos momentos separados. Cuando le hablas, el estudio ya terminó.','1 vez','se entrena, y cuesta millones. Responder cuesta centavos.'],
  [5,'CÓMO LEE','Lee pedacitos: tokens','No ve palabras ni letras. Parte tu texto en trozos y trabaja con esos.','3 palabras = 5 tokens','todo se mide y se cobra en tokens.'],
  [6,'CÓMO ESCRIBE','Adivina la que sigue','Le da un puntaje a cada palabra posible, escoge una y repite.','31 de 100','los puntajes de todas las opciones suman 100.'],
  [7,'CÓMO PEDIRLE','La fórmula del buen pedido','No adivina lo que tienes en la cabeza. Tu explicación es todo lo que recibe.','qué + para quién + cómo','esa es toda la fórmula. Lo que no digas, lo rellena genérico.'],
  [8,'SU MEMORIA','La mesa se llena','Solo tiene presente cierta cantidad de conversación a la vez.','≈ 120.000','palabras le caben: un libro mediano. Lo viejo se cae.'],
  [9,'SU PERILLA','Seria o creativa: tú eliges','La temperatura decide si va a lo seguro o se arriesga con opciones raras.','99 de 100','veces gana la opción top con la perilla abajo.'],
  [10,'SU PELIGRO','Inventa con seguridad','No tiene botón de «no sé». Si le falta el dato, arma uno que suena perfecto.','suena ≠ cierto','su puntaje mide qué tan bien suena, no qué tan cierto es.'],
  [11,'SU FECHA','Su memoria tiene fecha','Estudió hasta un día concreto. Lo de después no existe… salvo que busque.','memoria: ayer','internet: hoy. Conectada deja de adivinar.'],
  [12,'EMPIEZA HOY','Copia, pega y listo','Es una herramienta para pensar y producir más rápido. No decide por ti.','5 min al día','bastan para agarrarle la mano.'],
];

const LEVELS = ['facil', 'medio', 'dificil'];

// Mecánica asignada a los 36 labs (la tabla del diseño).
const KINDS = {
  1:['choice','build','order'], 2:['hotcold','choice','order'], 3:['choice','hotcold','choice'],
  4:['choice','order','choice'], 5:['choice','cut','order'], 6:['choice','choice','build'],
  7:['choice','build','build'], 8:['choice','order','build'], 9:['choice','knob','choice'],
  10:['choice','build','order'], 11:['choice','choice','order'], 12:['order','build','build'],
};

// Los 36 labs, escritos. Si algún id falta aquí, se siembra como borrador y la API
// responde 409 en vez de fingir que se puede resolver.
const REAL = {
  // ---- Lección 1 · aprende viendo ejemplos ----
  '1.1': { kind:'choice',
    prompt:'¿Cómo aprende a distinguir un gato de un perro?',
    payload:{ options:['Alguien le escribe las reglas','Viendo miles de ejemplos ya marcados','Buscando en internet cada vez','Preguntándole a un experto'] },
    solution:{ value:'Viendo miles de ejemplos ya marcados' },
    explanation:'Nadie le escribe «el gato tiene orejas puntudas». Ve cien mil fotos marcadas como gato o perro y saca el parecido sola. Por eso funciona con cosas que nadie sabría explicar con reglas.' },
  '1.2': { kind:'build',
    prompt:'Arma el material con el que se entrena: qué reconocer + cuántos ejemplos + cómo le dices cuál es cuál',
    payload:{ slots:['QUÉ RECONOCER','CUÁNTOS EJEMPLOS','CÓMO LE DICES CUÁL ES CUÁL'], tiles:[
      { slot:0, text:'Facturas pagadas y sin pagar' }, { slot:1, text:'100.000 facturas' },
      { slot:2, text:'Cada una marcada «pagada» o «pendiente»' }, { slot:0, text:'Fotos de gato' },
      { slot:1, text:'3 fotos' }, { slot:2, text:'Sin marcar nada' }] },
    solution:{ slots:['QUÉ RECONOCER','CUÁNTOS EJEMPLOS','CÓMO LE DICES CUÁL ES CUÁL'] },
    explanation:'Las tres piezas son obligatorias. Con 3 ejemplos sin marcar no aprende nada: a ti te bastan 3 fotos de gato porque llevas años viendo el mundo, ella arranca de cero.' },
  '1.3': { kind:'order',
    prompt:'¿En qué orden ocurre el entrenamiento?',
    payload:{ steps:[
      { id:'a', text:'Se juntan miles de ejemplos' },
      { id:'b', text:'Cada ejemplo se marca con su respuesta' },
      { id:'c', text:'El modelo intenta y se ajusta' },
      { id:'d', text:'Se prueba con ejemplos que nunca vio' }] },
    solution:{ order:['a','b','c','d'] },
    explanation:'El último paso es el que importa: si acierta solo con los ejemplos que ya vio, se los memorizó. Aprender es acertar con los nuevos.' },

  // ---- Lección 2 · mejorar = bajar el error ----
  '2.2': { kind:'choice',
    prompt:'Su error pasó de 94 a 23. ¿Qué significa eso?',
    payload:{ options:['Acertó 23 veces','Quedó menos lejos que antes','Ya no se equivoca','Aprendió 23 cosas nuevas'] },
    solution:{ value:'Quedó menos lejos que antes' },
    explanation:'El número que baja mide distancia, no acierto: qué tan lejos quedó de la respuesta buena. 23 sigue siendo estar lejos. Entrenar es exactamente hacer bajar ese número.' },
  '2.3': { kind:'order',
    prompt:'Ordena la vuelta que da el entrenamiento, una y otra vez',
    payload:{ steps:[
      { id:'a', text:'Intenta responder' },
      { id:'b', text:'Mide qué tan lejos quedó' },
      { id:'c', text:'Mueve un poco sus perillas' },
      { id:'d', text:'Vuelve a intentar, más cerca' }] },
    solution:{ order:['a','b','c','d'] },
    explanation:'Esa vuelta se repite millones de veces. No hay ningún momento de «entender»: solo intentar, medir y corregir un poquito.' },

  // ---- Lección 3 · todo queda en perillas ----
  '3.1': { kind:'choice',
    prompt:'De todo lo que aprendió, ¿qué queda guardado dentro?',
    payload:{ options:['Las fotos y los textos que vio','Frases copiadas, listas para pegar','Millones de números ajustados','Un archivo con las reglas que descubrió'] },
    solution:{ value:'Millones de números ajustados' },
    explanation:'No guarda los ejemplos: guarda cómo lo dejaron. Setenta mil millones de números, cada uno movido un poquito por lo que vio. Ahí está todo lo aprendido y nada más.' },
  '3.2': { kind:'hotcold',
    prompt:'Una perilla quedó mal puesta. Muévela hasta acercarte al valor que la deja bien',
    payload:{ min:1, max:100 }, solution:{ value:64 },
    explanation:'Una perilla es solo un número: ni una idea, ni una palabra. Ajustar el modelo es esto, repetido setenta mil millones de veces a la vez.' },
  '3.3': { kind:'choice',
    prompt:'Copias todas las perillas de un modelo a otra máquina vacía. ¿Qué obtienes?',
    payload:{ options:['Una máquina vacía: falta el entrenamiento','El mismo modelo, respondiendo igual','Un modelo que empieza a aprender de cero','Nada: las perillas no se pueden copiar'] },
    solution:{ value:'El mismo modelo, respondiendo igual' },
    explanation:'Los números SON el modelo. Copiarlos es copiarlo todo — por eso un modelo se puede descargar y correr en otro lado sin volver a entrenar nada.' },

  // ---- Lección 4 · contigo no aprende ----
  '4.1': { kind:'choice',
    prompt:'Hoy le corriges un error y te da las gracias. Mañana, en una conversación nueva, ¿lo recuerda?',
    payload:{ options:['Sí, ya lo aprendió','No: la conversación nueva empieza en blanco','Solo si se lo repites tres veces','Solo si le diste permiso'] },
    solution:{ value:'No: la conversación nueva empieza en blanco' },
    explanation:'Te dice «entendido» porque eso es lo que suena bien ahí, no porque haya cambiado por dentro. Sus perillas quedaron congeladas cuando terminó el entrenamiento.' },
  '4.2': { kind:'order',
    prompt:'Ordena los dos momentos: estudiar y responder',
    payload:{ steps:[
      { id:'a', text:'Se entrena una vez, y cuesta millones' },
      { id:'b', text:'Sus perillas quedan congeladas' },
      { id:'c', text:'Tú le escribes' },
      { id:'d', text:'Responde sin cambiar nada por dentro' }] },
    solution:{ order:['a','b','c','d'] },
    explanation:'Cuando le hablas, el estudio ya terminó hace meses. Nada de lo que escribas mueve una sola perilla.' },
  '4.3': { kind:'choice',
    prompt:'¿Por qué entrenarla cuesta millones y responderte cuesta centavos?',
    payload:{ options:['Porque responder usa un modelo más pequeño','Porque entrenar ajusta todas las perillas y responder solo las usa','Porque entrenar necesita internet','Porque responder lo hace una persona'] },
    solution:{ value:'Porque entrenar ajusta todas las perillas y responder solo las usa' },
    explanation:'Entrenar es mover setenta mil millones de números millones de veces. Responderte es leerlos una vez. Mismo modelo, dos costos que no se parecen.' },

  // ---- Lección 6 · adivina la que sigue ----
  '6.2': { kind:'choice',
    prompt:'Le mandas el mismo pedido dos veces. ¿Sale igual?',
    payload:{ options:['Siempre igual: es un programa','Puede cambiar: escoge entre opciones con puntaje','Cambia solo si cambias una palabra','Cambia solo la primera vez'] },
    solution:{ value:'Puede cambiar: escoge entre opciones con puntaje' },
    explanation:'La palabra ganadora se lleva 31 de 100, no 90. Cuando ninguna arrasa, la segunda tiene chance real — y por eso el mismo pedido puede salir distinto.' },
  '6.3': { kind:'build',
    prompt:'Escribe la frase de a un pedacito, como lo hace ella',
    payload:{ slots:['PRIMER PEDACITO','EL QUE SIGUE','EL QUE SIGUE'], tiles:[
      { slot:0, text:'El gato' }, { slot:1, text:'se subió' }, { slot:2, text:'al tejado' },
      { slot:0, text:'Buenos' }, { slot:1, text:'días,' }, { slot:2, text:'Ricardo' }] },
    solution:{ slots:['PRIMER PEDACITO','EL QUE SIGUE','EL QUE SIGUE'] },
    explanation:'No planea la frase completa y luego la escribe: escoge un pedacito, lo vuelve a leer todo y escoge el siguiente. Por eso la ves escribir de a poquitos.' },

  // ---- Lección 7 · la fórmula del buen pedido ----
  '7.1': { kind:'choice',
    prompt:'¿Cuál de estos pedidos te va a dar algo usable?',
    payload:{ options:['Resume esto','Resume este contrato','Resume este contrato para un cliente sin abogado, en 5 puntos','Hazlo bien y rápido, por favor'] },
    solution:{ value:'Resume este contrato para un cliente sin abogado, en 5 puntos' },
    explanation:'«Resume esto» le deja tres decisiones a ella: para quién, qué tan largo y qué dejar afuera. Lo que no dices, lo rellena genérico.' },
  '7.3': { kind:'build',
    prompt:'Arma un pedido difícil: qué + para quién + cómo + qué evitar + formato',
    payload:{ slots:['QUÉ','PARA QUIÉN','CÓMO','QUÉ EVITAR','FORMATO'], tiles:[
      { slot:0, text:'Escribe la propuesta' }, { slot:1, text:'para un cliente que no es técnico' },
      { slot:2, text:'tono directo, sin adornos' }, { slot:3, text:'sin promesas de plazos' },
      { slot:4, text:'una página, con precios en una tabla' },
      { slot:0, text:'Revisa este código' }, { slot:1, text:'para quien lo va a mantener' },
      { slot:2, text:'señala solo lo que rompe algo' }, { slot:3, text:'sin sugerencias de estilo' },
      { slot:4, text:'lista, archivo y línea' }] },
    solution:{ slots:['QUÉ','PARA QUIÉN','CÓMO','QUÉ EVITAR','FORMATO'] },
    explanation:'«Qué evitar» es la ranura que casi nadie llena y la que más ahorra: sin ella te devuelve lo de siempre y te toca pedirlo otra vez.' },

  // ---- Lección 8 · la mesa se llena ----
  '8.1': { kind:'choice',
    prompt:'La conversación se hace larguísima. ¿Qué pasa?',
    payload:{ options:['Se pone lenta pero recuerda todo','Lo más viejo se cae de la mesa','Guarda el resto en tu cuenta','Te avisa antes de olvidar'] },
    solution:{ value:'Lo más viejo se cae de la mesa' },
    explanation:'Le caben unas 120.000 palabras a la vez: un libro mediano. Cuando se llena, lo primero que escribiste deja de existir para ella — y no te avisa.' },
  '8.2': { kind:'order',
    prompt:'Ordena de lo primero que se cae de la mesa a lo último',
    payload:{ steps:[
      { id:'a', text:'El saludo del principio' },
      { id:'b', text:'Las instrucciones que diste al arrancar' },
      { id:'c', text:'Lo que hablaron hace un rato' },
      { id:'d', text:'Lo que acabas de escribir' }] },
    solution:{ order:['a','b','c','d'] },
    explanation:'Se cae por antigüedad, no por importancia. Por eso las instrucciones del arranque son justo lo que hay que repetir cuando la charla se alarga.' },
  '8.3': { kind:'build',
    prompt:'Le tienes que pasar un documento largo y solo importa el capítulo 3. Arma el pedido',
    payload:{ slots:['QUÉ LE PEGAS','QUÉ LE PIDES','QUÉ NO QUIERES'], tiles:[
      { slot:0, text:'Solo el capítulo 3' }, { slot:1, text:'Las tres obligaciones que me caen a mí' },
      { slot:2, text:'Nada de resumir el resto del documento' },
      { slot:0, text:'Las 300 páginas completas' }, { slot:1, text:'Un resumen general' },
      { slot:2, text:'Sin restricciones' }] },
    solution:{ slots:['QUÉ LE PEGAS','QUÉ LE PIDES','QUÉ NO QUIERES'] },
    explanation:'Pegar las 300 páginas llena la mesa de cosas que no te interesan y empuja fuera tu propia pregunta. Menos texto y más preciso gana casi siempre.' },

  // ---- Lección 9 · seria o creativa ----
  '9.1': { kind:'choice',
    prompt:'Bajas la temperatura al mínimo. ¿Qué obtienes?',
    payload:{ options:['Respuestas más cortas','Casi siempre la misma respuesta','Respuestas más verdaderas','Respuestas más rápidas'] },
    solution:{ value:'Casi siempre la misma respuesta' },
    explanation:'Abajo escoge la opción de mayor puntaje casi siempre: 99 de 100 veces. Repetible no significa cierta — la perilla no toca la verdad, solo el riesgo.' },
  '9.3': { kind:'choice',
    prompt:'Lluvia de ideas para el nombre de una marca. ¿Dónde dejas la perilla?',
    payload:{ options:['Abajo: quiero la mejor opción','Arriba: quiero opciones raras','En el medio siempre','No aplica: los nombres no usan perilla'] },
    solution:{ value:'Arriba: quiero opciones raras' },
    explanation:'Arriba, «Sr. Mostacho» empieza a tener chance frente a «Max». Eso es basura en un correo de trabajo y es justo lo que quieres en una lluvia de ideas.' },

  // ---- Lección 10 · inventa con seguridad ----
  '10.1': { kind:'choice',
    prompt:'Le pides el artículo exacto de una ley que no conoce. ¿Qué hace?',
    payload:{ options:['Dice que no sabe','Arma un artículo que suena perfecto','Se queda en blanco','Busca en internet sola'] },
    solution:{ value:'Arma un artículo que suena perfecto' },
    explanation:'No tiene botón de «no sé»: su trabajo es que la frase suene bien, y un número de artículo inventado suena igual de bien que el verdadero. Suena ≠ cierto.' },
  '10.2': { kind:'build',
    prompt:'Arma el pedido que baja el invento: dale la fuente + pide la cita + permítele decir «no sé»',
    payload:{ slots:['LA FUENTE','LA CITA','EL PERMISO'], tiles:[
      { slot:0, text:'Te pego la ley completa' }, { slot:1, text:'Cita el artículo y pega la frase' },
      { slot:2, text:'Si no está en el texto, dime «no está»' },
      { slot:0, text:'Búscalo tú' }, { slot:1, text:'Explícame con tus palabras' },
      { slot:2, text:'Dame siempre una respuesta' }] },
    solution:{ slots:['LA FUENTE','LA CITA','EL PERMISO'] },
    explanation:'El permiso es la pieza clave: sin un «puedes decir que no está», inventar es la única salida que le dejas.' },
  '10.3': { kind:'order',
    prompt:'Te dio un dato con toda la seguridad del mundo. Ordena cómo lo verificas',
    payload:{ steps:[
      { id:'a', text:'Le pides la fuente exacta' },
      { id:'b', text:'Abres la fuente tú mismo' },
      { id:'c', text:'Buscas el dato dentro' },
      { id:'d', text:'Si no está, lo descartas completo' }] },
    solution:{ order:['a','b','c','d'] },
    explanation:'Ojo con el paso dos: la fuente también puede estar inventada. Si el enlace no abre o el documento no dice eso, el dato se cae — no se negocia.' },

  // ---- Lección 11 · su memoria tiene fecha ----
  '11.1': { kind:'choice',
    prompt:'¿Por qué no sabe qué pasó ayer?',
    payload:{ options:['Porque se le olvidó','Porque su estudio terminó en una fecha','Porque las noticias no le interesan','Porque nadie se lo contó'] },
    solution:{ value:'Porque su estudio terminó en una fecha' },
    explanation:'Su memoria tiene fecha de cierre. Lo de después no es que lo dude: no existe para ella. Y si le preguntas, te va a responder con lo que sabía hasta ese día.' },
  '11.2': { kind:'choice',
    prompt:'Entonces, ¿cómo se entera de lo de hoy?',
    payload:{ options:['Se actualiza sola cada noche','Buscando en internet en ese momento','Preguntándole a otros usuarios','No hay forma'] },
    solution:{ value:'Buscando en internet en ese momento' },
    explanation:'Conectada deja de adivinar: busca, lee y te responde con lo que encontró. Sin conexión, cualquier cosa reciente sale de su memoria vieja.' },
  '11.3': { kind:'order',
    prompt:'Ordena lo que pasa cuando le preguntas algo de esta semana y sí puede buscar',
    payload:{ steps:[
      { id:'a', text:'Le preguntas algo con fecha reciente' },
      { id:'b', text:'Busca en internet' },
      { id:'c', text:'Lee lo que encontró' },
      { id:'d', text:'Responde citando de dónde salió' }] },
    solution:{ order:['a','b','c','d'] },
    explanation:'El paso cuatro es tu control: si responde sin decir de dónde salió, no buscó — contestó de memoria y no lo dijo.' },

  // ---- Lección 12 · empieza hoy ----
  '12.1': { kind:'order',
    prompt:'Ordena cómo arrancar hoy, en cinco minutos',
    payload:{ steps:[
      { id:'a', text:'Elige una tarea que ya sabes hacer' },
      { id:'b', text:'Pídesela con qué + para quién + cómo' },
      { id:'c', text:'Compara su resultado con el tuyo' },
      { id:'d', text:'Ajusta el pedido y repite' }] },
    solution:{ order:['a','b','c','d'] },
    explanation:'Se arranca con algo que ya dominas, no con algo que no sabes hacer: es la única forma de darte cuenta cuando te está entregando basura bien escrita.' },
  '12.2': { kind:'build',
    prompt:'Arma tu rutina de 5 minutos: la tarea + cuándo + cómo sabrás si sirvió',
    payload:{ slots:['LA TAREA','CUÁNDO','CÓMO SABRÁS SI SIRVIÓ'], tiles:[
      { slot:0, text:'Redactar los correos de la mañana' }, { slot:1, text:'Al abrir el computador' },
      { slot:2, text:'Si lo mandé sin reescribirlo entero' },
      { slot:0, text:'Resumir lo que leí' }, { slot:1, text:'Antes de cerrar el día' },
      { slot:2, text:'Si mañana entiendo mi propio resumen' }] },
    solution:{ slots:['LA TAREA','CUÁNDO','CÓMO SABRÁS SI SIRVIÓ'] },
    explanation:'Sin la tercera ranura la rutina se cae en una semana: necesitas una señal de que te sirvió, no la sensación de estar usando algo moderno.' },
  '12.3': { kind:'build',
    prompt:'Escribe tu primer pedido de verdad, con las cuatro piezas',
    payload:{ slots:['QUÉ','PARA QUIÉN','CÓMO','QUÉ EVITAR'], tiles:[
      { slot:0, text:'Ordena estas notas de la reunión' }, { slot:1, text:'para el equipo que no fue' },
      { slot:2, text:'decisiones primero, en lista' }, { slot:3, text:'sin repetir lo que ya sabíamos' },
      { slot:0, text:'Explícame este error' }, { slot:1, text:'para mí, que no soy técnico' },
      { slot:2, text:'con un ejemplo del día a día' }, { slot:3, text:'sin código' }] },
    solution:{ slots:['QUÉ','PARA QUIÉN','CÓMO','QUÉ EVITAR'] },
    explanation:'Ese es el curso completo en una línea: le dices qué, para quién, cómo y qué no quieres. El resto es práctica.' },
  '5.1': { kind:'choice',
    prompt:'¿En cuántos tokens parte el modelo «Cartagena es hermosa»?',
    payload:{ options:['3','5','9','20'] }, solution:{ value:'5' },
    explanation:'Son cinco: Carta · gena · es · her · mosa. Las palabras largas y los nombres propios se parten en trozos; las cortas y muy frecuentes, como «es», entran enteras. Por eso tres palabras terminan siendo cinco tokens.' },
  '5.2': { kind:'cut',
    prompt:'Corta «Cartagena es hermosa» como lo haría el modelo',
    payload:{ words:['Cartagena','es','hermosa'] }, solution:{ cuts:['0-4','2-2'] },
    explanation:'Los cortes van en Carta|gena y her|mosa. «es» no se corta: aparece tantas veces en español que el modelo ya la tiene como un trozo propio. La regla no es gramatical, es de frecuencia.' },
  '5.3': { kind:'order',
    prompt:'Del texto que escribes a la palabra que responde: ¿en qué orden pasa?',
    payload:{ steps:[
      { id:'a', text:'Parte tu texto en tokens' },
      { id:'b', text:'Convierte cada token en números' },
      { id:'c', text:'Puntúa cada token que podría seguir' },
      { id:'d', text:'Escoge uno y lo vuelve a meter al final' }] },
    solution:{ order:['a','b','c','d'] },
    explanation:'Ese último paso explica por qué escribe de a un pedacito y por qué se queda sin espacio: cada token nuevo se suma a lo que ya está en la mesa.' },
  '2.1': { kind:'hotcold',
    prompt:'Adivina el número entre 1 y 100 y mira bajar tu error',
    payload:{ min:1, max:100 }, solution:{ value:37 },
    explanation:'Entrenar es exactamente esto: intentar, medir qué tan lejos quedaste y volver a intentar más cerca. El número que baja es el error, no el acierto.' },
  '6.1': { kind:'choice',
    prompt:'«El gato se subió al…» ¿qué palabra elige?',
    payload:{ options:['tejado','sofá','árbol','techo'], scores:{ tejado:31, 'sofá':24, 'árbol':19, techo:14 } },
    solution:{ value:'tejado' },
    explanation:'«tejado» se lleva 31 de 100. Los puntajes de todas las opciones suman 100 y ninguna llega a la mitad: por eso el mismo pedido dos veces puede salir distinto.' },
  '7.2': { kind:'build',
    prompt:'Arma el pedido: qué + para quién + cómo',
    payload:{ slots:['QUÉ','PARA QUIÉN','CÓMO'], tiles:[
      { slot:0, text:'Resume este contrato' }, { slot:1, text:'para un cliente sin abogado' },
      { slot:2, text:'en 5 puntos, sin tecnicismos' }, { slot:0, text:'Escribe un correo' },
      { slot:1, text:'para mi jefe' }, { slot:2, text:'en 3 líneas, tono directo' }] },
    solution:{ slots:['QUÉ','PARA QUIÉN','CÓMO'] },
    explanation:'Lo que no dices, lo rellena genérico. «Resume» sin para quién ni cómo devuelve un resumen para nadie.' },
  '9.2': { kind:'knob',
    prompt:'Deja la perilla donde el resultado sea repetible para un correo de trabajo',
    payload:{ min:0, max:100, cands:[
      { name:'Max', logit:5.2 }, { name:'Luna', logit:4.7 }, { name:'Rocky', logit:3.9 },
      { name:'Coco', logit:3.4 }, { name:'Sr. Mostacho', logit:1.1 }, { name:'Nube', logit:0.7 }] },
    solution:{ min:0, max:25 },
    explanation:'Con la perilla abajo casi siempre gana el mismo candidato: eso es lo que quieres en un correo. Subiéndola, los raros empiezan a tener chance — sirve para lluvia de ideas, no para trabajo formal.' },
};

await migrate();

const INS_LESSON = `INSERT INTO lessons (n,eyebrow,title,summary,math,math_cap) VALUES (?,?,?,?,?,?)
  ON CONFLICT (n) DO UPDATE SET eyebrow = excluded.eyebrow, title = excluded.title,
    summary = excluded.summary, math = excluded.math, math_cap = excluded.math_cap`;
for (const l of LESSONS) await run(INS_LESSON, l);

// Vuelve a sembrar sin borrar intentos: los labs se actualizan en su sitio.
const INS_LAB = `INSERT INTO labs (id,lesson_n,idx,level,kind,prompt,payload,solution,explanation,draft)
  VALUES (?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT (id) DO UPDATE SET lesson_n = excluded.lesson_n, idx = excluded.idx,
    level = excluded.level, kind = excluded.kind, prompt = excluded.prompt,
    payload = excluded.payload, solution = excluded.solution,
    explanation = excluded.explanation, draft = excluded.draft`;

let real = 0, draft = 0;
for (const [n] of LESSONS) {
  for (let i = 1; i <= 3; i++) {
    const id = `${n}.${i}`;
    const r = REAL[id];
    if (r) {
      await run(INS_LAB, [id, n, i, LEVELS[i - 1], r.kind, r.prompt,
        JSON.stringify(r.payload), JSON.stringify(r.solution), r.explanation, 0]);
      real++;
    } else {
      await run(INS_LAB, [id, n, i, LEVELS[i - 1], KINDS[n][i - 1],
        `[Por escribir] Lab ${id} · mecánica: ${KINDS[n][i - 1]}`,
        JSON.stringify({}), JSON.stringify({ value: null }),
        '[Por escribir] La explicación se redacta junto al enunciado.', 1]);
      draft++;
    }
  }
}

// Texto de enseñanza por lección e idioma. Es lo que se lee ANTES del lab.
const INS_TEXTO = `INSERT INTO lesson_text (lesson_n, lang, technical, analogy, examples) VALUES (?,?,?,?,?)
  ON CONFLICT (lesson_n, lang) DO UPDATE SET technical = EXCLUDED.technical,
    analogy = EXCLUDED.analogy, examples = EXCLUDED.examples`;
let textos = 0;
for (const [n, porIdioma] of Object.entries(CONTENIDO)) {
  for (const [lang, t] of Object.entries(porIdioma)) {
    await run(INS_TEXTO, [Number(n), lang, t.technical, t.analogy, JSON.stringify(t.examples)]);
    textos++;
  }
}

const INS_USER = `INSERT INTO users (email,name,pass_hash,role,paid,cohort) VALUES (?,?,?,?,?,?)
  ON CONFLICT (email) DO NOTHING`;
for (const u of [
  ['ricardo@velez.co', 'Ricardo Vélez', 'student', 1, 'agosto'],
  ['paula@correo.com', 'Paula Gómez', 'tutor', 1, 'agosto'],
  ['founder.alpadev@gmail.com', 'Alejandro Padrón', 'admin', 1, null],
]) await run(INS_USER, [u[0], u[1], hashPassword('Curso2026*'), u[2], u[3], u[4]]);

console.log(`sembrado: ${LESSONS.length} lecciones · ${real} labs escritos · ${draft} labs en borrador · ${textos} textos de leccion · 3 usuarios`);
await pool.end();
