package io.alpadev.iadesdecero

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * Los mismos tokens que `ios/Sources/Tokens.swift`, que a su vez son los de
 * `web/src/lib/theme-css.ts` copiados sin redondear.
 *
 * DOS DIFERENCIAS REALES CON iOS, y ninguna es cosmetica:
 *
 * 1. Las medidas van en `dp` y los textos en `sp`. En iOS un punto es un punto;
 *    en Android el usuario puede escalar el texto en Ajustes y `sp` lo respeta
 *    mientras `dp` no. El suelo tactil de 44 es `dp` porque un dedo no cambia de
 *    tamaño con los ajustes de accesibilidad; los tamaños de fuente son `sp`
 *    porque el texto si debe.
 *
 * 2. El tracking se expresa en `em`, que es como lo declara el CSS, en vez de
 *    convertirlo a puntos como hubo que hacer en SwiftUI. Aqui sale gratis y
 *    ademas sobrevive al escalado del punto 1.
 */
object T {

    // Color
    val bg      = Color(0xFF000000)
    val panel   = Color(0xFF0B0B0C)

    val l1      = Color(0xFFFFFFFF)
    val l2      = Color(0xFFEBEBF5).copy(alpha = 0.62f)
    val l3      = Color(0xFFEBEBF5).copy(alpha = 0.50f)

    val hair    = Color(0xFF545458).copy(alpha = 0.46f)
    val hair2   = Color(0xFF545458).copy(alpha = 0.16f)
    val fill    = Color(0xFF787880).copy(alpha = 0.22f)

    val ac      = Color(0xFF0A84FF)
    val acSolid = Color(0xFF0A6CFF)
    val ok      = Color(0xFF30D158)
    val or      = Color(0xFFFF9F0A)
    val rd      = Color(0xFFFF453A)

    val btnBg   = Color(0xFFFFFFFF)
    val btnFg   = Color(0xFF000000)

    val barTrack = Color(0xFF787880).copy(alpha = 0.20f)

    // Tipografia
    //
    // El CSS usa `-apple-system` para el cuerpo y `ui-monospace` para las
    // etiquetas. En Android el equivalente del primero es la fuente del sistema
    // (Roboto), que es lo que da FontFamily.Default. No se empaqueta SF Pro: es
    // de Apple y su licencia no permite redistribuirla en una app Android.

    val lbl = TextStyle(
        fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium,
        fontSize = 10.sp, letterSpacing = 0.18.em, color = l3,
    )
    val eb = TextStyle(
        fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold,
        fontSize = 10.sp, letterSpacing = 0.22.em, color = ac,
    )
    val h1 = TextStyle(
        fontWeight = FontWeight.Bold, fontSize = 34.sp,
        lineHeight = 36.sp, letterSpacing = (-0.035).em, color = l1,
    )
    val h2 = TextStyle(
        fontWeight = FontWeight.Bold, fontSize = 21.sp,
        lineHeight = 24.sp, letterSpacing = (-0.028).em, color = l1,
    )
    val h3 = TextStyle(
        fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
        lineHeight = 20.sp, letterSpacing = (-0.01).em, color = l1,
    )
    val p = TextStyle(
        fontSize = 16.sp, lineHeight = 24.sp, color = l2,
    )
    val s = TextStyle(
        fontSize = 13.sp, lineHeight = 19.sp, color = l3,
    )
    val btn = TextStyle(
        fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold,
        fontSize = 11.sp, letterSpacing = 0.10.em, color = btnFg,
    )
    val est = TextStyle(
        fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium,
        fontSize = 10.sp, letterSpacing = 0.12.em,
    )
    val num = TextStyle(
        fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium,
        fontSize = 13.sp, color = l3,
    )

    // Medidas
    val tap = 44.dp
    val radius = 6.dp
}
