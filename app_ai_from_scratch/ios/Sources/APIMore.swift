import Foundation

// MARK: - Modelos del detalle de leccion
//
// Formas copiadas del contrato real:
//   /api/lessons/:n     server.ts:206  { lesson, labs, texto, textoIdioma, quiz, quizScore }
//   PublicLab           grading.ts:82  { id, lesson, idx, level, kind, prompt, payload, draft, solved, attempts }
//   attempt             server.ts:330  { correct, explanation, hint, nuevos }

struct LabFull: Codable, Identifiable, Equatable {
    let id: String
    let lesson: Int
    let idx: Int
    let level: String?
    let kind: String
    let prompt: String
    let payload: JSONValue
    let draft: Bool
    var solved: Bool
    var attempts: Int
}

struct LessonTexto: Codable, Equatable {
    let technical: String?
    let analogy: String?
}

struct LessonFull: Codable, Equatable {
    let n: Int
    let eyebrow: String?
    let title: String
    let summary: String?
    let math: String?
    let math_cap: String?
}

struct LessonDetail: Codable {
    let lesson: LessonFull
    var labs: [LabFull]
    let texto: LessonTexto?
    // El servidor los manda desde siempre (server.ts:209) y la app los tiraba:
    // el quiz de la leccion simplemente no existia en movil.
    var quiz: [Pregunta]?
    var quizScore: Puntaje?
}

struct AttemptHint: Codable, Equatable {
    let err: Double?
    let word: String?
    let range: [Double?]?
}

struct AttemptResult: Codable {
    let correct: Bool
    let explanation: String
    let hint: AttemptHint?
    let nuevos: [Logro]?
}

// MARK: - Chat
//
// POST /api/chat  body {mensajes:[{role,content}]}  →  { respuesta, proveedor, modelo }
// Las claves en español son valores de cable (CLAUDE.md, excepción deliberada).

struct ChatMsg: Codable, Identifiable, Equatable {
    // UUID local y fuera del cable: role+content como id duplicaba ids en
    // cuanto se manda el mismo texto dos veces, y ForEach pinta fantasmas.
    var id = UUID()
    let role: String
    let content: String

    private enum CodingKeys: String, CodingKey { case role, content }
}

// El cuerpo mandaba SOLO `mensajes`, asi que el movil no podia elegir carril ni
// esfuerzo y ademas dejaba `lang` al valor de la cuenta aunque la app estuviera
// en otro idioma. Los cuatro campos opcionales son los que el servidor ya acepta
// (api/src/server.ts, SCHEMA_CHAT); ninguno es nuevo en el cable.
private struct ChatReq: Codable {
    let mensajes: [ChatMsg]
    let lang: String?
    let fuente: String?
    let proveedor: String?
    let esfuerzo: String?
}
private struct ChatOK: Codable {
    let respuesta: String?
    let proveedor: String?
    let modelo: String?
    let error: String?
    let esperaS: Int?
}

/// Una respuesta del tutor con QUIEN la firmo. El pie de cada respuesta lo dice
/// en pantalla porque la politica de privacidad publicada lo promete.
struct ChatTurno: Equatable {
    let mensaje: ChatMsg
    let proveedor: String?
    let modelo: String?
}

// MARK: - Estado del chat
//
// GET /api/chat/estado  →  { disponible, proveedores:[{id,modelo,carril}],
//                            herramientas:[...], familias:{...} }
//
// SE ELIGE UN CARRIL, NO UNA MARCA, y la lista de carriles vivos sale del
// SERVIDOR. Escribirla aqui seria la copia que prohibe la regla 4 de la casa: el
// dia que un id cambia en ai/src/course_ai/agent/providers.py, el boton sigue
// pintado y manda un proveedor que ya no existe.

struct ProvFila: Codable, Identifiable, Equatable {
    var id: String { ident }
    let ident: String
    let modelo: String?
    let carril: String?

    private enum CodingKeys: String, CodingKey { case ident = "id", modelo, carril }
}

struct ChatEstado: Codable, Equatable {
    let disponible: Bool
    let proveedores: [ProvFila]
    let herramientas: [String]

    /// Primer proveedor vivo de ese carril, o nil si hoy no lo sirve nadie.
    func resolver(_ carril: String) -> String? {
        proveedores.first { $0.carril == carril }?.ident
    }

