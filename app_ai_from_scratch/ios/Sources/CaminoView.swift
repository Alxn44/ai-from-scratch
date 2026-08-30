import SwiftUI

/// El camino: tu rango, cuanto llevas y el avance por leccion.
/// Espejo de /logros en la web sobre GET /api/logros.
struct CaminoView: View {
    @Environment(Sesion.self) private var sesion

    @State private var datos: CaminoData?
    @State private var cargando = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text("El camino").label(T.l1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let d = datos {
                        rango(d)
                        porLeccion(d.perLesson)
                    } else if cargando {
                        ProgressView().tint(T.l3).frame(maxWidth: .infinity).padding(.top, 60)
                    }
                    if let error { Aviso(texto: error) }
                }
                .padding(18)
                .padding(.bottom, 32)
            }
            .background(T.bg)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await cargar() }
        }
        .task { await cargar() }
    }

    private func rango(_ d: CaminoData) -> some View {
        // El indice se acota: un nivel 13 del servidor no debe tirar la app.
        let nivel = min(max(d.nivel, 0), RANGOS.count - 1)
        return VStack(alignment: .leading, spacing: 10) {
            Text("Tu rango").label()
            Text(RANGOS[nivel])
                .font(T.h2).tracking(T.h2Track)
                .foregroundStyle(T.l1)
                .fixedSize(horizontal: false, vertical: true)
            Text("Nivel \(nivel) de \(RANGOS.count - 1) · \(d.logros.count) logros")
                .font(T.s).monospacedDigit().foregroundStyle(T.l3)
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Rectangle().fill(T.fill.opacity(0.8))
                    Rectangle().fill(T.ac)
                        .frame(width: g.size.width * (Double(nivel) / Double(RANGOS.count - 1)))
                }
            }
            .frame(height: 4)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(T.panel)
        .overlay(alignment: .leading) { Rectangle().fill(T.ac).frame(width: 2) }
    }

    private func porLeccion(_ filas: [LeccionAvance]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Por lección").label().padding(.bottom, 12)
            ForEach(filas) { f in
                HStack(spacing: 12) {
                    Text(String(format: "%02d", f.n))
                        .font(T.mono(13, .medium)).monospacedDigit()
                        .foregroundStyle(f.solved == f.total && f.total > 0 ? T.ok : T.l3)
                        .frame(width: 32, alignment: .leading)
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Rectangle().fill(T.fill.opacity(0.8))
                            Rectangle()
                                .fill(f.solved == f.total && f.total > 0 ? T.ok : T.l1)
                                .frame(width: f.total > 0 ? g.size.width * Double(f.solved) / Double(f.total) : 0)
                        }
                    }
                    .frame(height: 4)
                    Text("\(f.solved)/\(f.total)")
                        .font(T.mono(11, .medium)).monospacedDigit()
                        .foregroundStyle(T.l3)
                        .frame(width: 44, alignment: .trailing)
                }
                .frame(minHeight: 36)
            }
        }
    }

    private func cargar() async {
        error = nil
        do {
            datos = try await API.shared.camino()
        } catch APIFailure.sinSesion {
            await sesion.salir()
        } catch let f as APIFailure {
            error = f.errorDescription
        } catch let otro {
            error = otro.localizedDescription
        }
        cargando = false
    }
}
