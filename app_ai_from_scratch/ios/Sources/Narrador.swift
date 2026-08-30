import SwiftUI
import AVFoundation

/// El modo escuchar, portado de web/src/lib/narrator.ts.
///
/// Lo que se porta tal cual: el partidor de frases con su lista de abreviaturas
/// («según el art. 5» no corta), la tabla que traduce los simbolos del curso a
/// habla (→ a coma, ≈ a «aproximadamente»), las velocidades 0.8/1/1.25/1.5, las
/// pausas de 140/340 ms entre frase y bloque, las claves de preferencia
/// (curso.narra.vel / curso.narra.voz), que NUNCA arranca sola y que se para al
/// salir de la pantalla y se pausa al irse la app al fondo.
///
/// Lo que aqui es distinto A PROPOSITO: la web sigue la palabra con un reloj
/// estimado (cps autocalibrado, techo 0.92) porque el evento `boundary` no
/// dispara en Firefox. AVSpeechSynthesizer si tiene un evento fiable
/// (willSpeakRangeOfSpeechString, palabra a palabra, en local), asi que el
/// barrido va anclado al motor real y toda la maquinaria del reloj sobra. Es el
/// mismo objetivo con la primitiva honesta de la plataforma.
@Observable
final class Narrador: NSObject, AVSpeechSynthesizerDelegate {

    // MARK: troceado — el mismo de narrator.ts

    /// Abreviaturas con punto que no terminan frase. Lista, no heuristica.
    private static let ABREV: Set<String> = ["art", "núm", "num", "no", "pág", "pag", "fig", "etc", "ej",
                                             "p", "pp", "cap", "vol", "sr", "sra", "dr", "dra", "aprox",
                                             "vs", "ss", "ed", "trad"]

    static func frases(_ t: String) -> [String] {
        let cierra: Set<Character> = [".", "!", "?", "…", ";"]
        let abre: Set<Character> = ["¿", "¡", "«", "\"", "(", "'"]
        let chars = Array(t)
        var out: [String] = []
        var ini = 0
        var i = 0
        while i < chars.count {
            if !cierra.contains(chars[i]) { i += 1; continue }
            var j = i
            while j + 1 < chars.count && cierra.contains(chars[j + 1]) { j += 1 }
            let sig: Character? = j + 1 < chars.count ? chars[j + 1] : nil
            if sig != " " && sig != "\n" && sig != nil { i = j + 1; continue }
            let luego: Character? = j + 2 < chars.count ? chars[j + 2] : nil
            // la palabra antes del punto decide si es abreviatura
            let antes = String(chars[ini..<j].reversed().prefix(while: { $0.isLetter }).reversed()).lowercased()
            if chars[j] == "." && Self.ABREV.contains(antes) { i = j + 1; continue }
            let cortaAqui: Bool = {
                guard let l = luego else { return true }
                return abre.contains(l) || (l.isUppercase && l.isLetter) || l.isNumber
            }()
            if !cortaAqui { i = j + 1; continue }
            let trozo = String(chars[ini...j]).trimmingCharacters(in: .whitespacesAndNewlines)
            if !trozo.isEmpty { out.append(trozo) }
            ini = j + 1
            i = j + 1
        }
        let resto = String(chars[ini...].prefix(chars.count)).trimmingCharacters(in: .whitespacesAndNewlines)
        if !resto.isEmpty { out.append(resto) }
        // frases de una o dos letras son basura de puntuacion: a la anterior
        return out.reduce(into: [String]()) { a, f in
            if f.count <= 2 && !a.isEmpty { a[a.count - 1] += " " + f } else { a.append(f) }
        }
    }

