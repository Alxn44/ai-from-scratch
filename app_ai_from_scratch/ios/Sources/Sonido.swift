import AVFoundation

/// El kit de sonido, portado NUMERO A NUMERO de web/src/lib/sound.ts. Las tres
/// reglas medidas de alli valen aqui igual: nada bajo 300 Hz (altavoz de
/// portatil; el de un iPhone es peor), ataque ≤75 ms (mas tarde que eso el oido
/// separa sonido y animacion), y el volumen escala con la importancia — un lab
/// pasa 36 veces y suena a -20 dBFS; el fallo informa sin castigar, tercera
/// menor hacia abajo.
///
/// La sintesis es offline: cada hito se calcula en un AVAudioPCMBuffer con
/// matematica pura (senos, triangulos, ruido filtrado con biquads a mano) y se
/// reproduce de una pieza. Cero ficheros de audio, igual que la web.
enum Sonido {

    /// Pentatonica mayor de Do, dos octavas y pico — la escala ES el progreso:
    /// cerrar la leccion 12 suena arriba de cerrar la 2.
    static let ESCALA: [Double] = [523.25, 587.33, 659.25, 783.99, 880.0,
                                   1046.5, 1174.66, 1318.51, 1567.98, 1760.0, 2093.0, 2349.32]

    static let CLAVE = "curso.sonido"   // misma clave de preferencia que la web

    static var suena: Bool {
        UserDefaults.standard.string(forKey: CLAVE) != "off"
    }

    static func silenciar(_ off: Bool) {
        UserDefaults.standard.set(off ? "off" : "on", forKey: CLAVE)
    }

    enum Hito: String {
        case lab, leccion, rango, estrella, racha, liga, fallo, final
    }

    private static let engine = AVAudioEngine()
    private static let player = AVAudioPlayerNode()
    private static var listo = false
    private static let fs = 44_100.0

