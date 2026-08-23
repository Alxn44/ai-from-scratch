from __future__ import annotations

import pytest

from ia.ontologia.datos import TABLAS
from ia.ontologia.render import catalogo, huella, prompt_sistema, render_para_modelo


@pytest.mark.parametrize("lang", ["es", "en"])
def test_el_bloque_de_ontologia_no_nombra_lo_prohibido(lang):
    """Nombrar `labs.solution` en el inventario de columnas es ensenarle que existe
    y como se llama. La REGLA de conducta si puede decir «no reveles la solucion de
    un lab» — y en ingles eso contiene la palabra «solution», que no es el nombre
    de la columna. Por eso se comprueba el bloque de ontologia, no el prompt entero."""
    p = render_para_modelo(lang)
    for prohibida in ("solution", "pass_hash", "locked_until", "ext_id", "deleted_at"):
        assert prohibida not in p, prohibida
    for tabla_entera in ("payments", "role_audit"):
        assert tabla_entera not in p, tabla_entera


@pytest.mark.parametrize("lang", ["es", "en"])
def test_ni_el_prompt_entero_nombra_una_columna_cualificada(lang):
    p = prompt_sistema(lang)
    for ref in ("labs.solution", "users.pass_hash", "payments.raw", "attempts.user_id"):
        assert ref not in p, ref


@pytest.mark.parametrize("lang", ["es", "en"])
def test_lo_permitido_si_aparece(lang):
    p = render_para_modelo(lang)
    for c in ("prompt", "payload", "explanation", "alias", "caudal"):
        assert c in p, c


def test_los_dos_idiomas_dan_prompts_distintos():
    assert prompt_sistema("es") != prompt_sistema("en")
    assert huella("es") != huella("en")


def test_la_huella_es_estable():
    assert huella("es") == huella("es")


def test_el_catalogo_no_declara_ningun_argumento_de_persona():
    for h in catalogo():
        for arg in h["argumentos"]:
            assert "user" not in arg.lower() and "id_" not in arg.lower(), h


def test_toda_columna_tiene_clase_valida():
    for nombre, t in TABLAS.items():
        for col, c in t.columnas.items():
            assert c.clase in ("publico", "propio", "agregado", "jamas"), f"{nombre}.{col}"
