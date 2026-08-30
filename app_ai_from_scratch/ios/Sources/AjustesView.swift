import SwiftUI
import QuickLook

/// Ajustes: idioma, tema, material y cuenta. El equivalente de
/// web/src/pages/ajustes.astro, con el mismo contrato (PATCH /api/settings).
///
/// La preferencia se guarda EN LOS DOS SITIOS a proposito: en el equipo primero
/// (para que el arranque siguiente no parpadee) y en el servidor despues (para
/// que la web se entere). Si la red falla, el cambio local se queda y el aviso
/// lo dice; lo contrario — revertir la pantalla porque el servidor no contesto —
/// es peor: el usuario ve que su toque no hizo nada.
struct AjustesView: View {
    @Environment(Sesion.self) private var sesion
    @Environment(Tema.self) private var tema
    @Environment(Idioma.self) private var idioma

    @State private var guardando = false
    @State private var aviso: String?
    @State private var error: String?

    // material
    @State private var pdf: URL?
    @State private var bajandoPdf = false

    // cuenta
    @State private var confirmarBorrado = false
    @State private var clave = ""
    @State private var borrando = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                Text(L.ajustes).label(T.l1)

                idiomaSeccion
                temaSeccion
                materialSeccion
                cuentaSeccion

                if let aviso {
                    Text(aviso).font(T.s).foregroundStyle(T.ok)
                }
                if let error { Aviso(texto: error) }
            }
            .padding(18)
            .padding(.bottom, 32)
        }
        .background(T.bg)
        .toolbarBackground(T.bg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .sheet(item: Envoltorio.opcional($pdf)) { caja in
            VisorDocumento(url: caja.url)
        }
        .alert(L.eliminarCuenta, isPresented: $confirmarBorrado) {
            SecureField(L.contrasena, text: $clave)
            Button(L.eliminarConfirmar, role: .destructive) { borrar() }
            Button(L.cerrar, role: .cancel) { clave = "" }
        } message: {
            Text(L.eliminarCuentaB)
        }
    }

    // MARK: idioma

    private var idiomaSeccion: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L.idioma).label()
            Segmentado(
                opciones: [("es", "Español"), ("en", "English"), ("auto", L.automatico)],
                elegida: idioma.codigo
            ) { nuevo in
                idioma.codigo = nuevo
                guarda(lang: nuevo, theme: nil)
            }
            .disabled(guardando)
        }
    }

    // MARK: tema

    private var temaSeccion: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L.tema).label()
            Segmentado(
                opciones: [("dark", L.oscuro), ("paper", L.papel), ("auto", L.automatico)],
                elegida: tema.modo.rawValue
            ) { nuevo in
                if let m = Tema.Modo(rawValue: nuevo) { tema.modo = m }
                guarda(lang: nil, theme: nuevo)
            }
            .disabled(guardando)
        }
    }

    // MARK: material

    private var materialSeccion: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L.material).label()
            Text(L.matPdf)
                .font(T.s).lineSpacing(T.sLine).foregroundStyle(T.l3)
                .fixedSize(horizontal: false, vertical: true)
            BotonSecundario(titulo: L.descargarPdf, cargando: bajandoPdf) { bajaPDF() }
        }
    }

    // MARK: cuenta

    private var cuentaSeccion: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L.cuenta).label()
            if case .dentro(let u) = sesion.estado {
                if !u.name.isEmpty {
                    Text(u.name).font(T.h3).tracking(T.h3Track).foregroundStyle(T.l1)
                }
                if !u.email.isEmpty {
                    Text(u.email).font(T.s).foregroundStyle(T.l3)
                }
                Text(u.paid ? L.cursoCompleto : L.parteGratuita)
                    .font(T.mono(10, .medium)).tracking(T.lblTrack).textCase(.uppercase)
                    .foregroundStyle(u.paid ? T.ok : T.l3)
            }

            Button {
                Task { await sesion.salir() }
            } label: {
                Text(L.cerrarSesion)
                    .font(T.btn).tracking(T.btnTrack).textCase(.uppercase)
                    .foregroundStyle(T.l2)
                    .frame(maxWidth: .infinity, minHeight: T.tap)
                    .overlay(RoundedRectangle(cornerRadius: T.radius).strokeBorder(T.hair, lineWidth: 1))
            }

            // 5.1.1(v) de App Store: si la app deja crear cuenta, tiene que
            // dejar borrarla DENTRO de la app. Enlazar a la web no cumple.
            Button {
                confirmarBorrado = true
            } label: {
                ZStack {
                    Text(L.eliminarCuenta)
                        .font(T.btn).tracking(T.btnTrack).textCase(.uppercase)
                        .opacity(borrando ? 0 : 1)
                    if borrando { ProgressView().controlSize(.small).tint(T.rd) }
                }
                .foregroundStyle(T.rd)
                .frame(maxWidth: .infinity, minHeight: T.tap)
                .overlay(RoundedRectangle(cornerRadius: T.radius).strokeBorder(T.rd.opacity(0.4), lineWidth: 1))
            }
            .disabled(borrando)
        }
    }

    // MARK: acciones

    private func guarda(lang: String?, theme: String?) {
        guardando = true
        aviso = nil
        error = nil
        Task {
            do {
                let u = try await API.shared.guardarAjustes(lang: lang, theme: theme)
                sesion.estado = .dentro(u)
                aviso = L.ajGuardado
            } catch APIFailure.sinSesion {
                await sesion.salir()
            } catch let f as APIFailure {
                // El cambio local YA se aplico: se avisa de que no viajo, no se
                // revierte la pantalla debajo del dedo.
                error = "\(L.ajNoGuardo). \(f.errorDescription ?? "")"
            } catch let otro {
                error = "\(L.ajNoGuardo). \(otro.localizedDescription)"
            }
            guardando = false
        }
    }

    private func bajaPDF() {
        bajandoPdf = true
        error = nil
        Task {
            do {
                pdf = try await API.shared.descargarPDF(lang: idioma.efectivo)
            } catch APIFailure.requierePago {
                error = L.muroTitulo
            } catch let f as APIFailure {
                error = f.errorDescription
            } catch let otro {
                error = otro.localizedDescription
            }
            bajandoPdf = false
        }
    }

    private func borrar() {
        guard !clave.isEmpty else { return }
        borrando = true
        error = nil
        let secreto = clave
        clave = ""
        Task {
            do {
                try await API.shared.borrarCuenta(password: secreto)
                sesion.estado = .fuera
            } catch let f as APIFailure {
                error = f.errorDescription
            } catch let otro {
                error = otro.localizedDescription
            }
            borrando = false
        }
    }
}

