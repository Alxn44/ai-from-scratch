import SwiftUI

/// `.ch-pill` de la web: borde fino, mono en mayusculas, y el suelo tactil de 44
/// que el CSS respeta con `min-height`. Se usa para las respuestas rapidas del
/// tutor y para las sugerencias del rail, que son la misma cosa — un prompt de un
/// toque — y por eso son un solo componente.
///
/// Envuelve con `Flujo` (LabView.swift), que ya es el flow layout de la app.
struct Pastilla: View {
    let titulo: String
    let accion: () -> Void

    var body: some View {
        Button(action: accion) {
            Text(titulo)
                .font(T.mono(11, .medium)).tracking(11 * 0.08).textCase(.uppercase)
                .foregroundStyle(T.l2)
                .multilineTextAlignment(.leading)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .frame(minHeight: T.tap)
                .overlay(Rectangle().strokeBorder(T.hair2, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
