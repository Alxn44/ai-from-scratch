import SwiftUI

/// El tutor. Mismo contrato que la web: POST /api/chat con el hilo entero
/// (`mensajes`), respuesta en `respuesta`. El hilo persistente lo guarda el
/// servidor en messages/, y `fuente:"chat"` es el MISMO hilo que la web: la
/// conversacion se sigue en el movil donde se dejo en el escritorio.
///
/// La pantalla es la maqueta 1a del rediseño, con los tokens del producto:
/// respuestas como PROSA (avatar + parrafos, sin caja), lo tuyo en burbuja a la
/// derecha, composer de dos filas con carril y esfuerzo, y el rail del curso —
/// que en escritorio es una columna de 300 px — aqui en una hoja.
struct ChatView: View {
    @Environment(Sesion.self) private var sesion

    @State private var mensajes: [ChatMsg] = []
    /// El pie «Responde X · modelo Y» por respuesta. Va aparte de `mensajes`
    /// porque `mensajes` es lo que viaja por el cable y el pie no viaja.
    @State private var firmas: [UUID: String] = [:]
    @State private var texto = ""
    @State private var enviando = false
    @State private var error: String?
    @State private var estado = ChatEstado.vacio
    @State private var railAbierto = false
    @State private var ancho: CGFloat = 0

    /// Lo elegido se guarda, no se pregunta cada vez. Se guarda el CARRIL y no un
    /// id de proveedor: un id caduca cuando cambia la tabla del servidor, un
    /// carril no.
    @AppStorage("ia.carril") private var carril = "flash"
    @AppStorage("ia.esfuerzo") private var esfuerzo = "medio"

