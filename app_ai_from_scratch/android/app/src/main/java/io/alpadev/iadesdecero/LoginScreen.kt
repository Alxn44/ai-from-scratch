package io.alpadev.iadesdecero

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(api: Api, alEntrar: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var clave by remember { mutableStateOf("") }
    var cargando by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val alcance = rememberCoroutineScope()

    val completo = email.isNotBlank() && clave.isNotEmpty()

    Column(
        Modifier
            .fillMaxSize()
            .background(T.bg)
            .verticalScroll(rememberScrollState())
            .safeDrawingPadding()
            .padding(horizontal = 24.dp)
            .padding(top = 60.dp, bottom = 40.dp)
            .widthIn(max = 430.dp),
        horizontalAlignment = Alignment.Start,
    ) {
        // Marca. En la web es un cuadro con "IA" y el nombre al lado
        // (login.astro:41). Mismo par aqui.
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
            Box(Modifier.size(30.dp).background(T.btnBg), contentAlignment = Alignment.Center) {
                Text("IA", style = T.btn.copy(fontSize = androidx.compose.ui.unit.TextUnit(13f, androidx.compose.ui.unit.TextUnitType.Sp)))
            }
            Text("IA desde cero", style = T.h3)
        }
        Spacer(Modifier.height(40.dp))

        Text("Entrar".uppercase(), style = T.eb)
        Spacer(Modifier.height(8.dp))

        Text("Vuelve al curso", style = T.h1)
        Spacer(Modifier.height(12.dp))

        Text(
            "Doce lecciones, treinta y seis labs y un tutor que solo ve tus datos.",
            style = T.p,
        )
        Spacer(Modifier.height(30.dp))

        CampoTexto("Correo", email, { email = it }, teclado = KeyboardType.Email)
        Spacer(Modifier.height(18.dp))
        CampoTexto("Contraseña", clave, { clave = it }, seguro = true, imeAction = ImeAction.Done)
        Spacer(Modifier.height(18.dp))

        error?.let {
            Aviso(it)
            Spacer(Modifier.height(18.dp))
        }

        BotonPrimario("Entrar", cargando = cargando, habilitado = completo) {
            alcance.launch {
                cargando = true
                error = null
                try {
                    api.login(email, clave)
                    alEntrar()
                } catch (f: Fallo) {
                    // El backend distingue 401 credenciales de 423 bloqueada
                    // (auth/src/index.ts:114 y :118). La app tambien: "no te
                    // sabes la clave" y "agotaste los intentos" piden cosas
                    // distintas del usuario.
                    error = f.texto
                } catch (e: Exception) {
                    error = e.message ?: "Error desconocido."
                }
                cargando = false
            }
        }

        Spacer(Modifier.height(22.dp))
        Text("¿No tienes cuenta? Créala en aifromscratch.shop", style = T.s)
    }
}
