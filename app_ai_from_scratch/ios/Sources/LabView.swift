import SwiftUI

// MARK: - Distribucion en flujo
//
// Chips de opciones y palabras del corte envuelven a la siguiente linea, como
// `flex-wrap` en la web. SwiftUI no trae un flow layout hasta iOS 26, y el
// objetivo es 17, asi que son ~30 lineas de Layout propias.
struct Flujo: Layout {
    var hgap: CGFloat = 10
    var vgap: CGFloat = 10

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let ancho = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, fila: CGFloat = 0
        for s in subviews {
            let t = s.sizeThatFits(.unspecified)
            if x > 0 && x + t.width > ancho { x = 0; y += fila + vgap; fila = 0 }
            x += t.width + hgap
            fila = max(fila, t.height)
        }
        return CGSize(width: ancho == .infinity ? max(0, x - hgap) : ancho, height: y + fila)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, fila: CGFloat = 0
        for s in subviews {
            let t = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + t.width > bounds.maxX { x = bounds.minX; y += fila + vgap; fila = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(t))
            x += t.width + hgap
            fila = max(fila, t.height)
        }
    }
}

// MARK: - El lab
//
// Las seis mecanicas y sus encodings estan COPIADOS de web/src/lib/labs-client.ts,
// que es el contrato vivo (grading.ts corrige en el servidor):
//   choice  → el texto de la opcion          cut  → ["indicePalabra-indiceCorte", …]
//   order   → [ids en orden de toque]        build→ {"0": texto, …} por ranura
//   knob    → numero 0–100                   hotcold → numero min–max
// grading.ts pasa todo por String() al comparar, asi que mandar strings es seguro
// incluso si el seed usara numeros como ids.
struct LabView: View {
    let lab: LabFull
    let alIntento: (AttemptResult) -> Void

    @Environment(\.dismiss) private var cerrar

    @State private var answer: JSONValue?
    @State private var resultado: AttemptResult?
    @State private var error: String?
    @State private var enviando = false
    /// Reiniciar sube esto y el `.id()` recrea la mecanica con estado limpio.
    @State private var generacion = 0
    @State private var cerca: [IntentoCerca] = []   // historial de hotcold

    // El payload se interpreta UNA vez. Si se interpretara en `body`, las fichas
    // de `build` recibirian UUID nuevos en cada render y ForEach parpadearia.
    private let opciones: [String]
    private let palabras: [String]
    private let pasos: [Paso]
    private let ranuras: [String]
    private let fichas: [Ficha]
    private let cands: [Cand]
    private let hcMin: Double
    private let hcMax: Double

    init(lab: LabFull, alIntento: @escaping (AttemptResult) -> Void) {
        self.lab = lab
        self.alIntento = alIntento
        opciones = lab.payload["options"]?.strings ?? []
        palabras = lab.payload["words"]?.strings ?? []
        pasos = (lab.payload["steps"]?.arrayValue ?? []).compactMap { p in
            guard let id = Self.texto(p["id"]), let t = p["text"]?.stringValue else { return nil }
            return Paso(id: id, text: t)
        }
        ranuras = lab.payload["slots"]?.strings ?? []
        fichas = (lab.payload["tiles"]?.arrayValue ?? []).compactMap { f in
            guard let s = f["slot"]?.numberValue, let t = f["text"]?.stringValue else { return nil }
            return Ficha(slot: Int(s), text: t)
        }
        cands = (lab.payload["cands"]?.arrayValue ?? []).compactMap { c in
            guard let n = c["name"]?.stringValue, let l = c["logit"]?.numberValue else { return nil }
            return Cand(name: n, logit: l)
        }
        hcMin = lab.payload["min"]?.numberValue ?? 1
        hcMax = lab.payload["max"]?.numberValue ?? 100
    }

