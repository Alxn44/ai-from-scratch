import SwiftUI

// Ganchos de QA, SOLO en Debug. Existen porque en esta maquina no se puede
// teclear ni tocar el simulador (Accesibilidad denegada): sin esto no hay forma
// de VER una mecanica montada ni de entrar con sesion en una prueba. Nada de
// este fichero llega a un build Release.
//
// Uso (simctl pasa el entorno con prefijo SIMCTL_CHILD_):
//   SIMCTL_CHILD_IA_QA_LAB=cut xcrun simctl launch <UD> io.alpadev.iadesdecero
//     → abre directamente la mecanica `cut` con datos de muestra, sin red.
//   SIMCTL_CHILD_IA_QA_CORREO=... SIMCTL_CHILD_IA_QA_CLAVE=... → login solo.
//   SIMCTL_CHILD_IA_QA_ORIGEN=http://127.0.0.1:4321 → apunta a `pnpm dev`.
#if DEBUG

enum QA {
    static func valor(_ clave: String) -> String? {
        ProcessInfo.processInfo.environment[clave]
    }

    /// Los seis kinds con payloads de MUESTRA (formas copiadas de api/src/seed.ts;
    /// contenido inventado y con id 0.0 para que nunca se confunda con un lab real).
    static func lab(_ kind: String) -> LabFull? {
        let payload: JSONValue
        let prompt: String
        switch kind {
        case "choice":
            prompt = "¿Cuántos tokens son «Cartagena es hermosa»? (muestra QA)"
            payload = .object(["options": .array([.string("3 palabras"), .string("5 tokens"), .string("1 token")])])
        case "cut":
            prompt = "Corta la frase donde cortaría el tokenizador. (muestra QA)"
            payload = .object(["words": .array([.string("Cartagena"), .string("es"), .string("hermosa")])])
        case "order":
            prompt = "Ordena los pasos del entrenamiento. (muestra QA)"
            payload = .object(["steps": .array([
                .object(["id": .string("a"), "text": .string("Mostrar millones de ejemplos")]),
                .object(["id": .string("b"), "text": .string("Medir cuánto se equivoca")]),
                .object(["id": .string("c"), "text": .string("Ajustar las perillas y repetir")]),
            ])])
        case "build":
            prompt = "Arma el prompt completo. (muestra QA)"
            payload = .object([
                "slots": .array([.string("QUÉ"), .string("PARA QUIÉN"), .string("CÓMO")]),
                "tiles": .array([
                    .object(["slot": .number(0), "text": .string("Resume este texto")]),
                    .object(["slot": .number(0), "text": .string("Haz un poema")]),
                    .object(["slot": .number(1), "text": .string("para alguien de 10 años")]),
                    .object(["slot": .number(2), "text": .string("en tres frases")]),
                    .object(["slot": .number(2), "text": .string("en inglés")]),
                ]),
            ])
        case "knob":
            prompt = "Mueve la temperatura y mira quién gana. (muestra QA)"
            payload = .object(["min": .number(0), "max": .number(100), "cands": .array([
                .object(["name": .string("gato"), "logit": .number(3.2)]),
                .object(["name": .string("perro"), "logit": .number(2.1)]),
                .object(["name": .string("dragón morado"), "logit": .number(0.4)]),
            ])])
        case "hotcold":
            prompt = "Encuentra el número que el modelo repite. (muestra QA)"
            payload = .object(["min": .number(1), "max": .number(100)])
        default:
            return nil
        }
        return LabFull(id: "0.0", lesson: 0, idx: 0, level: "muestra", kind: kind,
                       prompt: prompt, payload: payload, draft: false, solved: false, attempts: 0)
    }
}

/// La galeria: LabView a pantalla completa con la mecanica pedida por entorno.
struct GaleriaQA: View {
    let kind: String
    var body: some View {
        if let lab = QA.lab(kind) {
            LabView(lab: lab) { _ in }
        } else {
            Text("kind desconocido: \(kind)").foregroundStyle(T.rd)
        }
    }
}
#endif
