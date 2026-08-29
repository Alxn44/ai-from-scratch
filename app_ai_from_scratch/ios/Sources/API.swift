import Foundation

// MARK: - Modelos
//
// Cada campo esta copiado del contrato real, no supuesto:
//   user      auth/src/index.ts:55  shapeUser
//   lesson    api/src/server.ts:144 LessonCard, mas lo que /api/lessons añade
//   lab       api/src/server.ts:145 LabIndex, mas `solved`

struct User: Codable, Equatable {
    let id: Int
    let email: String
    let name: String
    let role: String
    let lang: String
    let theme: String
    let paid: Bool
    let cohort: String?
}

struct Lab: Codable, Identifiable, Hashable {
    let id: String
    let lesson_n: Int
    let idx: Int
    let level: String?
    let kind: String?
    let draft: Bool
    let solved: Bool
}

// Hashable, no solo Equatable: `NavigationLink(value:)` y
// `navigationDestination(for:)` empujan el valor a la pila de navegacion, y esa
// pila exige Hashable. Con Equatable compila la vista y falla el enlace.
struct Lesson: Codable, Identifiable, Hashable {
    var id: Int { n }
    let n: Int
    let eyebrow: String?
    let title: String
    let summary: String?
    let math: String?
    let math_cap: String?
    let locked: Bool
    let labs: [Lab]
    let solved: Int
    let total: Int
}

private struct LoginOK: Codable { let user: User }
private struct LessonsOK: Codable { let lessons: [Lesson] }
private struct APIError: Codable { let error: String?; let left: Int? }

// MARK: - Errores

enum APIFailure: LocalizedError {
    case credenciales
    case bloqueada
    case sinSesion
    case requierePago
    case servidor(Int, String)
    case red(String)

    var errorDescription: String? {
        switch self {
        case .credenciales:        return "Correo o contraseña incorrectos."
        case .bloqueada:           return "Cuenta bloqueada por intentos fallidos."
        case .sinSesion:           return "La sesión caducó."
        case .requierePago:        return "Esta lección es de pago."
        case let .servidor(c, m):  return "El servidor respondió \(c). \(m)"
        case let .red(m):          return "No se pudo conectar. \(m)"
        }
    }
}

// MARK: - Cliente

/// El cliente de la API de produccion.
///
/// LA SESION VA POR COOKIE, no por Bearer. `auth/src/index.ts:127` hace
/// `reply.setCookie(...)` y `api/src/server.ts:748` la lee de `req.cookies`. El
/// unico `Bearer` del backend (server.ts:856) es el secreto de servicio entre
/// api y payments, y no tiene nada que ver con el usuario.
///
/// Eso importa aqui por una razon concreta: no hay token que guardar ni cabecera
/// que poner. `URLSession` con `httpCookieStorage` compartido manda y recibe la
/// cookie sola, y `HTTPCookieStorage.shared` persiste en disco entre lanzamientos,
/// asi que la sesion sobrevive a cerrar la app sin que este fichero escriba una
/// linea de persistencia.
actor API {
    static let shared = API()

    /// El origen publico. El navegador pega a `/api/...` sobre el mismo origen y
    /// `web/src/pages/api/[...path].ts` reenvia a la API interna añadiendo `v3/`.
    /// La app entra por la MISMA puerta: si algun dia el prefijo pasa a v4, este
    /// fichero no se entera, que es justo lo que el proxy existe para conseguir.
    static let origin = URL(string: "https://aifromscratch.shop")!

    private let session: URLSession

    private init() {
        let cfg = URLSessionConfiguration.default
        cfg.httpCookieStorage = .shared
        cfg.httpCookieAcceptPolicy = .always
        cfg.httpShouldSetCookies = true
        // Sin esto una lista de lecciones cacheada sobrevive al logout.
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.timeoutIntervalForRequest = 20
        session = URLSession(configuration: cfg)
    }

    // MARK: Peticiones

    private func request(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> Data {
        var req = URLRequest(url: Self.origin.appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "accept")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let data: Data, response: URLResponse
        do { (data, response) = try await session.data(for: req) }
        catch { throw APIFailure.red(error.localizedDescription) }

        guard let http = response as? HTTPURLResponse else {
            throw APIFailure.red("Respuesta sin código de estado.")
        }
        guard (200..<300).contains(http.statusCode) else {
            // Los codigos de `error:` son valores de cable y estan en ingles o en
            // español segun los fijo el backend; se comparan tal cual, nunca
            // traducidos. CLAUDE.md los lista como excepcion deliberada.
            let code = (try? JSONDecoder().decode(APIError.self, from: data))?.error
            switch (http.statusCode, code) {
            case (401, "credenciales"):   throw APIFailure.credenciales
            case (401, _):                throw APIFailure.sinSesion
            case (423, _):                throw APIFailure.bloqueada
            case (402, _):                throw APIFailure.requierePago
            default:
                throw APIFailure.servidor(http.statusCode, code ?? "")
            }
        }
        return data
    }

    private func decode<X: Decodable>(_ type: X.Type, _ data: Data) throws -> X {
        do { return try JSONDecoder().decode(X.self, from: data) }
        catch {
            // Un fallo de decodificacion es un cambio de contrato, no un fallo de
            // red, y confundirlos manda a alguien a mirar el wifi durante una hora.
            throw APIFailure.servidor(200, "El formato de la respuesta cambió: \(error)")
        }
    }

    // MARK: Operaciones

    func login(email: String, password: String) async throws -> User {
        let data = try await request("POST", "api/auth/login", body: [
            "email": email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            "password": password,
        ])
        return try decode(LoginOK.self, data).user
    }

    func logout() async {
        _ = try? await request("POST", "api/auth/logout")
        for c in HTTPCookieStorage.shared.cookies ?? [] { HTTPCookieStorage.shared.deleteCookie(c) }
    }

    func lessons() async throws -> [Lesson] {
        let data = try await request("GET", "api/lessons")
        return try decode(LessonsOK.self, data).lessons
    }

    /// Hay cookie en almacen para este origen. No prueba que siga siendo valida
    /// -- eso solo lo dice el servidor -- pero evita enseñar el login a alguien
    /// que ya tiene sesion y luego cambiarle la pantalla debajo.
    func haySesionGuardada() -> Bool {
        (HTTPCookieStorage.shared.cookies(for: Self.origin) ?? []).isEmpty == false
    }
}
