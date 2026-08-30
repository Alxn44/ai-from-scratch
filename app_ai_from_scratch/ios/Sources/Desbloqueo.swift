import SwiftUI

/// El aviso de DESBLOQUEO, portado de web/src/lib/unlock.ts. La regla de alli
/// que importa: LA ESCALA ES EL DISEÑO. Un lab pasa 36 veces y lleva solo un
/// carril fino; un rango pasa doce veces en todo el curso y es el unico con
/// insignia y anillo. Tiempos y anchos son los de la web (MS y CARRIL).
///
/// La insignia aqui es un SF Symbol y no el SVG de badges.ts: portar los
/// trazados es trabajo de arte pendiente, y un simbolo del sistema respeta la
/// escala sin inventar una marca nueva.
struct HitoDesbloqueo: Identifiable, Equatable {
    enum Tipo: String { case lab, grado, rango, liga }
    struct Meta: Equatable { let lbl: String; let num: String; let pct: Double }

    let id = UUID()
    let tipo: Tipo
    let titulo: String
    let cuerpo: String?
    let meta: Meta?

    /// ms de vida y tipografia del titulo, por tipo — la tabla MS/TIPO de unlock.ts
    var vida: Double { [Tipo.lab: 2.6, .grado: 3.4, .liga: 4.4, .rango: 5.6][tipo] ?? 3 }
    var cuerpoTitulo: Font {
        switch tipo {
        case .lab:   return .system(size: 15, weight: .semibold)
        case .grado: return .system(size: 17, weight: .semibold)
        case .liga:  return .system(size: 19, weight: .semibold)
        case .rango: return .system(size: 22, weight: .bold)
        }
    }
    var tinta: Color {
        switch tipo {
        case .lab:   return T.ok
        case .grado: return T.ac
        case .liga:  return T.or
        case .rango: return T.or
        }
    }
    var simbolo: String? {
        switch tipo {
        case .lab:   return nil          // el lab NO lleva insignia: solo el carril
        case .grado: return "star.fill"
        case .liga:  return "medal.fill"
        case .rango: return "trophy.fill"
        }
    }
}

/// La cola de avisos. Una sola fuente por sesion; las vistas la montan como
/// overlay y cada tarjeta se va sola a su tiempo.
@Observable
final class Desbloqueos {
    static let shared = Desbloqueos()
    var activos: [HitoDesbloqueo] = []

    func mostrar(_ h: HitoDesbloqueo) {
        activos.append(h)
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(h.vida * 1_000_000_000))
            activos.removeAll { $0.id == h.id }
        }
    }
}

/// El carril de tarjetas, abajo (en la web es abajo-derecha compartido con los
/// toasts). Se monta una vez por pantalla que pueda ganar algo.
struct CapaDesbloqueos: View {
    @State private var centro = Desbloqueos.shared

    var body: some View {
        VStack(spacing: 8) {
            Spacer()
            ForEach(centro.activos) { h in
                TarjetaDesbloqueo(hito: h)
                    .transition(.asymmetric(
                        insertion: Fx.quieto ? .opacity : .opacity.combined(with: .offset(x: 14, y: 10)),
                        removal: .opacity))
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 90)
        .animation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.24), value: centro.activos)
        .allowsHitTesting(false)
    }
}

private struct TarjetaDesbloqueo: View {
    let hito: HitoDesbloqueo
    @State private var barra = false     // la barra de meta corre a su valor
    @State private var cuenta = false    // la linea de arriba es el tiempo que queda
    @State private var anillo = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // linea de tiempo: una barra que se vacia se ve de reojo; un contador
            // numerico obliga a leer (decision 3 de unlock.ts)
            GeometryReader { g in
                Rectangle().fill(hito.tinta.opacity(0.55))
                    .frame(width: cuenta ? 0 : g.size.width, alignment: .leading)
                    .animation(Fx.quieto ? nil : .linear(duration: hito.vida), value: cuenta)
            }
            .frame(height: 2)

            HStack(alignment: .center, spacing: 0) {
                if let s = hito.simbolo {
                    ZStack {
                        if !Fx.quieto {
                            Rectangle()
                                .strokeBorder(hito.tinta, lineWidth: 1)
                                .frame(width: 74, height: 74)
                                .scaleEffect(anillo ? 2.1 : 0.45)
                                .opacity(anillo ? 0 : 0.85)
                                .animation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.72).delay(0.06), value: anillo)
                        }
                        Image(systemName: s)
                            .font(.system(size: 26, weight: .semibold))
                            .foregroundStyle(hito.tinta)
                    }
                    .frame(width: hito.tipo == .rango ? 104 : 76, height: 84)
                    .background(T.fill.opacity(0.4))
                    .overlay(alignment: .trailing) { Rectangle().fill(T.hair2).frame(width: 1) }
                } else {
                    Rectangle().fill(hito.tinta).frame(width: 3)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text(hito.tipo == .rango ? L.rangoNuevo :
                         hito.tipo == .grado ? L.gradoNuevo :
                         hito.tipo == .liga ? L.liga : L.resuelto)
                        .font(T.mono(10, .semibold)).tracking(10 * 0.16).textCase(.uppercase)
                        .foregroundStyle(hito.tinta)
                    Text(hito.titulo)
                        .font(hito.cuerpoTitulo)
                        .foregroundStyle(T.l1)
                        .fixedSize(horizontal: false, vertical: true)
                    if let c = hito.cuerpo, !c.isEmpty {
                        Text(c).font(T.s).lineSpacing(T.sLine).foregroundStyle(T.l3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let m = hito.meta {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(m.lbl).label()
                                Spacer()
                                Text(m.num).font(T.mono(10, .medium)).monospacedDigit().foregroundStyle(T.l1)
                            }
                            GeometryReader { g in
                                ZStack(alignment: .leading) {
                                    Rectangle().fill(T.fill)
                                    Rectangle().fill(hito.tinta)
                                        .frame(width: barra ? g.size.width * m.pct / 100 : 0)
                                }
                            }
                            .frame(height: 3)
                            .animation(Fx.quieto ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: 0.95).delay(0.22), value: barra)
                        }
                        .padding(.top, 2)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
        }
        .background(T.panel)
        .overlay(Rectangle().strokeBorder(hito.tinta, lineWidth: 1))
        .frame(maxWidth: 436)
        .onAppear {
            // en Reducir Movimiento la barra queda en su valor final: el dato no
            // puede depender de la animacion (decision 4 de unlock.ts)
            barra = true
            cuenta = true
            anillo = true
        }
    }
}
