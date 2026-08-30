import SwiftUI

/// El idioma de la interfaz.
///
/// La web resuelve esto con un diccionario de claves y pinta `⟦clave⟧` cuando
/// falta una (web/src/lib/i18n.ts). Aqui es un STRUCT: si una traduccion falta,
/// no compila. Es la regla 1 de la casa — fallar cerrado y a gritos — aplicada
/// al sitio donde la web solo puede fallar en tiempo de ejecucion.
///
/// El servidor acepta es/en/fr/pt/auto (auth/src/index.ts:43), pero solo hay
/// diccionario real de es y en; fr y pt existen como valor guardable y caen a
/// español, exactamente como en la web.
struct Txt {
    // navegacion
    let curso: String, tutor: String, camino: String, mas: String

    // lista de lecciones
    let elCurso: String, progreso: String, dePago: String, hecha: String
    let abierta: String, labsMin: String

    // detalle de leccion
    let queEs: String, laAnalogia: String, laMatematica: String, labs: String
    let resuelto: String, pendiente: String, enPreparacion: String, intentos: String
    let muroTitulo: String, muroCuerpo: String, verPrecio: String, reintentar: String
    let ejemplos: String, pides: String, pasa: String

    // labs
    let comprobar: String, probar: String, reiniciar: String, cerrar: String
    let correcto: String, todaviaNo: String, errDe: String, rangoRep: String
    let cortesPuestos: String, pasosDisponibles: String, tuOrden: String
    let tocaPaso: String, vacio: String, fria: String, creativa: String
    let gana: String, tusIntentos: String, labResuelto: String, kindDesconocido: String

    // desbloqueos
    let rangoNuevo: String, gradoNuevo: String, liga: String, tuRango: String
    let gradosDeLaLeccion: String

    // chat
    let elTutor: String, chatVacio: String, chatVacioB: String
    let escribePregunta: String, pensando: String, chatFreno: String, chatSinIa: String
    // El composer: se elige un CARRIL, no una marca. Quien respondio de hecho lo
    // dice `proveedorPie` debajo de cada respuesta — la politica de privacidad
    // promete eso mismo con estas palabras: «te diremos en la misma pantalla que
    // proveedor atiende tu mensaje».
    let carrilFlash: String, carrilRazon: String, esfuerzo: String
    let bajo: String, medio: String, alto: String
    let proveedorPie: String, enviar: String, privAviso: String
    // El rail del curso, que en movil es una hoja. Copia identica a la de la web
    // (web/src/lib/i18n.ts, chat.*): las dos pantallas dicen lo MISMO.
    let elRail: String, tuProgreso: String, deLabs: String
    let racha: String, rachaUno: String, rachaCero: String, leccionDe: String
    let siguienteLab: String, empezarLab: String, cursoHecho: String, cursoHechoB: String
    let atajosCurso: String, preguntaEsto: String, railPie: String
    // Los tres niveles de lab. La app los venia enseñando CRUDOS, o sea "DIFICIL"
    // en la version inglesa, mientras la web dice "Hard" (i18n.ts curso.nDuro).
    let nFacil: String, nMedio: String, nDuro: String
    let sugFallo: String, sugSimple: String, sugPrueba: String
    let soloTuyo: String, soloTuyoB: String
    // Los atajos son PROMPTS: se mandan tal cual al tutor. Por eso son la misma
    // cadena que la web manda, no una parafrasis.
    let aEmpezar: String, aLeccion: String, aProgreso: String, aSiguiente: String
    let aLogros: String, aRanking: String, aPagar: String, aTutorial: String, aAyuda: String

    // camino
    let elCamino: String, nivelDe: String, porLeccion: String

