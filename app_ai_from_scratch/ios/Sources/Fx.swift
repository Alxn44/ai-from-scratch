import SwiftUI

/// Animaciones de resultado, portadas de web/src/lib/fx.ts con los MISMOS
/// numeros: 26 chispas en cono de -155° a -25°, velocidad 260-590, gravedad
/// 1100, roce 1.9/s, un solo anillo; el temblor del fallo es
/// x(t) = 8·e^(-t/0.11)·sin(2π·11·t) durante 430 ms. Todo respeta Reducir
/// Movimiento: sin recorrido queda el mismo cambio de color, igual que alli.
enum Fx {
    static var quieto: Bool { UIAccessibility.isReduceMotionEnabled }
}

/// Racha de la sesion. No va al servidor a proposito: una racha es "ahora
/// mismo vas seguido", no una estadistica historica. Un fallo la corta.
enum Racha { static var n = 0 }

// MARK: - Chispas

/// Una particula con su trayectoria en FORMA CERRADA. La web integra por
/// fotograma (vx *= e^(-k·dt); vy += G·dt); con arrastre exponencial la
/// integral tiene solucion exacta, asi que aqui cada fotograma evalua la
/// formula en vez de acumular estado — mismo recorrido, cero deriva.
private struct Chispa {
    let x0: Double, y0: Double, vx0: Double, vy0: Double
    let r: Double, vida: Double, giro0: Double, vg: Double
    let cuadro: Bool, blanca: Bool

    static let G = 1100.0
    static let ROCE = 1.9

    func pos(_ t: Double) -> CGPoint {
        let k = Self.ROCE
        let e = 1 - exp(-k * t)
        let x = x0 + vx0 / k * e
        let y = y0 + (vy0 - Self.G / k) / k * e + Self.G / k * t
        return CGPoint(x: x, y: y)
    }
}

/// El estallido del acierto. Se monta como overlay a pantalla de la hoja, con
/// el origen en el punto de la accion (el boton Comprobar): si el origen no es
/// donde el usuario toco, el movimiento no significa nada — leccion de fx.ts.
struct Chispas: View {
    let origen: CGPoint
    let alTerminar: () -> Void

    private let inicio = Date()
    private let particulas: [Chispa]

    init(origen: CGPoint, alTerminar: @escaping () -> Void) {
        self.origen = origen
        self.alTerminar = alTerminar
        var ps: [Chispa] = []
        for i in 0..<26 {
            // cono hacia arriba, repartido y no aleatorio puro, como alli
            let a = (-155 + (Double(i) / 25) * 130 + Double.random(in: -7...7)) * .pi / 180
            let v = Double.random(in: 260...590)
            ps.append(Chispa(
                x0: origen.x + Double.random(in: -5...5),
                y0: origen.y + Double.random(in: -3...3),
                vx0: cos(a) * v, vy0: sin(a) * v,
                r: Double.random(in: 1.7...4.3),
                vida: Double.random(in: 0.62...1.08),
                giro0: Double.random(in: 0...6.283), vg: Double.random(in: -7...7),
                cuadro: i % 3 == 0, blanca: i % 5 == 0
            ))
        }
        particulas = ps
    }

    var body: some View {
        TimelineView(.animation) { linea in
            Canvas { ctx, _ in
                let t = linea.date.timeIntervalSince(inicio)

                // un solo anillo: varios se leen como plantilla, uno como impacto
                if t < 0.5 {
                    let u = t / 0.5
                    let radio = 6 + u * 46
                    var camino = Path()
                    camino.addEllipse(in: CGRect(x: origen.x - radio, y: origen.y - radio,
                                                 width: radio * 2, height: radio * 2))
                    ctx.stroke(camino, with: .color(T.ok.opacity((1 - u) * 0.5)),
                               lineWidth: 1.4 * (1 - u * 0.6))
                }

                for p in particulas where t < p.vida {
                    let u = t / p.vida
                    let alfa = (u < 0.12 ? u / 0.12 : pow(1 - (u - 0.12) / 0.88, 1.6)) * 0.92
                    let r = p.r * (1 - u * 0.55)
                    let c = p.pos(t)
                    let color = (p.blanca ? T.l1 : T.ok).opacity(max(0, min(1, alfa)))
                    if p.cuadro {
                        var s = ctx
                        s.translateBy(x: c.x, y: c.y)
                        s.rotate(by: .radians(p.giro0 + p.vg * t))
                        s.fill(Path(CGRect(x: -r, y: -r * 0.7, width: r * 2, height: r * 1.4)),
                               with: .color(color))
                    } else {
                        ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)),
                                 with: .color(color))
                    }
                }
            }
        }
        .allowsHitTesting(false)
        .task {
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            alTerminar()
        }
    }
}

// MARK: - Temblor del fallo

/// El golpe amortiguado de fx.ts, evaluado por fotograma: sin envolvente un
/// temblor se lee como una maquina; con ella, como un golpe.
struct Temblor: ViewModifier {
    let disparo: Int          // subir el contador dispara un temblor nuevo
    @State private var inicio: Date?

    func body(content: Content) -> some View {
        TimelineView(.animation(paused: inicio == nil)) { linea in
            let x: Double = {
                guard let inicio else { return 0 }
                let t = linea.date.timeIntervalSince(inicio)
                guard t < 0.43 else { return 0 }
                return 8 * exp(-t / 0.11) * sin(2 * .pi * 11 * t)
            }()
            content.offset(x: x)
        }
        .onChange(of: disparo) {
            guard disparo > 0, !Fx.quieto else { return }
            inicio = Date()
            Task {
                try? await Task.sleep(nanoseconds: 500_000_000)
                inicio = nil
            }
        }
    }
}

// MARK: - Respiro del acierto

/// La tarjeta respira (scale .994 → 1.004 → 1 en 420 ms) con la curva de la
/// web, cubic-bezier(.16,1,.3,1) partida en sus dos tramos.
struct Respiro: ViewModifier {
    let disparo: Int
    @State private var escala = 1.0

    func body(content: Content) -> some View {
        content
            .scaleEffect(escala)
            .onChange(of: disparo) {
                guard disparo > 0, !Fx.quieto else { return }
                escala = 0.994
                withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.21)) { escala = 1.004 }
                withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.21).delay(0.21)) { escala = 1.0 }
            }
    }
}