    /// Los simbolos del curso, traducidos al habla. La flecha va a COMA: el
    /// texto real dice «bigotes → entonces gato» y con «entonces» salia
    /// «entonces entonces» (medido en la web, misma tabla).
    static func paraVoz(_ t: String) -> String {
        var s = t
        for (patron, x) in [("→", ", "), ("≈", " aproximadamente "), ("≠", " no es lo mismo que "),
                            ("=", " igual a "), ("∞", " infinitas "), ("·", ", "), ("+", " más "),
                            ("«", ""), ("»", "")] {
            s = s.replacingOccurrences(of: patron, with: x)
        }
        return s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    // MARK: datos

    struct Trozo: Identifiable, Equatable {
        let id: Int
        let bloque: Int      // indice del bloque visible: manda la pausa larga y el autoscroll
        let frase: Int       // indice de frase dentro del bloque
        let visible: String  // lo que se muestra
        let texto: String    // lo que se habla
    }

    private(set) var trozos: [Trozo] = []
    private(set) var frasesPorBloque: [[String]] = []

    // MARK: estado observable

    enum Estado: Equatable { case parado, preparando, leyendo, pausado }
    private(set) var estado: Estado = .parado
    private(set) var i = 0
    /// Fraccion hablada del trozo activo (0–1), del evento de palabra del motor.
    private(set) var fraccion: Double = 0

    var lang = "es"

    // MARK: preferencias — mismas claves que la web

    static let CLAVE_VEL = "curso.narra.vel"
    static let CLAVE_VOZ = "curso.narra.voz"
    static let VELS: [Double] = [0.8, 1, 1.25, 1.5]

    var vel: Double = {
        let v = UserDefaults.standard.double(forKey: Narrador.CLAVE_VEL)
        return Narrador.VELS.contains(v) ? v : 1
    }()

    private(set) var voces: [AVSpeechSynthesisVoice] = []
    private(set) var voz: AVSpeechSynthesisVoice?

    /// El espiritu de puntua() de la web con los datos que iOS si declara:
    /// calidad real (premium/enhanced) en vez de adivinar por nombre, y las
    /// «Compact» penalizadas — son la version mala de la buena, alli y aqui.
    private static func puntua(_ v: AVSpeechSynthesisVoice) -> Int {
        var p = 0
        switch v.quality {
        case .premium:  p += 20
        case .enhanced: p += 10
        default: break
        }
        if v.identifier.lowercased().contains("siri") { p += 8 }
        if v.identifier.lowercased().contains("compact") { p -= 25 }
        return p
    }

    private func pillaVoces() {
        let pref = lang.lowercased()
        voces = AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.lowercased().hasPrefix(pref) }
            .sorted { (Self.puntua($0), $1.name) > (Self.puntua($1), $0.name) }
        let guardada = UserDefaults.standard.string(forKey: Self.CLAVE_VOZ)
        voz = voces.first { $0.identifier == guardada } ?? voces.first
    }

    // MARK: motor

    private let synth = AVSpeechSynthesizer()
    /// Un didFinish viejo puede llegar tras un cancel y arrancaria una segunda
    /// cadena encima de la primera (la web midio 46 frases habladas en una
    /// leccion de 24 sin esta guarda). Cada arranque sube gen.
    private var gen = 0

    override init() {
        super.init()
        synth.delegate = self
    }