    // mas / cuenta
    let comunidad: String, ranking: String, ligas: String, cuenta: String
    let sonido: String, cerrarSesion: String, cursoCompleto: String, parteGratuita: String
    let material: String, descargarPdf: String, matPdf: String
    let tema: String, idioma: String, oscuro: String, papel: String, automatico: String
    let eliminarCuenta: String, eliminarCuentaB: String, eliminarConfirmar: String
    let suscripcion: String, cancelarSuscripcion: String, cancelada: String
    let enLaWeb: String, soporte: String, privacidad: String, terminos: String
    let ajustes: String, ajGuardado: String, ajNoGuardo: String

    // ranking / ligas
    let vasDe: String, noApuntado: String, apuntarme: String, alias: String
    let aliasMalo: String, aliasTomado: String, salirRanking: String, tablaVacia: String
    let ligaNoArranca: String, ligaFaltan: String

    // narrador
    let escuchar: String, pausa: String, seguir: String, parar: String
    let preparando: String, fraseDeN: String, sinVoz: String, velocidad: String, voz: String

    // login / registro / recuperar
    let entrar: String, vuelveAlCurso: String, loginSub: String
    let correo: String, contrasena: String, nombre: String
    let noTienesCuenta: String, crearCuenta: String, crearCuentaSub: String
    let yaTienesCuenta: String, olvidasteClave: String
    let recuperar: String, recuperarSub: String, enviarEnlace: String, recuperarOk: String

    // quiz / examen
    let quizTitulo: String, quizSub: String, quizHecho: String, quizPregunta: String
    let examenes: String, examenSub: String, examenN: String, examenRango: String
    let aprobado: String, noAprobado: String, apruebasCon: String, deSeis: String
}

// MARK: - Español

