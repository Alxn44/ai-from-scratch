package io.alpadev.iadesdecero

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

// MARK: Modelos
//
// Campos copiados del contrato real, no supuestos:
//   user    auth/src/index.ts:55   shapeUser
//   lesson  api/src/server.ts:144  LessonCard + lo que /api/lessons añade
//   lab     api/src/server.ts:145  LabIndex + `solved`

@Serializable
data class User(
    val id: Int,
    val email: String,
    val name: String,
    val role: String,
    val lang: String,
    val theme: String,
    val paid: Boolean,
    val cohort: String? = null,
)

@Serializable
data class Lab(
    val id: String,
    @SerialName("lesson_n") val lessonN: Int,
    val idx: Int,
    val level: String? = null,
    val kind: String? = null,
    val draft: Boolean = false,
    val solved: Boolean = false,
)

@Serializable
data class Lesson(
    val n: Int,
    val eyebrow: String? = null,
    val title: String,
    val summary: String? = null,
    val math: String? = null,
    @SerialName("math_cap") val mathCap: String? = null,
    val locked: Boolean = false,
    val labs: List<Lab> = emptyList(),
    val solved: Int = 0,
    val total: Int = 0,
)

// El cuerpo del login como tipo y no como `mapOf`: kotlinx no infiere el
// serializador de un Map generico y, mas util que eso, un tipo hace que añadir
// un campo al login sea un cambio que el compilador ve.
@Serializable private data class LoginReq(val email: String, val password: String)
@Serializable private data class LoginOK(val user: User)
@Serializable private data class LessonsOK(val lessons: List<Lesson>)
@Serializable private data class ApiErr(val error: String? = null, val left: Int? = null)

// MARK: Errores

sealed class Fallo(val texto: String) : Exception(texto) {
    data object Credenciales : Fallo("Correo o contraseña incorrectos.")
    data object Bloqueada    : Fallo("Cuenta bloqueada por intentos fallidos.")
    data object SinSesion    : Fallo("La sesión caducó.")
    data object RequierePago : Fallo("Esta lección es de pago.")
    class Servidor(code: Int, msg: String) : Fallo("El servidor respondió $code. $msg")
    class Red(msg: String) : Fallo("No se pudo conectar. $msg")
}

/**
 * Guarda las cookies entre lanzamientos.
 *
 * AQUI ANDROID PIERDE CONTRA iOS Y HAY QUE ESCRIBIRLO A MANO. En iOS
 * `HTTPCookieStorage.shared` persiste en disco sola y el cliente no escribe una
 * linea de persistencia. OkHttp no trae ningun almacen: su `CookieJar` por
 * defecto es `CookieJar.NO_COOKIES`, y `JavaNetCookieJar` con `CookieManager`
 * guarda en memoria, asi que la sesion se pierde al cerrar la app y el usuario
 * vuelve al login cada vez. Esto es ese almacen.
 *
 * Se guarda la cadena `Set-Cookie` completa y se reconstruye con
 * `Cookie.parse`, en vez de guardar nombre y valor: asi `expires`, `secure`,
 * `httpOnly` y `path` sobreviven al viaje y una cookie caducada se descarta al
 * cargarla en vez de mandarse muerta al servidor.
 */
class CookiesEnDisco(context: Context) : CookieJar {
    private val prefs = context.getSharedPreferences("cookies", Context.MODE_PRIVATE)

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (cookies.isEmpty()) return
        val vivas = cookies.filter { it.expiresAt > System.currentTimeMillis() }
        prefs.edit().putStringSet(url.host, vivas.map { it.toString() }.toSet()).apply()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val guardadas = prefs.getStringSet(url.host, emptySet()) ?: return emptyList()
        return guardadas.mapNotNull { Cookie.parse(url, it) }
            .filter { it.expiresAt > System.currentTimeMillis() }
    }

    fun borrar() = prefs.edit().clear().apply()

    fun hayAlgo(host: String): Boolean =
        (prefs.getStringSet(host, emptySet()) ?: emptySet()).isNotEmpty()
}

/**
 * Cliente de la API de produccion.
 *
 * La sesion va por cookie, no por Bearer: `auth/src/index.ts:127` hace
 * `setCookie` y `api/src/server.ts:748` la lee de `req.cookies`. El unico
 * `Bearer` del backend (server.ts:856) es el secreto de servicio entre api y
 * payments y no tiene nada que ver con el usuario.
 *
 * Se entra por el MISMO origen publico que el navegador, `/api/...`, dejando que
 * `web/src/pages/api/[...path].ts` añada el prefijo `v3`. Si algun dia pasa a v4
 * esta clase no se entera.
 */
class Api(context: Context) {

    private val jar = CookiesEnDisco(context.applicationContext)

    private val http = OkHttpClient.Builder()
        .cookieJar(jar)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    // `ignoreUnknownKeys`: el backend puede añadir un campo a LessonCard sin que
    // esta app deje de arrancar. Lo contrario es acoplar cada despliegue del
    // servidor a una release en Play.
    private val json = Json { ignoreUnknownKeys = true }

    private suspend fun pedir(metodo: String, ruta: String, cuerpo: String? = null): String =
        withContext(Dispatchers.IO) {
            val req = Request.Builder()
                .url(ORIGEN.newBuilder().addPathSegments(ruta).build())
                .header("accept", "application/json")
                .apply {
                    if (cuerpo != null) method(metodo, cuerpo.toRequestBody(JSON_TYPE))
                    else method(metodo, null)
                }
                .build()

            val res = try { http.newCall(req).execute() }
                      catch (e: IOException) { throw Fallo.Red(e.message ?: "sin detalle") }

            res.use {
                val texto = it.body?.string().orEmpty()
                if (it.isSuccessful) return@withContext texto

                // Los codigos de `error:` son valores de cable; se comparan tal
                // cual y no se traducen. CLAUDE.md los lista como excepcion.
                val code = runCatching { json.decodeFromString<ApiErr>(texto).error }.getOrNull()
                throw when {
                    it.code == 401 && code == "credenciales" -> Fallo.Credenciales
                    it.code == 401                           -> Fallo.SinSesion
                    it.code == 423                           -> Fallo.Bloqueada
                    it.code == 402                           -> Fallo.RequierePago
                    else -> Fallo.Servidor(it.code, code.orEmpty())
                }
            }
        }

    private inline fun <reified X> leer(texto: String): X =
        try { json.decodeFromString<X>(texto) }
        catch (e: Exception) {
            // Un fallo de decodificacion es un cambio de contrato, no de red.
            // Confundirlos manda a alguien a mirar el wifi durante una hora.
            throw Fallo.Servidor(200, "El formato de la respuesta cambió: ${e.message}")
        }

    suspend fun login(email: String, password: String): User {
        val cuerpo = json.encodeToString(
            LoginReq.serializer(),
            LoginReq(email.trim().lowercase(), password),
        )
        return leer<LoginOK>(pedir("POST", "api/auth/login", cuerpo)).user
    }

    suspend fun logout() {
        runCatching { pedir("POST", "api/auth/logout", "{}") }
        jar.borrar()
    }

    suspend fun lessons(): List<Lesson> =
        leer<LessonsOK>(pedir("GET", "api/lessons")).lessons

    /** Hay cookie guardada. No prueba que siga valida: eso solo lo dice el servidor. */
    fun haySesionGuardada(): Boolean = jar.hayAlgo(ORIGEN.host)

    companion object {
        val ORIGEN: HttpUrl = "https://aifromscratch.shop".toHttpUrl()
        private val JSON_TYPE = "application/json".toMediaType()
    }
}
