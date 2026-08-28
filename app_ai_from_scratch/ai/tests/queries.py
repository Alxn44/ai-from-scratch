"""182 sentences a customer types: 138 about a lesson, 44 about anything else.

WHERE THE 138 COME FROM. They were collected while reading the live corpus — 12
lessons, `lesson_text` in both languages, 36 lab prompts — as the sentences a
beginner types for each idea. Two things cross over from that reading and no
third: the query STRING and the lesson NUMBER it should reach. No lesson text, no
titles, no «anchor» words — those are `lessons.technical`, `lessons.analogy` and
`lesson_text.*`, all `muro: de_pago`, and holding them here would make the test
suite a derivative of the paid corpus just as surely as holding them in
`concepts.py` would.

WHERE NODE'S SEARCH LANDS IS NOT IN THIS FILE ANY MORE, and that is the point of
the change. It used to be a third column here, a dict of 138 entries documented as
«the measured output of the real ranking over the real content, frozen». It was
wrong on 53 of them. The true substring hit rate is 71/138 (51%), not the 75 (54%)
this file claimed, so every comparison in the package was quoted against a column
no run produces — and the test guarding it only checked that the typed dict summed
to the number the docstring quoted, i.e. it compared the copy against itself.

It is now generated: `baseline.search_baseline()` runs
`scripts/emit-search-baseline.mjs`, which CALLS `buscar_en_curso` over the corpus
`api/src/seed.ts` defines. Slower, needs Node, and the only version of the number
that can be believed. What comes back is integers.

A FIXTURE OF THE MAP'S OWN PHRASINGS WOULD MEASURE NOTHING. It would measure
whether the map can find itself. 17 of these 138 do happen to be verbatim in
`concepts.py` (the two named failures among them, because they are the ones the map
was written for), and the tests count that subset separately and assert the floors
on the OTHER 121 — because a number that rises whenever somebody writes a new
phrasing is a number that measures the author, not the router.

HARD is the subset whose discriminating word occurs nowhere in the lesson that
answers it, or occurs only in the wrong one (`random`: exactly once, in lesson 2).
Measured through the generated baseline, Node's search gets 0 of these 12 — no
re-weighting can reach a word that is not in the text — and they are the reason a
curated map is worth building.

OFF_TOPIC, at the bottom, is the population no lesson answers at all. Its header
says what it is for.
"""

from __future__ import annotations

# (query, lesson). Spanish first, then English, both in lesson order.
ES: tuple[tuple[str, int], ...] = (
    ('como aprende a reconocer un gato', 1),
    ('quien le ensena lo que sabe', 1),
    ('nadie le escribio las reglas', 1),
    ('aprende como un nino chiquito', 1),
    ('por que necesita tantas fotos', 1),
    ('le muestran ejemplos hasta que acierta', 1),
    ('como sabe diferenciar un perro de un gato', 1),
    ('necesita que alguien le diga cual es cual', 1),
    ('como sabe si va mejorando', 2),
    ('que significa que el numero baje', 2),
    ('es como afinar una guitarra', 2),
    ('juega frio y caliente', 2),
    ('como corrige sus fallas', 2),
    ('que tan lejos quedo de la respuesta', 2),
    ('donde guarda lo que sabe', 3),
    ('que hay dentro del archivo', 3),
    ('guarda las fotos que le mostraron', 3),
    ('puedo buscar un dato adentro', 3),
    ('es como una consola de sonido', 3),
    ('cuantos numeritos tiene', 3),
    ('se puede borrar un dato de adentro', 3),
    ('si le corrijo aprende', 4),
    ('manana se acuerda de lo que le dije', 4),
    ('por que no cambia cuando le hablo', 4),
    ('es como un libro impreso', 4),
    ('por que entrenarla cuesta tanto', 4),
    ('le ensene algo y no lo guardo', 4),
    ('en que pedazos parte el texto', 5),
    ('por que me cobran por pedacitos', 5),
    ('como cuenta lo que escribo', 5),
    ('es como el mesero que anota en clave', 5),
    ('cuenta letras o palabras', 5),
    ('por que una palabra rara cuesta mas', 5),
    ('como escoge la siguiente palabra', 6),
    ('es como el autocompletar del celular', 6),
    ('tiene un plan antes de escribir', 6),
    ('por que los puntajes suman 100', 6),
    ('escribe de a una palabra', 6),
    ('por que no sale igual dos veces', 6),
    ('como le pido bien las cosas', 7),
    ('por que me responde tan generico', 7),
    ('que le tengo que decir para que sirva', 7),
    ('es como darle la direccion al taxi', 7),
    ('me sale algo que no puedo usar', 7),
    ('hay que ser educado con ella', 7),
    ('por que se le olvida lo que le dije', 8),
    ('cuanto texto le cabe', 8),
    ('en charlas largas pierde el hilo', 8),
    ('es como una mesa que se llena', 8),
    ('le puedo pegar un documento entero', 8),
    ('por que repite cosas al final', 8),
    ('como lo hago menos aleatorio', 9),
    ('como hago que responda siempre lo mismo', 9),
    ('como lo pongo mas creativo', 9),
    ('por que me da respuestas distintas cada vez', 9),
    ('hay una perilla para la creatividad', 9),
    ('quiero que sea repetible para un correo', 9),
    ('es como tirar un dado', 9),
    ('para lluvia de ideas donde la dejo', 9),
    ('por que se inventa cosas', 10),
    ('por que nunca dice no se', 10),
    ('me dio un dato falso con toda seguridad', 10),
    ('es como el amigo que siempre responde', 10),
    ('puedo confiar en lo que me dice', 10),
    ('me invento una cita que no existe', 10),
    ('suena bien pero es mentira', 10),
    ('por que no sabe lo de ayer', 11),
    ('hasta cuando sabe cosas', 11),
    ('sabe el precio de hoy', 11),
    ('puede buscar en internet', 11),
    ('es como alguien encerrado sin ventanas', 11),
    ('me dio un dato viejo como si fuera de hoy', 11),
    ('como empiezo a usarla', 12),
    ('cuanto tiempo al dia le dedico', 12),
    ('hago ejercicios o trabajo real', 12),
    ('es como aprender a manejar', 12),
    ('por donde arranco hoy', 12),
    ('como agarro el habito', 12),
)

