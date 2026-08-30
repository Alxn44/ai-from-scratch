import SwiftUI

struct LessonsView: View {
    @Environment(Sesion.self) private var sesion

    @State private var lecciones: [Lesson] = []
    @State private var cargando = true
    @State private var error: String?
    @State private var ruta: [Lesson] = []
    @State private var rumbo = Rumbo.compartido

    var body: some View {
        NavigationStack(path: $ruta) {
            Group {
                if cargando && lecciones.isEmpty {
                    ProgressView().tint(T.l3).frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    lista
                }
            }
            .background(T.bg)
            .toolbar(.hidden, for: .navigationBar)
        }
        .task { await cargar() }
        .refreshable { await cargar() }
        // El destino que deja el rail del tutor. Se atiende cuando la lista ya
        // esta cargada — de ahi los dos disparadores: si el toque llega antes de
        // la respuesta de red, lo recoge el `onChange` de `lecciones`.
        .onChange(of: rumbo.leccion) { abrirPendiente() }
        .onChange(of: lecciones) { abrirPendiente() }
    }

    private func abrirPendiente() {
        guard let n = rumbo.leccion, let l = lecciones.first(where: { $0.n == n }) else { return }
        rumbo.leccion = nil
        if ruta.last != l { ruta = [l] }
    }

    private var lista: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                // El titulo vive en el contenido y no en la barra: iOS 26 mete
                // un ToolbarItem de texto en un circulo de cristal y lo trunca.
                Text(L.elCurso).label(T.l1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 18)
                    .padding(.bottom, 16)
                if let error {
                    Aviso(texto: error).padding(.horizontal, 14).padding(.bottom, 18)
                }

                if !lecciones.isEmpty {
                    resumen.padding(.horizontal, 18).padding(.bottom, 22)
                }

                ForEach(lecciones) { l in
                    NavigationLink(value: l) { Fila(leccion: l) }
                        .buttonStyle(.plain)
                }
            }
            .padding(.top, 18)
            .padding(.bottom, 32)
        }
        .navigationDestination(for: Lesson.self) { LessonDetailView(leccion: $0) }
    }

    /// Cuantos labs llevas de cuantos hay. `.bar` / `.barfill` del CSS.
    private var resumen: some View {
        let hechos = lecciones.reduce(0) { $0 + $1.solved }
        let todos  = lecciones.reduce(0) { $0 + $1.total }
        let frac   = todos > 0 ? Double(hechos) / Double(todos) : 0

        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(L.progreso).label()
                Spacer()
                Text("\(hechos)/\(todos)")
                    .font(T.mono(10, .medium)).tracking(T.lblTrack)
                    .foregroundStyle(T.l1)
                    .monospacedDigit()
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Rectangle().fill(Color(hex: 0x787880, alpha: 0.20))
                    Rectangle().fill(T.l1).frame(width: g.size.width * frac)
                }
            }
            .frame(height: 4)
        }
    }

    private func cargar() async {
        error = nil
        do {
            lecciones = try await API.shared.lessons()
            #if DEBUG
            // QA sin dedos: empuja una leccion al cargar si el entorno la pide.
            if let n = QA.valor("IA_QA_LECCION").flatMap({ Int($0) }),
               let l = lecciones.first(where: { $0.n == n }), ruta.isEmpty {
                ruta = [l]
            }
            #endif
        } catch APIFailure.sinSesion {
            // La cookie caduco o el servidor la invalido. No se enseña un error:
            // se vuelve al login, que es lo unico que se puede hacer al respecto.
            await sesion.salir()
        } catch let f as APIFailure {
            error = f.errorDescription
        } catch let otro {
            // Ver LoginView: `catch` sin nombre tapa el @State.
            error = otro.localizedDescription
        }
        cargando = false
    }
}

/// Una leccion en la lista.
///
/// Es `.row-m` del handoff: dos filas por leccion en vez de las cinco columnas
/// del escritorio. Numero, texto y estado arriba; labs y contador debajo. La
/// anotacion `m-panel` dice por que -- en la web, a 390px, la tabla se recorta a
/// tres columnas y se pierden los labs y el contador. Aqui no se recortan.
private struct Fila: View {
    let leccion: Lesson

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                Text(String(format: "%02d", leccion.n))
                    .font(T.mono(13, .medium))
                    .monospacedDigit()
                    .foregroundStyle(leccion.locked ? T.l3 : T.ac)
                    .frame(width: 32, alignment: .leading)

                VStack(alignment: .leading, spacing: 5) {
                    if let e = leccion.eyebrow, !e.isEmpty {
                        Text(e).label()
                    }
                    Text(leccion.title)
                        .font(T.h3).tracking(T.h3Track)
                        .foregroundStyle(leccion.locked ? T.l2 : T.l1)
                        .fixedSize(horizontal: false, vertical: true)
                    if let s = leccion.summary, !s.isEmpty {
                        Text(s)
                            .font(T.s).lineSpacing(T.sLine)
                            .foregroundStyle(T.l3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Spacer(minLength: 8)
                estado
            }

            if leccion.total > 0 {
                HStack(spacing: 8) {
                    Text("\(leccion.solved)/\(leccion.total) \(L.labsMin)")
                        .font(T.mono(10, .medium)).tracking(T.lblTrack)
                        .textCase(.uppercase)
                        .monospacedDigit()
                        .foregroundStyle(T.l3)
                    Spacer()
                }
                .padding(.leading, 44)
            }
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 18)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            Rectangle().fill(T.hair2).frame(height: 1)
        }
    }

    /// `.est` del CSS. Tres estados y ninguno es un icono suelto: un candado sin
    /// palabra no dice si es "aun no" o "de pago".
    @ViewBuilder private var estado: some View {
        if leccion.locked {
            Etiqueta(texto: L.dePago, color: T.or)
        } else if leccion.total > 0 && leccion.solved == leccion.total {
            Etiqueta(texto: L.hecha, color: T.ok)
        } else {
            Etiqueta(texto: L.abierta, color: T.l3)
        }
    }
}

/// Etiqueta de una linea: mono en mayusculas dentro de un recuadro fino. La usa la
/// lista de lecciones y el rail del tutor; una sola, no dos parecidas.
struct Etiqueta: View {
    let texto: String
    let color: Color
    var body: some View {
        Text(texto)
            .font(T.mono(10, .medium)).tracking(10 * 0.12).textCase(.uppercase)
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .frame(height: 26)
            .overlay(Rectangle().strokeBorder(color.opacity(0.40), lineWidth: 1))
    }
}
