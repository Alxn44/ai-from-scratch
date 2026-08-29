package io.alpadev.iadesdecero

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val api = Api(applicationContext)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(background = T.bg, surface = T.bg)) {
                Root(api)
            }
        }
    }
}

/** Quien esta dentro. Una sola fuente, en la raiz. */
class SesionVM(private val api: Api) : ViewModel() {
    sealed interface Estado {
        data object Comprobando : Estado
        data object Fuera : Estado
        data object Dentro : Estado
    }

    var estado by mutableStateOf<Estado>(Estado.Comprobando)
        private set

    /**
     * Al arrancar no se pregunta al servidor: si hay cookie guardada se entra y
     * la primera peticion real dira si sigue valida. Un `/api/lessons` de tanteo
     * antes de pintar nada añade un salto de red a cada arranque para responder
     * algo que la siguiente pantalla ya va a preguntar.
     */
    fun arrancar() {
        estado = if (api.haySesionGuardada()) Estado.Dentro else Estado.Fuera
    }

    fun entrar() { estado = Estado.Dentro }

    fun salir() = viewModelScope.launch {
        api.logout()
        estado = Estado.Fuera
    }
}

@Composable
fun Root(api: Api) {
    val vm = remember { SesionVM(api) }
    LaunchedEffect(Unit) { vm.arrancar() }

    Box(Modifier.fillMaxSize().background(T.bg)) {
        when (vm.estado) {
            SesionVM.Estado.Comprobando ->
                CircularProgressIndicator(color = T.l3, modifier = Modifier.align(Alignment.Center))
            SesionVM.Estado.Fuera  -> LoginScreen(api) { vm.entrar() }
            SesionVM.Estado.Dentro -> LessonsScreen(api, alSalir = { vm.salir() })
        }
    }
}

// MARK: Piezas compartidas

/** `.btn` del CSS: 44 de alto, mono 11, .1em, mayusculas, radio 6. */
@Composable
fun BotonPrimario(
    titulo: String,
    cargando: Boolean = false,
    habilitado: Boolean = true,
    modifier: Modifier = Modifier,
    accion: () -> Unit,
) {
    Button(
        onClick = accion,
        enabled = habilitado && !cargando,
        shape = RoundedCornerShape(T.radius),
        colors = ButtonDefaults.buttonColors(
            containerColor = T.btnBg,
            contentColor = T.btnFg,
            disabledContainerColor = T.btnBg.copy(alpha = 0.30f),
            disabledContentColor = T.btnFg.copy(alpha = 0.60f),
        ),
        contentPadding = PaddingValues(horizontal = 20.dp),
        modifier = modifier.fillMaxWidth().heightIn(min = T.tap),
    ) {
        if (cargando) {
            CircularProgressIndicator(color = T.btnFg, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
        } else {
            Text(titulo.uppercase(), style = T.btn)
        }
    }
}

/**
 * `.input`: 44 de alto, fondo `fill`, borde `hair2`, texto 15.
 *
 * `BasicTextField` envuelto a mano y no `OutlinedTextField`: el de Material3
 * impone 56dp de alto minimo y una etiqueta flotante, y ninguna de las dos cosas
 * esta en el diseño. Pelear con sus defaults sale mas caro que componerlo.
 */
@Composable
fun CampoTexto(
    etiqueta: String,
    valor: String,
    alCambiar: (String) -> Unit,
    seguro: Boolean = false,
    teclado: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text(etiqueta.uppercase(), style = T.lbl)
        androidx.compose.foundation.text.BasicTextField(
            value = valor,
            onValueChange = alCambiar,
            singleLine = true,
            textStyle = TextStyle(color = T.l1, fontSize = androidx.compose.ui.unit.TextUnit(15f, androidx.compose.ui.unit.TextUnitType.Sp)),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(T.ac),
            visualTransformation = if (seguro) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = teclado, imeAction = imeAction),
            modifier = Modifier
                .fillMaxWidth()
                .height(T.tap)
                .background(T.fill)
                .border(1.dp, T.hair2)
                .padding(horizontal = 14.dp),
            decorationBox = { inner ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterStart) { inner() }
            },
        )
    }
}

/** Aviso de error en linea. Nunca un dialogo: esconde el campo que hay que corregir. */
@Composable
fun Aviso(texto: String, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .background(T.rd.copy(alpha = 0.10f))
            .border(1.dp, T.rd.copy(alpha = 0.35f))
            .padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.padding(top = 6.dp).size(6.dp).clip(RoundedCornerShape(3.dp)).background(T.rd))
        Text(texto, style = T.s.copy(color = T.l2))
    }
}

/** `.est`: pastilla de estado con borde, nunca un icono suelto sin palabra. */
@Composable
fun Etiqueta(texto: String, color: Color) {
    Box(
        Modifier.height(26.dp).border(1.dp, color.copy(alpha = 0.40f)).padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(texto.uppercase(), style = T.est.copy(color = color))
    }
}

/** Linea de 1dp en `hair2`. Se repite en las tres pantallas. */
@Composable
fun Filete() = Box(Modifier.fillMaxWidth().height(1.dp).background(T.hair2))
