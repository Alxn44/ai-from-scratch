import SwiftUI

/// La respuesta del tutor, pintada como PROSA y no como salida de terminal.
///
/// Es el gemelo de `web/src/lib/prosa.ts`, y lo es a proposito: la MISMA
/// respuesta tiene que partirse en los mismos bloques en las dos pantallas. Si
/// una parte por linea en blanco y la otra no, la misma frase se lee distinta
/// segun el aparato y nadie sabe cual es la buena.
///
/// SI HAY MARKDOWN. La primera version de este fichero decia que no, porque el
/// prompt del tutor (ai/src/course_ai/ontology/render.py) pide «un guion» para
/// las listas y no menciona markdown. Se midio contra el servidor de verdad y
/// volvio esto:
///
///     1. **Lee la Leccion 1.** Abre «Aprende viendo ejemplos»…
///     2. **Resuelve el lab 1.1.** Es tu primer ejercicio…
///
/// Asteriscos y numeracion. Un prompt es una PETICION, no un contrato. Se pinta
/// lo que llega: parrafos, listas por guion pegadas a su frase, listas
/// numeradas separadas por hueco, y **negrita** dentro de cualquiera.
enum Prosa {

    enum Bloque: Equatable, Identifiable {
        case parrafo([String])
        case lista([String])

        var id: String {
            switch self {
            case .parrafo(let xs): return "p:\(xs.joined(separator: "\u{1}"))"
            case .lista(let xs):   return "l:\(xs.joined(separator: "\u{1}"))"
            }
        }
    }

    /// Una linea de lista: guion, raya, vinieta `*`, o «1.» / «1)».
    /// `*` exige espacio detras, para que `**negrita**` al principio de linea no
    /// se lea como vinieta.
    static let ITEM = try! NSRegularExpression(
        pattern: "^[ \\t]*(?:[-\u{2013}\u{2014}*][ \\t]+|\\d{1,2}[.)][ \\t]+)")

    private static func esItem(_ l: String) -> Bool { marca(l) != nil }

    private static func marca(_ l: String) -> NSRange? {
        let r = NSRange(l.startIndex..., in: l)
        guard let m = ITEM.firstMatch(in: l, options: [.anchored], range: r) else { return nil }
        return m.range
    }

    private static func sinMarca(_ l: String) -> String {
        guard let r = marca(l), let rango = Range(r, in: l) else { return l }
        return String(l[rango.upperBound...])
    }

    /// Parte el texto en bloques. Separado del pintado a proposito: la decision
    /// de que es parrafo y que es lista es la parte con reglas, y se puede
    /// probar sin levantar una vista.
    ///
    /// Recorre LINEAS y no bloques separados por hueco, porque las dos formas
    /// que manda el modelo son incompatibles con partir primero por hueco: la
    /// lista por guion viene PEGADA a la frase que la presenta, y la numerada
    /// viene con un hueco ENTRE cada item. Un hueco entre items no rompe la
    /// lista; una linea que no es item, si.
    static func bloques(_ texto: String) -> [Bloque] {
        // \r\n antes de partir: un modelo detras de un proxy los ha devuelto, y
        // entonces cada linea acaba con un \r invisible que rompe la comparacion.
        let crudo = texto
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !crudo.isEmpty else { return [] }

        var out: [Bloque] = []
        var parrafo: [String] = []
        var items: [String] = []

        func cierraParrafo() {
            if !parrafo.isEmpty { out.append(.parrafo(parrafo)); parrafo = [] }
        }
        func cierraLista() {
            // Un guion suelto al final de una frase no es una lista: es un
            // guion. Se exigen dos para no convertir «— y ya esta» en un bloque
            // de un elemento.
            if items.count >= 2 { out.append(.lista(items)) }
            else if items.count == 1 { out.append(.parrafo(items)) }
            items = []
        }

        for bruta in crudo.split(separator: "\n", omittingEmptySubsequences: false) {
            let linea = String(bruta).replacingOccurrences(
                of: "[ \\t]+$", with: "", options: .regularExpression)
            if linea.trimmingCharacters(in: .whitespaces).isEmpty {
                cierraParrafo()          // el hueco NO cierra la lista
                continue
            }
            if esItem(linea) {
                cierraParrafo()
                items.append(sinMarca(linea))
                continue
            }
            cierraLista()
            parrafo.append(linea)
        }
        cierraParrafo()
        cierraLista()
        return out
    }

    /// `**negrita**` → texto con tramos en semibold.
    ///
    /// Se parte a mano en vez de usar `AttributedString(markdown:)`: ese parser
    /// entiende TAMBIEN enlaces, y un enlace que venga del modelo se pintaria
    /// como enlace tocable. Aqui solo existe la negrita, igual que en la web.
    static func enLinea(_ s: String, base: Color) -> AttributedString {
        var out = AttributedString()
        var resto = Substring(s)
        while let abre = resto.range(of: "**") {
            let cola = resto[abre.upperBound...]
            guard let cierra = cola.range(of: "**"), cierra.lowerBound > cola.startIndex else { break }
            var llano = AttributedString(String(resto[..<abre.lowerBound]))
            llano.foregroundColor = base
            var fuerte = AttributedString(String(cola[..<cierra.lowerBound]))
            fuerte.font = .system(size: 15, weight: .semibold)
            // Sube a l1 en vez de solo engordar: sobre l2 un semibold casi no se
            // distingue, y el contraste si.
            fuerte.foregroundColor = T.l1
            out.append(llano); out.append(fuerte)
            resto = cola[cierra.upperBound...]
        }
        var final = AttributedString(String(resto))
        final.foregroundColor = base
        out.append(final)
        return out
    }
}

/// El cuerpo de una respuesta. Parrafos sueltos, sin caja, y las listas en un
/// bloque con filo de acento a la izquierda y el indice en monoespaciada — la
/// misma anatomia que `.pr-lista` en la web.
struct ProsaView: View {
    let texto: String

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            ForEach(Prosa.bloques(texto)) { b in
                switch b {
                case .parrafo(let lineas):
                    // Los saltos sueltos dentro de un parrafo se respetan: si el
                    // modelo corto ahi, corto por algo.
                    linea(lineas.joined(separator: "\n"))
                case .lista(let items):
                    VStack(alignment: .leading, spacing: 9) {
                        ForEach(Array(items.enumerated()), id: \.offset) { i, it in
                            HStack(alignment: .top, spacing: 11) {
                                // El indice lo pone la lista, no el modelo: si
                                // el modelo escribio «1.» ya se le quito, asi
                                // que una respuesta que empiece a contar en 3 se
                                // pinta 01, 02, 03 y no hereda su despiste.
                                Text(String(format: "%02d", i + 1))
                                    .font(T.mono(12, .semibold)).foregroundStyle(T.ac)
                                    .padding(.top, 4)
                                linea(it)
                            }
                        }
                    }
                    .padding(.horizontal, 17).padding(.vertical, 15)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(T.panel)
                    .overlay(alignment: .leading) { Rectangle().fill(T.ac).frame(width: 2) }
                }
            }
        }
    }

    private func linea(_ t: String) -> some View {
        Text(Prosa.enLinea(t, base: T.l2))
            .font(.system(size: 15)).lineSpacing(15 * 0.62)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
