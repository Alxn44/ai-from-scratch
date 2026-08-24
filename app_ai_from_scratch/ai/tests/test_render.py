from __future__ import annotations

import pytest

from course_ai.ontology.data import TABLES, TOOLS
from course_ai.ontology.render import (
    catalog,
    document,
    fingerprint,
    render_for_model,
    system_prompt,
)


@pytest.mark.parametrize("lang", ["es", "en"])
def test_the_ontology_block_does_not_name_what_is_forbidden(lang):
    """Naming `labs.solution` in the column inventory is teaching the model that it
    exists and what it is called. The behaviour RULE may say «never reveal a lab
    solution» — and in English that contains the word «solution», which is not the
    column's name. That is why the ontology block is checked, not the whole prompt."""
    p = render_for_model(lang)
    for forbidden in ("solution", "pass_hash", "locked_until", "ext_id", "deleted_at"):
        assert forbidden not in p, forbidden
    for whole_table in ("payments", "role_audit"):
        assert whole_table not in p, whole_table


@pytest.mark.parametrize("lang", ["es", "en"])
def test_not_even_the_whole_prompt_names_a_qualified_column(lang):
    p = system_prompt(lang)
    for ref in ("labs.solution", "users.pass_hash", "payments.raw", "attempts.user_id"):
        assert ref not in p, ref


@pytest.mark.parametrize("lang", ["es", "en"])
def test_what_is_allowed_does_appear(lang):
    p = render_for_model(lang)
    for c in ("prompt", "payload", "explanation", "alias", "caudal"):
        assert c in p, c


def test_the_two_languages_give_different_prompts():
    assert system_prompt("es") != system_prompt("en")
    assert fingerprint("es") != fingerprint("en")


def test_the_fingerprint_is_stable():
    assert fingerprint("es") == fingerprint("es")


def test_the_catalog_declares_no_person_argument():
    for h in catalog():
        for arg in h["argumentos"]:
            assert "user" not in arg.lower() and "id_" not in arg.lower(), h


def test_every_column_has_a_valid_sensitivity():
    for name, t in TABLES.items():
        for col, c in t.columns.items():
            assert c.sensitivity in ("publico", "propio", "agregado", "jamas"), f"{name}.{col}"


# ---------------------------------------------------------------------------
# THE GENERATED DOCUMENT
#
# It replaced scripts/gen-ontologia.mjs, which rendered the same document from the
# v2 record in api/src/ontology.js — a hand-written copy of this prose that nothing
# compared against data.py. These tests pin the two statements that copy carried
# and that must not come back, plus the fact that every number is counted.
FAMILIES = (("contenido", ("curso_indice",)), ("propio", ("mi_progreso",)))


def test_the_header_names_the_real_source():
    """The old document said it was generated from `api/src/ontology.js`. That file's
    ontology record is the dead v2 copy, so the claim pointed a reader at the wrong
    truth."""
    doc = document(FAMILIES)
    assert "ai/src/course_ai/ontology/data.py" in doc
    assert "pnpm ontology" in doc
    assert "api/src/ontology.js" not in doc


def test_it_does_not_claim_a_rejected_argument_comes_back():
    """The old document said an undeclared key «queda registrada en la respuesta como
    `_ignorado`». That field was removed on purpose: naming the key you just refused
    tells the model which one to try next."""
    doc = document(FAMILIES)
    assert "discarded and written to the server log" in doc
    assert "Nothing about it comes back in the response." in doc
    # It may only appear as history, never as current behaviour.
    assert "queda registrada" not in doc
    assert "used to be echoed" in doc


def test_it_carries_both_axes_and_says_they_are_orthogonal():
    doc = document(FAMILIES)
    assert "orthogonal" in doc
    for value in ("publico", "propio", "agregado", "jamas", "gratis", "de_pago"):
        assert f"`{value}`" in doc, value


def test_it_carries_all_four_obligations():
    doc = document(FAMILIES)
    for p in ("**P1**", "**P2**", "**P3**", "**P4**"):
        assert p in doc, p


def test_every_table_and_column_is_rendered_with_both_axes():
    doc = document(FAMILIES)
    for name, t in TABLES.items():
        assert f"### `{name}`" in doc, name
        for col, c in t.columns.items():
            assert f"| `{col}` | `{c.sensitivity}` | `{c.paywall}` |" in doc, f"{name}.{col}"


def test_a_note_containing_a_pipe_does_not_break_the_table():
    """`users.role` reads «student | tutor | admin». Unescaped, that silently splits
    the row into extra columns and the table stops being readable."""
    doc = document(FAMILIES)
    assert "student \\| tutor \\| admin" in doc
    assert "| student | tutor | admin" not in doc


def test_the_counts_are_counted_and_not_typed():
    doc = document(FAMILIES)
    n_cols = sum(len(t.columns) for t in TABLES.values())
    assert f"{len(TABLES)} tables · {n_cols} columns · {len(TOOLS)} tools" in doc


def test_the_tool_families_come_from_the_registry():
    """The grouping is Node's, so a family the registry does not report cannot appear —
    and a name the registry reports that this ontology does not declare is called out
    rather than dropped."""
    doc = document((("contenido", ("curso_indice", "no_declarada_aqui")),))
    assert "### family `contenido` · 2" in doc
    assert "`curso_indice`" in doc
    assert "**not declared in data.py**" in doc


def test_the_document_ends_with_a_single_newline():
    doc = document(FAMILIES)
    assert doc.endswith("\n") and not doc.endswith("\n\n")


CAPS = (("queue", 32), ("stack", 16), ("memo", 96), ("sessions", 400))


def test_the_caps_are_rendered_when_the_emitter_reports_them():
    """They are read out of `CAPS` in api/src/agent-bus.ts by the emitter, so the
    document can state them without holding a second copy."""
    doc = document(FAMILIES, CAPS)
    for name, value in CAPS:
        assert f"| `{name}` | {value} |" in doc, name
    assert "cannot drift from the code because they are not copied" in doc


def test_without_caps_it_names_the_module_instead_of_inventing_numbers():
    """The fallback states where the numbers live. What it must never do is print a
    number nobody read — that is the second copy this generator exists to remove."""
    doc = document(FAMILIES)
    assert "The caps on all three live in `CAPS` in `api/src/agent-bus.ts`" in doc
    assert "| `queue` |" not in doc
    for hardcoded in ("32", "16", "96", "400"):
        assert f"| {hardcoded} |" not in doc, hardcoded


def test_a_cap_the_emitter_did_not_report_is_not_rendered():
    """Whatever keys come back are rendered; nothing is assumed to exist."""
    doc = document(FAMILIES, (("queue", 8),))
    assert "| `queue` | 8 |" in doc
    assert "| `sessions` |" not in doc
