// Teaching text for each lesson: technical explanation, analogy and worked
// examples. Writing rules (the same ones as the carousel):
//   · technical: 90-140 words, exact mechanism, zero untranslated jargon
//   · analogy:   50-80 words, ONE metaphor, everyday
//   · examples:  2 concrete cases with input, output and why
// The lab comes AFTER this: if the lab cannot be solved by reading this page, the
// text is written wrong, not the lab.
//
// THE EXAMPLE KEYS STAY SPANISH. `titulo`, `entrada`, `salida` and `nota` are
// serialised by seed.ts into lesson_text.examples (a JSON column) and read back
// out of the database by web/src/pages/leccion/[n].astro, which is not part of
// this migration. Renaming them is a data migration plus a change in web/, in one
// commit or not at all.

/** One worked example, exactly as it is stored in lesson_text.examples. */
export interface WorkedExample {
  titulo: string;
  entrada: string;
  salida: string;
  nota: string;
}

/** The teaching text for one lesson in one language. */
export interface LessonText {
  technical: string;
  analogy: string;
  examples: WorkedExample[];
}

export const LESSON_CONTENT: Record<number, Record<string, LessonText>> = {
  1: {
    es: {
      technical: 'Un modelo no recibe reglas escritas por nadie. Recibe ejemplos ya marcados: cien mil fotos donde alguien puso «gato» o «perro». Por cada foto hace una predicción, la compara con la marca y ajusta un poquito sus números internos para fallar menos la próxima. Repite eso millones de veces. Lo que queda al final no es una lista de reglas — «orejas puntudas y bigotes = gato» — sino un patrón numérico que separa las dos cosas mejor de lo que cualquiera podría escribir a mano. Por eso acierta con un gato que nunca vio: no memorizó fotos, midió el parecido.',
      analogy: 'Piensa en un niño de dos años. Nadie le da la definición de perro. Le señalan perros en la calle: «mira, un perro». Se equivoca, lo corrigen, vuelve a mirar. Un día señala un perro que nunca había visto y acierta. No aprendió la regla: aprendió el parecido a fuerza de ejemplos. El modelo hace lo mismo, solo que necesita cien mil señalamientos y no tres.',
      examples: [
        { titulo: 'Lo que sí pasa', entrada: 'foto + la marca «gato», cien mil veces', salida: 'el modelo mueve sus números hasta que la próxima foto de gato le dé «gato»', nota: 'Nadie escribió «los gatos tienen bigotes» en ninguna parte.' },
        { titulo: 'Lo que no es', entrada: 'si orejas puntudas y bigotes → entonces gato', salida: 'una regla escrita a mano: eso es programación normal, no aprendizaje', nota: 'Con reglas fallas con el primer gato de orejas caídas.' },
      ],
    },
    en: {
      technical: 'A model is not given rules written by anyone. It is given labelled examples: a hundred thousand photos where someone wrote “cat” or “dog”. For each photo it makes a guess, compares it with the label, and nudges its internal numbers so the next guess is a little less wrong. It repeats that millions of times. What is left at the end is not a list of rules — “pointy ears plus whiskers equals cat” — but a numeric pattern that separates the two better than anything a person could write by hand. That is why it gets a cat it has never seen: it did not memorise photos, it measured resemblance.',
      analogy: 'Think of a two-year-old. Nobody hands them the definition of a dog. People point at dogs in the street: “look, a dog”. The child gets it wrong, is corrected, looks again. One day they point at a dog they have never seen and get it right. They did not learn the rule; they learned the resemblance through examples. The model does the same, it just needs a hundred thousand pointings instead of three.',
      examples: [
        { titulo: 'What actually happens', entrada: 'photo plus the label “cat”, a hundred thousand times', salida: 'the model shifts its numbers until the next cat photo comes out as “cat”', nota: 'Nobody ever wrote “cats have whiskers” anywhere.' },
        { titulo: 'What it is not', entrada: 'if pointy ears and whiskers then cat', salida: 'a hand-written rule: that is ordinary programming, not learning', nota: 'With rules you fail on the first floppy-eared cat.' },
      ],
    },
  },
  2: {
    es: {
      technical: 'Mejorar, para un modelo, es una sola cosa: bajar un número. Ese número se llama error y mide qué tan lejos quedó su respuesta de la correcta. Empieza alto — 94, digamos — porque al principio responde casi al azar. Después de cada ejemplo el entrenamiento pregunta: ¿si muevo esta perilla un poquito hacia arriba, el error sube o baja? La mueve hacia donde baja. Millones de veces, sobre miles de millones de perillas. El error cae a 23, luego a 4, y ahí deja de bajar: llegó a su límite. Todo el entrenamiento es eso, no hay más magia: bajar el número.',
      analogy: 'Es afinar una guitarra a oído, sin afinador. Tocas la cuerda, suena mal, giras la clavija un poco. ¿Sonó peor? Giras al otro lado. ¿Mejor? Sigues por ahí. No sabes la frecuencia exacta ni te importa: solo persigues «suena menos mal». El modelo no oye, pero hace exactamente eso con miles de millones de clavijas a la vez.',
      examples: [
        { titulo: 'Primer intento', entrada: 'le muestran «2 + 2» y responde «7»', salida: 'error alto: 94. Ajusta perillas en la dirección que lo baja', nota: 'El error no es una nota escolar: es la distancia a la respuesta buena.' },
        { titulo: 'Miles de ejemplos después', entrada: 'la misma cuenta', salida: 'responde «4» y el error queda en 4: ya casi no hay de dónde bajar', nota: 'Cuando el error deja de bajar, el entrenamiento se detiene.' },
      ],
    },
    en: {
      technical: 'For a model, improving is one thing only: making a number go down. That number is called the error, and it measures how far its answer landed from the right one. It starts high — 94, say — because at first it answers close to random. After each example, training asks: if I nudge this dial up a little, does the error go up or down? It nudges it whichever way makes it drop. Millions of times, across billions of dials. The error falls to 23, then to 4, and there it stops: that is its limit. All of training is that. There is no other magic: push the number down.',
      analogy: 'It is tuning a guitar by ear, with no tuner. You pluck the string, it sounds off, you turn the peg a little. Worse? Turn the other way. Better? Keep going that way. You do not know the exact frequency and you do not care: you are chasing “sounds less bad”. The model cannot hear, but it does exactly that with billions of pegs at once.',
      examples: [
        { titulo: 'First try', entrada: 'it is shown “2 + 2” and answers “7”', salida: 'high error: 94. It shifts dials in whichever direction lowers it', nota: 'The error is not a school grade: it is the distance to the good answer.' },
        { titulo: 'Thousands of examples later', entrada: 'the same sum', salida: 'it answers “4” and the error sits at 4: barely anything left to squeeze', nota: 'When the error stops dropping, training stops.' },
      ],
    },
  },
  3: {
    es: {
      technical: 'Lo que el modelo aprendió no está guardado como fotos, frases ni artículos. Está guardado como números: setenta mil millones de ellos en un modelo grande. Cada número es una perilla y no significa nada por sí sola; el conocimiento vive en la combinación de todas. Cuando el entrenamiento «aprende» algo, lo único que pasa es que muchas perillas quedaron en una posición un poco distinta. Por eso no puedes abrir un modelo y buscar el archivo donde dice quién ganó el mundial: no hay archivo. Hay una configuración de perillas que, al pasarle tu pregunta, produce esa respuesta.',
      analogy: 'Piensa en una consola de sonido con setenta mil millones de perillas y ni una etiqueta. El técnico las movió durante meses hasta que la mezcla sonó bien. Si le preguntas «¿cuál perilla es la voz?», no tiene respuesta: la voz no está en una perilla, está en cómo quedaron todas juntas. El modelo es esa consola.',
      examples: [
        { titulo: 'Dentro del archivo', entrada: 'abres el modelo descargado', salida: 'una lista gigante de números: 0.0173, -0.4402, 1.2088…', nota: 'Ni una palabra en español. Todo el conocimiento está en esos números.' },
        { titulo: 'Qué cambia al entrenar', entrada: 'le enseñan mil recetas de cocina', salida: 'ningún archivo nuevo: cambian de posición un montón de perillas', nota: 'Por eso «borrar un dato» de un modelo no es borrar un archivo.' },
      ],
    },
    en: {
      technical: 'What the model learned is not stored as photos, sentences or articles. It is stored as numbers: seventy billion of them in a large model. Each number is a dial and means nothing on its own; the knowledge lives in the combination of all of them. When training “learns” something, all that happens is that many dials end up in slightly different positions. That is why you cannot open a model and look for the file that says who won the World Cup: there is no file. There is a dial setting that, fed your question, produces that answer.',
      analogy: 'Picture a mixing desk with seventy billion knobs and not a single label. The engineer spent months turning them until the mix sounded right. Ask “which knob is the voice?” and there is no answer: the voice is not in one knob, it is in how all of them ended up together. The model is that desk.',
      examples: [
        { titulo: 'Inside the file', entrada: 'you open the downloaded model', salida: 'a giant list of numbers: 0.0173, -0.4402, 1.2088…', nota: 'Not one English word. All the knowledge is in those numbers.' },
        { titulo: 'What training changes', entrada: 'it is taught a thousand recipes', salida: 'no new file appears: a great many dials move position', nota: 'That is why “deleting a fact” from a model is not deleting a file.' },
      ],
    },
  },
  4: {
    es: {
      technical: 'Hay dos momentos y no se mezclan. El primero es el entrenamiento: se hace una vez, dura semanas, consume miles de tarjetas gráficas y cuesta millones de dólares. Ahí se mueven las perillas. El segundo es cuando tú le hablas, y se llama inferencia: las perillas están congeladas, el modelo solo hace pasar tu texto por ellas y devuelve una respuesta. Cuesta centavos. Por eso lo que le cuentas hoy no lo «aprende»: no hay nada escribiéndose. Si mañana te reconoce, es porque alguien guardó tu conversación aparte y se la vuelve a pegar al principio del pedido, no porque el modelo cambió.',
      analogy: 'Un libro impreso. El autor lo escribió y corrigió durante años; eso fue el entrenamiento. Tú lo lees en la sala: eso es hablarle. Puedes subrayarlo, discutir con él en voz alta y contarle tu vida al libro: el texto no cambia. Si quieres que el libro «sepa» algo tuyo, tienes que meterle un papelito entre las páginas cada vez que lo abres.',
      examples: [
        { titulo: 'Lo que crees que pasa', entrada: '«mi perro se llama Nube» → y mañana vuelves', salida: 'el modelo no guardó nada: sus perillas están idénticas', nota: 'Entrenar de nuevo cuesta millones; no ocurre porque tú escribiste.' },
        { titulo: 'Lo que sí pasa', entrada: 'la app guarda tu nota y la pega al inicio del próximo pedido', salida: 'parece memoria, pero es tu propio texto viajando otra vez', nota: 'Memoria de producto, no aprendizaje del modelo.' },
      ],
    },
    en: {
      technical: 'There are two moments and they never mix. The first is training: it happens once, takes weeks, burns thousands of graphics cards and costs millions of dollars. That is when the dials move. The second is when you talk to it, and it is called inference: the dials are frozen, the model just runs your text through them and returns an answer. It costs cents. That is why what you tell it today is not “learned”: nothing is being written. If it recognises you tomorrow, it is because someone stored your conversation separately and pastes it back at the top of the request — not because the model changed.',
      analogy: 'A printed book. The author wrote and revised it for years; that was training. You read it in your living room: that is talking to it. You can underline it, argue with it out loud and tell the book your life story: the text does not change. If you want the book to “know” something about you, you have to slip a note between the pages every time you open it.',
      examples: [
        { titulo: 'What you think happens', entrada: '“my dog is called Nube” → and you come back tomorrow', salida: 'the model stored nothing: its dials are identical', nota: 'Retraining costs millions; it does not happen because you typed.' },
        { titulo: 'What actually happens', entrada: 'the app saves your note and pastes it at the top of the next request', salida: 'it looks like memory, but it is your own text travelling again', nota: 'Product memory, not model learning.' },
      ],
    },
  },
  5: {
    es: {
      technical: 'El modelo no ve letras ni palabras: ve trozos llamados tokens. Antes de que empiece a pensar, un partidor corta tu texto en pedazos frecuentes y le pone a cada uno un número. «Cartagena es hermosa» son tres palabras para ti, pero cinco tokens para él: Carta | gena | es | her | mosa. Las palabras comunes suelen ser un token entero; las raras se parten en pedazos. Todo lo que sigue trabaja con esa lista de números, y todo lo que se cobra o se limita se mide ahí: el precio, el tamaño del pedido y el largo de la respuesta se cuentan en tokens, no en palabras.',
      analogy: 'Es el mesero que anota tu pedido en su propia clave. Tú dices «una arepa de huevo con queso»; él escribe «AR-HUE + QS». No es tu frase, es su forma de trocearla para que la cocina la entienda rápido. Si pides algo rarísimo, tiene que escribirlo en más trocitos. Y te cobran por trocitos, no por palabras.',
      examples: [
        { titulo: 'Palabra común', entrada: 'gato', salida: '1 token', nota: 'Aparece muchísimo en el texto con el que se entrenó: le tocó pedazo propio.' },
        { titulo: 'Palabra rara', entrada: 'Cartagena', salida: '2 tokens: Carta + gena', nota: 'En español, la regla práctica: un token ≈ media palabra larga.' },
      ],
    },
    en: {
      technical: 'The model does not see letters or words: it sees chunks called tokens. Before it starts thinking, a splitter cuts your text into frequent pieces and gives each one a number. “Cartagena is beautiful” is three words to you but five tokens to it: Cart | agena | is | beaut | iful. Common words usually get one whole token; rare ones get chopped up. Everything downstream works on that list of numbers, and everything that is billed or capped is measured there: the price, the size of the request and the length of the answer are all counted in tokens, not words.',
      analogy: 'It is the waiter writing your order in their own shorthand. You say “a cheese and egg arepa”; they write “AR-EGG + CHS”. It is not your sentence, it is their way of chunking it so the kitchen reads it fast. Order something exotic and they have to write more chunks. And you are billed per chunk, not per word.',
      examples: [
        { titulo: 'Common word', entrada: 'cat', salida: '1 token', nota: 'It shows up constantly in the training text, so it got its own chunk.' },
        { titulo: 'Rare word', entrada: 'Cartagena', salida: '2 tokens: Cart + agena', nota: 'Rule of thumb in English: one token ≈ three quarters of a word.' },
      ],
    },
  },
  6: {
    es: {
      technical: 'El modelo no escribe frases: escribe la siguiente palabra, una a la vez. Con lo que lleva escrito le da un puntaje a cada palabra posible de su vocabulario, y esos puntajes suman 100. Si vas escribiendo «el café está muy…», puede quedar así: «caliente» 31, «bueno» 22, «rico» 14, «frío» 9, y el resto repartido. Escoge una, la pega al texto y vuelve a empezar el cálculo con la frase ya más larga. Repite hasta terminar. No hay un plan de párrafo guardado en ninguna parte: la coherencia sale de que cada palabra nueva se decide mirando todas las anteriores.',
      analogy: 'Es el autocompletar del teclado del celular, pero con mucho mejor oído. Escribes «voy para la…» y te ofrece tres opciones. Tocas una y te ofrece las tres siguientes. Si aceptas siempre la primera sugerencia, sale un mensaje completo que nunca planeaste. El modelo hace eso mismo, con un vocabulario enorme y mirando toda la conversación en vez de las dos últimas palabras.',
      examples: [
        { titulo: 'Los puntajes', entrada: '«el café está muy…»', salida: 'caliente 31 · bueno 22 · rico 14 · frío 9 · resto 24', nota: 'Suman 100: es un reparto de probabilidad, no una nota.' },
        { titulo: 'Palabra por palabra', entrada: 'escoge «caliente» y sigue', salida: 'ahora calcula sobre «el café está muy caliente…»', nota: 'Cada palabra cambia el reparto de la siguiente.' },
      ],
    },
    en: {
      technical: 'The model does not write sentences: it writes the next word, one at a time. Given what it has written so far, it scores every possible word in its vocabulary, and those scores add up to 100. Type “the coffee is very…” and it might land like this: “hot” 31, “good” 22, “nice” 14, “cold” 9, and the rest spread thin. It picks one, appends it, and runs the whole calculation again on the now-longer sentence. It repeats until it stops. There is no paragraph plan stored anywhere: the coherence comes from each new word being decided while looking at everything before it.',
      analogy: 'It is your phone keyboard’s autocomplete, with a far better ear. You type “I am heading to the…” and it offers three options. You tap one and it offers the next three. Accept the first suggestion every time and out comes a whole message you never planned. The model does exactly that, with a huge vocabulary and looking at the entire conversation instead of the last two words.',
      examples: [
        { titulo: 'The scores', entrada: '“the coffee is very…”', salida: 'hot 31 · good 22 · nice 14 · cold 9 · rest 24', nota: 'They add to 100: it is a split of probability, not a grade.' },
        { titulo: 'Word by word', entrada: 'it picks “hot” and carries on', salida: 'now it scores over “the coffee is very hot…”', nota: 'Every word changes the split for the next one.' },
      ],
    },
  },
  7: {
    es: {
      technical: 'El modelo no adivina lo que tienes en la cabeza: tu texto es todo lo que recibe. Un pedido usable lleva tres cosas. Qué quieres exactamente, con el verbo claro: resume, traduce, corrige, propón diez. Para quién es, porque eso fija el tono y el nivel: para mi jefe, para un niño de ocho años, para un cliente enojado. Y cómo lo quieres entregado: en cinco líneas, en tabla, sin tecnicismos, en español de Colombia. Lo que no digas, lo rellena con lo más común de su entrenamiento, y lo más común es genérico. Pedir bien no es ser educado: es cerrarle las opciones vagas.',
      analogy: 'Es un taxi. Si te subes y dices «arranque», el taxista arranca, y va a donde le parezca. Si dices «a la carrera 70 con la 30, por la avenida, sin autopista», llegas a donde querías. No es que el taxista sea tonto: es que le dijiste tres datos en vez de uno. El modelo maneja igual de bien y adivina igual de mal.',
      examples: [
        { titulo: 'Pedido vago', entrada: 'escríbeme algo sobre nuestro producto', salida: 'tres párrafos correctos, genéricos y sin uso: podría ser de cualquier empresa', nota: 'No dijiste qué, ni para quién, ni cómo.' },
        { titulo: 'Pedido con la fórmula', entrada: 'Escribe 5 líneas (cómo) para un cliente que ya nos compró (para quién) explicando que subimos el precio 8% (qué)', salida: 'un texto que puedes mandar casi sin tocarlo', nota: 'Misma IA, mismo minuto: cambió el pedido.' },
      ],
    },
    en: {
      technical: 'The model does not guess what is in your head: your text is everything it gets. A usable request carries three things. What exactly you want, with a clear verb: summarise, translate, fix, give me ten options. Who it is for, because that sets the tone and the level: for my boss, for an eight-year-old, for an angry customer. And how you want it delivered: in five lines, as a table, no jargon, in plain English. Whatever you leave out, it fills in with the most common thing from its training, and the most common thing is generic. Prompting well is not about being polite: it is about closing off the vague options.',
      analogy: 'It is a taxi. Get in and say “drive”, and the driver drives — wherever they feel like. Say “to 70th and 30th, take the avenue, avoid the motorway”, and you arrive where you wanted. The driver is not stupid: you gave three facts instead of one. The model drives just as well and guesses just as badly.',
      examples: [
        { titulo: 'Vague request', entrada: 'write me something about our product', salida: 'three correct, generic, unusable paragraphs: could be any company', nota: 'You said no what, no who for, no how.' },
        { titulo: 'Request with the formula', entrada: 'Write 5 lines (how) for a customer who already bought from us (who for) explaining an 8% price rise (what)', salida: 'text you can send with barely a touch', nota: 'Same AI, same minute: the request changed.' },
      ],
    },
  },
  8: {
    es: {
      technical: 'El modelo solo tiene presente una cantidad fija de conversación a la vez, y eso se llama ventana de contexto. En los modelos de hoy son unas 120.000 palabras: un libro mediano. Ahí dentro cabe todo — las instrucciones del sistema, tu pedido, los archivos que pegaste y todo lo que ya se dijo — y cada respuesta nueva se calcula mirando ese bloque completo. Cuando se llena, lo más viejo se sale. No se «olvida» como una persona: desaparece del texto que se le pasa, así que dejó de existir. Por eso en charlas largas repite cosas o pierde un dato que le diste al principio.',
      analogy: 'Una mesa de trabajo. Cabe cierta cantidad de papeles y no más. Mientras el documento esté sobre la mesa, lo tiene en cuenta. Cuando pones papeles nuevos y ya no hay espacio, los de abajo caen al piso. No los rompió ni los archivó: simplemente ya no los ve. Si necesitas que vuelva a considerarlos, los levantas y los pones otra vez encima.',
      examples: [
        { titulo: 'Charla corta', entrada: 'le das tu nombre y a las 3 preguntas lo usas', salida: 'lo recuerda: sigue dentro de la ventana', nota: 'No es memoria, es que el texto todavía viaja.' },
        { titulo: 'Charla de dos horas', entrada: 'le das tu nombre y preguntas 400 mensajes después', salida: 'lo perdió: se cayó de la mesa', nota: 'Solución: pégaselo otra vez, o resume la charla en un párrafo.' },
      ],
    },
    en: {
      technical: 'The model only holds a fixed amount of conversation at once, and that is called the context window. On today’s models it is around 120,000 words: a medium-sized book. Everything lives in there — the system instructions, your request, the files you pasted and everything already said — and each new answer is computed looking at that whole block. When it fills up, the oldest part falls out. It does not “forget” the way a person does: it disappears from the text being fed in, so it stopped existing. That is why long chats start repeating themselves or lose a detail you gave at the start.',
      analogy: 'A desk. It holds a certain number of papers and no more. While a document is on the desk, it is taken into account. Put new papers down with no space left and the ones at the bottom fall on the floor. They were not shredded or filed: they are simply out of sight. If you need them considered again, you pick them up and put them back on top.',
      examples: [
        { titulo: 'Short chat', entrada: 'you give your name and use it 3 questions later', salida: 'it remembers: still inside the window', nota: 'Not memory — the text is still travelling with the request.' },
        { titulo: 'Two-hour chat', entrada: 'you give your name and ask 400 messages later', salida: 'it lost it: fell off the desk', nota: 'Fix: paste it again, or summarise the chat in one paragraph.' },
      ],
    },
  },
  9: {
    es: {
      technical: 'La temperatura es una perilla que decide qué tan obediente es el modelo con sus propios puntajes. En cero, siempre escoge la palabra de puntaje más alto: si esa palabra ganaba 99 de 100 veces, la vas a ver 99 de 100 veces. Sube la temperatura y el reparto se aplana: opciones que tenían 4 de 100 empiezan a salir, y el texto se vuelve menos predecible. No hay un valor «bueno»: baja para datos, resúmenes, código y traducciones, donde quieres la misma respuesta correcta cada vez; alta para lluvia de ideas, nombres y textos creativos, donde repetirse es el problema.',
      analogy: 'Es el volante del dado en un juego de mesa. Temperatura cero: no hay dado, siempre sale la jugada más segura, la partida es idéntica cada vez. Temperatura alta: tiras el dado en cada turno y aparecen jugadas raras, algunas brillantes y algunas malísimas. El tablero es el mismo; lo que cambia es cuánto azar aceptas en la mano.',
      examples: [
        { titulo: 'Temperatura baja', entrada: '«convierte 30 dólares a pesos» × 10 veces', salida: 'la misma respuesta 10 de 10', nota: 'Lo que quieres cuando hay una respuesta correcta.' },
        { titulo: 'Temperatura alta', entrada: '«dame 10 nombres para una cafetería» × 10 veces', salida: 'listas distintas cada vez, 4 de 10 opciones extrañas', nota: 'Lo que quieres cuando repetirse es el fracaso.' },
      ],
    },
    en: {
      technical: 'Temperature is a dial that decides how obedient the model is to its own scores. At zero it always takes the highest-scoring word: if that word was winning 99 out of 100 times, you will see it 99 out of 100 times. Raise the temperature and the split flattens: options that had 4 out of 100 start showing up, and the text gets less predictable. There is no “good” value: low for facts, summaries, code and translation, where you want the same correct answer every time; high for brainstorming, naming and creative writing, where repeating yourself is the failure.',
      analogy: 'It is the dice in a board game. Temperature zero: no dice, always the safest move, every game plays out identically. High temperature: you roll on every turn and odd moves appear, some brilliant and some terrible. The board is the same; what changes is how much chance you accept in your hand.',
      examples: [
        { titulo: 'Low temperature', entrada: '“convert 30 dollars to pesos” × 10 times', salida: 'the same answer 10 out of 10', nota: 'What you want when there is one correct answer.' },
        { titulo: 'High temperature', entrada: '“give me 10 names for a coffee shop” × 10 times', salida: 'different lists each time, 4 in 10 options odd', nota: 'What you want when repeating yourself is the failure.' },
      ],
    },
  },
  10: {
    es: {
      technical: 'El modelo no tiene un botón de «no sé». Su trabajo es producir la continuación más probable, y una continuación con datos inventados puede ser mucho más probable — más parecida a los textos que leyó — que un «no tengo ese dato». Por eso cuando le falta información arma algo que suena perfecto: nombres plausibles, fechas verosímiles, citas con formato impecable, artículos que nunca existieron. No está mintiendo, porque mentir supone saber la verdad: está completando. La regla práctica no es dejar de usarlo, es esta: lo que suena bien no es lo que es cierto, y todo dato con consecuencias se verifica en la fuente antes de usarlo.',
      analogy: 'Es el amigo que nunca dice «no sé». Le preguntas por una calle de una ciudad que no conoce y te da indicaciones con total seguridad: dos cuadras, gire a la derecha, junto a la panadería. No te está engañando, está siendo servicial con lo que le parece razonable. Con él te sirve la charla; no te sirve para llegar sin mirar el mapa.',
      examples: [
        { titulo: 'Dato inventado', entrada: '«dame el artículo de la ley que regula esto»', salida: 'un número de artículo con formato perfecto que no existe', nota: 'Suena a ley porque imita la forma de una ley.' },
        { titulo: 'Cómo se ataja', entrada: '«dime qué buscar para verificarlo y en qué fuente»', salida: 'te da la pista y tú confirmas en el sitio oficial', nota: 'Sirve para orientar la búsqueda, no para cerrarla.' },
      ],
    },
    en: {
      technical: 'The model has no “I don’t know” button. Its job is to produce the most likely continuation, and a continuation with invented facts can be far more likely — far more like the text it read — than “I do not have that”. So when information is missing it builds something that sounds perfect: plausible names, believable dates, citations with flawless formatting, papers that never existed. It is not lying, because lying requires knowing the truth: it is completing. The practical rule is not to stop using it, it is this: sounding right is not being right, and any fact with consequences gets checked at the source before you use it.',
      analogy: 'It is the friend who never says “I don’t know”. You ask about a street in a city they have never visited and they give directions with total confidence: two blocks, turn right, next to the bakery. They are not deceiving you, they are being helpful with what seems reasonable. Great company; not something to navigate by without a map.',
      examples: [
        { titulo: 'Invented fact', entrada: '“give me the section of the law that covers this”', salida: 'a perfectly formatted section number that does not exist', nota: 'It sounds like law because it imitates the shape of law.' },
        { titulo: 'How to head it off', entrada: '“tell me what to search for and which source to check”', salida: 'it gives you the lead and you confirm on the official site', nota: 'Good for aiming the search, not for closing it.' },
      ],
    },
  },
  11: {
    es: {
      technical: 'El entrenamiento se hizo con textos recogidos hasta una fecha concreta, y ahí se congeló. De lo que pasó después, el modelo no tiene nada: ni el resultado del partido de ayer, ni el precio de hoy, ni que cambiaste de trabajo el mes pasado. Y como no tiene botón de «no sé», si le preguntas por algo posterior a su fecha va a completar con lo más probable, que puede ser un dato viejo dicho en presente. Hay una salida: conectarlo a una búsqueda. Cuando puede buscar, deja de adivinar y trae la fuente; lo que necesitas ver en la respuesta es el enlace, no la seguridad con que lo dice.',
      analogy: 'Es un enciclopedista brillante que quedó encerrado en una biblioteca sin ventanas hace un año. De todo lo anterior sabe muchísimo. De lo de este año no sabe que existe, y como no quiere quedarte mal, te contesta con lo que había en el último periódico que alcanzó a leer. Ábrele una ventana — dale internet — y vuelve a ser útil para hoy.',
      examples: [
        { titulo: 'Sin conexión', entrada: '«¿cuánto cuesta el dólar hoy?»', salida: 'un número de hace meses, dicho con toda seguridad', nota: 'No sabe que su fecha ya pasó.' },
        { titulo: 'Con búsqueda', entrada: 'la misma pregunta en una herramienta con internet', salida: 'el valor de hoy y el enlace de dónde lo sacó', nota: 'Si no hay enlace, sigue siendo adivinanza.' },
      ],
    },
    en: {
      technical: 'Training was done on text collected up to a specific date, and there it froze. Of what happened afterwards, the model has nothing: not yesterday’s score, not today’s price, not the fact that you changed jobs last month. And since it has no “I don’t know” button, ask about something after its date and it will complete with the most likely thing, which may be a stale fact stated in the present tense. There is a way out: connect it to search. When it can look things up it stops guessing and brings the source; what you need to see in the answer is the link, not the confidence.',
      analogy: 'It is a brilliant encyclopaedist who was locked in a windowless library a year ago. About everything before that, they know an enormous amount. About this year, they do not know it exists — and rather than disappoint you, they answer from the last newspaper they managed to read. Open a window — give them the internet — and they are useful for today again.',
      examples: [
        { titulo: 'Offline', entrada: '“what is the dollar worth today?”', salida: 'a number from months ago, delivered with full confidence', nota: 'It does not know its own date has passed.' },
        { titulo: 'With search', entrada: 'the same question in a tool with internet access', salida: 'today’s value and the link it came from', nota: 'No link, still guesswork.' },
      ],
    },
  },
  12: {
    es: {
      technical: 'Con lo anterior ya tienes el modelo mental completo: aprende de ejemplos, guarda todo en números, no cambia cuando le hablas, lee en tokens, escribe palabra por palabra, obedece a tu pedido, olvida lo que se sale de la mesa, se pone creativa con la temperatura, inventa cuando le falta el dato y su memoria tiene fecha. Lo que falta es uso. Cinco minutos al día, sobre trabajo real y no sobre ejercicios: el correo que ibas a escribir, el texto que ibas a resumir, la duda que ibas a buscar. Un pedido con qué, para quién y cómo, y verificar lo que tenga consecuencias. Con eso ya estás arriba del 90% de la gente.',
      analogy: 'Es aprender a manejar. No aprendiste leyendo el manual del carro: aprendiste con el carro andando, en calles que ya ibas a recorrer. La teoría te evita rayar la pintura; el volante lo agarras conduciendo. Cinco minutos diarios con trabajo tuyo enseñan más que un fin de semana de teoría.',
      examples: [
        { titulo: 'Práctica mala', entrada: 'ejercicios inventados en un cuaderno aparte', salida: 'te aburres el jueves y lo dejas', nota: 'Sin consecuencia real no hay hábito.' },
        { titulo: 'Práctica buena', entrada: 'el correo difícil de hoy: qué + para quién + cómo', salida: 'un borrador en 30 segundos que corriges en 2 minutos', nota: 'Trabajo que igual tenías que hacer: el hábito se sostiene solo.' },
      ],
    },
    en: {
      technical: 'With the previous lessons you have the whole mental model: it learns from examples, stores everything as numbers, does not change when you talk to it, reads in tokens, writes word by word, obeys your request, forgets what falls off the desk, gets creative with temperature, invents when a fact is missing, and its memory has a date. What is left is use. Five minutes a day, on real work rather than exercises: the email you were going to write, the text you were going to summarise, the question you were going to look up. One request with what, who for and how — and verify anything with consequences. That already puts you ahead of 90% of people.',
      analogy: 'It is learning to drive. You did not learn by reading the car manual: you learned with the car moving, on streets you were going to drive anyway. The theory keeps you from scratching the paint; the wheel is learned by driving. Five minutes a day on your own work teaches more than a weekend of theory.',
      examples: [
        { titulo: 'Bad practice', entrada: 'made-up exercises in a separate notebook', salida: 'you get bored by Thursday and drop it', nota: 'No real stake, no habit.' },
        { titulo: 'Good practice', entrada: 'today’s difficult email: what + who for + how', salida: 'a draft in 30 seconds that you fix in 2 minutes', nota: 'Work you had to do anyway: the habit holds itself up.' },
      ],
    },
  },
};
