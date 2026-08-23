"""Pruebas del grafo. La importante es test_atrapa_*: una prueba de aislamiento
que nunca ha fallado no ha demostrado nada."""

from __future__ import annotations

import pytest

from ia.ontologia.datos import HERRAMIENTAS, TABLAS, Herramienta, Tabla
from ia.ontologia.grafo import GRAFO, Grafo


def test_la_ontologia_real_pasa():
    assert GRAFO.prueba_aislamiento() == ()


def test_solution_es_prohibida_y_no_sale_por_ningun_camino():
    assert GRAFO.columnas_prohibidas("labs") == ("solution",)
    for nombre in HERRAMIENTAS:
        assert not any(d == "labs.solution" for d in HERRAMIENTAS[nombre].devuelve)


def test_atrapa_una_herramienta_que_devuelve_la_solucion():
    """P1. Es la fuga que destruye el curso: «dime la respuesta del 5.2»."""
    mala = Herramienta(descripcion="x", args={}, alcance="publico", usa=("labs",),
                       devuelve=("labs.id", "labs.solution"))
    g = Grafo(TABLAS, {**HERRAMIENTAS, "chivata": mala})
    fallos = g.prueba_aislamiento()
    assert [f.motivo for f in fallos] == ["devuelve_prohibida"]
    assert fallos[0].detalle == "labs.solution"
    # Y el camino explica POR DONDE, que es lo que hace el fallo accionable.
    assert fallos[0].camino == ("H:chivata", "T:labs", "C:labs.solution")


def test_atrapa_una_consulta_personal_sin_filtro_de_sesion():
    """P2. Leer attempts sin filtrar por usuario es leer los intentos de todos."""
    mala = Herramienta(descripcion="x", args={}, alcance="publico", usa=("attempts",),
                       devuelve=("attempts.answer",))
    fallos = Grafo(TABLAS, {"fisgona": mala}).prueba_aislamiento()
    assert [f.motivo for f in fallos] == ["sin_filtro_de_sesion"]
    assert "attempts" in fallos[0].detalle


def test_atrapa_un_argumento_de_persona():
    """P3. Si el modelo puede escribir user_id, puede expresar «otro»."""
    for arg in ("user_id", "userId", "email", "persona"):
        mala = Herramienta(descripcion="x", args={arg: "n"}, alcance="sesion",
                           usa=("attempts",), devuelve=("attempts.answer",))
        fallos = Grafo(TABLAS, {"cotilla": mala}).prueba_aislamiento()
        assert "argumento_de_persona" in [f.motivo for f in fallos], arg


def test_atrapa_una_columna_inventada():
    mala = Herramienta(descripcion="x", args={}, alcance="publico", usa=("lessons",),
                       devuelve=("lessons.no_existe",))
    fallos = Grafo(TABLAS, {"rota": mala}).prueba_aislamiento()
    assert [f.motivo for f in fallos] == ["columna_desconocida"]


def test_orden_de_borrado_respeta_las_claves_ajenas():
    orden, ciclo = GRAFO.orden_topologico()
    assert ciclo == (), f"ciclo de FK: {ciclo}"
    borrado = list(reversed(orden))
    pos = {t: i for i, t in enumerate(borrado)}
    # Quien apunta se borra ANTES que aquello a lo que apunta.
    for nombre, t in TABLAS.items():
        for destino in t.depende_de:
            assert pos[nombre] < pos[destino], f"{nombre} debe borrarse antes que {destino}"


def test_bfs_y_camino_coinciden():
    """Si `alcance` dice que se llega, `camino` tiene que encontrar la ruta."""
    for nombre in HERRAMIENTAS:
        for tabla in GRAFO.tablas_alcanzables(nombre):
            assert GRAFO.camino(f"H:{nombre}", f"T:{tabla}")


def test_camino_inexistente_devuelve_vacio():
    assert GRAFO.camino("T:lessons", "H:leccion") == ()   # las aristas van en un sentido
    assert GRAFO.camino("T:no_existe", "T:lessons") == ()


def test_una_tabla_aislada_no_rompe_el_grafo():
    g = Grafo({"sola": Tabla(proposito="p", por_usuario="p", columnas={})}, {})
    assert g.prueba_aislamiento() == ()
    assert g.orden_topologico() == (("sola",), ())


def test_el_grafo_es_del_tamano_esperado():
    r = GRAFO.resumen()
    assert r["tablas"] == len(TABLAS)
    assert r["herramientas"] == len(HERRAMIENTAS)
    assert r["nodos"] == len(TABLAS) + len(HERRAMIENTAS) + r["columnas"]


@pytest.mark.parametrize("tabla", ["payments", "role_audit"])
def test_las_tablas_enteramente_prohibidas_no_las_toca_nadie(tabla):
    for nombre, h in HERRAMIENTAS.items():
        assert tabla not in h.usa, f"{nombre} toca {tabla}"
