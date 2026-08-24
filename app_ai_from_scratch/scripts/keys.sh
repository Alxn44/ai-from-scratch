#!/usr/bin/env bash
#
# Genera los secretos que SON NUESTROS y arma los .env.
#
#   scripts/keys.sh                 32 bytes (256 bits) — lo correcto para HMAC
#   scripts/keys.sh --bits 2048     256 bytes, si lo quieres asi de todos modos
#   scripts/keys.sh --rsa           ademas, par RSA 2048 (solo si mueves a RS256)
#   scripts/keys.sh --force         sobrescribe .env existentes (hace copia .bak)
#   scripts/keys.sh --print         solo imprime, no escribe nada
#
# LO QUE ESTE SCRIPT NO PUEDE HACER, y es importante:
#
#   MP_ACCESS_TOKEN, MP_PUBLIC_KEY y MP_WEBHOOK_SECRET los emite Mercado Pago en
#   su panel. No son aleatorios: identifican TU cuenta. Generarlos con openssl
#   produce cadenas validas en forma e inutiles en fondo, y el checkout falla en
#   silencio. Se dejan como marcadores y los pegas tu.
#   -> https://www.mercadopago.com.co/developers/panel/app
#
# SOBRE LOS 2048 BITS:
#
#   api/src/auth.js:29 firma con createHmac('sha256', SECRET). HMAC-SHA256 tiene
#   bloque de 64 bytes y, por RFC 2104 seccion 3, una clave mas larga que el
#   bloque SE HASHEA A 32 BYTES antes de usarse. Un secreto de 2048 bits (256
#   bytes) se reduce a 256 bits antes de firmar: no es mas fuerte que uno de 32
#   bytes, solo mas largo en el archivo. 2048 es el numero de RSA, no de HMAC.
#   El script acepta --bits por si lo quieres igual, y avisa.
#
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BITS=256
RSA=0
FORCE=0
PRINT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --bits)  BITS="${2:?--bits necesita un numero}"; shift 2 ;;
    --rsa)   RSA=1; shift ;;
    --force) FORCE=1; shift ;;
    --print) PRINT=1; shift ;;
    -h|--help) sed -n '3,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "opcion desconocida: $1" >&2; exit 2 ;;
  esac
done

command -v openssl >/dev/null || { echo "falta openssl" >&2; exit 1; }

case "$BITS" in
  ''|*[!0-9]*) echo "--bits tiene que ser un numero" >&2; exit 2 ;;
esac
[ "$BITS" -ge 128 ] || { echo "--bits por debajo de 128 no se acepta" >&2; exit 2; }
[ $(( BITS % 8 )) -eq 0 ] || { echo "--bits tiene que ser multiplo de 8" >&2; exit 2; }
BYTES=$(( BITS / 8 ))

if [ "$BITS" -gt 512 ]; then
  echo "aviso: $BITS bits para HMAC-SHA256 no anade fuerza. RFC 2104: la clave se"
  echo "       hashea a 256 bits antes de firmar. 256 bits es el numero correcto."
  echo
fi

# El tr -d es obligatorio: openssl rand -base64 mete saltos de linea cada 64
# caracteres, y un secreto partido en dos lineas rompe el parseo del .env — el
# servidor arrancaria con la clave a medias y ningun token viejo validaria.
# (Sin -A: esa opcion no existe en el LibreSSL que trae macOS. Verificado.)
secreto() { openssl rand -base64 "$1" | tr -d '\n'; }

