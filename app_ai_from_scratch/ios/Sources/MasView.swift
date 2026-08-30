import SwiftUI

/// «Más»: lo que en la web es el resto del menu lateral — Ranking, Ligas y la
/// cuenta. La compra, el PDF y borrar la cuenta viven en la web y aqui se
/// enlaza, no se imita.
struct MasView: View {
    @Environment(Sesion.self) private var sesion
    @State private var verRanking = false
    @State private var verLigas = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    Text("Más").label(T.l1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    seccion("Comunidad") {
                        fila("Ranking") { verRanking = true }
                        fila("Ligas") { verLigas = true }
                    }
                    cuenta
                    enlaces
                }
                .padding(18)
                .padding(.bottom, 32)
            }
            .background(T.bg)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(isPresented: $verRanking) { RankingView() }
            .navigationDestination(isPresented: $verLigas) { LigasView() }
            .onAppear {
                #if DEBUG
                switch QA.valor("IA_QA_MAS") {
                case "ranking": verRanking = true
                case "ligas":   verLigas = true
                default: break
                }
                #endif
            }
        }
    }

    private func seccion(_ titulo: String, @ViewBuilder _ contenido: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(titulo).label().padding(.bottom, 10)
            contenido()
        }
    }

    private func fila(_ titulo: String, accion: @escaping () -> Void) -> some View {
        Button(action: accion) {
            HStack {
                Text(titulo).font(T.h3).tracking(T.h3Track).foregroundStyle(T.l1)
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(T.l3)
            }
            .frame(minHeight: T.tap)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) { Rectangle().fill(T.hair2).frame(height: 1) }
    }

    private var cuenta: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Cuenta").label().padding(.bottom, 10)
            if case .dentro(let u) = sesion.estado, !u.email.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    if !u.name.isEmpty {
                        Text(u.name).font(T.h3).tracking(T.h3Track).foregroundStyle(T.l1)
                    }
                    Text(u.email).font(T.s).foregroundStyle(T.l3)
                    Text(u.paid ? "Curso completo" : "Parte gratuita")
                        .font(T.mono(10, .medium)).tracking(T.lblTrack).textCase(.uppercase)
                        .foregroundStyle(u.paid ? T.ok : T.l3)
                        .padding(.top, 4)
                }
                .padding(.bottom, 14)
            }
            Button {
                Task { await sesion.salir() }
            } label: {
                Text("Cerrar sesión")
                    .font(T.btn).tracking(T.btnTrack).textCase(.uppercase)
                    .foregroundStyle(T.rd)
                    .frame(maxWidth: .infinity, minHeight: T.tap)
                    .overlay(RoundedRectangle(cornerRadius: T.radius).strokeBorder(T.rd.opacity(0.4), lineWidth: 1))
            }
        }
    }

    /// Gestion que la web ya resuelve. Enlazar es honesto; duplicar el flujo de
    /// pago o el borrado en la app v1 seria una segunda implementacion a mantener.
    private var enlaces: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("En la web").label().padding(.bottom, 10)
            enlace("Ajustes de la cuenta", "https://aifromscratch.shop/ajustes")
            enlace("Perfil y progreso", "https://aifromscratch.shop/perfil")
            enlace("Soporte", "https://aifromscratch.shop/soporte")
            enlace("Privacidad", "https://aifromscratch.shop/privacidad")
            enlace("Términos", "https://aifromscratch.shop/terminos")
        }
    }

    private func enlace(_ titulo: String, _ url: String) -> some View {
        Link(destination: URL(string: url)!) {
            HStack {
                Text(titulo).font(.system(size: 15)).foregroundStyle(T.l2)
                Spacer()
                Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(T.l3)
            }
            .frame(minHeight: T.tap)
            .contentShape(Rectangle())
        }
        .overlay(alignment: .bottom) { Rectangle().fill(T.hair2).frame(height: 1) }
    }
}

// MARK: - Ranking