    /// Un id de paso puede venir como string o como numero; el servidor compara
    /// con String() asi que aqui tambien se aplana a texto.
    private static func texto(_ v: JSONValue?) -> String? {
        if let s = v?.stringValue { return s }
        if let n = v?.numberValue {
            return n == n.rounded() ? String(Int(n)) : String(n)
        }
        return nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 10) {
                        Text("Lab \(lab.id)").eyebrow()
                        if let n = lab.level, !n.isEmpty { Text(n).label() }
                        Spacer()
                        if lab.solved {
                            Text("Resuelto")
                                .font(T.mono(10, .medium)).tracking(10 * 0.12).textCase(.uppercase)
                                .foregroundStyle(T.ok)
                        }
                    }

                    Text(lab.prompt)
                        .font(T.h3).tracking(T.h3Track)
                        .foregroundStyle(T.l1)
                        .fixedSize(horizontal: false, vertical: true)

                    mecanica.id(generacion)

                    if lab.kind == "hotcold" && !cerca.isEmpty { historial }

                    if let r = resultado, lab.kind != "hotcold" || r.correct { banner(r) }
                    if let error { Aviso(texto: error) }
                }
                .padding(18)
                .padding(.bottom, 8)
            }
            .background(T.bg)
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cerrar") { cerrar() }
                        .font(T.lbl).tracking(T.lblTrack).textCase(.uppercase)
                        .foregroundStyle(T.l3)
                        .frame(minWidth: T.tap, minHeight: T.tap, alignment: .trailing)
                }
            }
            .toolbarBackground(T.bg, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .safeAreaInset(edge: .bottom) { pie }
            .onChange(of: answer) { resultado = nil }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: mecanica por kind

    @ViewBuilder private var mecanica: some View {
        switch lab.kind {
        case "choice":  EligeView(opciones: opciones) { answer = $0 }
        case "cut":     CortaView(palabras: palabras) { answer = $0 }
        case "order":   OrdenaView(pasos: pasos) { answer = $0 }
        case "build":   ArmaView(ranuras: ranuras, fichas: fichas) { answer = $0 }
        case "knob":    PerillaView(cands: cands) { answer = $0 }
        case "hotcold": FrioCalienteView(minimo: hcMin, maximo: hcMax) { answer = $0 }
        default:
            // Un kind que esta app no conoce: decirlo es mejor que un hueco.
            Aviso(texto: "Este tipo de lab aún no se puede hacer en la app. Está disponible en la web.")
        }
    }

    // MARK: pie de acciones

    /// `Comprobar` + `Reiniciar`, como [data-check] y [data-reset] de la web.
    /// La web solo registra reset en cut/order/build/knob; choice y hotcold no
    /// tienen nada que reiniciar, asi que aqui el boton ni aparece.
    private var pie: some View {
        HStack(spacing: 10) {
            if ["cut", "order", "build", "knob"].contains(lab.kind) {
                Button {
                    generacion += 1
                    answer = nil
                    resultado = nil
                } label: {
                    Text("Reiniciar")
                        .font(T.btn).tracking(T.btnTrack).textCase(.uppercase)
                        .foregroundStyle(T.l2)
                        .frame(minWidth: 110, minHeight: T.tap)
                        .overlay(RoundedRectangle(cornerRadius: T.radius).strokeBorder(T.hair, lineWidth: 1))
                }
            }
            BotonPrimario(
                titulo: lab.kind == "hotcold" ? "Probar" : "Comprobar",
                cargando: enviando,
                habilitado: answer != nil,
                accion: enviar
            )
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .background(T.bg.opacity(0.94))
    }

    private func enviar() {
        guard let answer else { return }
        enviando = true
        error = nil
        Task {
            do {
                let r = try await API.shared.attempt(labId: lab.id, answer: answer)
                if lab.kind == "hotcold", let h = r.hint, let e = h.err, let w = h.word,
                   case .number(let g) = answer {
                    cerca.append(IntentoCerca(n: Int(g), err: Int(e), word: w))
                }
                resultado = r
                alIntento(r)
            } catch let f as APIFailure {
                error = f.errorDescription
            } catch let otro {
                error = otro.localizedDescription
            }
            enviando = false
        }
    }

    // MARK: resultado

    /// El mismo copy que la web: `correcto`/`todaviaNo`/`errDe`/`rangoRep` de
    /// web/src/lib/i18n.ts. La explicacion viene del servidor y se enseña en
    /// acierto Y en fallo, igual que alli.
    private func banner(_ r: AttemptResult) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(r.correct ? "Correcto" : "Todavía no")
                .font(T.h3).tracking(T.h3Track)
                .foregroundStyle(r.correct ? T.ok : T.rd)
            Text(r.explanation + extra(r))
                .font(.system(size: 15)).lineSpacing(15 * 0.4)
                .foregroundStyle(T.l2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) { Rectangle().fill(T.hair2).frame(height: 1) }
    }

    private func extra(_ r: AttemptResult) -> String {
        guard let h = r.hint else { return "" }
        if let e = h.err, let w = h.word { return " Tu error fue de \(Int(e)) (\(w))." }
        if let rango = h.range, rango.count == 2, let a = rango[0], let b = rango[1] {
            return " El rango que cuenta como repetible es \(Int(a))–\(Int(b))."
        }
        return ""
    }

    /// «Tus intentos · error» de hotcold, con los mismos umbrales de color que
    /// la web: 0 exacto, ≤5 caliente, ≤20 tibio, resto frio.
    private var historial: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Tus intentos · error").label()
            ForEach(Array(cerca.enumerated()), id: \.offset) { i, x in
                HStack(spacing: 12) {
                    Text("\(i + 1)").font(T.mono(13)).monospacedDigit().foregroundStyle(T.l3)
                        .frame(width: 30, alignment: .leading)
                    Text("\(x.n)").font(T.mono(15)).monospacedDigit().foregroundStyle(T.l1)
                        .frame(width: 44, alignment: .leading)
                    Text(x.word).font(T.s).foregroundStyle(color(x.err))
                    Spacer()
                    Text("\(x.err)").font(T.mono(15, .semibold)).monospacedDigit().foregroundStyle(color(x.err))
                }
                .padding(.bottom, 7)
                .overlay(alignment: .bottom) { Rectangle().fill(T.hair2).frame(height: 1) }
            }
        }
    }

    private func color(_ err: Int) -> Color {
        err == 0 ? T.ok : err <= 5 ? T.or : err <= 20 ? T.l2 : T.ac
    }
}

