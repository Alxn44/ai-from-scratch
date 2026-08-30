import SwiftUI

/// El tutor. Mismo contrato que la web: POST /api/chat con el hilo entero
/// (`mensajes`), respuesta en `respuesta`. El hilo vive en memoria de la vista:
/// el historial persistente ya lo guarda el servidor en messages/.
struct ChatView: View {
    @Environment(Sesion.self) private var sesion

    @State private var mensajes: [ChatMsg] = []
    @State private var texto = ""
    @State private var enviando = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { lector in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            Text("El tutor").label(T.l1)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.bottom, 6)
                            if mensajes.isEmpty { vacio }
                            ForEach(mensajes) { m in burbuja(m) }
                            if enviando {
                                HStack(spacing: 8) {
                                    ProgressView().controlSize(.small).tint(T.l3)
                                    Text("Pensando…").font(T.s).foregroundStyle(T.l3)
                                }
                                .padding(.horizontal, 4)
                            }
                            if let error { Aviso(texto: error) }
                            Color.clear.frame(height: 1).id("fondo")
                        }
                        .padding(18)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onChange(of: mensajes) {
                        withAnimation { lector.scrollTo("fondo", anchor: .bottom) }
                    }
                }
                compositor
            }
            .background(T.bg)
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var vacio: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Pregunta lo que quieras del curso").font(T.h3).tracking(T.h3Track).foregroundStyle(T.l1)
            Text("El tutor solo puede ver tus propios datos: tu avance, tus intentos y las lecciones. Nada de nadie más.")
                .font(T.s).lineSpacing(T.sLine).foregroundStyle(T.l3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.bottom, 14)
    }

    @ViewBuilder private func burbuja(_ m: ChatMsg) -> some View {
        let propio = m.role == "user"
        HStack {
            if propio { Spacer(minLength: 40) }
            Text(m.content)
                .font(.system(size: 15)).lineSpacing(15 * 0.4)
                .foregroundStyle(propio ? Color.white : T.l1)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(propio ? T.acSolid : T.panel)
                .overlay(RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(propio ? Color.clear : T.hair2, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 14))
            if !propio { Spacer(minLength: 40) }
        }
    }

    private var compositor: some View {
        HStack(spacing: 10) {
            TextField("Escribe tu pregunta", text: $texto, axis: .vertical)
                .font(.system(size: 15))
                .foregroundStyle(T.l1)
                .lineLimit(1...4)
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(T.fill)
                .overlay(RoundedRectangle(cornerRadius: T.radius).strokeBorder(T.hair2, lineWidth: 1))
                .onSubmit(enviar)

            Button(action: enviar) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(T.btnFg)
                    .frame(width: T.tap, height: T.tap)
                    .background(T.btnBg.opacity(puedeEnviar ? 1 : 0.3))
                    .clipShape(RoundedRectangle(cornerRadius: T.radius))
            }
            .disabled(!puedeEnviar)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(T.bg)
        .overlay(alignment: .top) { Rectangle().fill(T.hair2).frame(height: 1) }
    }

    private var puedeEnviar: Bool {
        !enviando && !texto.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func enviar() {
        guard puedeEnviar else { return }
        let contenido = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        texto = ""
        error = nil
        mensajes.append(ChatMsg(role: "user", content: contenido))
        enviando = true
        Task {
            do {
                let r = try await API.shared.chat(mensajes: mensajes)
                mensajes.append(r)
            } catch APIFailure.sinSesion {
                await sesion.salir()
            } catch let APIFailure.servidor(codigo, _) where codigo == 429 {
                // El freno de ritmo del servidor. Decir "espera" es la respuesta
                // correcta; reintentar solo lo alargaria.
                error = "Vas muy seguido. Espera unos segundos y vuelve a preguntar."
            } catch let APIFailure.servidor(codigo, _) where codigo == 501 {
                error = "El chat no está configurado en el servidor."
            } catch let f as APIFailure {
                error = f.errorDescription
            } catch let otro {
                error = otro.localizedDescription
            }
            enviando = false
        }
    }
}
