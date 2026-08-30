import SwiftUI

/// «Más»: lo que en la web es el resto del menu lateral — exámenes, ranking,
/// ligas y los ajustes de la cuenta. Todo dentro de la app; lo unico que sigue
/// enlazando a la web es lo que la web resuelve mejor o no puede vivir aqui
/// (la compra, las paginas legales).
struct MasView: View {
    @Environment(Sesion.self) private var sesion
    @State private var verRanking = false
    @State private var verLigas = false
    @State private var verExamenes = false
    @State private var verAjustes = false
    @State private var sonidoOn = Sonido.suena

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    Text(L.mas).label(T.l1)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    seccion(L.curso) {
                        fila(L.examenes) { verExamenes = true }
                    }
                    seccion(L.comunidad) {
                        fila(L.ranking) { verRanking = true }
                        fila(L.ligas) { verLigas = true }
                    }
                    seccion(L.cuenta) {
                        fila(L.ajustes) { verAjustes = true }
                        Toggle(isOn: $sonidoOn) {
                            Text(L.sonido).font(.system(size: 15)).foregroundStyle(T.l1)
                        }
                        .tint(T.ac)
                        .frame(minHeight: T.tap)
                        .onChange(of: sonidoOn) { Sonido.silenciar(!sonidoOn) }
                        .overlay(alignment: .bottom) { Rectangle().fill(T.hair2).frame(height: 1) }
                    }
                    enlaces
                }
                .padding(18)
                .padding(.bottom, 32)
            }
            .background(T.bg)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(isPresented: $verRanking) { RankingView() }
            .navigationDestination(isPresented: $verLigas) { LigasView() }
            .navigationDestination(isPresented: $verExamenes) { ExamenesView() }
            .navigationDestination(isPresented: $verAjustes) { AjustesView() }
            .onAppear {
                #if DEBUG
                switch QA.valor("IA_QA_MAS") {
                case "ranking":  verRanking = true
                case "ligas":    verLigas = true
                case "examenes": verExamenes = true
                case "ajustes":  verAjustes = true
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

    /// Lo que la web resuelve y aqui no se duplica: la compra (decision de
    /// negocio pendiente sobre compras dentro de la app) y las paginas legales,
    /// que son texto y deben poder cambiar sin publicar una version.
    private var enlaces: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(L.enLaWeb).label().padding(.bottom, 10)
            enlace(L.verPrecio, "https://aifromscratch.shop/pago")
            enlace(L.soporte, "https://aifromscratch.shop/soporte")
            enlace(L.privacidad, "https://aifromscratch.shop/privacidad")
            enlace(L.terminos, "https://aifromscratch.shop/terminos")
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
    @State private var alias = ""
    @State private var apuntando = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(L.ranking).label(T.l1)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let d = datos {
                    if d.yo.apuntado, let puesto = d.yo.puesto {
                        HStack {
                            Text(rellena(L.vasDe, ["p": puesto, "a": d.yo.alias ?? ""]))
                                .font(T.h3).tracking(T.h3Track).foregroundStyle(T.l1)
                            Spacer()
                            Button(L.salirRanking) { salir() }
                                .font(T.s).foregroundStyle(T.l3)
                                .frame(minHeight: T.tap)
                        }
                    } else {
                        alta
                    }

                    VStack(spacing: 0) {
                        ForEach(Array(d.tabla.enumerated()), id: \.element.id) { i, fila in
                            HStack(spacing: 12) {
                                Text("\(i + 1)").font(T.mono(13)).monospacedDigit().foregroundStyle(T.l3)
                                    .frame(width: 30, alignment: .leading)
                                Text(fila.alias).font(.system(size: 15)).foregroundStyle(T.l1)
                                Spacer()
                                Text("\(fila.lecciones) · \(fila.labs) \(L.labsMin)")
                                    .font(T.mono(11)).monospacedDigit().foregroundStyle(T.l3)
                            }
                            .frame(minHeight: 44)
                            .overlay(alignment: .bottom) { Rectangle().fill(T.hair2).frame(height: 1) }
                        }
                    }
                    if d.tabla.isEmpty {
                        Text(L.tablaVacia).font(T.s).foregroundStyle(T.l3)
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
        .task { await cargar() }
    }

    /// Apuntarse con alias, DENTRO de la app. La web lo tiene y aqui solo se
    /// podia mirar la tabla: el alias es lo unico publico — ni el nombre ni el
    /// correo salen del servidor — y por eso se elige, no se deriva.
    private var alta: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L.noApuntado)
                .font(T.s).lineSpacing(T.sLine).foregroundStyle(T.l3)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                TextField(L.alias, text: $alias)
                    .font(.system(size: 15))
                    .foregroundStyle(T.l1)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(.horizontal, 14)
                    .frame(height: T.tap)
                    .background(T.fill)
                    .overlay(Rectangle().strokeBorder(T.hair2, lineWidth: 1))
                Button(action: apuntarse) {
                    ZStack {
                        Text(L.apuntarme)
                            .font(T.btn).tracking(T.btnTrack).textCase(.uppercase)
                            .opacity(apuntando ? 0 : 1)
                        if apuntando { ProgressView().controlSize(.small).tint(T.btnFg) }
                    }
                    .foregroundStyle(T.btnFg)
                    .padding(.horizontal, 16)
                    .frame(minHeight: T.tap)
                    .background(T.btnBg.opacity(alias.count >= 3 ? 1 : 0.3))
                    .clipShape(RoundedRectangle(cornerRadius: T.radius))
                }
                .disabled(alias.count < 3 || apuntando)
            }
        }
    }

    private func apuntarse() {
        apuntando = true
        error = nil
        Task {
            do {
                _ = try await API.shared.apuntarseRanking(alias: alias)
                alias = ""
                await cargar()
            } catch let APIFailure.servidor(codigo, motivo) where codigo == 409 || motivo == "alias_tomado" {
                error = L.aliasTomado
            } catch let APIFailure.servidor(codigo, _) where codigo == 400 {
                error = L.aliasMalo
            } catch let f as APIFailure {
                error = f.errorDescription
            } catch let otro {
                error = otro.localizedDescription
            }
            apuntando = false
        }
    }

    private func salir() {
        Task {
            do { try await API.shared.salirRanking(); await cargar() }
            catch let f as APIFailure { error = f.errorDescription }
            catch let otro { error = otro.localizedDescription }
        }
    }

    private func cargar() async {
        error = nil
        do { datos = try await API.shared.ranking() }
        catch APIFailure.sinSesion { await sesion.salir() }
        catch let f as APIFailure { error = f.errorDescription }
        catch let otro { error = otro.localizedDescription }
        cargando = false
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
                Text(L.ligas).label(T.l1)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let d = datos {
                    if !d.activa {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(L.ligaNoArranca).font(T.h3).tracking(T.h3Track).foregroundStyle(T.l1)
                            if let faltan = d.faltan, let minimo = d.minimo {
                                Text(rellena(L.ligaFaltan, ["n": faltan, "m": minimo]))
                                    .font(T.s).lineSpacing(T.sLine).foregroundStyle(T.l3)
                            }
                        }
                        .padding(18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(Rectangle().strokeBorder(T.hair2, lineWidth: 1))
                    } else {
                        if let yo = d.yo {
                            Text("\(L.liga) \(yo.metal) · \(rellena(L.vasDe, ["p": yo.puesto, "a": yo.alias]))")
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