// MARK: - Piezas de datos

private struct Paso: Identifiable, Equatable { let id: String; let text: String }
private struct Ficha: Identifiable, Equatable { let id = UUID(); let slot: Int; let text: String }
private struct Cand: Identifiable, Equatable { var id: String { name }; let name: String; let logit: Double }
struct IntentoCerca: Equatable { let n: Int; let err: Int; let word: String }

// MARK: - choice

private struct EligeView: View {
    let opciones: [String]
    let onCambia: (JSONValue?) -> Void
    @State private var sel: String?

    var body: some View {
        Flujo(hgap: 10, vgap: 10) {
            ForEach(opciones, id: \.self) { o in
                Button {
                    sel = o
                    onCambia(.string(o))
                } label: {
                    Text(o)
                        .font(.system(size: 15))
                        .foregroundStyle(sel == o ? T.l1 : T.l2)
                        .padding(.horizontal, 16)
                        .frame(minWidth: 78, minHeight: T.tap)
                        .background(sel == o ? T.ac.opacity(0.18) : T.fill.opacity(0.5))
                        .overlay(RoundedRectangle(cornerRadius: T.radius)
                            .strokeBorder(sel == o ? T.ac : T.hair, lineWidth: 1))
                }
            }
        }
    }
}

// MARK: - cut

