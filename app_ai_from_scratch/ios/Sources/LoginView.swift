import SwiftUI

struct LoginView: View {
    @Environment(Sesion.self) private var sesion

    /// El teclado sale con la pantalla y el foco esta en el correo. Un login que
    /// obliga a tocar el primer campo cobra un toque por cada entrada al curso.
    enum Campo { case correo, clave }
    @FocusState private var foco: Campo?

    @State private var email = ""
    @State private var clave = ""
    @State private var cargando = false
    @State private var error: String?

    private var completo: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty && !clave.isEmpty
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {

                // Marca. En la web es un cuadro con "IA" y el nombre al lado
                // (login.astro:41). Mismo par aqui.
                HStack(spacing: 11) {
                    Text("IA")
                        .font(T.mono(13, .bold))
                        .foregroundStyle(T.btnFg)
                        .frame(width: 30, height: 30)
                        .background(T.btnBg)
                    Text("IA desde cero")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(T.l1)
                }
                .padding(.bottom, 40)

                Text("Entrar").eyebrow()
                    .padding(.bottom, 8)

                Text("Vuelve al curso")
                    .font(T.h1).tracking(T.h1Track)
                    .foregroundStyle(T.l1)
                    .padding(.bottom, 12)

                Text("Doce lecciones, treinta y seis labs y un tutor que solo ve tus datos.")
                    .font(T.p).lineSpacing(T.pLine)
                    .foregroundStyle(T.l2)
                    .padding(.bottom, 30)

                VStack(spacing: 18) {
                    CampoTexto(etiqueta: "Correo", valor: $email,
                               contentType: .username, keyboard: .emailAddress)
                        .focused($foco, equals: .correo)
                    CampoTexto(etiqueta: "Contraseña", valor: $clave,
                               seguro: true, contentType: .password)
                        .focused($foco, equals: .clave)
                }
                .padding(.bottom, 18)
                // Return encadena: del correo pasa a la clave, y desde la clave
                // envia. Sin esto hay que bajar el teclado para llegar al boton.
                .onSubmit {
                    switch foco {
                    case .correo: foco = .clave
                    case .clave:  if completo { Task { await entrar() } }
                    case nil:     break
                    }
                }

                if let error {
                    Aviso(texto: error).padding(.bottom, 18)
                }

                BotonPrimario(titulo: "Entrar", cargando: cargando, habilitado: completo) {
                    Task { await entrar() }
                }

                Text("¿No tienes cuenta? Créala en aifromscratch.shop")
                    .font(T.s).lineSpacing(T.sLine)
                    .foregroundStyle(T.l3)
                    .padding(.top, 22)
            }
            .padding(.horizontal, 24)
            .padding(.top, 60)
            .padding(.bottom, 40)
            .frame(maxWidth: 430, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(T.bg)
        .onAppear { foco = .correo }
    }

    private func entrar() async {
        cargando = true
        error = nil
        do {
            let u = try await API.shared.login(email: email, password: clave)
            sesion.entrar(u)
        } catch let f as APIFailure {
            // El backend distingue 401 credenciales de 423 bloqueada
            // (auth/src/index.ts:114 y :118). La app tambien: "no te sabes la
            // clave" y "has agotado los intentos" piden cosas distintas.
            error = f.errorDescription
        } catch let otro {
            // `catch { }` sin nombre liga `error` implicitamente y TAPA el
            // @State de arriba: compila como asignacion a un `let` y el aviso
            // nunca se pinta. Se nombra a proposito.
            error = otro.localizedDescription
        }
        cargando = false
    }
}
