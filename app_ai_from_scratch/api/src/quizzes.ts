// Quick quizzes (3 per lesson) and three block exams. Graded on the server.
// Options are shuffled at seed time so the payload never lines up with `solution`.

export type QuestionKind = 'quiz' | 'exam';

export interface QuestionOpt { id: string; es: string; en: string }

export interface QuestionSeed {
  id: string;
  kind: QuestionKind;
  pack: string;
  idx: number;
  lesson_n: number;
  prompt_es: string;
  prompt_en: string;
  options: QuestionOpt[];
  answer: string;
  explanation_es: string;
  explanation_en: string;
}

const o = (id: string, es: string, en: string): QuestionOpt => ({ id, es, en });

const q = (
  id: string, lesson_n: number, idx: number,
  prompt_es: string, prompt_en: string,
  options: QuestionOpt[], answer: string,
  explanation_es: string, explanation_en: string,
): QuestionSeed => ({
  id, kind: 'quiz', pack: `q${String(lesson_n).padStart(2, '0')}`, idx, lesson_n,
  prompt_es, prompt_en, options, answer, explanation_es, explanation_en,
});

const e = (
  exam: 1 | 2 | 3, idx: number, lesson_n: number,
  prompt_es: string, prompt_en: string,
  options: QuestionOpt[], answer: string,
  explanation_es: string, explanation_en: string,
): QuestionSeed => ({
  id: `e${exam}.${idx}`, kind: 'exam', pack: `e${exam}`, idx, lesson_n,
  prompt_es, prompt_en, options, answer, explanation_es, explanation_en,
});

export const EXAMS: { n: number; from: number; to: number }[] = [
  { n: 1, from: 1, to: 4 },
  { n: 2, from: 5, to: 8 },
  { n: 3, from: 9, to: 12 },
];

export const PASS_RATIO = 0.7;