/// Cada palabra es una fila de letras con un hueco tocable entre cada dos; el
/// hueco activo pinta la barra en azul. La clave es `"palabra-indice"`, igual
/// que en la web. El hueco mide 44 de alto: es un objetivo tactil, no un adorno.
private struct CortaView: View {
    let palabras: [String]
    let onCambia: (JSONValue?) -> Void
    @State private var cortes: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Flujo(hgap: 34, vgap: 14) {
                ForEach(Array(palabras.enumerated()), id: \.offset) { wi, palabra in
                    HStack(spacing: 0) {
                        let letras = Array(palabra)
                        ForEach(letras.indices, id: \.self) { i in
                            Text(String(letras[i]))
                                .font(T.mono(26, .medium))
                                .foregroundStyle(T.l1)
                                .padding(.vertical, 6)
                                .padding(.horizontal, 1)
                            if i < letras.count - 1 {
                                let clave = "\(wi)-\(i)"
                                Button {
                                    if cortes.contains(clave) { cortes.remove(clave) } else { cortes.insert(clave) }
                                    onCambia(.array(cortes.sorted().map { .string($0) }))
                                } label: {
                                    Rectangle()
                                        .fill(cortes.contains(clave) ? T.ac : T.hair)
                                        .frame(width: 2, height: 30)
                                        .frame(width: 16, height: T.tap)
                                        .contentShape(Rectangle())
                                }
                            }
                        }
                    }
                }
            }
            Text("\(cortes.count) cortes puestos")
                .font(T.s).foregroundStyle(T.l3).monospacedDigit()
        }
    }
}

// MARK: - order

private struct OrdenaView: View {
    let pasos: [Paso]
    let onCambia: (JSONValue?) -> Void
    @State private var seq: [String] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 9) {
                Text("Pasos disponibles").label()
                ForEach(pasos.filter { !seq.contains($0.id) }) { p in
                    Button {
                        seq.append(p.id)
                        onCambia(.array(seq.map { .string($0) }))
                    } label: {
                        Text(p.text)
                            .font(.system(size: 15)).lineSpacing(15 * 0.4)
                            .foregroundStyle(T.l1)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .overlay(RoundedRectangle(cornerRadius: T.radius).strokeBorder(T.hair, lineWidth: 1))
                            .contentShape(Rectangle())
                    }
                }
            }
            VStack(alignment: .leading, spacing: 9) {
                Text("Tu orden").label()
                if seq.isEmpty {
                    Text("Toca un paso para empezar.")
                        .font(T.s).foregroundStyle(T.l3)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .overlay(RoundedRectangle(cornerRadius: T.radius)
                            .strokeBorder(T.hair, style: StrokeStyle(lineWidth: 1, dash: [4])))
                }
                ForEach(Array(seq.enumerated()), id: \.element) { i, id in
                    if let p = pasos.first(where: { $0.id == id }) {
                        HStack(spacing: 12) {
                            Text("\(i + 1)").font(T.mono(13, .semibold)).monospacedDigit().foregroundStyle(T.ac)
                            Text(p.text).font(.system(size: 15)).lineSpacing(15 * 0.4).foregroundStyle(T.l1)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                        .background(T.fill.opacity(0.45))
                        .overlay(RoundedRectangle(cornerRadius: T.radius).strokeBorder(T.hair, lineWidth: 1))
                    }
                }
            }
        }
    }
}

// MARK: - build

private struct ArmaView: View {
    let ranuras: [String]
    let fichas: [Ficha]
    let onCambia: (JSONValue?) -> Void
    @State private var relleno: [String?]

    init(ranuras: [String], fichas: [Ficha], onCambia: @escaping (JSONValue?) -> Void) {
        self.ranuras = ranuras
        self.fichas = fichas
        self.onCambia = onCambia
        _relleno = State(initialValue: ranuras.map { _ in nil })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(ranuras.enumerated()), id: \.offset) { i, etiqueta in
                HStack(alignment: .center, spacing: 12) {
                    Text(etiqueta).label()
                        .frame(width: 92, alignment: .leading)
                    Text(relleno[i] ?? "vacío")
                        .font(.system(size: 15))
                        .foregroundStyle(relleno[i] == nil ? T.l3 : T.l1)
                        .frame(maxWidth: .infinity, minHeight: T.tap, alignment: .leading)
                        .padding(.horizontal, 14)
                        .background(T.fill.opacity(0.45))
                        .overlay(RoundedRectangle(cornerRadius: T.radius)
                            .strokeBorder(relleno[i] == nil ? T.hair : T.ac, lineWidth: 1))
                }
            }
            Flujo(hgap: 8, vgap: 8) {
                ForEach(fichas.filter { f in f.slot < relleno.count && relleno[f.slot] != f.text }) { f in
                    Button {
                        guard f.slot < relleno.count else { return }
                        relleno[f.slot] = f.text
                        // Como `{...filled}` en la web: TODAS las ranuras viajan,
                        // las vacias como null, y el servidor exige texto en todas.
                        var obj: [String: JSONValue] = [:]
                        for (i, v) in relleno.enumerated() {
                            obj[String(i)] = v.map { .string($0) } ?? .null
                        }
                        onCambia(.object(obj))
                    } label: {
                        Text(f.text)
                            .font(.system(size: 14))
                            .foregroundStyle(T.l2)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 40)
                            .overlay(RoundedRectangle(cornerRadius: T.radius).strokeBorder(T.hair, lineWidth: 1))
                    }
                }
            }
            .padding(.top, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .top) { Rectangle().fill(T.hair2).frame(height: 1) }
        }
    }
}

