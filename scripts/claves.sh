#!/usr/bin/env bash
#
# Genera los secretos que SON NUESTROS y arma los .env.
#
#   scripts/claves.sh                 32 bytes (256 bits) — lo correcto para HMAC
#   scripts/claves.sh --bits 2048     256 bytes, si lo quieres asi de todos modos
#   scripts/claves.sh --rsa           ademas, par RSA 2048 (solo si mueves a RS256)
#   scripts/claves.sh --force         sobrescribe .env existentes (hace copia .bak)
#   scripts/claves.sh --print         solo imprime, no escribe nada
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
# 32 bytes es lo correcto por la misma razon que el JWT: se compara con ===,
# no se hashea, y 256 bits de aleatorio no se adivinan.
IA="$(secreto 32)"
# Sin simbolos porque va dentro de una URL de conexion: un + o un / ahi hay que
# percent-encodearlo y la mitad de los clientes no lo hacen. Se piden 48 bytes y
# se cortan 32 caracteres: tr -dc descarta +/= y con 24 bytes salia de 28 a 32,
# o sea entropia variable. Con 48 siempre sobra material para los 32 exactos.
DBPASS="$(secreto 48 | tr -dc 'A-Za-z0-9' | cut -c1-32)"
DBUSER=curso
DBNAME=curso

escribe() {                      # escribe() destino contenido
  local dest="$1" cont="$2"
  if [ -e "$dest" ] && [ "$FORCE" -eq 0 ]; then
    echo "  existe, NO se toca: ${dest#$RAIZ/}   (usa --force)"
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
}

API_ENV="# Generado por scripts/claves.sh — no se sube a ningun repositorio.
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

# --- Mercado Pago: ESTOS TRES NO SE GENERAN --------------------------------
# Los emite Mercado Pago y son de tu cuenta. Pegalos del panel:
#   https://www.mercadopago.com.co/developers/panel/app
# Sin los dos primeros, /api/payments responde 501 en vez de fingir un pago.
MP_ACCESS_TOKEN=
MP_PUBLIC_KEY=
MP_WEBHOOK_SECRET="

WEB_ENV="# Generado por scripts/claves.sh
API_URL=http://localhost:8787
PUBLIC_SITE=http://localhost:4321
# La publica de Mercado Pago SI va en el cliente: es publica a proposito.
MP_PUBLIC_KEY="

AI_ENV="# Generado por scripts/claves.sh — servicio de IA (Python, v3).
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

ROOT_ENV="# Lo que lee docker-compose.yml por interpolacion.
JWT_SECRET=$JWT
IA_SECRETO=$IA
POSTGRES_PASSWORD=$DBPASS
MP_ACCESS_TOKEN=
MP_PUBLIC_KEY=
MP_WEBHOOK_SECRET="

if [ "$PRINT" -eq 1 ]; then
  echo "JWT_SECRET=$JWT"
  echo "IA_SECRETO=$IA"
  echo "POSTGRES_PASSWORD=$DBPASS"
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
  D="$RAIZ/scripts/claves"
  mkdir -p "$D"; chmod 700 "$D"
  if [ -e "$D/jwt-rs256.key" ] && [ "$FORCE" -eq 0 ]; then
    echo "  existe, NO se toca: scripts/claves/jwt-rs256.key   (usa --force)"
  else
    ( umask 077; openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
        -out "$D/jwt-rs256.key" 2>/dev/null )
    openssl rsa -in "$D/jwt-rs256.key" -pubout -out "$D/jwt-rs256.pub" 2>/dev/null
    chmod 600 "$D/jwt-rs256.key"; chmod 644 "$D/jwt-rs256.pub"
    echo "  par RSA 2048: scripts/claves/jwt-rs256.{key,pub}"
    echo "  OJO: auth.js firma con HMAC. Este par no se usa hasta que muevas a RS256."
  fi
fi

# .gitignore: un secreto correcto en un archivo versionado no es un secreto.
GI="$RAIZ/.gitignore"
for l in '.env' '*.env' 'api/.env' 'web/.env' 'ai/.env' '.env.bak.*' 'scripts/claves/' 'ai/.venv/' '__pycache__/' '.pytest_cache/'; do
  grep -qxF "$l" "$GI" 2>/dev/null || echo "$l" >> "$GI"
done
echo "  .gitignore cubre los .env y scripts/claves/"

echo
echo "generado por nosotros : JWT_SECRET ($BITS bits), IA_SECRETO (256 bits) y la clave de Postgres"
echo "lo tienes que pegar tu: MP_ACCESS_TOKEN, MP_PUBLIC_KEY, MP_WEBHOOK_SECRET"
echo
echo "la clave de Postgres cambio: el contenedor viejo sigue con la anterior."
echo "  docker compose down -v && pnpm db && pnpm --dir api seed"
echo "  (el -v borra el volumen; los intentos guardados se van con el)"
