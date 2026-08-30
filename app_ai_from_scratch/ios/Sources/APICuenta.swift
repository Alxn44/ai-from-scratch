import Foundation

// MARK: - Cuenta, ajustes y el resto de la superficie
//
// Formas copiadas del contrato real:
//   /api/me            auth/src/index.ts  → { user }
//   PATCH /api/settings                   → { user }        body { lang?, theme? }
//   /api/auth/register                    → 201 { user }    body { email, name, password, lang, theme }
//   /api/auth/recover                     → { ok, msg }     body { email }
//   /api/account/delete                   → { ok, deleted } body { password }
//   /api/chat/history?fuente=chat         → { threadId, turns:[{id,createdAt,role,content}] }
//   /api/ranking/optin  POST/DELETE       → { alias, apuntado }
//   /api/exams                            → { exams:[{n,from,to,locked,correct,total,passed,passAt}] }
//   /api/exams/:n?lang=                   → { n, from, to, questions:[…], score }
//   /api/questions/:id/attempt            → { correct, explanation, score }
//   /api/subscriptions/me                 → lo que devuelve payments
//   /api/pdf/:lang                        → los bytes del PDF (402 sin compra)

private struct UserOK: Codable { let user: User }

struct Turno: Codable, Identifiable, Equatable {
    let id: String
    let role: String
    let content: String
}
private struct HistorialOK: Codable { let threadId: String?; let turns: [Turno] }

struct OptinOK: Codable { let alias: String; let apuntado: Bool }

/// Una pregunta de quiz o examen. `solution` nunca aparece: api/src/assess.ts:21
/// declara esta forma exacta y el servidor corrige.
struct Pregunta: Codable, Identifiable, Equatable {
    struct Opcion: Codable, Identifiable, Equatable { let id: String; let text: String }
    let id: String
    let kind: String
    let pack: String
    let idx: Int
    let lesson: Int
    let prompt: String
    let options: [Opcion]
    var solved: Bool
    var attempts: Int
}

struct Puntaje: Codable, Equatable {
    let correct: Int
    let total: Int
    let passed: Bool
    let passAt: Int
}

struct ExamenFila: Codable, Identifiable, Equatable {
    var id: Int { n }
    let n: Int
    let from: Int
    let to: Int
    let locked: Bool
    let correct: Int
    let total: Int
    let passed: Bool
    let passAt: Int
}
private struct ExamsOK: Codable { let exams: [ExamenFila] }

struct ExamenDetalle: Codable {
    let n: Int
    let from: Int
    let to: Int
    var questions: [Pregunta]
    var score: Puntaje
}

struct RespuestaPregunta: Codable {
    let correct: Bool
    let explanation: String
    let score: Puntaje
}

struct Suscripcion: Codable, Equatable {
    let estado: String?
    let status: String?
    /// El estado real venga como venga: payments no fija el idioma de la clave.
    var vigente: String? { estado ?? status }
}

extension API {

    // MARK: cuenta

    /// Quien soy DE VERDAD. Sin esto la app arranca con un `User` de campos
    /// vacios (id 0, sin correo, paid=false) y las pantallas de cuenta mienten:
    /// «Parte gratuita» a alguien que pagó.
    func yo() async throws -> User {
        try decode(UserOK.self, await request("GET", "api/me")).user
    }

    /// Idioma y tema, al servidor. Es lo que hace que la preferencia elegida en
    /// el movil sea la misma que te encuentras en la web.
    func guardarAjustes(lang: String?, theme: String?) async throws -> User {
        var cuerpo: [String: Any] = [:]
        if let lang { cuerpo["lang"] = lang }
        if let theme { cuerpo["theme"] = theme }
        return try decode(UserOK.self, await request("PATCH", "api/settings", body: cuerpo)).user
    }

    func registrar(email: String, name: String, password: String,
                   lang: String, theme: String) async throws -> User {
        let data = try await request("POST", "api/auth/register", body: [
            "email": email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
            "password": password, "lang": lang, "theme": theme,
        ])
        return try decode(UserOK.self, data).user
    }

    /// Siempre contesta lo mismo exista o no la cuenta: el servidor no filtra
    /// quien esta registrado, y la app no debe inventarse que si.
    func recuperar(email: String) async throws {
        _ = try await request("POST", "api/auth/recover", body: [
            "email": email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
        ])
    }

    /// Borrado de cuenta dentro de la app. No es una florituta: la guia 5.1.1(v)
    /// de App Store lo EXIGE en cualquier app que permita crear cuenta, y sin
    /// esto la ficha se rechaza en revision.
    func borrarCuenta(password: String) async throws {
        _ = try await request("POST", "api/account/delete", body: ["password": password])
        for c in HTTPCookieStorage.shared.cookies ?? [] { HTTPCookieStorage.shared.deleteCookie(c) }
    }

    // MARK: chat

    /// El hilo guardado. La app arrancaba el chat vacio en cada lanzamiento
    /// mientras el servidor tenia la conversacion entera.
    func historialChat() async throws -> [ChatMsg] {
        let data = try await request("GET", "api/chat/history?fuente=chat")
        return try decode(HistorialOK.self, data).turns.map { ChatMsg(role: $0.role, content: $0.content) }
    }

    // MARK: ranking

    func apuntarseRanking(alias: String) async throws -> OptinOK {
        let data = try await request("POST", "api/ranking/optin", body: [
            "alias": alias.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
        ])
        return try decode(OptinOK.self, data)
    }

    func salirRanking() async throws {
        _ = try await request("DELETE", "api/ranking/optin")
    }

    // MARK: quiz y examenes

    func examenes() async throws -> [ExamenFila] {
        try decode(ExamsOK.self, await request("GET", "api/exams")).exams
    }

    func examen(n: Int, lang: String) async throws -> ExamenDetalle {
        try decode(ExamenDetalle.self, await request("GET", "api/exams/\(n)?lang=\(lang)"))
    }

    /// La respuesta es el ID de la opcion: `grade()` compara con `String()`
    /// contra `solution.value`, y las opciones publicas viajan como {id, text}.
    func responder(preguntaId: String, opcion: String, lang: String) async throws -> RespuestaPregunta {
        let data = try await request("POST", "api/questions/\(preguntaId)/attempt",
                                     body: ["answer": opcion, "lang": lang])
        return try decode(RespuestaPregunta.self, data)
    }

    // MARK: suscripcion y material

    func suscripcion() async throws -> Suscripcion {
        try decode(Suscripcion.self, await request("GET", "api/subscriptions/me"))
    }

    func cancelarSuscripcion() async throws {
        _ = try await request("POST", "api/subscriptions/cancel")
    }

    /// Baja el PDF a un fichero temporal y devuelve su URL, para abrirlo con el
    /// visor del sistema o compartirlo. 402 sin compra, que la vista traduce a
    /// «el PDF se abre después de la compra».
    func descargarPDF(lang: String) async throws -> URL {
        let data = try await requestRaw("GET", "api/pdf/\(lang)")
        let destino = FileManager.default.temporaryDirectory
            .appendingPathComponent("ia-desde-cero-\(lang).pdf")
        try data.write(to: destino, options: .atomic)
        return destino
    }
}
