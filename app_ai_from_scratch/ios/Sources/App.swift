import SwiftUI

@main
struct IAdesdeCeroApp: App {
    @State private var sesion = Sesion()
    @State private var tema = Tema.compartido
    @State private var idioma = Idioma.compartido

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(sesion)
                .environment(tema)
                .environment(idioma)
                // NO se fuerza un `.id` para repintar. Se probo y es peor: rearma
                // el arbol entero, con lo que cambiar el tema DESDE Ajustes te
                // saca de Ajustes. Y no hace falta: `T.bg` lee
                // `Tema.compartido.claro` y `L.x` lee `Idioma.compartido.codigo`,
                // que son propiedades @Observable, asi que toda vista que las
                // use durante su `body` queda suscrita sola y se repinta en el
                // sitio, sin perder la navegacion.
                #if DEBUG
                .onAppear {
                    // QA sin dedos: fija tema e idioma desde el entorno.
                    if let t = QA.valor("IA_QA_TEMA"), let m = Tema.Modo(rawValue: t) { tema.modo = m }
                    if let i = QA.valor("IA_QA_IDIOMA"), Idioma.VALIDOS.contains(i) { idioma.codigo = i }
                    // Prueba del repintado sin `.id`: cambia el tema a los 3s.
                    // Si la pantalla no cambia de color sola, la suscripcion via
                    // tokens estaticos no funciona y hay que replantearla.
                    if QA.valor("IA_QA_FLIP") != nil {
                        Task { @MainActor in
                            try? await Task.sleep(nanoseconds: 3_000_000_000)
                            tema.modo = tema.modo == .dark ? .paper : .dark
                        }
                    }
                }
                #endif
                .preferredColorScheme(tema.esquema)
                .tint(T.ac)
        }
    }
}

/// Quien esta dentro. Una sola fuente, en la raiz.
@Observable
final class Sesion {
    enum Estado: Equatable { case comprobando, fuera, dentro(User) }
    var estado: Estado = .comprobando

    /// Al arrancar: si hay cookie se entra ya con lo que se sabe, y se pide
    /// /api/me en paralelo para tener al usuario DE VERDAD.
    ///
    /// Antes esto metia un `User` de campos vacios y nunca lo reemplazaba, asi
    /// que Ajustes decia «Parte gratuita» y correo en blanco a alguien que habia
    /// pagado. Pintar primero y corregir despues evita el salto de red antes de
    /// la primera pantalla sin mentir sobre los datos.
    func arrancar() async {
        guard await API.shared.haySesionGuardada() else { estado = .fuera; return }
        if case .dentro = estado {} else {
            estado = .dentro(User(id: 0, email: "", name: "", role: "", lang: "", theme: "", paid: false, cohort: nil))
        }
        do { adopta(try await API.shared.yo()) }
        catch APIFailure.sinSesion { estado = .fuera }
        catch { /* red: se sigue con lo guardado; la siguiente peticion reintenta */ }
    }

    func entrar(_ u: User) { adopta(u) }

    /// El usuario manda sobre las preferencias locales: si la cuenta trae tema o
    /// idioma, la app se pone en ese, que es lo que hace que cambiarlo en la web
    /// se note aqui y al reves.
    func adopta(_ u: User) {
        estado = .dentro(u)
        if let m = Tema.Modo(rawValue: u.theme) { Tema.compartido.modo = m }
        if Idioma.VALIDOS.contains(u.lang) { Idioma.compartido.codigo = u.lang }
    }

    func salir() async {
        await API.shared.logout()
        estado = .fuera
    }
}

struct RootView: View {
    @Environment(Sesion.self) private var sesion
    @State private var pestana = "curso"

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
        TabView(selection: $pestana) {
            LessonsView()
                .tabItem { Label(L.curso, systemImage: "book") }.tag("curso")
            ChatView()
                .tabItem { Label(L.tutor, systemImage: "bubble.left.and.bubble.right") }.tag("tutor")
            CaminoView()
                .tabItem { Label(L.camino, systemImage: "chart.bar") }.tag("camino")
            MasView()
                .tabItem { Label(L.mas, systemImage: "ellipsis.circle") }.tag("mas")
        }
        .toolbarBackground(T.bg, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        .onAppear {
            #if DEBUG
            if let t = QA.valor("IA_QA_TAB") { pestana = t }
            #endif
        }
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