    /// Carriles que el servidor puede atender ahora mismo.
    var carrilesVivos: [String] {
        ["flash", "razon"].filter { c in proveedores.contains { $0.carril == c } }
    }

    static let vacio = ChatEstado(disponible: false, proveedores: [], herramientas: [])
}

/// GET /api/coach → la racha ya calculada (api/src/coach.ts). No se recalcula en
/// la app: es la misma cifra que usa el sistema de avisos, y dos calculos
/// separados acaban diciendo dos cosas distintas.
struct CoachRacha: Codable, Equatable { let racha: Int }

// MARK: - Camino / Ranking / Ligas

struct Logro: Codable, Identifiable, Equatable {
    var id: String { code }
    let code: String
    let kind: String
    let lesson_n: Int?
}

struct LeccionAvance: Codable, Identifiable, Equatable {
    var id: Int { n }
    let n: Int
    let total: Int
    let solved: Int
}

struct CaminoData: Codable {
    let logros: [Logro]
    let nivel: Int
    let total: Int
    let perLesson: [LeccionAvance]
}

struct RankRow: Codable, Identifiable, Equatable {
    var id: String { alias }
    let alias: String
    let lecciones: Int
    let labs: Int
}
struct RankYo: Codable, Equatable { let alias: String?; let apuntado: Bool; let puesto: Int? }
struct RankingData: Codable { let tabla: [RankRow]; let yo: RankYo }

struct LigaRow: Codable, Identifiable, Equatable {
    var id: String { alias }
    let alias: String
    let metal: String
    let caudal: Int
    let puesto: Int?
}
struct LigaYo: Codable, Equatable { let alias: String; let metal: String; let puesto: Int; let caudal: Int }
struct LigasData: Codable {
    let activa: Bool
    let faltan: Int?
    let minimo: Int?
    let tabla: [LigaRow]
    let yo: LigaYo?
}

// MARK: - Llamadas

extension API {

    func lessonDetail(n: Int) async throws -> LessonDetail {
        let data = try await request("GET", "api/lessons/\(n)")
        return try decode(LessonDetail.self, data)
    }

    /// `answer` viaja tal cual lo arma la mecánica: el encoding por kind está
    /// copiado de web/src/lib/labs-client.ts, que es el contrato vivo:
    ///   choice → el TEXTO de la opción · cut → ["wi-i", …] · order → [ids]
    ///   build → {"0": texto, …} · knob/hotcold → número
    func attempt(labId: String, answer: JSONValue) async throws -> AttemptResult {
        struct Body: Codable { let answer: JSONValue }
        let body = try JSONEncoder().encode(Body(answer: answer))
        let data = try await requestRaw("POST", "api/labs/\(labId)/attempt", body: body)
        return try decode(AttemptResult.self, data)
    }

    /// `fuente` va explicito y vale "chat": es el MISMO hilo que la web. El
    /// servidor ya lo tomaba por defecto (server.ts), pero escribirlo deja claro
    /// que compartir la conversacion entre movil y escritorio es deliberado.
    func chat(mensajes: [ChatMsg], proveedor: String?, esfuerzo: String) async throws -> ChatTurno {
        let body = try JSONEncoder().encode(ChatReq(
            mensajes: mensajes,
            lang: Idioma.compartido.efectivo,
            fuente: "chat",
            proveedor: proveedor,
            esfuerzo: esfuerzo))
        let data = try await requestRaw("POST", "api/chat", body: body)
        let r = try decode(ChatOK.self, data)
        guard let texto = r.respuesta, !texto.isEmpty else {
            throw APIFailure.servidor(200, r.error ?? "sin_respuesta")
        }
        return ChatTurno(mensaje: ChatMsg(role: "assistant", content: texto),
                         proveedor: r.proveedor, modelo: r.modelo)
    }

    func chatEstado() async throws -> ChatEstado {
        try decode(ChatEstado.self, await request("GET", "api/chat/estado"))
    }

    func racha() async throws -> Int {
        try decode(CoachRacha.self, await request("GET", "api/coach")).racha
    }

    func camino() async throws -> CaminoData {
        try decode(CaminoData.self, await request("GET", "api/logros"))
    }

    func ranking() async throws -> RankingData {
        try decode(RankingData.self, await request("GET", "api/ranking"))
    }

    func ligas() async throws -> LigasData {
        try decode(LigasData.self, await request("GET", "api/ligas"))
    }
}