// MARK: - Piezas

/// El `.seg` de la web: botones pegados con uno marcado. El handoff documenta
/// que en la web median 30px de alto y no llegaban al suelo tactil; aqui son 44
/// desde el principio.
struct Segmentado: View {
    let opciones: [(String, String)]
    let elegida: String
    let alElegir: (String) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(opciones, id: \.0) { valor, titulo in
                Button {
                    if valor != elegida { alElegir(valor) }
                } label: {
                    Text(titulo)
                        .font(T.mono(10, .semibold)).tracking(10 * 0.12).textCase(.uppercase)
                        .foregroundStyle(valor == elegida ? T.onAc : T.l3)
                        .frame(maxWidth: .infinity, minHeight: T.tap)
                        .background(valor == elegida ? T.acSolid : Color.clear)
                        .contentShape(Rectangle())
                }
                if valor != opciones.last?.0 {
                    Rectangle().fill(T.hair2).frame(width: 1)
                }
            }
        }
        .overlay(RoundedRectangle(cornerRadius: T.radius).strokeBorder(T.hair, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: T.radius))
    }
}

struct BotonSecundario: View {
    let titulo: String
    var cargando = false
    let accion: () -> Void

    var body: some View {
        Button(action: accion) {
            ZStack {
                Text(titulo)
                    .font(T.btn).tracking(T.btnTrack).textCase(.uppercase)
                    .opacity(cargando ? 0 : 1)
                if cargando { ProgressView().controlSize(.small).tint(T.l2) }
            }
            .foregroundStyle(T.l2)
            .frame(maxWidth: .infinity, minHeight: T.tap)
            .overlay(RoundedRectangle(cornerRadius: T.radius).strokeBorder(T.hair, lineWidth: 1))
        }
        .disabled(cargando)
    }
}

/// `sheet(item:)` exige Identifiable y `URL` no lo es. Envolver es menos codigo
/// que un booleano aparte que hay que mantener en sincronia con el valor.
struct Envoltorio: Identifiable {
    let id = UUID()
    let url: URL

    static func opcional(_ b: Binding<URL?>) -> Binding<Envoltorio?> {
        Binding(get: { b.wrappedValue.map { Envoltorio(url: $0) } },
                set: { if $0 == nil { b.wrappedValue = nil } })
    }
}

/// El visor del sistema. Un PDF de 12 lecciones no se lee en una hoja propia:
/// QuickLook trae zoom, busqueda, compartir e imprimir sin escribir nada.
struct VisorDocumento: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> QLPreviewController {
        let c = QLPreviewController()
        c.dataSource = context.coordinator
        return c
    }
    func updateUIViewController(_ c: QLPreviewController, context: Context) {}
    func makeCoordinator() -> Coordinador { Coordinador(url: url) }

    final class Coordinador: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ c: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
            url as QLPreviewItem
        }
    }
}
