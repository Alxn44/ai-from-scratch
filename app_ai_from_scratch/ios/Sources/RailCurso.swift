import SwiftUI

/// El rail del curso. En la web es una columna de 300 px siempre a la vista
/// (chat.astro, `.ch-rail`); en el movil no cabe una segunda columna, asi que es
/// una hoja que se abre desde la cabecera del tutor. El contenido es el mismo y
/// en el mismo orden: progreso, siguiente lab, atajos, sugerencias y el pie de
/// herramientas.
///
/// Los datos son los mismos endpoints que usa la web y NINGUNO se recalcula
/// aqui: `/api/lessons` da el avance y el siguiente lab, `/api/coach` da la
/// racha ya contada, y `/api/chat/estado` — que ya trae el chat cargado — da
/// cuantas herramientas hay.
struct RailCurso: View {
    let estado: ChatEstado
    /// Un atajo es un PROMPT: se cierra la hoja y se manda al tutor.
    let alPulsarAtajo: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var rumbo = Rumbo.compartido
    @State private var lecciones: [Lesson] = []
    @State private var racha = 0
    @State private var cargando = true

    private var hechos: Int { lecciones.reduce(0) { $0 + $1.solved } }
    private var todos: Int  { lecciones.reduce(0) { $0 + $1.total } }
    private var cerradas: Int { lecciones.filter { $0.total > 0 && $0.solved == $0.total }.count }
    private var pct: Int { todos > 0 ? Int((Double(hechos) / Double(todos) * 100).rounded()) : 0 }