EN: tuple[tuple[str, int], ...] = (
    ('how does it learn to recognise a cat', 1),
    ('who teaches it what it knows', 1),
    ('nobody wrote the rules', 1),
    ('learns like a small child', 1),
    ('why does it need so many photos', 1),
    ('they show it examples until it gets it right', 1),
    ('how does it know it is getting better', 2),
    ('what does it mean that the number goes down', 2),
    ('like tuning a guitar by ear', 2),
    ('how does it fix its mistakes', 2),
    ('where does it keep what it knows', 3),
    ('what is inside the file', 3),
    ('does it store the photos', 3),
    ('can i find one fact inside it', 3),
    ('like a mixing desk with knobs', 3),
    ('does it learn when i correct it', 4),
    ('will it remember tomorrow what i said', 4),
    ('why does it not change when i talk to it', 4),
    ('like a printed book', 4),
    ('why is training so expensive', 4),
    ('what pieces does it split my text into', 5),
    ('why am i billed per chunk', 5),
    ('does it count letters or words', 5),
    ('like a waiter writing shorthand', 5),
    ('how does it pick the next word', 6),
    ('like autocomplete on my phone', 6),
    ('does it plan the paragraph first', 6),
    ('it writes one word at a time', 6),
    ('how do i ask it properly', 7),
    ('why is the answer so generic', 7),
    ('what do i have to tell it', 7),
    ('like giving the taxi an address', 7),
    ('the answer is not usable', 7),
    ('why does it forget what i told it', 8),
    ('how much text fits', 8),
    ('it loses the thread in long chats', 8),
    ('like a desk that fills up', 8),
    ('can i paste a whole document', 8),
    ('how do i make it less random', 9),
    ('how do i make it answer the same every time', 9),
    ('how do i make it more creative', 9),
    ('why do i get different answers each time', 9),
    ('is there a creativity dial', 9),
    ('like rolling dice', 9),
    ('why does it make things up', 10),
    ('why does it never say i do not know', 10),
    ('it gave me a false fact confidently', 10),
    ('like the friend who always answers', 10),
    ('can i trust what it says', 10),
    ('it invented a citation', 10),
    ('why does it not know about yesterday', 11),
    ('how up to date is it', 11),
    ('does it know today price', 11),
    ('can it search the internet', 11),
    ('like someone locked in a library', 11),
    ('how do i start using it', 12),
    ('how much time per day', 12),
    ('exercises or real work', 12),
    ('like learning to drive', 12),
    ('where do i start today', 12),
)

ALL: tuple[tuple[str, int, str], ...] = (
    *((q, n, "es") for q, n in ES),
    *((q, n, "en") for q, n in EN),
)

# (query, lesson, lang) — the subset only a curated map can route.
HARD: tuple[tuple[str, int, str], ...] = (
    ('quien le ensena lo que sabe', 1, 'es'),
    ('who teaches it what it knows', 1, 'en'),
    ('como corrige sus fallas', 2, 'es'),
    ('where does it keep what it knows', 3, 'en'),
    ('que le tengo que decir para que sirva', 7, 'es'),
    ('what do i have to tell it', 7, 'en'),
    ('how much text fits', 8, 'en'),
    ('como lo pongo mas creativo', 9, 'es'),
    ('why does it make things up', 10, 'en'),
    ('como empiezo a usarla', 12, 'es'),
    ('como agarro el habito', 12, 'es'),
    ('where do i start today', 12, 'en'),
)