    /// Carga los bloques visibles (titulo, resumen, texto…) y arma los trozos.
    func cargar(bloques: [String], lang: String) {
        self.lang = lang
        parar()
        var ts: [Trozo] = []
        var porBloque: [[String]] = []
        for (b, textoBloque) in bloques.enumerated() {
            let fs = Self.frases(textoBloque.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression))
            porBloque.append(fs)
            for (k, f) in fs.enumerated() {
                ts.append(Trozo(id: ts.count, bloque: b, frase: k, visible: f, texto: Self.paraVoz(f)))
            }
        }
        trozos = ts
        frasesPorBloque = porBloque
        pillaVoces()
    }

    var hayVoz: Bool { voz != nil }

    func alterna() {
        switch estado {
        case .parado:              arranca()
        case .leyendo, .preparando: pausa()
        case .pausado:             sigue()
        }
    }

    func arranca() {
        guard hayVoz, !trozos.isEmpty else { return }
        gen += 1
        synth.stopSpeaking(at: .immediate)
        // .spokenAudio agacha la musica del alumno mientras lee y la suelta al
        // parar; la narracion es contenido, no un pitido de interfaz.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio,
                                                         options: [.duckOthers])
        estado = .preparando
        if i >= trozos.count { i = 0 }
        di(i)
    }

    func pausa() {
        guard estado == .leyendo || estado == .preparando else { return }
        estado = .pausado
        synth.pauseSpeaking(at: .word)
    }

    func sigue() {
        guard estado == .pausado else { return }
        if synth.isPaused {
            estado = .leyendo
            synth.continueSpeaking()
        } else {
            estado = .preparando
            di(i)
        }
    }

    func parar() {
        gen += 1
        estado = .parado
        i = 0
        fraccion = 0
        synth.stopSpeaking(at: .immediate)
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
    }

    func cicloVelocidad() {
        let k = (Self.VELS.firstIndex(of: vel) ?? 1) + 1
        vel = Self.VELS[k % Self.VELS.count]
        UserDefaults.standard.set(vel, forKey: Self.CLAVE_VEL)
        // se oye el cambio en el sitio, sin volver a empezar la leccion
        if estado == .leyendo || estado == .preparando {
            gen += 1
            synth.stopSpeaking(at: .immediate)
            estado = .preparando
            di(i)
        }
    }

    func elegirVoz(_ v: AVSpeechSynthesisVoice) {
        voz = v
        UserDefaults.standard.set(v.identifier, forKey: Self.CLAVE_VOZ)
        if estado == .leyendo || estado == .preparando {
            gen += 1
            synth.stopSpeaking(at: .immediate)
            estado = .preparando
            di(i)
        }
    }

    private func di(_ k: Int) {
        guard k < trozos.count else { parar(); return }
        i = k
        fraccion = 0
        let u = AVSpeechUtterance(string: trozos[k].texto)
        u.voice = voz
        // El rate de AVSpeech va 0–1 con 0.5 de normal: el multiplicador de la
        // web se aplica sobre ese centro.
        u.rate = Float(min(Double(AVSpeechUtteranceMaximumSpeechRate),
                           Double(AVSpeechUtteranceDefaultSpeechRate) * vel))
        // respirar entre frases; mas al cambiar de bloque, que es cambiar de idea
        let cambia = k + 1 < trozos.count && trozos[k + 1].bloque != trozos[k].bloque
        u.postUtteranceDelay = cambia ? 0.34 : 0.14
        synth.speak(u)
    }

    // MARK: delegado — los eventos que a la web le faltan

    func speechSynthesizer(_ s: AVSpeechSynthesizer, didStart u: AVSpeechUtterance) {
        if estado == .preparando { estado = .leyendo }
    }

    func speechSynthesizer(_ s: AVSpeechSynthesizer, willSpeakRangeOfSpeechString r: NSRange,
                           utterance u: AVSpeechUtterance) {
        let total = max(1, (u.speechString as NSString).length)
        fraccion = Double(r.location + r.length) / Double(total)
    }

    func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) {
        let mia = gen
        guard estado == .leyendo, mia == gen else { return }
        fraccion = 1
        if i + 1 < trozos.count { di(i + 1) } else { parar() }
    }

    func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel u: AVSpeechUtterance) { }
}

// MARK: - La barra

/// La barra de abajo de narrator.ts: Escuchar/Pausa/Seguir, Parar, velocidad,
/// voz y «frase i de n», con la luz de tres barras que dice que ESTA leyendo
/// (sin ella, la latencia de arranque del motor se lee como que no funciona).
struct BarraNarrador: View {
    @Bindable var narrador: Narrador

    var body: some View {
        HStack(spacing: 10) {
            luz

            Button(action: { narrador.alterna() }) {
                Text(etiquetaPrincipal)
                    .font(T.btn).tracking(T.btnTrack).textCase(.uppercase)
                    .foregroundStyle(T.btnFg)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 34)
                    .background(T.btnBg.opacity(narrador.hayVoz ? 1 : 0.3))
                    .clipShape(RoundedRectangle(cornerRadius: T.radius))
            }
            .disabled(!narrador.hayVoz)

            if narrador.estado != .parado {
                Button(action: { narrador.parar() }) {
                    Text(L.parar)
                        .font(T.btn).tracking(T.btnTrack).textCase(.uppercase)
                        .foregroundStyle(T.l2)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 34)
                        .overlay(RoundedRectangle(cornerRadius: T.radius).strokeBorder(T.hair, lineWidth: 1))
                }
            }

            Button(action: { narrador.cicloVelocidad() }) {
                Text("\(narrador.vel == 1 ? "1" : String(narrador.vel))×")
                    .font(T.mono(11, .semibold)).monospacedDigit()
                    .foregroundStyle(T.l2)
                    .padding(.horizontal, 10)
                    .frame(minHeight: 34)
                    .overlay(RoundedRectangle(cornerRadius: T.radius).strokeBorder(T.hair, lineWidth: 1))
            }

