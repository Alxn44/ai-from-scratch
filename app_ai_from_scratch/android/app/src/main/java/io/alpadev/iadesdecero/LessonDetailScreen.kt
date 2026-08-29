package io.alpadev.iadesdecero

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

@Composable
fun LessonDetailScreen(l: Lesson, alVolver: () -> Unit) {
    // El boton fisico de atras cierra el detalle. Sin esto sale de la app, que en
    // Android es el pecado clasico de una pila de navegacion hecha con un
    // booleano en vez de con el NavController.
    BackHandler(onBack = alVolver)

    val contexto = LocalContext.current

    Column(Modifier.fillMaxSize().background(T.bg).safeDrawingPadding()) {

        Row(
            Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.sizeIn(minWidth = T.tap, minHeight = T.tap).clickable(onClick = alVolver),
                contentAlignment = Alignment.CenterStart,
            ) {
                Text("< Volver".uppercase(), style = T.lbl)
            }
        }
        Filete()

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp)
                .padding(top = 18.dp, bottom = 40.dp)
        ) {
            val cabeza = l.eyebrow?.takeIf { it.isNotBlank() }
                ?.let { "%02d · %s".format(l.n, it) } ?: "%02d".format(l.n)
            Text(cabeza.uppercase(), style = T.eb)
            Spacer(Modifier.height(10.dp))

            Text(l.title, style = T.h1)
            Spacer(Modifier.height(14.dp))

            l.summary?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = T.p)
                Spacer(Modifier.height(26.dp))
            }

            // La tarjeta de matematicas. Regla del curso: numeros y
            // comparaciones, nunca formulas ni letras griegas.
            l.math?.takeIf { it.isNotBlank() }?.let { m ->
                Box(Modifier.fillMaxWidth().background(T.panel)) {
                    // El filete azul de 2dp: una caja hermana pegada al borde
                    // izquierdo y estirada a lo alto. Un `drawWithContent` a
                    // mano haria lo mismo con mas superficie donde equivocarse.
                    Box(Modifier.width(2.dp).fillMaxHeight().background(T.ac).align(Alignment.CenterStart))
                    Column(
                        Modifier.fillMaxWidth().padding(start = 20.dp, top = 18.dp, end = 18.dp, bottom = 18.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("La matemática".uppercase(), style = T.lbl)
                        Text(
                            m,
                            style = T.h1.copy(fontSize = 30.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.03).em),
                        )
                        l.mathCap?.takeIf { it.isNotBlank() }?.let { Text(it, style = T.s) }
                    }
                }
                Spacer(Modifier.height(26.dp))
            }

            if (l.locked) Muro(contexto) else if (l.labs.isNotEmpty()) Labs(l)
        }
    }
}

/**
 * El muro de pago.
 *
 * `LeccionCerrada.astro:29` es una de las roturas confirmadas del handoff: una
 * rejilla `1fr 320px` de 344px dentro de 334 disponibles. Aqui no hay rejilla de
 * dos columnas que romper, y el aviso dice QUE se compra: una leccion cerrada es
 * un escaparate, no un callejon sin salida.
 */
@Composable
private fun Muro(contexto: android.content.Context) {
    Column(
        Modifier.fillMaxWidth().border(1.dp, T.hair2).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("De pago".uppercase(), style = T.lbl.copy(color = T.or))
        Text("Esta lección está en la parte de pago del curso.", style = T.h3)
        Text("La compra se hace en la web. Al volver aquí, la lección estará abierta.", style = T.s.copy(color = T.l2))
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = T.tap)
                .clip(RoundedCornerShape(T.radius))
                .background(T.btnBg)
                .clickable {
                    contexto.startActivity(
                        Intent(Intent.ACTION_VIEW, Uri.parse("https://aifromscratch.shop/pago"))
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            Text("Ver el precio".uppercase(), style = T.btn)
        }
    }
}

@Composable
private fun Labs(l: Lesson) {
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Labs".uppercase(), style = T.lbl)
            Spacer(Modifier.weight(1f))
            Text("${l.solved}/${l.total}", style = T.lbl.copy(color = T.l1))
        }
        l.labs.forEach { lab ->
            // Es la fila 1 de las dos que el handoff marca rotas en `m-leccion`:
            // pastilla + nivel contra el estado con `space-between` y texto
            // largo. Aqui el titulo envuelve y el estado no se aplasta, porque no
            // compiten por la misma linea a la fuerza.
            Row(
                Modifier.fillMaxWidth().padding(vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("${lab.lessonN}.${lab.idx}", style = T.num.copy(fontSize = 11.sp), modifier = Modifier.width(38.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(lab.kind ?: "Lab", style = T.h3)
                    lab.level?.takeIf { it.isNotBlank() }?.let { Text(it.uppercase(), style = T.lbl) }
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    (if (lab.solved) "Resuelto" else "Pendiente").uppercase(),
                    style = T.est.copy(color = if (lab.solved) T.ok else T.l3),
                )
            }
            Filete()
        }
    }
}