# ---------------------------------------------------------------------------
# 44 MESSAGES THAT ARE NOT ABOUT A LESSON, and the public tool that answers each.
#
# WHY THEY EXIST. The 138 above measure «does it find the right lesson». They
# cannot measure the failure that costs the most, because every one of them HAS a
# lesson: a customer asking the price, their password, an invoice or the weather,
# and being handed a lesson number with high confidence. Measured before the fix,
# `entender_pregunta` named a lesson for 18 of these 44 — «cuanto cuesta el curso
# completo» came back as lesson 4 at confianza 1.0, because `cuesta` bridges to
# `inferencia` and lesson 4 carries the phrasing «cuanto cuesta una respuesta». The
# trace showed a confident, well-reasoned route, which is why nothing looked broken.
#
# The third column is the PUBLIC bridged tool that holds the answer, or None. None
# does not mean «anything goes»: every one of the 44 must come back without a lesson
# number. It means this fixture does not claim which tool is right — either because
# no tool is (a recipe, a football result: `sin_ruta` is the answer) or because two
# are defensible (a double charge is both a price question and a support case).
#
# They are ordinary customer sentences, written here and nowhere else. Nothing was
# read out of a lesson to build them, and none of them is a marker list read back to
# itself: `test_no_product_marker_matches_a_course_question` asserts the other
# direction over all 138 above, which is the direction that would break the course.
OFF_TOPIC: tuple[tuple[str, str, str | None], ...] = (
    ('cuanto cuesta el curso completo', 'es', 'precio_y_compra'),
    ('puedo pagar el curso con tarjeta de credito', 'es', 'precio_y_compra'),
    ('hay algun descuento para estudiantes', 'es', 'precio_y_compra'),
    ('quiero un reembolso', 'es', 'precio_y_compra'),
    ('el curso incluye certificado', 'es', None),
    ('ya pague el curso y sigue cerrada la leccion 5', 'es', None),
    ('me cobraron dos veces la suscripcion', 'es', None),
    ('necesito la factura con mi nit', 'es', 'soporte'),
    ('olvide mi contrasena y no puedo entrar', 'es', 'soporte'),
    ('la pagina no carga en mi celular', 'es', 'soporte'),
    ('no me llego el correo de confirmacion', 'es', None),
    ('como cambio el idioma de la plataforma', 'es', 'ajustes'),
    ('quiero poner el tema oscuro', 'es', 'ajustes'),
    ('como borro mi cuenta', 'es', 'mis_datos_y_privacidad'),
    ('que datos mios guardan', 'es', None),
    ('que datos guardan de mi cuenta', 'es', 'mis_datos_y_privacidad'),
    ('donde descargo el pdf del curso', 'es', 'descargar_pdf'),
    ('donde veo mi puesto en la liga', 'es', 'donde_encuentro'),
    ('hay app movil del curso', 'es', 'como_funciona'),
    ('cual es la capital de francia', 'es', None),
    ('quien gano el mundial de futbol', 'es', None),
    ('necesito una receta de arroz con pollo', 'es', None),
    ('que tiempo va a hacer manana en bogota', 'es', None),
    ('cuanto es 15 por ciento de 200', 'es', None),
    ('how much does the full course cost', 'en', 'precio_y_compra'),
    ('can i pay with paypal', 'en', 'precio_y_compra'),
    ('is there a student discount', 'en', 'precio_y_compra'),
    ('i want a refund', 'en', 'precio_y_compra'),
    ('you charged my card twice', 'en', 'precio_y_compra'),
    ('my invoice has the wrong tax id', 'en', 'soporte'),
    ('i forgot my password', 'en', 'soporte'),
    ('the site does not load on my phone', 'en', 'soporte'),
    ('i did not get the confirmation email', 'en', None),
    ('how do i change the interface language', 'en', 'ajustes'),
    ('how do i turn on dark mode', 'en', 'ajustes'),
    ('how do i delete my account', 'en', 'mis_datos_y_privacidad'),
    ('what data do you keep about me', 'en', None),
    ('where do i download the pdf', 'en', 'descargar_pdf'),
    ('where can i see my league position', 'en', 'donde_encuentro'),
    ('do you have a mobile app', 'en', 'como_funciona'),
    ('who won the world cup', 'en', None),
    ('how do i cook rice', 'en', None),
    ('translate this sentence into spanish', 'en', None),
    ('what is 15 percent of 200', 'en', None),
)