let ES = Txt(
    curso: "Curso", tutor: "Tutor", camino: "Camino", mas: "Más",

    elCurso: "El curso", progreso: "Progreso", dePago: "De pago", hecha: "Hecha",
    abierta: "Abierta", labsMin: "labs",

    queEs: "Qué es", laAnalogia: "La analogía", laMatematica: "La matemática", labs: "Labs",
    resuelto: "Resuelto", pendiente: "Pendiente", enPreparacion: "En preparación", intentos: "intentos",
    muroTitulo: "Esta lección está en la parte de pago del curso.",
    muroCuerpo: "La compra se hace en la web. Al volver aquí, la lección estará abierta.",
    verPrecio: "Ver el precio", reintentar: "Reintentar",
    ejemplos: "Ejemplos", pides: "Le pides", pasa: "Qué pasa",

    comprobar: "Comprobar", probar: "Probar", reiniciar: "Reiniciar", cerrar: "Cerrar",
    correcto: "Correcto", todaviaNo: "Todavía no",
    errDe: "Tu error fue de {err} ({word}).",
    rangoRep: "El rango que cuenta como repetible es {a}–{b}.",
    cortesPuestos: "{n} cortes puestos", pasosDisponibles: "Pasos disponibles", tuOrden: "Tu orden",
    tocaPaso: "Toca un paso para empezar.", vacio: "vacío", fria: "FRÍA", creativa: "CREATIVA",
    gana: "gana {q} con {n} de 100", tusIntentos: "Tus intentos · error",
    labResuelto: "Lab {id} resuelto",
    kindDesconocido: "Este tipo de lab aún no se puede hacer en la app. Está disponible en la web.",

    rangoNuevo: "Rango nuevo", gradoNuevo: "Grado nuevo", liga: "Liga", tuRango: "Tu rango",
    gradosDeLaLeccion: "Grados de la lección",

    elTutor: "El tutor", chatVacio: "Pregunta lo que quieras del curso",
    chatVacioB: "El tutor solo puede ver tus propios datos: tu avance, tus intentos y las lecciones. Nada de nadie más.",
    escribePregunta: "Escribe tu pregunta", pensando: "Pensando…",
    chatFreno: "Vas muy seguido. Espera unos segundos y vuelve a preguntar.",
    chatSinIa: "El chat no está configurado en el servidor.",
    carrilFlash: "Rápido", carrilRazon: "Razona", esfuerzo: "Esfuerzo",
    bajo: "Bajo", medio: "Medio", alto: "Alto",
    proveedorPie: "Responde {p} · modelo {m}", enviar: "Enviar",
    privAviso: "Lo que escribas en modo IA viaja al proveedor del modelo para poder responderte. No se usa para entrenar.",
    elRail: "Tu curso", tuProgreso: "Tu progreso", deLabs: "/ {n} labs",
    racha: "Racha {n} días", rachaUno: "Racha 1 día", rachaCero: "Sin racha",
    leccionDe: "Lección {n} de {m}",
    siguienteLab: "Siguiente lab", empezarLab: "Empezar lab",
    cursoHecho: "Curso completo", cursoHechoB: "Las 12 lecciones cerradas. Pregunta lo que quieras repasar.",
    atajosCurso: "Atajos del curso", preguntaEsto: "Pregúntale esto",
    railPie: "{n} herramientas · solo ven tu cuenta",
    nFacil: "Fácil", nMedio: "Medio", nDuro: "Difícil",
    sugFallo: "¿Por qué falló mi último lab?", sugSimple: "Dame un ejemplo más simple", sugPrueba: "Ponme a prueba",
    soloTuyo: "Solo veo tu cuenta",
    soloTuyoB: "Las herramientas del agente no aceptan el identificador de otra persona: el servidor pone el tuyo.",
    aEmpezar: "Empezar", aLeccion: "Hacer una lección", aProgreso: "Mi progreso", aSiguiente: "Qué sigue",
    aLogros: "Mis logros", aRanking: "Mi puesto", aPagar: "Pagar", aTutorial: "Tutorial", aAyuda: "Qué puedes hacer",

    elCamino: "El camino", nivelDe: "Nivel {n} de {t} · {l} logros", porLeccion: "Por lección",

    comunidad: "Comunidad", ranking: "Ranking", ligas: "Ligas", cuenta: "Cuenta",
    sonido: "Sonido", cerrarSesion: "Cerrar sesión",
    cursoCompleto: "Curso completo", parteGratuita: "Parte gratuita",
    material: "Material", descargarPdf: "Descargar el PDF",
    matPdf: "Las 12 lecciones en PDF, en tu idioma, para leer sin conexión.",
    tema: "Tema", idioma: "Idioma", oscuro: "Oscuro", papel: "Papel", automatico: "Auto",
    eliminarCuenta: "Eliminar la cuenta",
    eliminarCuentaB: "Se borra tu cuenta y todo tu avance. No se puede deshacer.",
    eliminarConfirmar: "Sí, eliminar mi cuenta",
    suscripcion: "Suscripción", cancelarSuscripcion: "Cancelar la suscripción",
    cancelada: "Cancelada",
    enLaWeb: "En la web", soporte: "Soporte", privacidad: "Privacidad", terminos: "Términos",
    ajustes: "Ajustes", ajGuardado: "Ajustes guardados", ajNoGuardo: "No se pudo guardar",

    vasDe: "Vas de {p}º como {a}", noApuntado: "Aún no estás apuntado en el ranking.",
    apuntarme: "Apuntarme", alias: "Alias",
    aliasMalo: "De 3 a 18 caracteres: letras, números, punto, guion o guion bajo.",
    aliasTomado: "Ese alias ya está tomado.", salirRanking: "Salir del ranking",
    tablaVacia: "Todavía no hay nadie en la tabla.",
    ligaNoArranca: "La liga aún no arranca",
    ligaFaltan: "Faltan {n} personas apuntadas: arranca con {m}.",

    escuchar: "Escuchar la lección", pausa: "Pausa", seguir: "Seguir", parar: "Parar",
    preparando: "Preparando…", fraseDeN: "frase {i} de {n}", sinVoz: "Sin voz en español",
    velocidad: "Velocidad de lectura", voz: "Voz",

    entrar: "Entrar", vuelveAlCurso: "Vuelve al curso",
    loginSub: "Doce lecciones, treinta y seis labs y un tutor que solo ve tus datos.",
    correo: "Correo", contrasena: "Contraseña", nombre: "Nombre",
    noTienesCuenta: "¿No tienes cuenta?", crearCuenta: "Crear cuenta",
    crearCuentaSub: "Las cuatro primeras lecciones son gratis, sin tarjeta.",
    yaTienesCuenta: "¿Ya tienes cuenta?", olvidasteClave: "¿Olvidaste la contraseña?",
    recuperar: "Recuperar la cuenta",
    recuperarSub: "Te mandamos un enlace para poner una contraseña nueva.",
    enviarEnlace: "Enviar el enlace",
    recuperarOk: "Si ese correo tiene cuenta, el enlace ya salió.",

    quizTitulo: "Quiz rápido",
    quizSub: "Tres preguntas. No bloquea los labs: es para comprobar que se quedó.",
    quizHecho: "Quiz cerrado", quizPregunta: "Pregunta {n}",
    examenes: "Exámenes",
    examenSub: "Tres bloques. Seis preguntas cada uno. Apruebas con 5 de 6. Se puede repetir y se conserva tu mejor resultado.",
    examenN: "Examen {n}", examenRango: "Lecciones {a}–{b}",
    aprobado: "Aprobado", noAprobado: "Sin aprobar", apruebasCon: "Apruebas con {n}",
    deSeis: "{a} de {b}"
)

