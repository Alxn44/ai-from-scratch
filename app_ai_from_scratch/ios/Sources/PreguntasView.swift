import SwiftUI

/// Una pregunta de opcion multiple, la pieza que comparten el quiz de leccion y
/// el examen. La respuesta que viaja es el ID de la opcion, no su texto:
/// `publicQuestion` (api/src/assess.ts:33) publica `{id, text}` y el corrector
/// compara contra `solution.value` con `String()`.
///
/// Una vez acertada NO se puede volver a responder: el servidor guarda el mejor
/// intento y dejar reintentar una acertada solo sirve para inflar el contador.
struct PreguntaView: View {
    let pregunta: Pregunta
    let numero: Int
    let alResponder: (RespuestaPregunta) -> Void

    @Environment(Idioma.self) private var idioma
    @State private var elegida: String?
    @State private var resultado: RespuestaPregunta?
    @State private var enviando = false
    @State private var error: String?

    private var cerrada: Bool { pregunta.solved || resultado?.correct == true }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(rellena(L.quizPregunta, ["n": numero])).label()
                Spacer()
                if cerrada {
                    Text(L.correcto)
                        .font(T.mono(10, .medium)).tracking(10 * 0.12).textCase(.uppercase)
                        .foregroundStyle(T.ok)
                }
            }

            Text(pregunta.prompt)
                .font(T.h3).tracking(T.h3Track)
                .foregroundStyle(T.l1)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 8) {
                ForEach(pregunta.options) { o in
                    Button {
                        guard !cerrada, !enviando else { return }
                        elegida = o.id
                        responder(o.id)
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Text(o.text)
                                .font(.system(size: 15)).lineSpacing(15 * 0.4)
                                .foregroundStyle(color(o.id))
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                            if elegida == o.id, let r = resultado {
                                Image(systemName: r.correct ? "checkmark" : "xmark")
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(r.correct ? T.ok : T.rd)
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 12)
                        .frame(maxWidth: .infinity, minHeight: T.tap, alignment: .leading)
                        .background(elegida == o.id ? T.fill.opacity(0.5) : Color.clear)
                        .overlay(RoundedRectangle(cornerRadius: T.radius)
                            .strokeBorder(borde(o.id), lineWidth: 1))
                        .contentShape(Rectangle())
                    }
                    .disabled(cerrada || enviando)
                }
            }

            if enviando {
                ProgressView().controlSize(.small).tint(T.l3)
            }

            if let r = resultado, !r.explanation.isEmpty {
                Text(r.explanation)
                    .font(.system(size: 15)).lineSpacing(15 * 0.4)
                    .foregroundStyle(T.l2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
            if let error { Aviso(texto: error) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(T.panel)
        .overlay(Rectangle().strokeBorder(T.hair2, lineWidth: 1))
    }

    private func color(_ id: String) -> Color {
        guard elegida == id, let r = resultado else { return T.l2 }
        return r.correct ? T.ok : T.rd
    }

    private func borde(_ id: String) -> Color {
        guard elegida == id else { return T.hair }
        guard let r = resultado else { return T.ac }
        return r.correct ? T.ok : T.rd
    }

    private func responder(_ opcion: String) {
        enviando = true
        error = nil
        Task {
            do {
                let r = try await API.shared.responder(preguntaId: pregunta.id,
                                                       opcion: opcion, lang: idioma.efectivo)
                resultado = r
                alResponder(r)
                if r.correct { Sonido.sonar(.lab, paso: max(1, min(12, pregunta.lesson))) }
                else { Sonido.sonar(.fallo) }
            } catch let f as APIFailure {
                error = f.errorDescription
            } catch let otro {
                error = otro.localizedDescription
            }
            enviando = false
        }
    }
}

/// El quiz de la leccion. Tres preguntas que NO bloquean los labs: la propia
/// web lo dice en su subtitulo, y por eso vive debajo de los labs y no encima.
struct QuizSeccion: View {
    let preguntas: [Pregunta]
    @State var puntaje: Puntaje?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(L.quizTitulo).label()
                Spacer()
                if let p = puntaje {
                    Text(rellena(L.deSeis, ["a": p.correct, "b": p.total]))
                        .font(T.mono(10, .medium)).tracking(T.lblTrack)
                        .monospacedDigit()
                        .foregroundStyle(p.passed ? T.ok : T.l1)
                }
            }
            Text(L.quizSub)
                .font(T.s).lineSpacing(T.sLine).foregroundStyle(T.l3)
                .fixedSize(horizontal: false, vertical: true)

            ForEach(Array(preguntas.enumerated()), id: \.element.id) { i, q in
                PreguntaView(pregunta: q, numero: i + 1) { r in puntaje = r.score }
            }
        }
    }
}