// MARK: - knob

/// La temperatura se SIENTE: el softmax corre en vivo mientras arrastras, con la
/// misma formula que la web (T = 0.12 + t/100·1.5). La respuesta que viaja es el
/// valor 0–100 del deslizador, no la T derivada.
private struct PerillaView: View {
    let cands: [Cand]
    let onCambia: (JSONValue?) -> Void
    @State private var t: Double = 20

    private var temperatura: Double { 0.12 + (t / 100) * 1.5 }

    private var probs: [Double] {
        let xs = cands.map { exp($0.logit / temperatura) }
        let s = xs.reduce(0, +)
        return s > 0 ? xs.map { $0 / s } : xs
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 16) {
                Text("FRÍA").font(T.mono(13, .semibold)).foregroundStyle(T.l3)
                Slider(value: $t, in: 0...100, step: 1)
                    .onChange(of: t) { onCambia(.number(t)) }
                Text("CREATIVA").font(T.mono(13, .semibold)).foregroundStyle(T.l3)
            }
            if let top = probs.indices.max(by: { probs[$0] < probs[$1] }) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("T = \(String(format: "%.2f", temperatura))")
                        .font(.system(size: 26, weight: .bold)).tracking(26 * -0.03)
                        .monospacedDigit().foregroundStyle(T.l1)
                    Text("gana \(cands[top].name) con \(Int((probs[top] * 100).rounded())) de 100")
                        .font(T.s).foregroundStyle(T.l3)
                }
                VStack(alignment: .leading, spacing: 9) {
                    ForEach(Array(cands.enumerated()), id: \.element.id) { i, c in
                        HStack(spacing: 12) {
                            Text(c.name).font(T.s).foregroundStyle(T.l2)
                                .frame(width: 108, alignment: .leading)
                            GeometryReader { g in
                                ZStack(alignment: .leading) {
                                    Rectangle().fill(T.fill.opacity(0.8))
                                    Rectangle().fill(i == top ? T.ac : T.l3)
                                        .frame(width: g.size.width * probs[i])
                                }
                            }
                            .frame(height: 10)
                            Text("\(Int((probs[i] * 100).rounded()))")
                                .font(T.s).monospacedDigit().foregroundStyle(T.l3)
                                .frame(width: 42, alignment: .trailing)
                        }
                    }
                }
            }
        }
        .onAppear { onCambia(.number(t)) }
    }
}

// MARK: - hotcold

private struct FrioCalienteView: View {
    let minimo: Double
    let maximo: Double
    let onCambia: (JSONValue?) -> Void
    @State private var g: Double

    init(minimo: Double, maximo: Double, onCambia: @escaping (JSONValue?) -> Void) {
        self.minimo = minimo
        self.maximo = maximo
        self.onCambia = onCambia
        // 50 como la web, pero dentro del rango real del payload.
        _g = State(initialValue: min(max(50, minimo), maximo))
    }

    var body: some View {
        HStack(spacing: 16) {
            Slider(value: $g, in: minimo...maximo, step: 1)
                .onChange(of: g) { onCambia(.number(g)) }
            Text("\(Int(g))")
                .font(.system(size: 26, weight: .bold)).tracking(26 * -0.03)
                .monospacedDigit().foregroundStyle(T.l1)
                .frame(width: 58, alignment: .trailing)
        }
        .onAppear { onCambia(.number(g)) }
    }
}