    private static let ESFUERZOS = ["bajo", "medio", "alto"]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                cabecera
                ScrollViewReader { lector in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 32) {
                            bienvenida
                            ForEach(mensajes) { m in turno(m) }
                            if enviando { pensando }
                            if let error { Aviso(texto: error) }
                            Color.clear.frame(height: 1).id("fondo")
                        }
                        .padding(.horizontal, 18)
                        .padding(.top, 26)
                        .padding(.bottom, 10)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onChange(of: mensajes) {
                        withAnimation { lector.scrollTo("fondo", anchor: .bottom) }
                    }
                }
                compositor
            }
            .background(T.bg)
            .background {
                // Una sola medida del ancho util, para que la burbuja propia
                // pueda ocupar el 68% como en la web en vez de un numero fijo.
                GeometryReader { g in
                    Color.clear.onAppear { ancho = g.size.width }
                        .onChange(of: g.size.width) { ancho = g.size.width }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .sheet(isPresented: $railAbierto) {
            RailCurso(estado: estado) { atajo in
                railAbierto = false
                enviar(atajo)
            }
        }
        .task {
            // El hilo vive en el servidor (messages/). Sin esto la app abria el
            // chat en blanco en cada lanzamiento mientras la web enseñaba la
            // conversacion entera: la misma cuenta con dos memorias distintas.
            if mensajes.isEmpty {
                do { mensajes = try await API.shared.historialChat() }
                catch { /* sin historial se empieza en blanco, que es lo que habia */ }
            }
            // Los carriles vivos los dice el SERVIDOR. Si no contesta, se queda
            // el estado vacio: el composer sigue funcionando y manda sin
            // proveedor, que es lo correcto — elige el servidor.
            do { estado = try await API.shared.chatEstado() }
            catch { /* sin estado no se ofrece carril; el envio sigue */ }
        }
    }

    // MARK: cabecera

    private var cabecera: some View {
        HStack(spacing: 12) {
            Text(L.elTutor).label(T.l3)
            Spacer(minLength: 8)
            Button { railAbierto = true } label: {
                Text(L.elRail)
                    .font(T.mono(10, .semibold)).tracking(10 * 0.12).textCase(.uppercase)
                    .foregroundStyle(T.l2)
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .overlay(Rectangle().strokeBorder(T.hair, lineWidth: 1))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 18)
        .frame(height: 52)
        .overlay(alignment: .bottom) { Rectangle().fill(T.hair2).frame(height: 1) }
    }

    // MARK: hilo

    private var avatar: some View {
        Text("IA")
            .font(T.mono(10, .semibold))
            .foregroundStyle(T.ac)
            .frame(width: 27, height: 27)
            .background(T.fill)
            .overlay(Rectangle().strokeBorder(T.ac, lineWidth: 1))
    }

    private var bienvenida: some View {
        HStack(alignment: .top, spacing: 15) {
            avatar
            VStack(alignment: .leading, spacing: 13) {
                Text(L.chatVacio)
                    .font(.system(size: 15)).lineSpacing(15 * 0.62).foregroundStyle(T.l2)
                    .fixedSize(horizontal: false, vertical: true)
                Text(L.chatVacioB)
                    .font(.system(size: 15)).lineSpacing(15 * 0.62).foregroundStyle(T.l2)
                    .fixedSize(horizontal: false, vertical: true)
                Flujo(hgap: 8, vgap: 8) {
                    ForEach([L.aEmpezar, L.aSiguiente, L.aAyuda], id: \.self) { a in
                        Pastilla(titulo: a) { enviar(a) }
                    }
                }
            }
        }
    }

    @ViewBuilder private func turno(_ m: ChatMsg) -> some View {
        if m.role == "user" {
            // 68% como en la web. El Spacer se queda el 32% restante, asi que un
            // mensaje corto sigue siendo corto y uno largo topa donde debe.
            HStack(spacing: 0) {
                Spacer(minLength: max(40, ancho * 0.32))
                Text(m.content)
                    .font(.system(size: 15)).lineSpacing(15 * 0.55)
                    .foregroundStyle(T.l1)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 17).padding(.vertical, 11)
                    .background(T.fill)
                    .overlay(Rectangle().strokeBorder(T.ac, lineWidth: 1))
            }
        } else {
            HStack(alignment: .top, spacing: 15) {
                avatar
                VStack(alignment: .leading, spacing: 11) {
                    ProsaView(texto: m.content)
                    // ESTE PIE NO SE QUITA. La politica de privacidad publicada
                    // dice «te diremos en la misma pantalla que proveedor atiende
                    // tu mensaje».
                    if let pie = firmas[m.id] {
                        Text(pie)
                            .font(.system(size: 11.5)).lineSpacing(11.5 * 0.5)
                            .foregroundStyle(T.l3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private var pensando: some View {
        HStack(alignment: .top, spacing: 15) {
            avatar
            HStack(spacing: 8) {
                ProgressView().controlSize(.small).tint(T.l3)
                Text(L.pensando).font(.system(size: 15)).foregroundStyle(T.l3)
            }
            .padding(.top, 3)
        }
    }

    // MARK: composer

    private var compositor: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(spacing: 0) {
                TextField(L.escribePregunta, text: $texto, axis: .vertical)
                    .font(.system(size: 15)).lineSpacing(15 * 0.5)
                    .foregroundStyle(T.l1)
                    .lineLimit(1...6)
                    .padding(.horizontal, 16).padding(.vertical, 14)

                Rectangle().fill(T.hair2).frame(height: 1)

                HStack(spacing: 12) {
                    Segmentado(
                        opciones: [("flash", L.carrilFlash), ("razon", L.carrilRazon)],
                        elegida: carril,
                        compacto: true,
                        deshabilitadas: carrilesMuertos
                    ) { carril = $0 }

                    esfuerzoControl
                    Spacer(minLength: 4)
                    botonEnviar
                }
                .padding(.horizontal, 10).padding(.vertical, 8)
            }
            .background(T.panel)
            .overlay(Rectangle().strokeBorder(T.hair, lineWidth: 1))

            Text(L.privAviso)
                .font(.system(size: 11.5)).lineSpacing(11.5 * 0.5)
                .foregroundStyle(T.l3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 11)
        }
        .padding(.horizontal, 18)
        .padding(.top, 12).padding(.bottom, 10)
        .background(T.bg)
        .overlay(alignment: .top) { Rectangle().fill(T.hair2).frame(height: 1) }
    }

    /// Carriles que el servidor NO sirve hoy. Si aun no ha contestado no se
    /// apaga ninguno: apagar por falta de respuesta es apagar por no saber.
    private var carrilesMuertos: Set<String> {
        let vivos = estado.carrilesVivos
        return vivos.isEmpty ? [] : Set(["flash", "razon"]).subtracting(vivos)
    }

    /// La pista de esfuerzo. Un `Slider` de verdad y no un dibujo: asi funciona
    /// con VoiceOver y con teclado externo, cosa que un punto sobre una linea no
    /// hace.
    private var esfuerzoControl: some View {
        let indice = Binding<Double>(
            get: { Double(Self.ESFUERZOS.firstIndex(of: esfuerzo) ?? 1) },
            set: { esfuerzo = Self.ESFUERZOS[min(2, max(0, Int($0.rounded())))] }
        )
        return HStack(spacing: 9) {
            Slider(value: indice, in: 0...2, step: 1)
                .tint(T.ac)
                .frame(width: 58)
                .accessibilityLabel(L.esfuerzo)
            Text(nombreEsfuerzo)
                .font(T.mono(9.5, .semibold)).tracking(9.5 * 0.08).textCase(.uppercase)
                .foregroundStyle(T.ac)
                .frame(width: 40, alignment: .leading)
        }
    }

    private var nombreEsfuerzo: String {
        switch esfuerzo {
        case "bajo": return L.bajo
        case "alto": return L.alto
        default:     return L.medio
        }
    }

    private var botonEnviar: some View {
        Button(action: { enviar(texto) }) {
            Image(systemName: "arrow.up")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(T.onAc)
                .frame(width: 36, height: 36)
                .background(T.acSolid.opacity(puedeEnviar ? 1 : 0.3))
                .clipShape(RoundedRectangle(cornerRadius: T.radius))
        }
        .buttonStyle(.plain)
        .disabled(!puedeEnviar)
        .accessibilityLabel(L.enviar)
    }

    private var puedeEnviar: Bool {
        !enviando && !texto.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: envio

    private func enviar(_ crudo: String) {
        let contenido = crudo.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !enviando, !contenido.isEmpty else { return }
        texto = ""
        error = nil
        mensajes.append(ChatMsg(role: "user", content: contenido))
        enviando = true
        Task {
            do {
                let r = try await API.shared.chat(
                    mensajes: mensajes,
                    proveedor: estado.resolver(carril),
                    esfuerzo: esfuerzo)
                firmas[r.mensaje.id] = rellena(L.proveedorPie, [
                    "p": r.proveedor ?? "—", "m": r.modelo ?? "—",
                ])
                mensajes.append(r.mensaje)
            } catch APIFailure.sinSesion {
                await sesion.salir()
            } catch let APIFailure.servidor(codigo, _) where codigo == 429 {
                // El freno de ritmo del servidor. Decir "espera" es la respuesta
                // correcta; reintentar solo lo alargaria.
                error = L.chatFreno
            } catch let APIFailure.servidor(codigo, _) where codigo == 501 {
                error = L.chatSinIa
            } catch let f as APIFailure {
                error = f.errorDescription
            } catch let otro {
                error = otro.localizedDescription
            }
            enviando = false
        }
    }
}