struct RankingView: View {
    @Environment(Sesion.self) private var sesion
    @State private var datos: RankingData?
    @State private var cargando = true
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Ranking").label(T.l1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let d = datos {
                    if let puesto = d.yo.puesto, d.yo.apuntado {
                        Text("Vas de \(puesto)º como \(d.yo.alias ?? "")")
                            .font(T.h3).tracking(T.h3Track).foregroundStyle(T.l1)
                    } else if !d.yo.apuntado {
                        Text("Aún no estás apuntado. Se entra desde la web, en Ranking, eligiendo un alias.")
                            .font(T.s).lineSpacing(T.sLine).foregroundStyle(T.l3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    VStack(spacing: 0) {
                        ForEach(Array(d.tabla.enumerated()), id: \.element.id) { i, fila in
                            HStack(spacing: 12) {
                                Text("\(i + 1)").font(T.mono(13)).monospacedDigit().foregroundStyle(T.l3)
                                    .frame(width: 30, alignment: .leading)
                                Text(fila.alias).font(.system(size: 15)).foregroundStyle(T.l1)
                                Spacer()
                                Text("\(fila.lecciones) lec · \(fila.labs) labs")
                                    .font(T.mono(11)).monospacedDigit().foregroundStyle(T.l3)
                            }
                            .frame(minHeight: 44)
                            .overlay(alignment: .bottom) { Rectangle().fill(T.hair2).frame(height: 1) }
                        }
                    }
                    if d.tabla.isEmpty {
                        Text("Todavía no hay nadie en la tabla.").font(T.s).foregroundStyle(T.l3)
                    }
                } else if cargando {
                    ProgressView().tint(T.l3).frame(maxWidth: .infinity).padding(.top, 60)
                }
                if let error { Aviso(texto: error) }
            }
            .padding(18)
        }
        .background(T.bg)
        .toolbarBackground(T.bg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task {
            do { datos = try await API.shared.ranking() }
            catch APIFailure.sinSesion { await sesion.salir() }
            catch let f as APIFailure { error = f.errorDescription }
            catch let otro { error = otro.localizedDescription }
            cargando = false
        }
    }
}

// MARK: - Ligas

struct LigasView: View {
    @Environment(Sesion.self) private var sesion
    @State private var datos: LigasData?
    @State private var cargando = true
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Ligas").label(T.l1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let d = datos {
                    if !d.activa {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("La liga aún no arranca").font(T.h3).tracking(T.h3Track).foregroundStyle(T.l1)
                            if let faltan = d.faltan, let minimo = d.minimo {
                                Text("Faltan \(faltan) personas apuntadas: arranca con \(minimo).")
                                    .font(T.s).lineSpacing(T.sLine).foregroundStyle(T.l3)
                            }
                        }
                        .padding(18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(Rectangle().strokeBorder(T.hair2, lineWidth: 1))
                    } else {
                        if let yo = d.yo {
                            Text("Liga \(yo.metal) · vas de \(yo.puesto)º con \(yo.caudal)")
                                .font(T.h3).tracking(T.h3Track).foregroundStyle(T.l1)
                        }
                        VStack(spacing: 0) {
                            ForEach(d.tabla) { fila in
                                HStack(spacing: 12) {
                                    Text(fila.puesto.map(String.init) ?? "–")
                                        .font(T.mono(13)).monospacedDigit().foregroundStyle(T.l3)
                                        .frame(width: 30, alignment: .leading)
                                    Text(fila.alias).font(.system(size: 15)).foregroundStyle(T.l1)
                                    Text(fila.metal)
                                        .font(T.mono(10, .medium)).tracking(T.lblTrack).textCase(.uppercase)
                                        .foregroundStyle(T.or)
                                    Spacer()
                                    Text("\(fila.caudal)")
                                        .font(T.mono(13)).monospacedDigit().foregroundStyle(T.l2)
                                }
                                .frame(minHeight: 44)
                                .overlay(alignment: .bottom) { Rectangle().fill(T.hair2).frame(height: 1) }
                            }
                        }
                    }
                } else if cargando {
                    ProgressView().tint(T.l3).frame(maxWidth: .infinity).padding(.top, 60)
                }
                if let error { Aviso(texto: error) }
            }
            .padding(18)
        }
        .background(T.bg)
        .toolbarBackground(T.bg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task {
            do { datos = try await API.shared.ligas() }
            catch APIFailure.sinSesion { await sesion.salir() }
            catch let f as APIFailure { error = f.errorDescription }
            catch let otro { error = otro.localizedDescription }
            cargando = false
        }
    }
}