// MARK: - Examenes

/// Los examenes: tres bloques de seis preguntas, se aprueba con cinco.
/// Espejo de web/src/pages/examen/, sobre GET /api/exams y /api/exams/:n.
struct ExamenesView: View {
    @Environment(Sesion.self) private var sesion
    @State private var filas: [ExamenFila] = []
    @State private var cargando = true
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(L.examenes).label(T.l1)
                Text(L.examenSub)
                    .font(T.s).lineSpacing(T.sLine).foregroundStyle(T.l3)
                    .fixedSize(horizontal: false, vertical: true)

                if cargando && filas.isEmpty {
                    ProgressView().tint(T.l3).frame(maxWidth: .infinity).padding(.top, 40)
                }

                ForEach(filas) { f in
                    NavigationLink { ExamenView(n: f.n) } label: { fila(f) }
                        .buttonStyle(.plain)
                        .disabled(f.locked)
                }

                if let error { Aviso(texto: error) }
            }
            .padding(18)
            .padding(.bottom, 32)
        }
        .background(T.bg)
        .toolbarBackground(T.bg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await cargar() }
    }

    private func fila(_ f: ExamenFila) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(rellena(L.examenN, ["n": f.n]))
                    .font(T.h3).tracking(T.h3Track)
                    .foregroundStyle(f.locked ? T.l3 : T.l1)
                Text(rellena(L.examenRango, ["a": f.from, "b": f.to]))
                    .font(T.s).foregroundStyle(T.l3)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                if f.locked {
                    Text(L.dePago)
                        .font(T.mono(10, .medium)).tracking(10 * 0.12).textCase(.uppercase)
                        .foregroundStyle(T.or)
                } else {
                    Text(rellena(L.deSeis, ["a": f.correct, "b": f.total]))
                        .font(T.mono(13, .medium)).monospacedDigit()
                        .foregroundStyle(f.passed ? T.ok : T.l1)
                    Text(f.passed ? L.aprobado : rellena(L.apruebasCon, ["n": f.passAt]))
                        .font(T.mono(10, .medium)).tracking(10 * 0.12).textCase(.uppercase)
                        .foregroundStyle(f.passed ? T.ok : T.l3)
                }
            }
        }
        .padding(.vertical, 14)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) { Rectangle().fill(T.hair2).frame(height: 1) }
    }

    private func cargar() async {
        error = nil
        do { filas = try await API.shared.examenes() }
        catch APIFailure.sinSesion { await sesion.salir() }
        catch let f as APIFailure { error = f.errorDescription }
        catch let otro { error = otro.localizedDescription }
        cargando = false
    }
}

struct ExamenView: View {
    let n: Int

    @Environment(Sesion.self) private var sesion
    @Environment(Idioma.self) private var idioma
    @State private var detalle: ExamenDetalle?
    @State private var puntaje: Puntaje?
    @State private var cargando = true
    @State private var error: String?
    @State private var muro = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let d = detalle {
                    HStack {
                        Text(rellena(L.examenN, ["n": d.n])).label(T.l1)
                        Spacer()
                        let p = puntaje ?? d.score
                        Text(rellena(L.deSeis, ["a": p.correct, "b": p.total]))
                            .font(T.mono(13, .medium)).monospacedDigit()
                            .foregroundStyle(p.passed ? T.ok : T.l1)
                    }
                    Text(rellena(L.examenRango, ["a": d.from, "b": d.to]))
                        .font(T.s).foregroundStyle(T.l3)

                    ForEach(Array(d.questions.enumerated()), id: \.element.id) { i, q in
                        PreguntaView(pregunta: q, numero: i + 1) { r in puntaje = r.score }
                    }
                } else if muro {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(L.dePago).label(T.or)
                        Text(L.muroTitulo)
                            .font(T.h3).tracking(T.h3Track).foregroundStyle(T.l1)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(L.muroCuerpo)
                            .font(T.s).lineSpacing(T.sLine).foregroundStyle(T.l2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(Rectangle().strokeBorder(T.hair2, lineWidth: 1))
                } else if cargando {
                    ProgressView().tint(T.l3).frame(maxWidth: .infinity).padding(.top, 60)
                }
                if let error { Aviso(texto: error) }
            }
            .padding(18)
            .padding(.bottom, 32)
        }
        .background(T.bg)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(T.bg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task {
            do { detalle = try await API.shared.examen(n: n, lang: idioma.efectivo) }
            catch APIFailure.requierePago { muro = true }
            catch APIFailure.sinSesion { await sesion.salir() }
            catch let f as APIFailure { error = f.errorDescription }
            catch let otro { error = otro.localizedDescription }
            cargando = false
        }
    }
}