export const QUESTIONS: QuestionSeed[] = [
  // ---- Lesson 1 · examples ----
  q('q01.1', 1, 1,
    '¿Cómo aprende a distinguir un gato de un perro?',
    'How does it learn to tell a cat from a dog?',
    [
      o('a', 'Alguien le escribe reglas del tipo «si tiene bigotes, es gato».', 'Someone writes rules like “if it has whiskers, it is a cat”.'),
      o('b', 'Ve muchísimos ejemplos y encuentra el parecido, sola.', 'It sees a huge number of examples and finds the resemblance, on its own.'),
      o('c', 'Copia las fotos que tú le mandas y las guarda.', 'It copies the photos you send and stores them.'),
    ], 'b',
    'Nadie le escribe las reglas. Encuentra el parecido entre miles de ejemplos.',
    'Nobody writes the rules. It finds the resemblance across thousands of examples.'),
  q('q01.2', 1, 2,
    'El número 100.000 de esta lección ¿qué cuenta?',
    'The number 100,000 in this lesson counts what?',
    [
      o('a', 'Fotos de gato que necesita para aprender qué es un gato.', 'Cat photos it needs to learn what a cat is.'),
      o('b', 'Fotos que guarda en un álbum para mostrártelas después.', 'Photos it keeps in an album to show you later.'),
      o('c', 'Reglas que un programador le escribió a mano.', 'Rules a programmer wrote by hand.'),
    ], 'a',
    'A ti te bastan tres ejemplos. A ella le hacen falta muchísimos más.',
    'Three examples are enough for you. It needs far more.'),
  q('q01.3', 1, 3,
    'Si nadie le escribe las reglas, ¿quién decide qué es un gato?',
    'If nobody writes the rules, who decides what a cat is?',
    [
      o('a', 'Tú, cada vez que chateas.', 'You, every time you chat.'),
      o('b', 'El parecido que encontró en los ejemplos.', 'The resemblance it found in the examples.'),
      o('c', 'Un diccionario interno de animales.', 'An internal dictionary of animals.'),
    ], 'b',
    'El concepto queda en el parecido, no en una lista de rasgos.',
    'The concept lives in the resemblance, not in a list of traits.'),

  // ---- Lesson 2 · error goes down ----
  q('q02.1', 2, 1,
    'Mejorar, para ella, es una sola cosa. ¿Cuál?',
    'Improving, for it, is one thing. Which?',
    [
      o('a', 'Que baje el número de «qué tan lejos quedé».', 'That the “how far off was I” number goes down.'),
      o('b', 'Que recuerde cada conversación que tuviste.', 'That it remembers every conversation you had.'),
      o('c', 'Que adivine lo que no le dijiste.', 'That it guesses what you did not say.'),
    ], 'a',
    'Entrenar = hacer bajar el error. 94 → 23 → 4.',
    'Training = making the error drop. 94 → 23 → 4.'),
  q('q02.2', 2, 2,
    'Cuando el error es «frío», ¿qué está pasando?',
    'When the error is “cold”, what is going on?',
    [
      o('a', 'Acertó.', 'It got it right.'),
      o('b', 'Está cerca.', 'It is close.'),
      o('c', 'Está lejos de la respuesta buena.', 'It is far from the good answer.'),
    ], 'c',
    'Frío, tibio y caliente miden distancia al acierto, no una nota escolar.',
    'Cold, warm and hot measure distance to the right answer, not a school grade.'),
  q('q02.3', 2, 3,
    '¿Qué mueve para que el error baje?',
    'What does it move so the error goes down?',
    [
      o('a', 'Las fotos que le enseñaste.', 'The photos you showed it.'),
      o('b', 'Unas perillas internas, un poquito cada vez.', 'Internal dials, a little each time.'),
      o('c', 'Tu historial de chat.', 'Your chat history.'),
    ], 'b',
    'Prueba un lado, mira si el error baja, se queda con ese lado.',
    'It tries one side, checks if the error dropped, and keeps that side.'),

  // ---- Lesson 3 · dials ----
  q('q03.1', 3, 1,
    'Lo que aprendió, ¿dónde queda?',
    'Where does what it learned live?',
    [
      o('a', 'En las fotos y las frases de entrenamiento.', 'In the training photos and sentences.'),
      o('b', 'En millones de numeritos ajustados: perillas.', 'In millions of adjusted numbers: dials.'),
      o('c', 'En un cuaderno que puedes abrir.', 'In a notebook you can open.'),
    ], 'b',
    'Un modelo grande tiene unos 70.000.000.000 de perillas. Cada una es un número.',
    'A large model has about 70,000,000,000 dials. Each one is just a number.'),
  q('q03.2', 3, 2,
    'Si le pides «enséñame la foto del gato», ¿qué pasa?',
    'If you ask “show me the cat photo”, what happens?',
    [
      o('a', 'Saca la foto del archivo.', 'It pulls the photo from the file.'),
      o('b', 'No hay foto: solo quedaron los ajustes.', 'There is no photo: only the adjustments remained.'),
      o('c', 'Te manda a internet.', 'It sends you to the internet.'),
    ], 'b',
    'Las fotos se usaron para ajustar. Después ya no están.',
    'The photos were used to adjust. After that they are gone.'),
  q('q03.3', 3, 3,
    'Una perilla, ella sola, ¿qué representa?',
    'One dial, by itself, stands for what?',
    [
      o('a', 'Una idea concreta, como «oreja».', 'One concrete idea, like “ear”.'),
      o('b', 'Solo un número. El parecido sale de todas juntas.', 'Just a number. The resemblance comes from all of them together.'),
      o('c', 'Un archivo de texto.', 'A text file.'),
    ], 'b',
    'No hay una perilla que sea «gato». El gato es el conjunto.',
    'There is no dial that is “cat”. The cat is the whole set.'),

  // ---- Lesson 4 · train vs inference ----
  q('q04.1', 4, 1,
    'Cuando le hablas, ¿sigue estudiando?',
    'When you talk to it, is it still studying?',
    [
      o('a', 'Sí: cada mensaje mueve las perillas.', 'Yes: each message moves the dials.'),
      o('b', 'No. El estudio ya terminó. Ahora solo responde.', 'No. Studying is already over. Now it only answers.'),
      o('c', 'Solo si le dices «aprende esto».', 'Only if you say “learn this”.'),
    ], 'b',
    'Estudiar y responder son dos momentos separados. Contigo no aprende.',
    'Studying and answering are two separate moments. It does not learn from you.'),
  q('q04.2', 4, 2,
    'El «1 vez» de esta lección, ¿qué es?',
    'The “1 time” in this lesson is what?',
    [
      o('a', 'Cuántas veces se entrena el modelo. Responder es aparte y barato.', 'How many times the model is trained. Answering is separate and cheap.'),
      o('b', 'Cuántas preguntas puedes hacer al día.', 'How many questions you can ask per day.'),
      o('c', 'Cuántas fotos guarda.', 'How many photos it stores.'),
    ], 'a',
    'Entrenar cuesta millones. Cada respuesta cuesta centavos.',
    'Training costs millions. Each answer costs cents.'),
  q('q04.3', 4, 3,
    'Le cuentas un secreto hoy. Mañana, con otra persona, ¿lo sabe?',
    'You tell it a secret today. Tomorrow, with someone else, does it know?',
    [
      o('a', 'Sí: ya lo guardó en las perillas.', 'Yes: it already stored it in the dials.'),
      o('b', 'No, salvo que esa conversación siga abierta en el hilo.', 'No, unless that conversation is still open in the thread.'),
      o('c', 'Sí, si el secreto era importante.', 'Yes, if the secret was important.'),
    ], 'b',
    'El chat de hoy no entra al entrenamiento. No se queda en el modelo.',
    'Today’s chat does not go into training. It does not stay in the model.'),

  // ---- Lesson 5 · tokens ----
  q('q05.1', 5, 1,
    '¿Qué ve cuando lees «Cartagena es hermosa»?',
    'What does it see when you write “Cartagena is beautiful”?',
    [
      o('a', 'Las palabras enteras, como tú.', 'Whole words, like you do.'),
      o('b', 'Letras sueltas.', 'Single letters.'),
      o('c', 'Pedacitos llamados tokens. Una palabra larga puede ser varios.', 'Chunks called tokens. A long word can be several.'),
    ], 'c',
    '3 palabras pueden ser 5 tokens. Todo se mide en tokens.',
    '3 words can be 5 tokens. Everything is measured in tokens.'),
  q('q05.2', 5, 2,
    '¿Por qué importa el recuento de tokens?',
    'Why does the token count matter?',
    [
      o('a', 'Porque se cobra y se limita en tokens, no en palabras.', 'Because billing and limits are in tokens, not words.'),
      o('b', 'Porque cada token es una foto.', 'Because each token is a photo.'),
      o('c', 'No importa: es un detalle interno.', 'It does not matter: it is an internal detail.'),
    ], 'a',
    'La factura y la mesa de memoria se miden en tokens.',
    'The bill and the memory table are measured in tokens.'),
  q('q05.3', 5, 3,
    '«Carta|gena|es|her|mosa» ¿qué está mostrando?',
    '“Cart|agena|is|beaut|iful” is showing what?',
    [
      o('a', 'Un error de escritura.', 'A spelling error.'),
      o('b', 'Cómo parte el texto en tokens.', 'How it splits the text into tokens.'),
      o('c', 'Las sílabas de la escuela.', 'School syllables.'),
    ], 'b',
    'No son sílabas de colegio. Son los trozos con los que trabaja.',
    'They are not school syllables. They are the chunks it works with.'),

  // ---- Lesson 6 · next token ----
  q('q06.1', 6, 1,
    'Cuando escribe, ¿qué elige en cada paso?',
    'When it writes, what does it pick at each step?',
    [
      o('a', 'La frase entera de una vez.', 'The whole sentence at once.'),
      o('b', 'El siguiente token, y vuelve a calcular con el texto nuevo.', 'The next token, then it recalculates with the new text.'),
      o('c', 'Una palabra al azar de un diccionario.', 'A random word from a dictionary.'),
    ], 'b',
    'Calcula opciones, elige un token, y el texto nuevo cambia las cuentas.',
    'It scores options, picks a token, and the new text changes the sums.'),
  q('q06.2', 6, 2,
    'Si las opciones suman 100, ¿qué son esos números?',
    'If the options add up to 100, what are those numbers?',
    [
      o('a', 'Una nota de qué tan cierto es cada uno.', 'A grade of how true each one is.'),
      o('b', 'Un reparto de probabilidad: cómo de probable es cada token.', 'A probability split: how likely each token is.'),
      o('c', 'Cuántas veces lo vio en internet.', 'How many times it saw it on the internet.'),
    ], 'b',
    'hot 31 · good 22 · nice 14… suman 100. No miden verdad.',
    'hot 31 · good 22 · nice 14… they add to 100. They do not measure truth.'),
  q('q06.3', 6, 3,
    '¿Por qué a veces «se va por las ramas» a mitad de frase?',
    'Why does it sometimes wander mid-sentence?',
    [
      o('a', 'Porque eligió un token raro y ahora calcula encima de ese.', 'Because it picked an odd token and now it calculates on top of that.'),
      o('b', 'Porque se aburre.', 'Because it gets bored.'),
      o('c', 'Porque olvidó el principio a propósito.', 'Because it forgot the start on purpose.'),
    ], 'a',
    'Cada token elegido es el suelo del siguiente cálculo.',
    'Each chosen token is the floor of the next calculation.'),

  // ---- Lesson 7 · prompt ----
  q('q07.1', 7, 1,
    'La fórmula del buen pedido es…',
    'The formula for a good ask is…',
    [
      o('a', 'qué + para quién + cómo', 'what + for whom + how'),
      o('b', 'por favor + gracias', 'please + thank you'),
      o('c', 'cuanto más largo, mejor', 'the longer, the better'),
    ], 'a',
    'Lo que no digas, lo rellena genérico. No adivina lo que tienes en la cabeza.',
    'What you leave out, it fills in generic. It does not guess what is in your head.'),
  q('q07.2', 7, 2,
    'Si pides «un correo» y sale soso, ¿qué faltó?',
    'If you ask “an email” and it comes out bland, what was missing?',
    [
      o('a', 'Pagar más.', 'Paying more.'),
      o('b', 'Para quién es y cómo lo quieres.', 'Who it is for and how you want it.'),
      o('c', 'Repetir la misma frase en inglés.', 'Repeating the same sentence in English.'),
    ], 'b',
    'Sin destinatario ni tono, rellena con el promedio.',
    'With no audience and no tone, it fills in the average.'),
  q('q07.3', 7, 3,
    '¿Adivina lo que no escribiste?',
    'Does it guess what you did not write?',
    [
      o('a', 'Sí, siempre acierta la intención oculta.', 'Yes, it always hits the hidden intent.'),
      o('b', 'No. Tu explicación es todo lo que recibe.', 'No. Your explanation is all it receives.'),
      o('c', 'Solo si usas mayúsculas.', 'Only if you use capital letters.'),
    ], 'b',
    'El pedido es el único material. El resto lo inventa genérico.',
    'The ask is the only material. The rest it invents as generic.'),

  // ---- Lesson 8 · context ----
  q('q08.1', 8, 1,
    'Su «memoria» del chat, ¿qué es?',
    'Its chat “memory” is what?',
    [
      o('a', 'Un cuaderno infinito.', 'An infinite notebook.'),
      o('b', 'Una mesa con sitio limitado. Lo más viejo puede caerse.', 'A table with limited room. The oldest can fall off.'),
      o('c', 'Las perillas del entrenamiento.', 'The training dials.'),
    ], 'b',
    'El límite se mide en tokens y cambia por modelo.',
    'The limit is measured in tokens and changes by model.'),
  q('q08.2', 8, 2,
    'Si el hilo se hace muy largo, ¿qué puede pasar?',
    'If the thread gets very long, what can happen?',
    [
      o('a', 'Olvida el principio de esta conversación.', 'It forgets the start of this conversation.'),
      o('b', 'Se borra tu cuenta.', 'Your account is deleted.'),
      o('c', 'Aprende el secreto para siempre.', 'It learns the secret forever.'),
    ], 'a',
    'Lo más antiguo puede quedar fuera de la mesa. No es rencor: no cabe.',
    'The oldest can fall off the table. It is not spite: it does not fit.'),
  q('q08.3', 8, 3,
    '¿El límite es siempre 120.000 palabras?',
    'Is the limit always 120,000 words?',
    [
      o('a', 'Sí, en todos los modelos.', 'Yes, on every model.'),
      o('b', 'No. Depende del modelo y se mide en tokens.', 'No. It depends on the model and is measured in tokens.'),
      o('c', 'Sí, si pagaste.', 'Yes, if you paid.'),
    ], 'b',
    'No hay un número mágico único. Cada modelo trae su mesa.',
    'There is no single magic number. Each model brings its own table.'),

  // ---- Lesson 9 · temperature ----
  q('q09.1', 9, 1,
    'La perilla de temperatura, ¿qué decide?',
    'The temperature dial decides what?',
    [
      o('a', 'Si va a lo seguro o se arriesga con opciones raras.', 'Whether it plays it safe or risks rarer options.'),
      o('b', 'Si la respuesta es verdadera.', 'Whether the answer is true.'),
      o('c', 'Cuántos tokens te cobra.', 'How many tokens it bills you.'),
    ], 'a',
    'Abajo: gana la opción top casi siempre. Arriba: aparecen las raras.',
    'Low: the top option almost always wins. High: the rare ones show up.'),
  q('q09.2', 9, 2,
    'Con la perilla abajo, «99 de 100» ¿qué significa?',
    'With the dial down, “99 of 100” means what?',
    [
      o('a', 'Que acierta el 99% de las preguntas de trivia.', 'That it scores 99% on trivia.'),
      o('b', 'Que casi siempre elige la opción más probable.', 'That it almost always picks the most likely option.'),
      o('c', 'Que se equivoca 99 veces.', 'That it is wrong 99 times.'),
    ], 'b',
    'Es repetición de la opción top, no un examen de verdad.',
    'It is the top option repeating, not a truth exam.'),
  q('q09.3', 9, 3,
    'Si quieres ideas raras para un nombre de gato, ¿la perilla?',
    'If you want odd ideas for a cat name, the dial should be?',
    [
      o('a', 'Abajo: lo más obvio.', 'Down: the most obvious.'),
      o('b', 'Arriba: que se arriesgue.', 'Up: let it take risks.'),
      o('c', 'Da igual.', 'It does not matter.'),
    ], 'b',
    'Creativa = más temperatura. Seria = menos.',
    'Creative = more temperature. Serious = less.'),

  // ---- Lesson 10 · hallucination ----
  q('q10.1', 10, 1,
    '¿Tiene un botón de «no sé»?',
    'Does it have a “I don’t know” button?',
    [
      o('a', 'Sí, y lo usa cuando falta el dato.', 'Yes, and it uses it when the fact is missing.'),
      o('b', 'No. Si le falta el dato, arma uno que suena perfecto.', 'No. If the fact is missing, it builds one that sounds perfect.'),
      o('c', 'Solo los sábados.', 'Only on Saturdays.'),
    ], 'b',
    'suena ≠ cierto. El puntaje mide cómo suena, no si es verdad.',
    'sounds ≠ true. The score measures how it sounds, not whether it is true.'),
  q('q10.2', 10, 2,
    'Una alucinación es…',
    'A hallucination is…',
    [
      o('a', 'Una respuesta que suena bien y es falsa.', 'An answer that sounds right and is false.'),
      o('b', 'Un error de conexión.', 'A connection error.'),
      o('c', 'Cuando se niega a responder.', 'When it refuses to answer.'),
    ], 'a',
    '99 de 100 veces suena seguro. 4 de 10 puede ser cierto. No es lo mismo.',
    '99 of 100 times it sounds sure. 4 of 10 may be true. Those are not the same.'),
  q('q10.3', 10, 3,
    '¿Cómo reduces que invente un dato con consecuencias?',
    'How do you cut down on invented facts with consequences?',
    [
      o('a', 'Subiendo la temperatura a tope.', 'Turning temperature all the way up.'),
      o('b', 'Pidiendo la fuente o un dato que puedas comprobar.', 'Asking for the source, or a fact you can check.'),
      o('c', 'Escribiendo en mayúsculas.', 'Writing in capital letters.'),
    ], 'b',
    'Si no puede citar o comprobar, no te fíes del tono seguro.',
    'If it cannot cite or check, do not trust the confident tone.'),

  // ---- Lesson 11 · cutoff ----
  q('q11.1', 11, 1,
    'Su memoria de entrenamiento, ¿hasta cuándo llega?',
    'How far does its training memory reach?',
    [
      o('a', 'Hasta hoy, siempre.', 'Up to today, always.'),
      o('b', 'Hasta un día concreto. Lo de después no existe… salvo que busque.', 'Up to a concrete day. After that it does not exist… unless it searches.'),
      o('c', 'Hasta el año en que naciste.', 'Up to the year you were born.'),
    ], 'b',
    'memoria: ayer · internet: hoy. Conectada deja de adivinar el presente.',
    'memory: yesterday · internet: today. Connected, it stops guessing the present.'),
  q('q11.2', 11, 2,
    'Le preguntas quién ganó un partido de anoche. Sin búsqueda, ¿qué hace?',
    'You ask who won last night’s match. With no search, what does it do?',
    [
      o('a', 'Mira el marcador en vivo.', 'It checks the live score.'),
      o('b', 'Arma un resultado que suena plausible.', 'It builds a result that sounds plausible.'),
      o('c', 'Se queda en silencio.', 'It stays silent.'),
    ], 'b',
    'No tiene el presente. Inventa con el tono de siempre.',
    'It does not have the present. It invents in the usual tone.'),
  q('q11.3', 11, 3,
    '«Busca» o una fuente de hoy, ¿para qué sirve?',
    '“Search” or a source from today is for what?',
    [
      o('a', 'Para que deje de adivinar lo que pasó después de su fecha.', 'So it stops guessing what happened after its date.'),
      o('b', 'Para entrenar el modelo otra vez.', 'To train the model again.'),
      o('c', 'Para borrar tu chat.', 'To erase your chat.'),
    ], 'a',
    'Internet (o un documento tuyo) es el «hoy». El modelo es el «ayer».',
    'The internet (or a document of yours) is “today”. The model is “yesterday”.'),

  // ---- Lesson 12 · start today ----
  q('q12.1', 12, 1,
    'Esta herramienta, ¿decide por ti?',
    'Does this tool decide for you?',
    [
      o('a', 'Sí: si suena seguro, ya está decidido.', 'Yes: if it sounds sure, the decision is made.'),
      o('b', 'No. Sirve para pensar y producir más rápido. Tú cierras.', 'No. It is for thinking and producing faster. You close.'),
      o('c', 'Sí, en temas legales.', 'Yes, on legal topics.'),
    ], 'b',
    'Copia, pega y listo es el hábito. La decisión sigue siendo tuya.',
    'Copy, paste and go is the habit. The decision stays yours.'),
  q('q12.2', 12, 2,
    'El «5 min al día» ¿qué afirma?',
    'The “5 min a day” claims what?',
    [
      o('a', 'Que en cinco minutos terminas el curso.', 'That you finish the course in five minutes.'),
      o('b', 'Que un rato corto y constante basta para agarrarle la mano.', 'That a short, steady slot is enough to get the hang of it.'),
      o('c', 'Que más tiempo no sirve.', 'That more time does not help.'),
    ], 'b',
    'No es un récord. Es el tamaño de un hábito que sí se sostiene.',
    'It is not a record. It is the size of a habit you can keep.'),
  q('q12.3', 12, 3,
    'Un pedido bueno para empezar hoy es…',
    'A good ask to start today is…',
    [
      o('a', '«Haz algo».', '“Do something”.'),
      o('b', 'Objetivo + para quién + formato, y comprobar un dato que importe.', 'Goal + for whom + format, and check one fact that matters.'),
      o('c', 'Pegar tu contraseña para que «entienda tu cuenta».', 'Pasting your password so it “understands your account”.'),
    ], 'b',
    'La lección 7 da la fórmula. La 10 pide comprobar. Juntas, ya puedes usarla.',
    'Lesson 7 gives the formula. Lesson 10 asks you to check. Together, you can use it.'),

  // ---- Exam 1 · lessons 1–4 ----
  e(1, 1, 1,
    'Elige la frase que describe cómo aprende.',
    'Pick the sentence that describes how it learns.',
    [
      o('a', 'Alguien le dicta las reglas y las memoriza.', 'Someone dictates the rules and it memorizes them.'),
      o('b', 'Encuentra el parecido entre muchos ejemplos, sola.', 'It finds the resemblance across many examples, on its own.'),
      o('c', 'Lee tu mente.', 'It reads your mind.'),
    ], 'b',
    'Eso es la lección 1. No hay reglamento escrito: hay ejemplos.',
    'That is lesson 1. There is no written rulebook: there are examples.'),
  e(1, 2, 2,
    'Entrenar es…',
    'Training is…',
    [
      o('a', 'Hacer bajar el error moviendo perillas.', 'Making the error drop by moving dials.'),
      o('b', 'Guardar cada chat para siempre.', 'Storing every chat forever.'),
      o('c', 'Poner una nota de 1 a 10.', 'Giving a mark from 1 to 10.'),
    ], 'a',
    '94 → 23 → 4. El error es distancia, no una calificación.',
    '94 → 23 → 4. Error is distance, not a grade.'),
  e(1, 3, 3,
    'Después del entrenamiento, las fotos…',
    'After training, the photos…',
    [
      o('a', 'Quedan en un álbum dentro del modelo.', 'Stay in an album inside the model.'),
      o('b', 'Ya no están: solo quedaron los ajustes.', 'Are gone: only the adjustments remained.'),
      o('c', 'Se mandan a tu correo.', 'Are emailed to you.'),
    ], 'b',
    'El modelo es el archivo de números, no la carpeta de fotos.',
    'The model is the file of numbers, not the photo folder.'),
  e(1, 4, 4,
    'Le cuentas algo personal en el chat. ¿Queda en el modelo?',
    'You tell it something personal in chat. Does it stay in the model?',
    [
      o('a', 'Sí, las perillas se mueven al instante.', 'Yes, the dials move at once.'),
      o('b', 'No. Contigo no aprende. El estudio ya cerró.', 'No. It does not learn from you. Studying already closed.'),
      o('c', 'Sí, si le pides que lo recuerde para siempre.', 'Yes, if you ask it to remember forever.'),
    ], 'b',
    'Responder no es entrenar. El secreto no entra a las perillas.',
    'Answering is not training. The secret does not enter the dials.'),
  e(1, 5, 2,
    '«Frío» en el juego de esta lección significa…',
    '“Cold” in this lesson’s game means…',
    [
      o('a', 'Que la respuesta es grosera.', 'That the answer is rude.'),
      o('b', 'Que todavía está lejos del acierto.', 'That it is still far from the hit.'),
      o('c', 'Que el servidor está caído.', 'That the server is down.'),
    ], 'b',
    'Frío / tibio / caliente = distancia al número bueno.',
    'Cold / warm / hot = distance to the good number.'),
  e(1, 6, 3,
    '70.000.000.000 en esta lección son…',
    '70,000,000,000 in this lesson are…',
    [
      o('a', 'Usuarios del curso.', 'Users of the course.'),
      o('b', 'Perillas (números) de un modelo grande.', 'Dials (numbers) of a large model.'),
      o('c', 'Palabras que memorizó.', 'Words it memorized.'),
    ], 'b',
    'Cada perilla es un número. El gato es el conjunto, no una sola.',
    'Each dial is a number. The cat is the set, not a single one.'),

  // ---- Exam 2 · lessons 5–8 ----
  e(2, 1, 5,
    'Un token es…',
    'A token is…',
    [
      o('a', 'Siempre una palabra entera.', 'Always a whole word.'),
      o('b', 'Un pedacito de texto. Una palabra larga puede ser varios.', 'A chunk of text. A long word can be several.'),
      o('c', 'Una foto.', 'A photo.'),
    ], 'b',
    '3 palabras = 5 tokens es el ejemplo de la lección.',
    '3 words = 5 tokens is the lesson’s example.'),
  e(2, 2, 6,
    'Escribe eligiendo…',
    'It writes by picking…',
    [
      o('a', 'Toda la respuesta de un golpe.', 'The whole answer in one go.'),
      o('b', 'El siguiente token, una y otra vez.', 'The next token, over and over.'),
      o('c', 'La primera letra de cada palabra.', 'The first letter of each word.'),
    ], 'b',
    'Cada token cambia el texto y por tanto las cuentas del siguiente.',
    'Each token changes the text and so the next sums.'),
  e(2, 3, 6,
    'Las barras que suman 100 miden…',
    'The bars that add to 100 measure…',
    [
      o('a', 'Qué tan cierto es cada token.', 'How true each token is.'),
      o('b', 'Qué tan probable es cada token ahora mismo.', 'How likely each token is right now.'),
      o('c', 'Cuánto cuesta cada uno.', 'How much each one costs.'),
    ], 'b',
    'Probabilidad ≠ verdad. La lección 10 lo deja aún más claro.',
    'Probability ≠ truth. Lesson 10 makes that even clearer.'),
  e(2, 4, 7,
    'Un pedido flojo («un correo») se arregla con…',
    'A weak ask (“an email”) is fixed with…',
    [
      o('a', 'qué + para quién + cómo', 'what + for whom + how'),
      o('b', 'Más signos de exclamación.', 'More exclamation marks.'),
      o('c', 'Pedirle que «sea creativo» y nada más.', 'Asking it to “be creative” and nothing else.'),
    ], 'a',
    'Sin destinatario y sin formato, rellena el promedio.',
    'With no audience and no format, it fills in the average.'),
  e(2, 5, 8,
    'Si el hilo llena la mesa…',
    'If the thread fills the table…',
    [
      o('a', 'El modelo se entrena otra vez.', 'The model trains again.'),
      o('b', 'Lo más antiguo de ESTA conversación puede caerse.', 'The oldest part of THIS conversation can fall off.'),
      o('c', 'Se borra tu progreso del curso.', 'Your course progress is erased.'),
    ], 'b',
    'El límite es por modelo y se mide en tokens, no en un número único de palabras.',
    'The limit is per model and is measured in tokens, not a single word count.'),
  e(2, 6, 7,
    '¿Adivina lo que no está en el pedido?',
    'Does it guess what is not in the ask?',
    [
      o('a', 'Sí, y casi nunca falla.', 'Yes, and it almost never fails.'),
      o('b', 'No. Lo que no digas lo rellena genérico.', 'No. What you leave out, it fills in generic.'),
      o('c', 'Solo si pagaste.', 'Only if you paid.'),
    ], 'b',
    'Tu explicación es todo el material. El resto es promedio.',
    'Your explanation is all the material. The rest is average.'),

  // ---- Exam 3 · lessons 9–12 ----
  e(3, 1, 9,
    'Temperatura alta sirve para…',
    'High temperature is for…',
    [
      o('a', 'Un dato que tiene que ser el de siempre.', 'A fact that has to be the usual one.'),
      o('b', 'Nombres raros, ideas que no sean la primera obvia.', 'Odd names, ideas that are not the first obvious one.'),
      o('c', 'Hacer verdadero lo falso.', 'Making the false become true.'),
    ], 'b',
    'Arriba se arriesga. Abajo gana la opción top (99 de 100).',
    'High takes risks. Low lets the top option win (99 of 100).'),
  e(3, 2, 10,
    '«Suena seguro» ¿quiere decir «es cierto»?',
    'Does “sounds sure” mean “is true”?',
    [
      o('a', 'Sí: el tono seguro es la prueba.', 'Yes: the sure tone is the proof.'),
      o('b', 'No. suena ≠ cierto. El puntaje mide cómo suena.', 'No. sounds ≠ true. The score measures how it sounds.'),
      o('c', 'Sí, si la temperatura está baja.', 'Yes, if temperature is low.'),
    ], 'b',
    'Es la tarjeta más importante del curso. No tiene botón de «no sé».',
    'It is the most important card in the course. There is no “I don’t know” button.'),
  e(3, 3, 11,
    'Sin búsqueda, un hecho de anoche…',
    'With no search, a fact from last night…',
    [
      o('a', 'Lo tiene, porque el modelo vive en el presente.', 'It has it, because the model lives in the present.'),
      o('b', 'No existe en su memoria: puede inventarlo con seguridad.', 'Does not exist in its memory: it may invent it with confidence.'),
      o('c', 'Lo pide a tu cámara.', 'It asks your camera.'),
    ], 'b',
    'memoria: ayer. internet: hoy.',
    'memory: yesterday. internet: today.'),
  e(3, 4, 12,
    'Usarla bien hoy es…',
    'Using it well today is…',
    [
      o('a', 'Dejar que decida por ti porque suena segura.', 'Letting it decide for you because it sounds sure.'),
      o('b', 'Pedir con fórmula, comprobar un dato que importe, y cerrar tú.', 'Ask with the formula, check one fact that matters, and you close.'),
      o('c', 'Pegar contraseñas para que «entienda tu vida».', 'Pasting passwords so it “understands your life”.'),
    ], 'b',
    'Herramienta para pensar más rápido. No sustituye tu criterio.',
    'A tool to think faster. It does not replace your judgement.'),
  e(3, 5, 10,
    'Para un dato con consecuencias (una fecha, un precio), ¿qué pides?',
    'For a fact with consequences (a date, a price), what do you ask?',
    [
      o('a', 'Que suene más seguro.', 'That it sound more sure.'),
      o('b', 'Una fuente o un dato que puedas mirar tú.', 'A source, or a fact you can look up yourself.'),
      o('c', 'Que suba la temperatura.', 'That it turn temperature up.'),
    ], 'b',
    'Si no se puede comprobar, el tono seguro no vale.',
    'If it cannot be checked, the sure tone is worthless.'),
  e(3, 6, 9,
    'Perilla abajo en un correo formal…',
    'Dial down on a formal email…',
    [
      o('a', 'Hace que se arriesgue con bromas.', 'Makes it risk jokes.'),
      o('b', 'Hace que se quede en la opción más probable, más seria.', 'Keeps it on the most likely, more serious option.'),
      o('c', 'Apaga el modelo.', 'Turns the model off.'),
    ], 'b',
    'Seria = temperatura baja. Creativa = alta. Tú eliges.',
    'Serious = low temperature. Creative = high. You choose.'),
];

const seedFrom = (txt: string): number => {
  let h = 2166136261;
  for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
const random = (state: number) => (): number => {
  state = (state + 0x6D2B79F5) >>> 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffled = <T>(xs: readonly T[], state: number): T[] => {
  const a = [...xs];
  const rnd = random(state);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

/** Options in stored order. Never the authored order if that put the answer first. */
export function storedOptions(q: QuestionSeed): QuestionOpt[] {
  for (let k = 0; k < 16; k++) {
    const opts = shuffled(q.options, seedFrom(`${q.id}#${k}`));
    if (opts[0]?.id !== q.answer) return opts;
  }
  const opts = [...q.options];
  opts.push(opts.shift()!);
  return opts;
}

export function passMark(total: number): number {
  return Math.ceil(total * PASS_RATIO);
}

export function examGate(examN: number): number | null {
  return EXAMS.find((e) => e.n === examN)?.to ?? null;
}
