import SwiftUI

@main
struct IAdesdeCeroApp: App {
    @State private var sesion = Sesion()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(sesion)
                .preferredColorScheme(.dark)
                .tint(T.ac)
        }
    }
}

/// Quien esta dentro. Una sola fuente, en la raiz.
@Observable
final class Sesion {
    enum Estado: Equatable { case comprobando, fuera, dentro(User) }
    var estado: Estado = .comprobando

    /// Al arrancar no se pregunta al servidor todavia: si hay cookie guardada se
    /// entra directo y la primera peticion real dira si sigue valida. Un
    /// `/api/lessons` de tanteo antes de pintar nada añade un salto de red a cada
    /// arranque para responder algo que la siguiente pantalla ya va a preguntar.
    func arrancar() async {
        estado = await API.shared.haySesionGuardada()
            ? .dentro(User(id: 0, email: "", name: "", role: "", lang: "", theme: "", paid: false, cohort: nil))
            : .fuera
    }

    func entrar(_ u: User) { estado = .dentro(u) }

    func salir() async {
        await API.shared.logout()
        estado = .fuera
    }
}

struct RootView: View {
    @Environment(Sesion.self) private var sesion

    var body: some View {
        ZStack {
            T.bg.ignoresSafeArea()
            #if DEBUG
            // La galeria de QA manda sobre todo: sin poder tocar el simulador
            // desde esta maquina, es la unica forma de capturar una mecanica.
            if let kind = QA.valor("IA_QA_LAB") {
                GaleriaQA(kind: kind)
            } else {
                interior
            }
            #else
            interior
            #endif
        }
        .task { await sesion.arrancar() }
    }

    @ViewBuilder private var interior: some View {
        switch sesion.estado {
        case .comprobando:
            ProgressView().tint(T.l3)
        case .fuera:
            LoginView()
        case .dentro:
            pestanas
        }
    }

    /// El menu. En la web es la barra lateral (App.astro: panel, curso, logros,
    /// ranking, ligas, perfil, ajustes); en iOS el patron equivalente es la tab
    /// bar: Curso, Tutor, Camino y Más (que agrupa ranking, ligas y cuenta).
    /// Cuatro y no ocho porque HIG pide 3–5 y porque panel/perfil son vistas de
    /// resumen que aqui ya cubren la lista y el camino.
    private var pestanas: some View {
        TabView {
            LessonsView()
                .tabItem { Label("Curso", systemImage: "book") }
            ChatView()
                .tabItem { Label("Tutor", systemImage: "bubble.left.and.bubble.right") }
            CaminoView()
                .tabItem { Label("Camino", systemImage: "chart.bar") }
            MasView()
                .tabItem { Label("Más", systemImage: "ellipsis.circle") }
        }
        .toolbarBackground(T.bg, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
    }
}

// MARK: - Piezas compartidas

/// `.btn` del CSS: 44 de alto, mono 11, .1em, mayusculas, radio 6.
struct BotonPrimario: View {
    let titulo: String
    var cargando = false
    var habilitado = true
    let accion: () -> Void

    var body: some View {
        Button(action: accion) {
            ZStack {
                Text(titulo)
                    .font(T.btn).tracking(T.btnTrack).textCase(.uppercase)
                    .opacity(cargando ? 0 : 1)
                if cargando {
                    ProgressView().controlSize(.small).tint(T.btnFg)
                }
            }
            .frame(maxWidth: .infinity, minHeight: T.tap)
            .background(T.btnBg.opacity(habilitado ? 1 : 0.30))
            .foregroundStyle(T.btnFg)
            .clipShape(RoundedRectangle(cornerRadius: T.radius))
        }
        .disabled(!habilitado || cargando)
    }
}

/// `.input`: 44 de alto, fondo `fill`, borde `hair2`, texto 15.
///
/// El tamaño 15 no es decorativo. El handoff (anotacion `r-brief`) documenta que
/// `admin.astro:42` pone un `font:500 11px` en linea y que iOS hace zoom al
/// enfocar cualquier campo por debajo de 16 -- en la web. Aqui no hay WebView y
/// no hay zoom, asi que se conserva el 15 del token en vez de inflarlo a 16 por
/// un motivo que en nativo no existe.
struct CampoTexto: View {
    let etiqueta: String
    @Binding var valor: String
    var seguro = false
    var contentType: UITextContentType?
    var keyboard: UIKeyboardType = .default

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(etiqueta).label()
            Group {
                if seguro { SecureField("", text: $valor) }
                else      { TextField("", text: $valor) }
            }
            .font(.system(size: 15))
            .foregroundStyle(T.l1)
            .textContentType(contentType)
            .keyboardType(keyboard)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(.horizontal, 14)
            .frame(height: T.tap)
            .background(T.fill)
            .overlay(Rectangle().strokeBorder(T.hair2, lineWidth: 1))
        }
    }
}

/// El aviso de error. Nunca un `alert`: un modal esconde el formulario que hay
/// que corregir y obliga a un toque extra para volver a el.
struct Aviso: View {
    let texto: String
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(T.rd).frame(width: 6, height: 6).padding(.top, 6)
            Text(texto).font(T.s).lineSpacing(T.sLine).foregroundStyle(T.l2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(T.rd.opacity(0.10))
        .overlay(Rectangle().strokeBorder(T.rd.opacity(0.35), lineWidth: 1))
    }
}
