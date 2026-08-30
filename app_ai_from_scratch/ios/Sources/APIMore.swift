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

private struct ChatReq: Codable { let mensajes: [ChatMsg] }
private struct ChatOK: Codable {
    let respuesta: String?
    let proveedor: String?
    let modelo: String?
    let error: String?
    let esperaS: Int?
}

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

    func chat(mensajes: [ChatMsg]) async throws -> ChatMsg {
        let body = try JSONEncoder().encode(ChatReq(mensajes: mensajes))
        let data = try await requestRaw("POST", "api/chat", body: body)
        let r = try decode(ChatOK.self, data)
        guard let texto = r.respuesta, !texto.isEmpty else {
            throw APIFailure.servidor(200, r.error ?? "sin_respuesta")
        }
        return ChatMsg(role: "assistant", content: texto)
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

/// Los doce rangos, copiados de web/src/lib/i18n.ts (logros.rangos). Copy de
/// producto en español a propósito: la UI nativa hoy es ES; el puerto EN va con
/// el diccionario completo, no rango a rango.
let RANGOS = ["Sin iniciar", "Iniciado", "Lector de Señales", "Contador de Trozos", "Guardián de Perillas",
              "Domador de Temperatura", "Cazador de Espejismos", "Custodio del Contexto", "Tejedor de Cadenas",
              "Alquimista de Datos", "Oráculo de Probabilidades", "Arquitecto de Agentes", "Mano Firme"]