    private static func arranca() -> Bool {
        guard suena else { return false }
        if !listo {
            // .ambient: el curso no debe callar la musica del usuario, igual que
            // la web no toma el foco de audio del sistema.
            try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
            let fmt = AVAudioFormat(standardFormatWithSampleRate: fs, channels: 1)
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: fmt)
            listo = true
        }
        if !engine.isRunning {
            do { try engine.start() } catch { return false }
        }
        return true
    }

    private static func dB(_ x: Double) -> Double { pow(10, x / 20) }

    // MARK: sintesis en el buffer

    /// Un parcial: onda, frecuencia, pico en dBFS, ataque y caida en segundos,
    /// deslizamiento opcional de frecuencia. Escribe SUMANDO sobre `out`.
    private static func tono(_ out: inout [Float], t0: Double, hz: Double, pico: Double,
                             atq: Double, caida: Double, onda: String = "sine", desliz: Double = 0) {
        let a = min(atq, 0.075)                       // regla 2
        let ini = Int(t0 * fs)
        let n = Int((caida + 0.02) * fs)
        let amp = dB(pico)
        var fase = 0.0
        for i in 0..<n {
            let t = Double(i) / fs
            // el deslizamiento exponencial de WebAudio: hz -> hz*desliz en `caida`
            let f = desliz > 0 ? hz * pow(desliz, t / caida) : hz
            fase += 2 * .pi * f / fs
            // envolvente exponencial como la de WebAudio: sube a `amp` en `a`,
            // cae a 0.0001 en `caida`
            let env: Double
            if t < a {
                env = 0.0001 * pow(amp / 0.0001, t / a)
            } else if t < caida {
                env = amp * pow(0.0001 / amp, (t - a) / (caida - a))
            } else {
                env = 0
            }
            let s = sin(fase)
            // triangulo por aproximacion: asin(sin) normalizado, mismo timbre
            let v = onda == "triangle" ? (2 / .pi) * asin(s) : s
            let j = ini + i
            if j < out.count { out[j] += Float(v * env) }
        }
    }

    /// Biquad RBJ. Los dos filtros del `golpe` de la web (bandpass Q 1.1 y
    /// highpass 320 Hz — regla 1) aplicados a mano sobre el ruido.
    private struct Biquad {
        var b0 = 0.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0
        var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0

        static func bandpass(_ f0: Double, q: Double, fs: Double) -> Biquad {
            let w = 2 * Double.pi * f0 / fs, al = sin(w) / (2 * q), a0 = 1 + al
            var b = Biquad()
            b.b0 = al / a0; b.b1 = 0; b.b2 = -al / a0
            b.a1 = -2 * cos(w) / a0; b.a2 = (1 - al) / a0
            return b
        }
        static func highpass(_ f0: Double, q: Double, fs: Double) -> Biquad {
            let w = 2 * Double.pi * f0 / fs, al = sin(w) / (2 * q), a0 = 1 + al
            let c = cos(w)
            var b = Biquad()
            b.b0 = (1 + c) / 2 / a0; b.b1 = -(1 + c) / a0; b.b2 = (1 + c) / 2 / a0
            b.a1 = -2 * c / a0; b.a2 = (1 - al) / a0
            return b
        }
        mutating func paso(_ x: Double) -> Double {
            let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = x; y2 = y1; y1 = y
            return y
        }
    }

    /// El golpe material: ruido con caida propia por pasabanda + pasaaltos.
    /// Es lo que hace que el cofre suene a madera y metal y no a pitido.
    private static func golpe(_ out: inout [Float], t0: Double, pico: Double,
                              dur: Double = 0.09, centro: Double = 1100) {
        let ini = Int(t0 * fs)
        let n = Int(dur * fs)
        var bp = Biquad.bandpass(centro, q: 1.1, fs: fs)
        var hp = Biquad.highpass(320, q: 0.7071, fs: fs)
        let amp = dB(pico)
        for i in 0..<n {
            let ruido = (Double.random(in: -1...1)) * pow(1 - Double(i) / Double(n), 2.2)
            let v = hp.paso(bp.paso(ruido)) * amp
            let j = ini + i
            if j < out.count { out[j] += Float(v) }
        }
    }

    // MARK: los ocho hitos — mismos numeros que sound.ts

    /// Suena un hito. `paso` (1..12) coloca el sonido en la escala.
    /// Silencioso y sin excepciones si el sonido esta apagado.
    static func sonar(_ hito: Hito, paso: Int = 1) {
        guard arranca() else { return }
        let g = ESCALA[max(0, min(11, paso - 1))]
        var dur = 1.2
        var mezcla = [Float](repeating: 0, count: Int(2.2 * fs))

        switch hito {
        case .lab:
            tono(&mezcla, t0: 0, hz: g, pico: -20, atq: 0.006, caida: 0.1, onda: "triangle")
            tono(&mezcla, t0: 0.055, hz: g * 1.5, pico: -22, atq: 0.006, caida: 0.14)
            dur = 0.3

        case .estrella:
            tono(&mezcla, t0: 0, hz: g, pico: -19, atq: 0.005, caida: 0.09, onda: "triangle")
            tono(&mezcla, t0: 0.05, hz: g * 1.25, pico: -20, atq: 0.005, caida: 0.1, onda: "triangle")
            tono(&mezcla, t0: 0.1, hz: g * 1.5, pico: -18, atq: 0.006, caida: 0.24)
            golpe(&mezcla, t0: 0, pico: -30, dur: 0.04, centro: 2600)
            dur = 0.45

        case .leccion:
            tono(&mezcla, t0: 0, hz: g, pico: -16, atq: 0.008, caida: 0.16, onda: "triangle")
            tono(&mezcla, t0: 0.09, hz: g * 1.335, pico: -15, atq: 0.008, caida: 0.2, onda: "triangle")
            tono(&mezcla, t0: 0.19, hz: g * 2, pico: -14, atq: 0.01, caida: 0.5)
            golpe(&mezcla, t0: 0, pico: -26, dur: 0.06, centro: 1800)
            dur = 0.8

        case .rango:
            golpe(&mezcla, t0: 0, pico: -14, dur: 0.13, centro: 700)
            golpe(&mezcla, t0: 0.02, pico: -20, dur: 0.07, centro: 2200)
            tono(&mezcla, t0: 0.03, hz: g, pico: -13, atq: 0.012, caida: 0.7, onda: "triangle")
            tono(&mezcla, t0: 0.06, hz: g * 1.26, pico: -16, atq: 0.012, caida: 0.62)
            tono(&mezcla, t0: 0.09, hz: g * 1.5, pico: -15, atq: 0.012, caida: 0.8)
            tono(&mezcla, t0: 0.12, hz: g * 2, pico: -18, atq: 0.014, caida: 1.0)
            dur = 1.3

        case .racha:
            for i in 0..<3 {
                tono(&mezcla, t0: Double(i) * 0.07, hz: g * pow(1.0595, Double(i * 2)),
                     pico: -19 + Double(i), atq: 0.006, caida: 0.13, onda: "triangle")
            }
            dur = 0.45

        case .liga:
            tono(&mezcla, t0: 0, hz: g, pico: -14, atq: 0.01, caida: 0.42, onda: "triangle", desliz: 1.5)
            tono(&mezcla, t0: 0.2, hz: g * 2, pico: -15, atq: 0.01, caida: 0.5)
            golpe(&mezcla, t0: 0.18, pico: -22, dur: 0.09, centro: 1500)
            dur = 0.9

        case .fallo:
            tono(&mezcla, t0: 0, hz: 660, pico: -26, atq: 0.008, caida: 0.11)
            tono(&mezcla, t0: 0.075, hz: 554, pico: -25, atq: 0.008, caida: 0.17)
            dur = 0.35

        case .final:
            let raiz = ESCALA[0]
            for (i, k) in [0, 2, 4, 7, 9, 11].enumerated() {
                let fi = Double(i)
                tono(&mezcla, t0: fi * 0.085, hz: raiz * pow(1.0595, Double(k)),
                     pico: -12 + fi * 0.5, atq: 0.014, caida: 1.4 - fi * 0.1,
                     onda: i % 2 == 1 ? "sine" : "triangle")
            }
            golpe(&mezcla, t0: 0, pico: -12, dur: 0.16, centro: 800)
            golpe(&mezcla, t0: 0.5, pico: -22, dur: 0.12, centro: 2000)
            dur = 2.1

        }

        let frames = AVAudioFrameCount(dur * fs)
        guard let fmt = AVAudioFormat(standardFormatWithSampleRate: fs, channels: 1),
              let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: frames) else { return }
        buf.frameLength = frames
        mezcla.withUnsafeBufferPointer { p in
            buf.floatChannelData![0].update(from: p.baseAddress!, count: Int(frames))
        }
        #if DEBUG
        if QA.valor("IA_QA_SONIDO") != nil {
            let pico = mezcla.prefix(Int(frames)).map { abs($0) }.max() ?? 0
            print("sonido \(hito.rawValue): pico \(pico)")
        }
        #endif
        if !player.isPlaying { player.play() }
        player.scheduleBuffer(buf, at: nil, options: [])
    }
}
