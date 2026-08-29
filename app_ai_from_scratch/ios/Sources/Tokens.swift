import SwiftUI

/// Los tokens de `web/src/lib/theme-css.ts`, copiados sin redondear.
///
/// La regla que trae el handoff (`design/movil/_base.css`, primera linea) es que
/// el artboard tiene que ser indistinguible de la app. Aqui vale igual: si un
/// color se aproxima "porque casi no se nota", la app deja de ser el mismo
/// producto y nadie sabe decir cuando dejo de serlo. Los alfa van tal cual
/// salen del CSS, no convertidos a un opaco equivalente sobre negro, porque
/// sobre `panel` (#0B0B0C) no dan el mismo resultado.
enum T {

    // MARK: Color

    static let bg      = Color(hex: 0x000000)
    static let panel   = Color(hex: 0x0B0B0C)

    static let l1      = Color(hex: 0xFFFFFF)
    static let l2      = Color(hex: 0xEBEBF5, alpha: 0.62)
    static let l3      = Color(hex: 0xEBEBF5, alpha: 0.50)

    static let hair    = Color(hex: 0x545458, alpha: 0.46)
    static let hair2   = Color(hex: 0x545458, alpha: 0.16)
    static let fill    = Color(hex: 0x787880, alpha: 0.22)

    static let ac      = Color(hex: 0x0A84FF)
    static let acSolid = Color(hex: 0x0A6CFF)
    static let ok      = Color(hex: 0x30D158)
    static let or      = Color(hex: 0xFF9F0A)
    static let rd      = Color(hex: 0xFF453A)

    static let btnBg   = Color(hex: 0xFFFFFF)
    static let btnFg   = Color(hex: 0x000000)
    static let onAc    = Color(hex: 0xFFFFFF)

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
