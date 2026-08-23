"""El grafo de la ontologia, y la PRUEBA de aislamiento sobre el.

Por que un grafo y no una lista de reglas: el aislamiento no se rompe por una
columna suelta, se rompe por un CAMINO. `ranking_publico` no lee ninguna columna
prohibida, pero une `ranking_optin` con `attempts` de terceros; lo que hay que
poder responder es «por donde llega el modelo a esta columna», y eso es
alcanzabilidad, no pertenencia.

Nodos:  H:nombre (herramienta) · T:nombre (tabla) · C:tabla.columna
Aristas: H --usa--> T · T --une--> T · T --tiene--> C

Complejidad, con V nodos y E aristas:
    alcance(h)              BFS            O(V + E)
    alcance_tablas(h)       BFS memoizado  O(V + E) la primera vez, O(1) despues
    camino(a, b)            BFS con padres O(V + E)
    orden_topologico()      Kahn           O(V + E)
    prueba_aislamiento()    |H| BFS        O(|H| * (V + E))

Con |H|=7 y V~90 esto son microsegundos; la razon de escribirlo asi no es la
velocidad, es que un BFS memoizado se puede correr en cada test y en CI sin
pensarlo. La alternativa, un cierre transitivo O(V^3) de Floyd-Warshall, seria
16 veces mas trabajo para responder menos.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from functools import cached_property

from .datos import ARGS_PROHIBIDOS, HERRAMIENTAS, TABLAS, Herramienta, Tabla


@dataclass(frozen=True, slots=True)
class Violacion:
    """Un fallo de aislamiento, con el camino que lo produce. Sin el camino, un
    fallo no es accionable: dice que hay fuga y no por donde."""

    herramienta: str
    motivo: str
    detalle: str
    camino: tuple[str, ...] = ()

    def __str__(self) -> str:  # pragma: no cover - solo para el CLI
        ruta = "  ->  ".join(self.camino) if self.camino else "(directo)"
        return f"[{self.herramienta}] {self.motivo}: {self.detalle}\n    {ruta}"


def _t(nombre: str) -> str:
    return f"T:{nombre}"


def _h(nombre: str) -> str:
    return f"H:{nombre}"


def _c(tabla: str, col: str) -> str:
    return f"C:{tabla}.{col}"


class Grafo:
    """Lista de adyacencia sobre la ontologia. Se construye una vez y se consulta."""

    def __init__(self, tablas: Mapping[str, Tabla] = TABLAS,
                 herramientas: Mapping[str, Herramienta] = HERRAMIENTAS) -> None:
        self.tablas = tablas
        self.herramientas = herramientas
        self.ady: dict[str, tuple[str, ...]] = {}
        self._construye()

    # ---- construccion: O(V + E) ----
    def _construye(self) -> None:
        ady: dict[str, list[str]] = {}
        for nombre, t in self.tablas.items():
            # T --tiene--> C  y  T --une--> T
            ady[_t(nombre)] = [_c(nombre, c) for c in t.columnas]
            ady[_t(nombre)] += [_t(o) for o in t.une if o in self.tablas]
            for c in t.columnas:
                ady.setdefault(_c(nombre, c), [])
        for nombre, h in self.herramientas.items():
            ady[_h(nombre)] = [_t(x) for x in h.usa if x in self.tablas]
        self.ady = {k: tuple(v) for k, v in ady.items()}

    def vecinos(self, nodo: str) -> tuple[str, ...]:
        return self.ady.get(nodo, ())

    @cached_property
    def nodos(self) -> tuple[str, ...]:
        return tuple(self.ady)

    @cached_property
    def aristas(self) -> int:
        return sum(len(v) for v in self.ady.values())

    # ---- BFS: O(V + E) ----
    def alcance(self, inicio: Iterable[str]) -> frozenset[str]:
        vistos: set[str] = set(inicio)
        cola = deque(vistos)
        while cola:
            for v in self.vecinos(cola.popleft()):
                if v not in vistos:
                    vistos.add(v)
                    cola.append(v)
        return frozenset(vistos)

    def camino(self, desde: str, hasta: str) -> tuple[str, ...]:
        """BFS con padres. Devuelve el camino MAS CORTO, que es el que explica
        mejor la fuga: el largo siempre existe si el corto existe."""
        if desde == hasta:
            return (desde,)
        padre: dict[str, str] = {desde: desde}
        cola = deque([desde])
        while cola:
            u = cola.popleft()
            for v in self.vecinos(u):
                if v in padre:
                    continue
                padre[v] = u
                if v == hasta:
                    ruta = [v]
                    while ruta[-1] != desde:
                        ruta.append(padre[ruta[-1]])
                    return tuple(reversed(ruta))
                cola.append(v)
        return ()

    def tablas_alcanzables(self, herramienta: str) -> frozenset[str]:
        """Tablas que la consulta puede tocar, joins incluidos."""
        return frozenset(n[2:] for n in self.alcance([_h(herramienta)]) if n.startswith("T:"))

    def vecindad_de_riesgo(self) -> Mapping[str, tuple[str, ...]]:
        """Aviso de diseno, no violacion: por herramienta, las tablas con datos
        personales que estan a un join de lo que ya lee. Es la lista de lo que se
        rompe si alguien anade un JOIN sin mirar el alcance."""
        out: dict[str, tuple[str, ...]] = {}
        for nombre, h in self.herramientas.items():
            si_toca = set(h.usa)
            cerca = sorted(
                t for t in self.tablas_alcanzables(nombre)
                if t not in si_toca
                and any(c.clase == "propio" for c in self.tablas[t].columnas.values()))
            if cerca:
                out[nombre] = tuple(cerca)
        return out

    # ---- Kahn: O(V + E) ----
    def orden_topologico(self) -> tuple[tuple[str, ...], tuple[str, ...]]:
        """Kahn sobre las aristas DIRIGIDAS `depende_de`.

        Sirve para una cosa concreta: borrar una cuenta en el orden correcto —
        primero quien apunta, despues a quien apuntan. Hoy ese orden esta
        implicito en el codigo de borrado; aqui es un dato que se puede leer.

        Con `une` esto no funcionaba: `une` es simetrica (users<->attempts) y Kahn
        metia siete de nueve tablas en un ciclo. Un ciclo aqui SI es un error de
        modelado, y por eso se devuelve para poder afirmarlo en un test.
        """
        entrantes = {n: 0 for n in self.tablas}
        for nombre, t in self.tablas.items():
            for o in t.depende_de:
                if o in entrantes:
                    entrantes[nombre] += 1
        cola = deque(sorted(n for n, g in entrantes.items() if g == 0))
        orden: list[str] = []
        while cola:
            u = cola.popleft()
            orden.append(u)
            for otra, t in sorted(self.tablas.items()):
                if u in t.depende_de:
                    entrantes[otra] -= 1
                    if entrantes[otra] == 0:
                        cola.append(otra)
        ciclo = tuple(sorted(n for n, g in entrantes.items() if g > 0))
        return tuple(orden), ciclo

    # ---- la prueba ----
    def prueba_aislamiento(self) -> tuple[Violacion, ...]:
        """Tres obligaciones. Si las tres se cumplen, un usuario no puede llegar
        a datos de otro ni a una columna prohibida por ningun camino declarado.

        P1  Ninguna herramienta DEVUELVE una columna de clase `jamas`.
        P2  Toda herramienta que alcanza una tabla con columnas `propio` declara
            alcance `sesion` o `agregado`. Alcanzarla con alcance `publico`
            significa una consulta sin filtro por usuario.
        P3  Ninguna firma acepta un argumento con el que expresar «otra persona».
        """
        fallos: list[Violacion] = []
        for nombre, h in self.herramientas.items():
            # P1
            for ref in h.devuelve:
                tabla, _, col = ref.partition(".")
                t = self.tablas.get(tabla)
                if t is None:
                    fallos.append(Violacion(nombre, "tabla_desconocida", ref))
                    continue
                c = t.columnas.get(col)
                if c is None:
                    fallos.append(Violacion(nombre, "columna_desconocida", ref))
                elif c.clase == "jamas":
                    fallos.append(Violacion(nombre, "devuelve_prohibida", ref,
                                            self.camino(_h(nombre), _c(tabla, col))))
            # P2 se comprueba sobre `usa` — las tablas que la consulta TOCA —, no
            # sobre el cierre transitivo de `une`. Con el cierre, `curso_indice`
            # (que solo lee lessons) daba violacion por lessons -> labs ->
            # attempts -> users: cuatro fallos, ninguno real. Una prueba que grita
            # en verde se desactiva, y entonces no protege nada. El cierre sigue
            # calculandose, pero como aviso de diseno: vecindad_de_riesgo().
            if h.alcance == "publico":
                for tabla in sorted(x for x in h.usa if x in self.tablas):
                    personales = [c for c, x in self.tablas[tabla].columnas.items()
                                  if x.clase == "propio"]
                    if personales:
                        fallos.append(Violacion(
                            nombre, "sin_filtro_de_sesion",
                            f"{tabla} tiene columnas propias ({', '.join(personales)}) "
                            f"y la herramienta se declara publica",
                            self.camino(_h(nombre), _t(tabla))))
            # P3
            for arg in h.args:
                if arg.lower().replace("-", "_") in ARGS_PROHIBIDOS:
                    fallos.append(Violacion(nombre, "argumento_de_persona", arg))
        return tuple(fallos)

    def columnas_prohibidas(self, tabla: str) -> tuple[str, ...]:
        t = self.tablas.get(tabla)
        if t is None:
            return ()
        return tuple(c for c, x in t.columnas.items() if x.clase == "jamas")

    def resumen(self) -> Mapping[str, object]:
        orden, ciclo = self.orden_topologico()
        return {
            "nodos": len(self.nodos), "aristas": self.aristas,
            "tablas": len(self.tablas), "herramientas": len(self.herramientas),
            "columnas": sum(len(t.columnas) for t in self.tablas.values()),
            "prohibidas": sum(len(self.columnas_prohibidas(t)) for t in self.tablas),
            # El borrado va al REVES del orden topologico: primero quien apunta.
            "orden_borrado": tuple(reversed(orden)), "ciclo": ciclo,
            "vecindad_de_riesgo": self.vecindad_de_riesgo(),
            "violaciones": len(self.prueba_aislamiento()),
        }


GRAFO = Grafo()


def main() -> int:
    """`uv run ia-prueba-aislamiento`. Sale 1 si hay violaciones: sirve en CI."""
    g = GRAFO
    r = g.resumen()
    print(f"grafo: {r['nodos']} nodos, {r['aristas']} aristas "
          f"({r['tablas']} tablas, {r['columnas']} columnas, {r['herramientas']} herramientas)")
    print(f"columnas jamas: {r['prohibidas']}")
    print(f"orden de borrado: {' -> '.join(r['orden_borrado']) or '(vacio)'}")
    if r["ciclo"]:
        print(f"CICLO de claves ajenas (error de modelado): {', '.join(r['ciclo'])}")
    for h, cerca in sorted(r["vecindad_de_riesgo"].items()):
        print(f"aviso: {h} tiene a un join {', '.join(cerca)} (datos personales)")
    fallos = g.prueba_aislamiento()
    if not fallos:
        print("aislamiento: P1, P2 y P3 se cumplen en las 7 herramientas")
        return 0
    print(f"aislamiento: {len(fallos)} violacion(es)")
    for f in fallos:
        print(f"  {f}")
    return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
