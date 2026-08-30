import SwiftUI

/// El tema vigente. Tres modos, los mismos que el servidor acepta
/// (auth/src/index.ts:44 `THEMES = ['dark','paper','auto']`), y la misma
/// preferencia viaja al servidor con PATCH /api/settings, asi que el tema que
/// eliges en el movil es el que te encuentras en la web.
///
/// Es `@Observable` y ademas se guarda en UserDefaults: el arranque pinta el
/// tema correcto ANTES de que llegue /api/me, que es lo que evita el fogonazo
/// blanco-negro de medio segundo en cada lanzamiento.
@Observable
final class Tema {
    static let compartido = Tema()

    enum Modo: String, CaseIterable { case dark, paper, auto }

    static let CLAVE = "curso.tema"

    var modo: Modo {
        didSet { UserDefaults.standard.set(modo.rawValue, forKey: Self.CLAVE) }
    }

    /// Lo pone la raiz desde `@Environment(\.colorScheme)`: en modo `auto` el
    /// tema es el del equipo, y esto es lo unico que lo sabe.
    var sistemaClaro = false

    var claro: Bool { modo == .paper || (modo == .auto && sistemaClaro) }

    /// Lo que `preferredColorScheme` debe forzar. En `auto` es nil: se deja
    /// mandar al sistema, que es exactamente lo que significa auto.
    var esquema: ColorScheme? {
        switch modo {
        case .dark:  return .dark
        case .paper: return .light
        case .auto:  return nil
        }
    }

    private init() {
        let guardado = UserDefaults.standard.string(forKey: Self.CLAVE) ?? ""
        modo = Modo(rawValue: guardado) ?? .dark
    }
}

/// Los tokens de `web/src/lib/theme-css.ts`, copiados sin redondear, en sus DOS
/// temas.
///
/// La regla que trae el handoff (`design/movil/_base.css`, primera linea) es que
/// el artboard tiene que ser indistinguible de la app. Aqui vale igual: si un
/// color se aproxima "porque casi no se nota", la app deja de ser el mismo
/// producto y nadie sabe decir cuando dejo de serlo. Los alfa van tal cual
/// salen del CSS, no convertidos a un opaco equivalente sobre negro, porque
/// sobre `panel` (#0B0B0C) no dan el mismo resultado.
///
/// El tema claro esta calibrado a mano sobre #F2F2F2 (>=4.5:1 medido en texto
/// de 10px en la web), NO es un invertido automatico: el azul baja de #0A84FF a
/// #0A5AD6 y el verde de #30D158 a #0C6B3E justo por eso. Mantenerlo asi.
enum T {

    private static var claro: Bool { Tema.compartido.claro }

    // MARK: Color

    static var bg: Color      { claro ? Color(hex: 0xF2F2F2) : Color(hex: 0x000000) }
    static var panel: Color   { claro ? Color(hex: 0xFFFFFF) : Color(hex: 0x0B0B0C) }

    static var l1: Color      { claro ? Color(hex: 0x000000) : Color(hex: 0xFFFFFF) }
    static var l2: Color      { claro ? Color(hex: 0x000000, alpha: 0.66) : Color(hex: 0xEBEBF5, alpha: 0.62) }
    static var l3: Color      { claro ? Color(hex: 0x000000, alpha: 0.58) : Color(hex: 0xEBEBF5, alpha: 0.50) }

    static var hair: Color    { claro ? Color(hex: 0x000000, alpha: 0.22) : Color(hex: 0x545458, alpha: 0.46) }
    static var hair2: Color   { claro ? Color(hex: 0x000000, alpha: 0.08) : Color(hex: 0x545458, alpha: 0.16) }
    static var fill: Color    { claro ? Color(hex: 0x787880, alpha: 0.20) : Color(hex: 0x787880, alpha: 0.22) }