            if narrador.voces.count > 1 {
                Menu {
                    ForEach(narrador.voces, id: \.identifier) { v in
                        Button {
                            narrador.elegirVoz(v)
                        } label: {
                            // el nombre va completo: recortarlo dejaba dos voces
                            // indistinguibles en la web
                            if v.identifier == narrador.voz?.identifier {
                                Label(v.name, systemImage: "checkmark")
                            } else {
                                Text(v.name)
                            }
                        }
                    }
                } label: {
                    Image(systemName: "person.wave.2")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(T.l2)
                        .frame(width: 34, height: 34)
                        .overlay(RoundedRectangle(cornerRadius: T.radius).strokeBorder(T.hair, lineWidth: 1))
                }
            }

            Spacer(minLength: 0)

            if narrador.estado == .leyendo || narrador.estado == .pausado {
                Text(rellena(L.fraseDeN, ["i": narrador.i + 1, "n": narrador.trozos.count]))
                    .font(T.s).monospacedDigit().foregroundStyle(T.l3)
                    .lineLimit(1)
            } else if !narrador.hayVoz {
                Text(L.sinVoz).font(T.s).foregroundStyle(T.or)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(T.bg)   // solido: al 97% el texto que scrollea debajo se transluce entre botones
        .overlay(alignment: .top) { Rectangle().fill(T.hair2).frame(height: 1) }
        .overlay(alignment: .leading) { Rectangle().fill(T.ac).frame(width: 2) }
    }

    private var etiquetaPrincipal: String {
        switch narrador.estado {
        case .parado:     return L.escuchar
        case .preparando: return L.preparando
        case .leyendo:    return L.pausa
        case .pausado:    return L.seguir
        }
    }

    /// El ecualizador de tres barras del nr-eq de la web.
    private var luz: some View {
        TimelineView(.animation(paused: narrador.estado != .leyendo)) { linea in
            let t = linea.date.timeIntervalSinceReferenceDate
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(0..<3, id: \.self) { k in
                    let alto: CGFloat = {
                        if Fx.quieto { return 9 }
                        switch narrador.estado {
                        case .leyendo:
                            let f = sin((t / 0.62 + Double(k) * 0.26) * 2 * .pi) * 0.5 + 0.5
                            return 4 + f * 10
                        case .preparando: return 6
                        default: return 4
                        }
                    }()
                    RoundedRectangle(cornerRadius: 1)
                        .fill(T.ac.opacity(narrador.estado == .parado ? 0.35 : 1))
                        .frame(width: 3, height: alto)
                }
            }
            .frame(height: 14, alignment: .bottom)
        }
        .frame(width: 13)
    }
}

// MARK: - Texto que se ilumina

/// Un bloque narrado. La frase activa lleva las palabras ya dichas en l1, las
/// que faltan en l2 (el MISMO tono del texto normal: en la web estaban mas
/// apagadas y la frase sonando se veia peor que las que nadie leia) y la
/// palabra actual en azul. El barrido usa la FRACCION hablada sobre las
/// palabras visibles: el texto que se habla no es el que se muestra (flechas a
/// comas), asi que un indice de caracter no serviria — misma solucion que la web.
struct TextoNarrado: View {
    let bloque: Int
    let fuente: Font
    let colorBase: Color
    let lineaExtra: CGFloat
    var narrador: Narrador

    var body: some View {
        let fs = bloque < narrador.frasesPorBloque.count ? narrador.frasesPorBloque[bloque] : []
        Text(atribuido(fs))
            .font(fuente)
            .lineSpacing(lineaExtra)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func atribuido(_ fs: [String]) -> AttributedString {
        var out = AttributedString()
        let activo = narrador.estado != .parado ? narrador.trozos[safe: narrador.i] : nil
        for (k, f) in fs.enumerated() {
            if k > 0 { out += AttributedString(" ") }
            if let a = activo, a.bloque == bloque, a.frase == k {
                let palabras = f.split(separator: " ", omittingEmptySubsequences: false)
                let dichas = Int(narrador.fraccion * Double(palabras.count) + 0.0001)
                for (w, palabra) in palabras.enumerated() {
                    if w > 0 { out += AttributedString(" ") }
                    var p = AttributedString(String(palabra))
                    if w < dichas { p.foregroundColor = T.l1 }
                    else if w == dichas { p.foregroundColor = T.ac; p.font = fuente.weight(.semibold) }
                    else { p.foregroundColor = T.l2 }
                    out += p
                }
            } else {
                var p = AttributedString(f)
                p.foregroundColor = colorBase
                out += p
            }
        }
        return out
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