JWT="$(secreto "$BYTES")"
# Secreto de servicio entre la API (Node) y el servicio de IA (Python). NO es
# autenticacion de usuario: prueba que la llamada a /api/interno/* viene del
# servicio y no de internet. La persona la sigue identificando la cookie.
# 32 bytes por la misma razon que el JWT: 256 bits de aleatorio no se adivinan.
# (Este comentario decia «se compara con ===, no se hashea». Ya no: esDelServicio
# hashea los dos lados con SHA-256 y los compara con timingSafeEqual, porque ===
# corta en el primer byte distinto. Un comentario que describe la implementacion
# vieja es peor que ninguno: manda a revisar el sitio equivocado.)
IA="$(secreto 32)"
# Sin simbolos porque va dentro de una URL de conexion: un + o un / ahi hay que
# percent-encodearlo y la mitad de los clientes no lo hacen. Se piden 48 bytes y
# se cortan 32 caracteres: tr -dc descarta +/= y con 24 bytes salia de 28 a 32,
# o sea entropia variable. Con 48 siempre sobra material para los 32 exactos.
DBPASS="$(secreto 48 | tr -dc 'A-Za-z0-9' | cut -c1-32)"
DBUSER=curso
DBNAME=curso
# Broker (RabbitMQ). Alfanumerico por lo mismo que la de Postgres: va dentro de
# amqp://app:CLAVE@broker:5672/ y un + o un / ahi hay que percent-encodearlo.
# RabbitMQ trae guest/guest de fabrica y solo acepta guest desde localhost; en un
# contenedor eso no protege nada, asi que el usuario se llama `app` y la clave se
# genera. Sin default en el yaml: va como ${RABBITMQ_PASSWORD:?}.
MQPASS="$(secreto 48 | tr -dc 'A-Za-z0-9' | cut -c1-32)"
# Data service (data/, Go). El unico proceso de la flota que tiene la credencial
# de Postgres; api le habla por HTTP y presenta este secreto en x-data-secreto.
# 32 bytes en base64 dan 44 caracteres, y data/internal/httpapi RECHAZA arrancar
# con menos de 32 o con una palabra de relleno dentro: no hay valor por defecto
# que sirva, ni siquiera en desarrollo.
DATASEC="$(secreto 32)"

# What this run ACTUALLY did, so the closing report can tell the truth instead
# of announcing a rotation that escribe() skipped. Space-separated, paths
# relative to RAIZ.
ESCRITOS=""
OMITIDOS=""

escribe() {                      # escribe() destino contenido
  local dest="$1" cont="$2"
  if [ -e "$dest" ] && [ "$FORCE" -eq 0 ]; then
    echo "  existe, NO se toca: ${dest#$RAIZ/}   (usa --force)"
    OMITIDOS="$OMITIDOS ${dest#$RAIZ/}"
    return
  fi
  if [ -e "$dest" ]; then
    cp -p "$dest" "$dest.bak.$(date +%Y%m%d%H%M%S)"
    echo "  copia previa: ${dest#$RAIZ/}.bak.*"
  fi
  # 0600 ANTES de escribir: si se crea 0644 y luego se cambia, hay una ventana en
  # la que el secreto es legible por cualquier usuario de la maquina.
  ( umask 077; printf '%s\n' "$cont" > "$dest" )
  chmod 600 "$dest"
  echo "  escrito 0600: ${dest#$RAIZ/}"
  ESCRITOS="$ESCRITOS ${dest#$RAIZ/}"
}

