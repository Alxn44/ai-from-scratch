package io.alpadev.iadesdecero

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
fun LessonsScreen(api: Api, alSalir: () -> Unit) {
    var lecciones by remember { mutableStateOf<List<Lesson>>(emptyList()) }
    var cargando by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var abierta by remember { mutableStateOf<Lesson?>(null) }
    val alcance = rememberCoroutineScope()

    suspend fun cargar() {
        error = null
        try {
            lecciones = api.lessons()
        } catch (f: Fallo) {
            // La cookie caduco o el servidor la invalido. No se enseña un error:
            // se vuelve al login, que es lo unico que se puede hacer al respecto.
            if (f is Fallo.SinSesion) alSalir() else error = f.texto
        } catch (e: Exception) {
            error = e.message ?: "Error desconocido."
        }
        cargando = false
    }

    LaunchedEffect(Unit) { cargar() }

    val elegida = abierta
    if (elegida != null) {
        LessonDetailScreen(elegida) { abierta = null }
        return
    }

    Column(Modifier.fillMaxSize().background(T.bg).safeDrawingPadding()) {

        // Cabecera de UNA fila. El handoff (anotacion `m-panel`) documenta que en
        // la web el slot topbar de panel.astro:46 es un duplicado exacto del
        // boton de :60 -- mismo href -- y que se borra, no se rescata. Aqui no
        // se reproduce ese slot.
        Row(
            Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("El curso".uppercase(), style = T.lbl.copy(color = T.l1))
            Spacer(Modifier.weight(1f))
            Box(
                Modifier
                    // Suelo tactil tambien aqui. El handoff señala que en la web
                    // los `.navlink` medían 10px de ALTO y con el pulgar no se
                    // aciertan. No se repite el defecto.
                    .sizeIn(minWidth = T.tap, minHeight = T.tap)
                    .clickable { alcance.launch { alSalir() } },
                contentAlignment = Alignment.CenterEnd,
            ) {
                Text("Salir".uppercase(), style = T.lbl)
            }
        }
        Filete()

        if (cargando && lecciones.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.l3)
            }
            return@Column
        }

        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 18.dp, bottom = 32.dp)) {

            error?.let {
                item { Aviso(it, Modifier.padding(horizontal = 18.dp)); Spacer(Modifier.height(18.dp)) }
            }

            if (lecciones.isNotEmpty()) {
                item { Resumen(lecciones); Spacer(Modifier.height(22.dp)) }
            }

            items(lecciones, key = { it.n }) { l ->
                Fila(l) { abierta = l }
            }
        }
    }
}

/** Cuantos labs llevas de cuantos hay. `.bar` / `.barfill` del CSS. */
@Composable
private fun Resumen(lecciones: List<Lesson>) {
    val hechos = lecciones.sumOf { it.solved }
    val todos = lecciones.sumOf { it.total }
    val frac = if (todos > 0) hechos.toFloat() / todos else 0f

    Column(Modifier.padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Progreso".uppercase(), style = T.lbl)
            Spacer(Modifier.weight(1f))
            Text("$hechos/$todos", style = T.lbl.copy(color = T.l1))
        }
        Box(Modifier.fillMaxWidth().height(4.dp).background(T.barTrack)) {
            Box(Modifier.fillMaxWidth(frac).height(4.dp).background(T.l1))
        }
    }
}

/**
 * Una leccion en la lista.
 *
 * Es `.row-m` del handoff: dos filas por leccion en vez de las cinco columnas
 * del escritorio. La anotacion `m-panel` dice por que -- en la web, a 390px, la
 * tabla se recorta a tres columnas y se pierden los labs y el contador. Aqui no
 * se recortan.
 */
@Composable
private fun Fila(l: Lesson, alTocar: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = alTocar)
            .padding(horizontal = 18.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                "%02d".format(l.n),
                style = T.num.copy(color = if (l.locked) T.l3 else T.ac),
                modifier = Modifier.width(32.dp),
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                l.eyebrow?.takeIf { it.isNotBlank() }?.let { Text(it.uppercase(), style = T.lbl) }
                Text(l.title, style = T.h3.copy(color = if (l.locked) T.l2 else T.l1))
                l.summary?.takeIf { it.isNotBlank() }?.let { Text(it, style = T.s) }
            }
            Spacer(Modifier.width(8.dp))
            when {
                l.locked -> Etiqueta("De pago", T.or)
                l.total > 0 && l.solved == l.total -> Etiqueta("Hecha", T.ok)
                else -> Etiqueta("Abierta", T.l3)
            }
        }
        if (l.total > 0) {
            Text(
                "${l.solved}/${l.total} labs".uppercase(),
                style = T.lbl,
                modifier = Modifier.padding(start = 44.dp),
            )
        }
    }
    Filete()
}