// MARK: - English
//
// Copy tomada de web/src/lib/i18n.ts donde existe (nav, ui, lec, quiz, exam,
// narra), no traducida a ojo: la app y la web deben decir lo MISMO.

let EN = Txt(
    curso: "Course", tutor: "Tutor", camino: "Path", mas: "More",

    elCurso: "The course", progreso: "Progress", dePago: "Paid", hecha: "Completed",
    abierta: "Open", labsMin: "labs",

    queEs: "What it is", laAnalogia: "As if it were…", laMatematica: "The math", labs: "Labs",
    resuelto: "Solved", pendiente: "Not started", enPreparacion: "Draft", intentos: "tries",
    muroTitulo: "This lesson is in the paid part of the course.",
    muroCuerpo: "The purchase happens on the web. When you come back, the lesson will be open.",
    verPrecio: "See the price", reintentar: "Try again",
    ejemplos: "Examples", pides: "You ask", pasa: "What happens",

    comprobar: "Check", probar: "Try", reiniciar: "Start over", cerrar: "Close",
    correcto: "Correct", todaviaNo: "Not yet",
    errDe: "You were off by {err} ({word}).",
    rangoRep: "The range that counts as repeatable is {a}–{b}.",
    cortesPuestos: "{n} cuts placed", pasosDisponibles: "Available steps", tuOrden: "Your order",
    tocaPaso: "Tap a step to begin.", vacio: "empty", fria: "COLD", creativa: "CREATIVE",
    gana: "{q} wins with {n} of 100", tusIntentos: "Your tries · error",
    labResuelto: "Lab {id} solved",
    kindDesconocido: "This kind of lab cannot be done in the app yet. It is available on the web.",

    rangoNuevo: "New rank", gradoNuevo: "New grade", liga: "League", tuRango: "Your rank",
    gradosDeLaLeccion: "Grades in this lesson",

    elTutor: "The tutor", chatVacio: "Ask anything about the course",
    chatVacioB: "The tutor can only see your own data: your progress, your attempts and the lessons. Nobody else's.",
    escribePregunta: "Type your question", pensando: "Thinking…",
    chatFreno: "That was quick. Wait a few seconds and ask again.",
    chatSinIa: "The chat is not configured on the server.",
    carrilFlash: "Fast", carrilRazon: "Reasoning", esfuerzo: "Effort",
    bajo: "Low", medio: "Medium", alto: "High",
    proveedorPie: "Answered by {p} · model {m}", enviar: "Send",
    privAviso: "What you type in AI mode travels to the model provider so it can answer you. It is not used for training.",
    elRail: "Your course", tuProgreso: "Your progress", deLabs: "/ {n} labs",
    racha: "{n} day streak", rachaUno: "1 day streak", rachaCero: "No streak",
    leccionDe: "Lesson {n} of {m}",
    siguienteLab: "Next lab", empezarLab: "Start lab",
    cursoHecho: "Course complete", cursoHechoB: "All 12 lessons closed. Ask about anything you want to review.",
    atajosCurso: "Course shortcuts", preguntaEsto: "Ask it this",
    railPie: "{n} tools · they only see your account",
    nFacil: "Easy", nMedio: "Medium", nDuro: "Hard",
    sugFallo: "Why did my last lab fail?", sugSimple: "Give me a simpler example", sugPrueba: "Quiz me",
    soloTuyo: "I only see your account",
    soloTuyoB: "The agent tools do not accept anyone else\u{2019}s id: the server injects yours.",
    aEmpezar: "Get started", aLeccion: "Do a lesson", aProgreso: "My progress", aSiguiente: "What is next",
    aLogros: "My achievements", aRanking: "My position", aPagar: "Pay", aTutorial: "Tutorial", aAyuda: "What you can do",

    elCamino: "The path", nivelDe: "Level {n} of {t} · {l} achievements", porLeccion: "By lesson",

    comunidad: "Community", ranking: "Leaderboard", ligas: "Leagues", cuenta: "Account",
    sonido: "Sound", cerrarSesion: "Sign out",
    cursoCompleto: "Full course", parteGratuita: "Free part",
    material: "Material", descargarPdf: "Download the PDF",
    matPdf: "All 12 lessons as a PDF, in your language, to read offline.",
    tema: "Theme", idioma: "Language", oscuro: "Dark", papel: "Paper", automatico: "Auto",
    eliminarCuenta: "Delete the account",
    eliminarCuentaB: "Your account and all your progress are erased. This cannot be undone.",
    eliminarConfirmar: "Yes, delete my account",
    suscripcion: "Subscription", cancelarSuscripcion: "Cancel the subscription",
    cancelada: "Cancelled",
    enLaWeb: "On the web", soporte: "Support", privacidad: "Privacy", terminos: "Terms",
    ajustes: "Settings", ajGuardado: "Settings saved", ajNoGuardo: "Could not save",

    vasDe: "You are {p} as {a}", noApuntado: "You have not joined the leaderboard yet.",
    apuntarme: "Join", alias: "Alias",
    aliasMalo: "3 to 18 characters: letters, numbers, dot, dash or underscore.",
    aliasTomado: "That alias is taken.", salirRanking: "Leave the leaderboard",
    tablaVacia: "Nobody is on the table yet.",
    ligaNoArranca: "The league has not started",
    ligaFaltan: "{n} more people need to join: it starts with {m}.",

    escuchar: "Listen to the lesson", pausa: "Pause", seguir: "Resume", parar: "Stop",
    preparando: "Starting…", fraseDeN: "sentence {i} of {n}", sinVoz: "No English voice",
    velocidad: "Reading speed", voz: "Voice",

    entrar: "Sign in", vuelveAlCurso: "Back to the course",
    loginSub: "Twelve lessons, thirty-six labs and a tutor that only sees your data.",
    correo: "Email", contrasena: "Password", nombre: "Name",
    noTienesCuenta: "No account yet?", crearCuenta: "Create account",
    crearCuentaSub: "The first four lessons are free, no card.",
    yaTienesCuenta: "Already have an account?", olvidasteClave: "Forgot your password?",
    recuperar: "Recover the account",
    recuperarSub: "We send you a link to set a new password.",
    enviarEnlace: "Send the link",
    recuperarOk: "If that email has an account, the link is already out.",

    quizTitulo: "Quick quiz",
    quizSub: "Three questions. It does not block the labs: it is to check it stuck.",
    quizHecho: "Quiz closed", quizPregunta: "Question {n}",
    examenes: "Exams",
    examenSub: "Three blocks. Six questions each. You pass with 5 of 6. You can retake it, and your best result is kept.",
    examenN: "Exam {n}", examenRango: "Lessons {a}–{b}",
    aprobado: "Passed", noAprobado: "Not passed", apruebasCon: "You pass with {n}",
    deSeis: "{a} of {b}"
)