    static var ac: Color      { claro ? Color(hex: 0x0A5AD6) : Color(hex: 0x0A84FF) }
    static var acSolid: Color { claro ? Color(hex: 0x0A5AD6) : Color(hex: 0x0A6CFF) }
    static var ok: Color      { claro ? Color(hex: 0x0C6B3E) : Color(hex: 0x30D158) }
    static var or: Color      { claro ? Color(hex: 0x8A5000) : Color(hex: 0xFF9F0A) }
    static var rd: Color      { claro ? Color(hex: 0xC21B12) : Color(hex: 0xFF453A) }

    static var btnBg: Color   { claro ? Color(hex: 0x000000) : Color(hex: 0xFFFFFF) }
    static var btnFg: Color   { claro ? Color(hex: 0xFFFFFF) : Color(hex: 0x000000) }
    /// Texto sobre relleno de acento. Blanco en LOS DOS temas — `btnFg` no
    /// sirve de sustituto, ese es negro en oscuro.
    static let onAc = Color(hex: 0xFFFFFF)

    // MARK: Tipografia
    //
    // La rampa de `web/src/layouts/App.astro`. En CSS el tracking va en `em` y
    // en SwiftUI en puntos, asi que cada uno se multiplica por su tamaño: .18em
    // sobre 10px son 1,8 pt. Se escribe la multiplicacion en vez del resultado
    // para que al cambiar un tamaño el tracking siga siendo el mismo tracking.

    /// `.lbl` — 500 10px mono, .18em, mayusculas, l3
    static let lbl        = Font.system(size: 10, weight: .medium, design: .monospaced)
    static let lblTrack   = 10 * 0.18

    /// `.eb` — 600 10px mono, .22em, mayusculas, ac
    static let eb         = Font.system(size: 10, weight: .semibold, design: .monospaced)
    static let ebTrack    = 10 * 0.22

    /// `.h1` — 700 34px, -.035em
    static let h1         = Font.system(size: 34, weight: .bold)
    static let h1Track    = 34 * -0.035

    /// `.h2` — 700 21px, -.028em
    static let h2         = Font.system(size: 21, weight: .bold)
    static let h2Track    = 21 * -0.028

    /// `.h3` — 600 15px, -.01em
    static let h3         = Font.system(size: 15, weight: .semibold)
    static let h3Track    = 15 * -0.01

    /// `.p` — 400 16px/1.5, l2
    static let p          = Font.system(size: 16)
    static let pLine      = 16 * 0.5   // SwiftUI toma el EXTRA, no el total

    /// `.s` — 400 13px/1.45, l3
    static let s          = Font.system(size: 13)
    static let sLine      = 13 * 0.45

    /// `.btn` — 600 11px mono, .1em, mayusculas
    static let btn        = Font.system(size: 11, weight: .semibold, design: .monospaced)
    static let btnTrack   = 11 * 0.10

    /// Numeros con ancho fijo. `.num` en el CSS es `font-variant-numeric:
    /// tabular-nums`, y aqui hace falta en la columna del numero de leccion y en
    /// el contador de labs: sin esto "1/3" y "11/3" desalinean la columna.
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }

    // MARK: Medidas

    /// El suelo tactil. `.btn`, `.chip` y `.input` lo respetan en el CSS, y el
    /// handoff señala que `.segb` (30px) no lo hacia. Aqui no hay excepciones.
    static let tap: CGFloat = 44
    static let radius: CGFloat = 6
}

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB,
            red:   Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >>  8) & 0xFF) / 255,
            blue:  Double( hex        & 0xFF) / 255,
            opacity: alpha
        )
    }
}

extension View {
    /// `.lbl`, `.eb` y `.btn` son mayusculas POR CSS (`text-transform`), no en el
    /// texto original. Reproducirlo aqui y no en las cadenas mantiene el string
    /// traducible: en aleman un `.uppercased()` sobre "Straße" no es lo mismo que
    /// sobre "STRASSE", y la decision de mayusculas es de presentacion.
    func label(_ color: Color = T.l3) -> some View {
        self.font(T.lbl).tracking(T.lblTrack).textCase(.uppercase).foregroundStyle(color)
    }

    func eyebrow() -> some View {
        self.font(T.eb).tracking(T.ebTrack).textCase(.uppercase).foregroundStyle(T.ac)
    }
}