# ¿Escribio esta corrida ese archivo? (comparacion de palabra completa: ".env"
# no debe casar con "api/.env")
se_escribio() { case " $ESCRITOS " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

API_ENV="# Generado por scripts/keys.sh — no se sube a ningun repositorio.
# JWT_SECRET: $BITS bits. Obligatorio en produccion (api/src/auth.js:4 revienta sin el).
JWT_SECRET=$JWT

DATABASE_URL=postgres://$DBUSER:$DBPASS@localhost:5432/$DBNAME

WEB_ORIGIN=http://localhost:4321
PORT=8787
NODE_ENV=development

# --- Servicio de IA (ai/, Python) -------------------------------------------
# Desde v3 el bucle del agente vive en ai/. La API le habla por HTTP y el
# secreto es compartido: tiene que ser el MISMO en api/.env y en ai/.env.
IA_URL=http://127.0.0.1:8799
IA_SECRETO=$IA

# --- Servicio de datos (data/, Go) ------------------------------------------
# api NO deberia tener DATABASE_URL: la credencial vive solo en data/ y en el
# servicio init. Mientras dure la migracion conviven las dos cosas, y el DSN de
# arriba desaparece cuando el ultimo call site deje de usar src/db.ts.
DATA_URL=http://127.0.0.1:8788
DATA_SECRETO=$DATASEC

# --- Mercado Pago: ESTOS TRES NO SE GENERAN --------------------------------
# Los emite Mercado Pago y son de tu cuenta. Pegalos del panel:
#   https://www.mercadopago.com.co/developers/panel/app
# Sin los dos primeros, /api/payments responde 501 en vez de fingir un pago.
MP_ACCESS_TOKEN=
MP_PUBLIC_KEY=
MP_WEBHOOK_SECRET="

WEB_ENV="# Generado por scripts/keys.sh
API_URL=http://localhost:8787
PUBLIC_SITE=http://localhost:4321
# La publica de Mercado Pago SI va en el cliente: es publica a proposito.
MP_PUBLIC_KEY="

AI_ENV="# Generado por scripts/keys.sh — servicio de IA (Python, v3).
# El MISMO valor que IA_SECRETO en api/.env: si difieren, la API recibe 401 del
# servicio y el chat responde 502 sin explicar por que.
IA_SECRETO=$IA
NODE_URL=http://127.0.0.1:8787
PORT=8799

# --- Llaves de modelo: las lee ESTE servicio, no la API ----------------------
# Basta una. El orden se fija con PROVEEDOR_ORDEN (ej: anthropic,deepseek).
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=
DEEPSEEK_API_KEY=
KIMI_API_KEY=
HF_TOKEN=
OPENCODE_API_KEY=
PROVEEDOR_ORDEN="

# The compose-level .env. It sits next to docker-compose.yml because that is the
# only place Compose looks for interpolation values. The three secrets below are
# declared with ${VAR:?} in docker-compose.yml, so a missing one aborts
# `docker compose up` instead of silently starting with a known value.
# POSTGRES_PASSWORD feeds BOTH the db service and the api's DATABASE_URL — it
# used to be a literal `curso` in the yaml, which is why rotating it here did
# nothing at all.
ROOT_ENV="# Lo que lee docker-compose.yml por interpolacion. Sin estas cinco,
# 'docker compose up' aborta: en el yaml van como \${VAR:?}, no con valor por defecto.
JWT_SECRET=$JWT
IA_SECRETO=$IA
POSTGRES_PASSWORD=$DBPASS
RABBITMQ_PASSWORD=$MQPASS
DATA_SECRETO=$DATASEC
MP_ACCESS_TOKEN=
MP_PUBLIC_KEY=
MP_WEBHOOK_SECRET="

if [ "$PRINT" -eq 1 ]; then
  echo "JWT_SECRET=$JWT"
  echo "IA_SECRETO=$IA"
  echo "POSTGRES_PASSWORD=$DBPASS"
  echo "RABBITMQ_PASSWORD=$MQPASS"
  echo "DATA_SECRETO=$DATASEC"
  exit 0
fi

echo "archivos"
# El .env de la RAIZ puede traer llaves de otros proyectos (ANTON_*, Hostinger,
# Cloudflare, Meta). escribe() ya respeta lo que existe salvo --force, y con
# --force hace copia .bak — pero una copia .bak de la que nadie se acuerda es una
# llave perdida. Se avisa explicitamente antes de tocarlo.
if [ -e "$RAIZ/.env" ] && [ "$FORCE" -eq 1 ]; then
  ajenas=$(grep -cE '^(HOSTINGER|CLOUDFLARE|META|ANTON|GOOGLE|GEMINI|RAILWAY|API_KEY)' "$RAIZ/.env" 2>/dev/null || true)
  if [ "${ajenas:-0}" -gt 0 ]; then
    echo
    echo "OJO: $RAIZ/.env tiene $ajenas variables que NO son de esta plataforma"
    echo "     (Hostinger, Cloudflare, Meta, ANTON...). --force lo sobrescribe."
    echo "     Se guarda copia .bak, pero revisala antes de borrarla."
    printf '     ¿Sigo? [s/N] '
    read -r resp
    case "$resp" in s|S|si|SI|y|Y) ;; *) echo "     cancelado"; exit 1 ;; esac
  fi