/// El idioma vigente. Igual que el tema: se guarda en el equipo para que el
/// arranque no parpadee y viaja al servidor con PATCH /api/settings, asi que el
/// idioma elegido en el movil es el que te encuentras en la web.
@Observable
final class Idioma {
    static let compartido = Idioma()
    static let CLAVE = "curso.idioma"

    /// Valores que el servidor acepta (auth/src/index.ts:43).
    static let VALIDOS = ["es", "en", "fr", "pt", "auto"]

    var codigo: String {
        didSet { UserDefaults.standard.set(codigo, forKey: Self.CLAVE) }
    }

    /// El idioma efectivo: `auto` sigue al equipo, y fr/pt caen a español
    /// porque no hay diccionario — igual que en la web.
    var efectivo: String {
        if codigo == "auto" {
            return Locale.preferredLanguages.first?.hasPrefix("en") == true ? "en" : "es"
        }
        return codigo == "en" ? "en" : "es"
    }

    var t: Txt { efectivo == "en" ? EN : ES }

    private init() {
        codigo = UserDefaults.standard.string(forKey: Self.CLAVE) ?? "es"
    }
}

/// Atajo de lectura: `L.entrar` en vez de `Idioma.compartido.t.entrar`.
var L: Txt { Idioma.compartido.t }