    /// Primera leccion abierta con labs pendientes y, de ella, el primer lab sin
    /// resolver que NO sea borrador: un borrador la API lo rechaza, asi que
    /// ofrecerlo como «siguiente» manda a la persona contra una pared.
    private var siguiente: (Lesson, Lab)? {
        guard let l = lecciones.first(where: { !$0.locked && $0.solved < $0.total }),
              let lab = l.labs.first(where: { !$0.solved && !$0.draft })
        else { return nil }
        return (l, lab)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if cargando && lecciones.isEmpty {
                        ProgressView().tint(T.l3).frame(maxWidth: .infinity).padding(.vertical, 40)
                    } else {
                        progreso
                        siguienteLab
                        atajos
                        sugerencias
                        alcance
                        Text(rellena(L.railPie, ["n": estado.herramientas.count]))
                            .font(T.mono(10.5, .medium)).tracking(10.5 * 0.06).textCase(.uppercase)
                            .foregroundStyle(T.l3)
                            .lineSpacing(10.5 * 0.6)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(18)
                .padding(.bottom, 30)
            }
            .background(T.bg)
            .navigationTitle(L.elRail)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(T.bg, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L.cerrar) { dismiss() }.tint(T.ac)
                }
            }
        }
        .task {
            do {
                async let ls = API.shared.lessons()
                async let r = API.shared.racha()
                lecciones = try await ls
                racha = (try? await r) ?? 0
            } catch { /* sin lista no hay rail; el chat sigue funcionando */ }
            cargando = false
        }
    }

    // MARK: progreso

    private var progreso: some View {
        VStack(alignment: .leading, spacing: 11) {
            Text(L.tuProgreso).label()
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(hechos)")
                    .font(.system(size: 30, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(T.l1)
                Text(rellena(L.deLabs, ["n": todos]))
                    .font(.system(size: 13)).foregroundStyle(T.l2)
                Spacer(minLength: 8)
                Text(rachaTexto)
                    .font(T.mono(10.5, .semibold)).tracking(10.5 * 0.1).textCase(.uppercase)
                    .foregroundStyle(T.ac)
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Rectangle().fill(T.fill)
                    Rectangle().fill(T.ac)
                        .frame(width: g.size.width * (todos > 0 ? Double(hechos) / Double(todos) : 0))
                }
            }
            .frame(height: 3)
            HStack {
                Text(rellena(L.leccionDe, ["n": min(cerradas + 1, max(lecciones.count, 1)),
                                           "m": max(lecciones.count, 1)]))
                Spacer()
                Text("\(pct)%")
            }
            .font(T.mono(10.5, .medium)).tracking(10.5 * 0.08).textCase(.uppercase)
            .foregroundStyle(T.l3)
        }
    }

    private var rachaTexto: String {
        switch racha {
        case 0:  return L.rachaCero
        case 1:  return L.rachaUno
        default: return rellena(L.racha, ["n": racha])
        }
    }

    // MARK: siguiente lab

    @ViewBuilder private var siguienteLab: some View {
        VStack(alignment: .leading, spacing: 11) {
            if let (lec, lab) = siguiente {
                Text(L.siguienteLab).label()
                VStack(alignment: .leading, spacing: 9) {
                    Text("\(lec.n).\(lab.idx) · \(lec.title)")
                        .font(.system(size: 15, weight: .semibold)).lineSpacing(15 * 0.35)
                        .foregroundStyle(T.l1)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Flujo(hgap: 7, vgap: 7) {
                        Etiqueta(texto: nivelNombre(lab.level), color: nivelColor(lab.level))
                        if let k = lab.kind, !k.isEmpty { Etiqueta(texto: k, color: T.l2) }
                    }
                    Button {
                        dismiss()
                        rumbo.abrir(leccion: lec.n)
                    } label: {
                        Text(L.empezarLab)
                            .font(T.btn).tracking(T.btnTrack).textCase(.uppercase)
                            .foregroundStyle(T.onAc)
                            .frame(maxWidth: .infinity, minHeight: 38)
                            .background(T.acSolid)
                            .clipShape(RoundedRectangle(cornerRadius: T.radius))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16).padding(.vertical, 15)
                .background(T.panel)
                .overlay(Rectangle().strokeBorder(T.hair2, lineWidth: 1))
            } else {
                Text(L.cursoHecho).label()
                Text(L.cursoHechoB)
                    .font(.system(size: 13)).lineSpacing(13 * 0.5).foregroundStyle(T.l2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: atajos y sugerencias

    private var atajos: some View {
        VStack(alignment: .leading, spacing: 11) {
            Text(L.atajosCurso).label()
            VStack(spacing: 1) {
                ForEach([L.aLeccion, L.aSiguiente, L.aProgreso, L.aLogros,
                         L.aRanking, L.aTutorial, L.aPagar, L.aAyuda], id: \.self) { a in
                    Button { alPulsarAtajo(a) } label: {
                        HStack(spacing: 11) {
                            Rectangle().strokeBorder(T.hair, lineWidth: 1).frame(width: 14, height: 14)
                            Text(a).font(.system(size: 13.5)).foregroundStyle(T.l2)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 12)
                        .frame(minHeight: T.tap)
                        .background(T.panel)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var sugerencias: some View {
        VStack(alignment: .leading, spacing: 11) {
            Text(L.preguntaEsto).label()
            Flujo(hgap: 8, vgap: 8) {
                ForEach([L.sugFallo, L.sugSimple, L.sugPrueba], id: \.self) { s in
                    Pastilla(titulo: s) { alPulsarAtajo(s) }
                }
            }
        }
    }

    private var alcance: some View {
        VStack(alignment: .leading, spacing: 11) {
            Text(L.soloTuyo).label()
            Text(L.soloTuyoB)
                .font(.system(size: 13)).lineSpacing(13 * 0.5).foregroundStyle(T.l2)
                .fixedSize(horizontal: false, vertical: true)
            if !estado.disponible {
                Text(L.chatSinIa)
                    .font(.system(size: 13)).lineSpacing(13 * 0.5).foregroundStyle(T.or)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 16).padding(.vertical, 14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(T.panel)
                    .overlay(alignment: .leading) { Rectangle().fill(T.or).frame(width: 2) }
            }
        }
    }
}