fi

escribe "$RAIZ/api/.env" "$API_ENV"
escribe "$RAIZ/web/.env" "$WEB_ENV"
escribe "$RAIZ/ai/.env"  "$AI_ENV"
escribe "$RAIZ/.env"     "$ROOT_ENV"

if [ "$RSA" -eq 1 ]; then
  D="$RAIZ/scripts/keys"
  mkdir -p "$D"; chmod 700 "$D"
  if [ -e "$D/jwt-rs256.key" ] && [ "$FORCE" -eq 0 ]; then
    echo "  existe, NO se toca: scripts/keys/jwt-rs256.key   (usa --force)"
  else
    ( umask 077; openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
        -out "$D/jwt-rs256.key" 2>/dev/null )
    openssl rsa -in "$D/jwt-rs256.key" -pubout -out "$D/jwt-rs256.pub" 2>/dev/null
    chmod 600 "$D/jwt-rs256.key"; chmod 644 "$D/jwt-rs256.pub"
    echo "  par RSA 2048: scripts/keys/jwt-rs256.{key,pub}"
    echo "  OJO: auth.js firma con HMAC. Este par no se usa hasta que muevas a RS256."
  fi
fi

# .gitignore: un secreto correcto en un archivo versionado no es un secreto.
GI="$RAIZ/.gitignore"
for l in '.env' '*.env' 'api/.env' 'web/.env' 'ai/.env' '.env.bak.*' 'scripts/keys/' 'ai/.venv/' '__pycache__/' '.pytest_cache/'; do
  grep -qxF "$l" "$GI" 2>/dev/null || echo "$l" >> "$GI"
done
echo "  .gitignore cubre los .env y scripts/keys/"

echo
# This report used to announce "la clave de Postgres cambio" unconditionally,
# even on a run where escribe() had skipped every file because it already
# existed. A control that reports success while doing nothing is worse than no
# control: it stops anyone from looking. Only claim what actually happened.
if [ -n "$ESCRITOS" ]; then
  echo "escrito en esta corrida:$ESCRITOS"
  echo "  con JWT_SECRET ($BITS bits), IA_SECRETO y DATA_SECRETO (256 bits), POSTGRES_PASSWORD y RABBITMQ_PASSWORD (32 caracteres)"
else
  echo "NO se escribio nada: los cuatro .env ya existian."
  echo "  los secretos generados en esta corrida se DESCARTAN. Nada roto."
  echo "  para rotarlos de verdad: scripts/keys.sh --force"
fi
# if, not `[ ... ] && echo`: under `set -e` a false AND-list at statement level
# aborts the script, so an empty OMITIDOS would kill the rest of the report.
if [ -n "$OMITIDOS" ]; then echo "intacto (ya existia):$OMITIDOS"; fi
echo "lo tienes que pegar tu: MP_ACCESS_TOKEN, MP_PUBLIC_KEY, MP_WEBHOOK_SECRET"

# The .env at the root is the one Compose reads. If it was not rewritten, the
# database password did not change and saying otherwise sends the operator to
# wipe a volume for nothing.
if se_escribio ".env"; then
  echo
  echo "la clave de Postgres de .env es NUEVA, pero el volumen pgdata sigue con la"
  echo "anterior: Postgres solo aplica POSTGRES_PASSWORD al inicializar el volumen."
  echo "  docker compose down -v && docker compose up -d --wait db && pnpm --dir api seed"
  echo "  (el -v borra el volumen; los intentos guardados se van con el)"
else
  echo
  echo "la clave de Postgres NO cambio: .env no se reescribio. El volumen sigue igual."
fi