/// Rellena `{clave}` como hace `fill()` en web/src/lib/labs-client.ts.
func rellena(_ s: String, _ v: [String: Any]) -> String {
    v.reduce(s) { $0.replacingOccurrences(of: "{\($1.key)}", with: String(describing: $1.value)) }
}

/// El nombre del nivel de un lab. El valor del cable es `facil|medio|dificil`
/// (ai/src/course_ai/ontology/data.py) y no es texto para enseñar: uno
/// desconocido se devuelve tal cual en vez de desaparecer, que es la regla 1 —
/// fallar a la vista y no en silencio.
func nivelNombre(_ level: String?) -> String {
    switch level {
    case "facil":   return L.nFacil
    case "medio":   return L.nMedio
    case "dificil": return L.nDuro
    default:        return level ?? ""
    }
}

/// El color del nivel. Los mismos tres del CSS (--ok / --or / --rd).
func nivelColor(_ level: String?) -> Color {
    switch level {
    case "facil":   return T.ok
    case "medio":   return T.or
    case "dificil": return T.rd
    default:        return T.hair
    }
}

/// Los doce rangos. En ingles salen de web/src/lib/i18n.ts (logros.rangos), no
/// traducidos a ojo aqui.
/// Trece entradas y no doce: el indice 0 es «sin iniciar», que la web resuelve
/// aparte porque su array empieza en el nivel 1.
let RANGOS_ES = ["Sin iniciar", "Iniciado", "Lector de Señales", "Contador de Trozos", "Guardián de Perillas",
                 "Domador de Temperatura", "Cazador de Espejismos", "Custodio del Contexto", "Tejedor de Cadenas",
                 "Alquimista de Datos", "Oráculo de Probabilidades", "Arquitecto de Agentes", "Mano Firme"]

let RANGOS_EN = ["Not started", "Initiate", "Signal Reader", "Chunk Counter", "Dial Keeper",
                 "Temperature Tamer", "Mirage Hunter", "Context Custodian", "Chain Weaver",
                 "Data Alchemist", "Probability Oracle", "Agent Architect", "Steady Hand"]

var RANGOS: [String] { Idioma.compartido.efectivo == "en" ? RANGOS_EN : RANGOS_ES }
