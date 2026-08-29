import SwiftUI

struct LessonDetailView: View {
    let leccion: Lesson

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {

                if let e = leccion.eyebrow, !e.isEmpty {
                    Text("\(String(format: "%02d", leccion.n)) · \(e)").eyebrow()
                        .padding(.bottom, 10)
                } else {
                    Text(String(format: "%02d", leccion.n)).eyebrow()
                        .padding(.bottom, 10)
                }

                Text(leccion.title)
                    .font(T.h1).tracking(T.h1Track)
                    .foregroundStyle(T.l1)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 14)

                if let s = leccion.summary, !s.isEmpty {
                    Text(s)
                        .font(T.p).lineSpacing(T.pLine)
                        .foregroundStyle(T.l2)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, 26)
                }

                // La tarjeta de matematicas. Regla del curso: numeros y
                // comparaciones, nunca formulas ni letras griegas.
                if let m = leccion.math, !m.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("La matemática").label()
                        Text(m)
                            .font(.system(size: 30, weight: .bold))
                            .tracking(30 * -0.03)
                            .monospacedDigit()
                            .foregroundStyle(T.l1)
                            .fixedSize(horizontal: false, vertical: true)
                        if let c = leccion.math_cap, !c.isEmpty {
                            Text(c)
                                .font(T.s).lineSpacing(T.sLine)
                                .foregroundStyle(T.l3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(T.panel)
                    .overlay(alignment: .leading) {
                        Rectangle().fill(T.ac).frame(width: 2)
                    }
                    .padding(.bottom, 26)
                }

                if leccion.locked {
                    muro
                } else if !leccion.labs.isEmpty {
                    labs
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 8)
            .padding(.bottom, 40)
        }
        .background(T.bg)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(T.bg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
    }

    /// El muro de pago.
    ///
    /// `LeccionCerrada.astro:29` es una de las roturas confirmadas del handoff:
    /// una rejilla `1fr 320px` de 344px dentro de 334 disponibles. Aqui no hay
    /// rejilla de dos columnas que romper -- apila -- y el aviso dice QUE se
    /// compra, no solo que esta cerrado. El comentario del handoff sobre esa
    /// pantalla es explicito: una leccion cerrada es un escaparate, no un
    /// callejon sin salida.
    private var muro: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("De pago").label(T.or)
            Text("Esta lección está en la parte de pago del curso.")
                .font(T.h3).tracking(T.h3Track)
                .foregroundStyle(T.l1)
                .fixedSize(horizontal: false, vertical: true)
            Text("La compra se hace en la web. Al volver aquí, la lección estará abierta.")
                .font(T.s).lineSpacing(T.sLine)
                .foregroundStyle(T.l2)
                .fixedSize(horizontal: false, vertical: true)
            Link(destination: URL(string: "https://aifromscratch.shop/pago")!) {
                Text("Ver el precio")
                    .font(T.btn).tracking(T.btnTrack).textCase(.uppercase)
                    .frame(maxWidth: .infinity, minHeight: T.tap)
                    .background(T.btnBg)
                    .foregroundStyle(T.btnFg)
                    .clipShape(RoundedRectangle(cornerRadius: T.radius))
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(Rectangle().strokeBorder(T.hair2, lineWidth: 1))
    }

    private var labs: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Labs").label()
                Spacer()
                Text("\(leccion.solved)/\(leccion.total)")
                    .font(T.mono(10, .medium)).tracking(T.lblTrack)
                    .monospacedDigit()
                    .foregroundStyle(T.l1)
            }
            .padding(.bottom, 12)

            ForEach(leccion.labs) { lab in
                // La cabecera del lab es la fila 1 de las dos que el handoff
                // marca como rotas en `m-leccion`: pastilla LAB + nivel contra
                // el estado, con `space-between` y texto largo. Aqui el titulo
                // puede envolver y el estado no se aplasta porque no compiten
                // por la misma linea a la fuerza.
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(String(format: "%d.%d", lab.lesson_n, lab.idx))
                        .font(T.mono(11, .medium))
                        .monospacedDigit()
                        .foregroundStyle(T.l3)
                        .frame(width: 38, alignment: .leading)

                    VStack(alignment: .leading, spacing: 4) {
                        Text(lab.kind ?? "Lab")
                            .font(T.h3).tracking(T.h3Track)
                            .foregroundStyle(T.l1)
                            .fixedSize(horizontal: false, vertical: true)
                        if let n = lab.level, !n.isEmpty {
                            Text(n).label()
                        }
                    }

                    Spacer(minLength: 8)

                    Text(lab.solved ? "Resuelto" : "Pendiente")
                        .font(T.mono(10, .medium)).tracking(10 * 0.12).textCase(.uppercase)
                        .foregroundStyle(lab.solved ? T.ok : T.l3)
                }
                .padding(.vertical, 12)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(T.hair2).frame(height: 1)
                }
            }
        }
    }
}
