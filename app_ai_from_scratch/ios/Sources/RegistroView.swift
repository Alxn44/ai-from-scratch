import SwiftUI

/// Crear cuenta desde la app. Antes el login mandaba a la web («Créala en
/// aifromscratch.shop»), lo que en un movil significa salir a Safari, teclear
/// otra vez y volver — y en App Store significa que la app no tiene ni una
/// funcion sin cuenta previa, que es motivo de rechazo por 4.2 (minimum
/// functionality) además de perder a quien la instala.
///
/// El contrato es el mismo que usa la web: POST /api/auth/register devuelve 201
/// con la cookie ya puesta, asi que al volver ya se esta dentro.
struct RegistroView: View {
    @Environment(Sesion.self) private var sesion
    @Environment(Idioma.self) private var idioma
    @Environment(Tema.self) private var tema
    @Environment(\.dismiss) private var cerrar

    enum Campo { case nombre, correo, clave }
    @FocusState private var foco: Campo?

    @State private var nombre = ""
    @State private var email = ""
    @State private var clave = ""
    @State private var cargando = false
    @State private var error: String?

    /// Los mismos minimos que valida el servidor (auth/src/index.ts:141-143):
    /// nombre de 2, clave de 8. Comprobarlos aqui evita un viaje de red para
    /// que el servidor conteste lo que ya se sabia.
    private var completo: Bool {
        nombre.trimmingCharacters(in: .whitespaces).count >= 2
            && email.contains("@") && clave.count >= 8
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(L.crearCuenta).eyebrow().padding(.bottom, 8)

                Text(L.crearCuenta)
                    .font(T.h1).tracking(T.h1Track)
                    .foregroundStyle(T.l1)
                    .padding(.bottom, 12)

                Text(L.crearCuentaSub)
                    .font(T.p).lineSpacing(T.pLine)
                    .foregroundStyle(T.l2)
                    .padding(.bottom, 30)

                VStack(spacing: 18) {
                    CampoTexto(etiqueta: L.nombre, valor: $nombre, contentType: .name)
                        .focused($foco, equals: .nombre)
                    CampoTexto(etiqueta: L.correo, valor: $email,
                               contentType: .username, keyboard: .emailAddress)
                        .focused($foco, equals: .correo)
                    CampoTexto(etiqueta: L.contrasena, valor: $clave,
                               seguro: true, contentType: .newPassword)
                        .focused($foco, equals: .clave)
                }
                .padding(.bottom, 18)
                .onSubmit {
                    switch foco {
                    case .nombre: foco = .correo
                    case .correo: foco = .clave
                    case .clave:  if completo { crear() }
                    case nil:     break
                    }
                }

                if let error { Aviso(texto: error).padding(.bottom, 18) }

                BotonPrimario(titulo: L.crearCuenta, cargando: cargando, habilitado: completo) {
                    crear()
                }

                Button {
                    cerrar()
                } label: {
                    Text(L.yaTienesCuenta + " " + L.entrar)
                        .font(T.s).foregroundStyle(T.ac)
                        .frame(minHeight: T.tap)
                }
                .padding(.top, 8)
            }
            .padding(.horizontal, 24)
            .padding(.top, 40)
            .padding(.bottom, 40)
            .frame(maxWidth: 430, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(T.bg)
        .onAppear { foco = .nombre }
    }

    private func crear() {
        cargando = true
        error = nil
        Task {
            do {
                let u = try await API.shared.registrar(
                    email: email, name: nombre, password: clave,
                    lang: idioma.codigo, theme: tema.modo.rawValue)
                sesion.entrar(u)
            } catch let APIFailure.servidor(codigo, motivo) where codigo == 409 || motivo == "correo_en_uso" {
                error = idioma.efectivo == "en"
                    ? "That email already has an account."
                    : "Ese correo ya tiene cuenta."
            } catch let f as APIFailure {
                error = f.errorDescription
            } catch let otro {
                error = otro.localizedDescription
            }
            cargando = false
        }
    }
}

/// Recuperar la cuenta. El servidor contesta lo MISMO exista o no el correo
/// (auth/src/index.ts: «Si ese correo tiene cuenta, el enlace ya salió»), asi
/// que esta pantalla tampoco puede decir si existe: hacerlo convertiria el
/// formulario en un detector de cuentas registradas.
struct RecuperarView: View {
    @Environment(\.dismiss) private var cerrar

    @State private var email = ""
    @State private var cargando = false
    @State private var enviado = false
    @State private var error: String?
    @FocusState private var foco: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(L.recuperar).eyebrow().padding(.bottom, 8)

                Text(L.recuperar)
                    .font(T.h1).tracking(T.h1Track)
                    .foregroundStyle(T.l1)
                    .padding(.bottom, 12)

                Text(L.recuperarSub)
                    .font(T.p).lineSpacing(T.pLine)
                    .foregroundStyle(T.l2)
                    .padding(.bottom, 30)

                if enviado {
                    Text(L.recuperarOk)
                        .font(T.h3).tracking(T.h3Track)
                        .foregroundStyle(T.ok)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, 22)
                    BotonPrimario(titulo: L.cerrar) { cerrar() }
                } else {
                    CampoTexto(etiqueta: L.correo, valor: $email,
                               contentType: .username, keyboard: .emailAddress)
                        .focused($foco)
                        .padding(.bottom, 18)
                        .onSubmit { if !email.isEmpty { enviar() } }

                    if let error { Aviso(texto: error).padding(.bottom, 18) }

                    BotonPrimario(titulo: L.enviarEnlace, cargando: cargando,
                                  habilitado: email.contains("@")) { enviar() }
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 40)
            .padding(.bottom, 40)
            .frame(maxWidth: 430, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(T.bg)
        .onAppear { foco = true }
    }

    private func enviar() {
        cargando = true
        error = nil
        Task {
            do {
                try await API.shared.recuperar(email: email)
                enviado = true
            } catch let f as APIFailure {
                error = f.errorDescription
            } catch let otro {
                error = otro.localizedDescription
            }
            cargando = false
        }
    }
}
