import SwiftUI

/// El detalle pide `/api/lessons/:n` al aparecer: la lista solo trae el indice
/// (sin `prompt` ni `payload`), y un lab sin payload no se puede jugar. Este es
/// el motivo del rework: antes esta vista pintaba filas estaticas con lo que
/// traia la lista y los labs "no abrian" porque no habia nada que abrir.
struct LessonDetailView: View {
    let leccion: Lesson

    @Environment(Sesion.self) private var sesion
    @State private var detalle: LessonDetail?
    @State private var cargando = true
    @State private var error: String?
    @State private var pago = false
    @State private var labAbierto: LabFull?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                cabecera

                if let t = detalle?.texto { textos(t) }

                if let m = leccion.math, !m.isEmpty { tarjetaMatematica(m) }

                if leccion.locked || pago {
                    muro
                } else if let d = detalle {
                    labs(d.labs)
                } else if cargando {
                    ProgressView().tint(T.l3)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 30)
                }

                if let error {
                    Aviso(texto: error).padding(.top, 8)
                    Button("Reintentar") { Task { await cargar() } }
                        .font(T.btn).tracking(T.btnTrack).textCase(.uppercase)
                        .foregroundStyle(T.ac)
                        .frame(minHeight: T.tap)
                        .padding(.top, 4)
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
        .task { await cargar() }
        .sheet(item: $labAbierto) { lab in
            LabView(lab: lab) { r in registrar(lab.id, r) }
        }
    }

    // MARK: cabecera

    private var cabecera: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let e = leccion.eyebrow, !e.isEmpty {
                Text("\(String(format: "%02d", leccion.n)) · \(e)").eyebrow().padding(.bottom, 10)
            } else {
                Text(String(format: "%02d", leccion.n)).eyebrow().padding(.bottom, 10)
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
        }
    }

    /// El texto de la leccion: tecnico primero y la analogia debajo, los dos
    /// del contrato (`texto.technical` / `texto.analogy`).
    private func textos(_ t: LessonTexto) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            if let tec = t.technical, !tec.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Qué es").label()
                    Text(tec)
                        .font(T.p).lineSpacing(T.pLine)
                        .foregroundStyle(T.l2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if let ana = t.analogy, !ana.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("La analogía").label()
                    Text(ana)
                        .font(T.p).lineSpacing(T.pLine)
                        .foregroundStyle(T.l2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(.bottom, 26)
    }

    private func tarjetaMatematica(_ m: String) -> some View {
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
        .overlay(alignment: .leading) { Rectangle().fill(T.ac).frame(width: 2) }
        .padding(.bottom, 26)
    }

    // MARK: labs

    private func labs(_ lista: [LabFull]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Labs").label()
                Spacer()
                Text("\(lista.filter(\.solved).count)/\(lista.count)")
                    .font(T.mono(10, .medium)).tracking(T.lblTrack)
                    .monospacedDigit().foregroundStyle(T.l1)
            }
            .padding(.bottom, 12)

            ForEach(lista) { lab in
                Button {
                    if !lab.draft { labAbierto = lab }
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(String(format: "%d.%d", lab.lesson, lab.idx))
                            .font(T.mono(11, .medium)).monospacedDigit()
                            .foregroundStyle(T.l3)
                            .frame(width: 38, alignment: .leading)

                        VStack(alignment: .leading, spacing: 4) {
                            Text(lab.prompt)
                                .font(T.h3).tracking(T.h3Track)
                                .foregroundStyle(lab.draft ? T.l3 : T.l1)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                            HStack(spacing: 8) {
                                if let n = lab.level, !n.isEmpty { Text(n).label() }
                                if lab.attempts > 0 {
                                    Text("\(lab.attempts) intentos")
                                        .font(T.mono(10, .medium)).tracking(T.lblTrack)
                                        .textCase(.uppercase).monospacedDigit()
                                        .foregroundStyle(T.l3)
                                }
                            }
                        }

                        Spacer(minLength: 8)

                        Text(lab.draft ? "En preparación" : lab.solved ? "Resuelto" : "Pendiente")
                            .font(T.mono(10, .medium)).tracking(10 * 0.12).textCase(.uppercase)
                            .foregroundStyle(lab.draft ? T.l3 : lab.solved ? T.ok : T.l3)
                    }
                    .padding(.vertical, 12)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(lab.draft)
                .overlay(alignment: .bottom) { Rectangle().fill(T.hair2).frame(height: 1) }
            }
        }
    }

    /// El muro de pago. `LeccionCerrada.astro` en la web es un escaparate, no un
    /// callejon: aqui igual, dice QUE se compra y donde.
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

    // MARK: datos

    private func cargar() async {
        error = nil
        cargando = true
        do {
            detalle = try await API.shared.lessonDetail(n: leccion.n)
            #if DEBUG
            if let idx = QA.valor("IA_QA_LAB_IDX").flatMap({ Int($0) }),
               let lab = detalle?.labs.first(where: { $0.idx == idx }), !lab.draft {
                labAbierto = lab
            }
            #endif
        } catch APIFailure.requierePago {
            pago = true
        } catch APIFailure.sinSesion {
            await sesion.salir()
        } catch let f as APIFailure {
            error = f.errorDescription
        } catch let otro {
            error = otro.localizedDescription
        }
        cargando = false
    }

    /// Cada intento actualiza la fila: intentos siempre, resuelto si acerto.
    /// Sin esto la hoja dice «Correcto» y la lista sigue diciendo «Pendiente».
    private func registrar(_ labId: String, _ r: AttemptResult) {
        guard var d = detalle, let i = d.labs.firstIndex(where: { $0.id == labId }) else { return }
        d.labs[i].attempts += 1
        if r.correct { d.labs[i].solved = true }
        detalle = d
    }
}
