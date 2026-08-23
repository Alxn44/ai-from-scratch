// Postgres. Un contenedor propio para la base (docker compose: db), así el backend
// puede escalar a varias instancias sin pelearse por un archivo.
import pg from 'pg';

const { Pool } = pg;
const url = process.env.DATABASE_URL ?? 'postgres://curso:curso@localhost:5432/curso';
export const pool = new Pool({ connectionString: url, max: 8 });

// Los SQL se escriben con ? (venían de SQLite); Postgres numera los parámetros.
const dollars = (text) => { let i = 0; return text.replace(/\?/g, () => '$' + ++i); };

export const get = async (text, params = []) => (await pool.query(dollars(text), params)).rows[0] ?? null;
export const all = async (text, params = []) => (await pool.query(dollars(text), params)).rows;
export const run = async (text, params = []) => (await pool.query(dollars(text), params));

// El contenedor de la base tarda en aceptar conexiones aunque el healthcheck pase.
export async function ready(tries = 40) {
  for (let i = 1; i <= tries; i++) {
    try { await pool.query('SELECT 1'); return; } catch (e) {
      if (i === tries) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

export async function migrate() {
  await ready();
  await pool.query(`
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  pass_hash  TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','tutor','admin')),
  lang       TEXT NOT NULL DEFAULT 'auto',   -- auto = idioma del dispositivo
  theme      TEXT NOT NULL DEFAULT 'auto',   -- auto = prefers-color-scheme
  paid       SMALLINT NOT NULL DEFAULT 0,
  cohort     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  failed     SMALLINT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  -- Borrado suave: la fila se conserva (los intentos y la cohorte siguen cuadrando)
  -- y el correo se rota para que la persona pueda volver a registrarse.
  deleted_at TIMESTAMPTZ,
  -- Va dentro del JWT. Subirla invalida las sesiones abiertas en otros equipos:
  -- es lo que hace verdad que «cambiar la contraseña cierra las otras sesiones».
  token_version INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- Recuperación de contraseña. Se guarda el HASH del token, nunca el token: si se
-- filtra la base, nadie puede canjear un enlace pendiente.
CREATE TABLE IF NOT EXISTS reset_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS reset_user ON reset_tokens(user_id, created_at);

CREATE TABLE IF NOT EXISTS lessons (
  n        INTEGER PRIMARY KEY,
  eyebrow  TEXT NOT NULL,
  title    TEXT NOT NULL,
  summary  TEXT NOT NULL,
  math     TEXT NOT NULL,
  math_cap TEXT NOT NULL,
  -- Dos registros por lección: primero el mecanismo con precisión, después la
  -- imagen cotidiana. Vacíos hasta que se redacten (ver CONTENIDO-LECCIONES.md).
  technical TEXT NOT NULL DEFAULT '',
  analogy   TEXT NOT NULL DEFAULT ''
);
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS technical TEXT NOT NULL DEFAULT '';
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS analogy   TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS labs (
  id          TEXT PRIMARY KEY,           -- '5.2'
  lesson_n    INTEGER NOT NULL REFERENCES lessons(n),
  idx         SMALLINT NOT NULL,          -- 1 | 2 | 3
  level       TEXT NOT NULL CHECK (level IN ('facil','medio','dificil')),
  kind        TEXT NOT NULL,              -- choice | cut | order | knob | build | hotcold
  prompt      TEXT NOT NULL,
  payload     TEXT NOT NULL,              -- JSON visible para el cliente
  solution    TEXT NOT NULL,              -- JSON, NUNCA sale al cliente
  explanation TEXT NOT NULL,
  draft       SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attempts (
  id       SERIAL PRIMARY KEY,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lab_id   TEXT NOT NULL REFERENCES labs(id),
  answer   TEXT NOT NULL,
  correct  SMALLINT NOT NULL,
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attempts_user ON attempts(user_id, lab_id);

CREATE TABLE IF NOT EXISTS payments (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  provider   TEXT NOT NULL DEFAULT 'mercadopago',
  ext_id     TEXT UNIQUE,
  status     TEXT NOT NULL,               -- approved | rejected | pending | refunded
  amount     DOUBLE PRECISION NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'USD',
  raw        TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Texto de enseñanza por lección e idioma: explicación técnica, analogía y
-- ejemplos resueltos. Una fila por idioma para poder añadir fr/pt sin tocar el
-- esquema ni duplicar columnas.
CREATE TABLE IF NOT EXISTS lesson_text (
  lesson_n  INTEGER NOT NULL REFERENCES lessons(n) ON DELETE CASCADE,
  lang      TEXT NOT NULL,
  technical TEXT NOT NULL,
  analogy   TEXT NOT NULL,
  examples  JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (lesson_n, lang)
);

CREATE TABLE IF NOT EXISTS achievements (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code      TEXT NOT NULL,
  kind      TEXT NOT NULL,
  lesson_n  INTEGER,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code)
);
CREATE INDEX IF NOT EXISTS logro_user ON achievements(user_id, earned_at DESC);

-- Ligas semanales: bronce, plata, oro. Una fila por persona y semana cerrada.
--
-- QUE MIDE: el CAUDAL de la semana, o sea cuantos labs distintos resolviste por
-- PRIMERA vez en esa semana. No el total acumulado: si midiera el total, quien
-- empezo antes gana para siempre y el que entra hoy no compite nunca.
--
-- POR QUE NO SE PUEDE INFLAR: la fecha que cuenta es MIN(at) de los intentos
-- correctos de cada lab. Volver a resolver un lab ya resuelto no mueve nada
-- porque su MIN(at) sigue en la semana original. No hace falta detectar trampa:
-- la consulta no la admite.
--
-- SEMANA: lunes 00:00 a domingo 23:59:59 en America/Bogota. UNA zona declarada
-- para todo el producto. Con la zona de cada cual, dos personas ven cierres
-- distintos y la tabla deja de ser comparable.
--
-- CIERRE IDEMPOTENTE: la clave primaria (user_id, week) mas ON CONFLICT DO
-- NOTHING. Cerrar dos veces la misma semana no duplica ni altera nada, asi que
-- el cron puede reintentar sin miedo.
--
-- ESTADO TERMINAL: quien ya resolvio los 36 labs no puede generar caudal, asi que
-- bajaria de liga por haber terminado. Esos van a estado 'salon' y se quedan con
-- su metal: no se les degrada por acabar el curso.
CREATE TABLE IF NOT EXISTS league_week (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week     DATE NOT NULL,                -- lunes de la semana, en America/Bogota
  metal    TEXT NOT NULL,                -- bronce | plata | oro
  caudal   INTEGER NOT NULL DEFAULT 0,   -- labs resueltos por primera vez esa semana
  puesto   INTEGER,                      -- dentro de su metal, 1 = arriba
  estado   TEXT NOT NULL DEFAULT 'activo', -- activo | salon
  cerrada  SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, week)
);
CREATE INDEX IF NOT EXISTS liga_semana ON league_week(week, metal, caudal DESC);

-- Cola de trabajos (v3). Postgres como cola: ver el porque en trabajos.js.
CREATE TABLE IF NOT EXISTS jobs (
  id         SERIAL PRIMARY KEY,
  tipo       TEXT NOT NULL,
  -- (tipo, clave) UNIQUE es lo que hace encola() idempotente: el reintento de un
  -- webhook trae el mismo id de pago y no crea un segundo trabajo.
  clave      TEXT NOT NULL,
  datos      JSONB NOT NULL DEFAULT '{}'::jsonb,
  estado     TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','curso','hecho','muerto')),
  intentos   SMALLINT NOT NULL DEFAULT 0,
  error      TEXT,
  corre_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  tomado_en  TIMESTAMPTZ,
  acabado_en TIMESTAMPTZ,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tipo, clave)
);
-- El indice es el que hace que tomaLote() no lea la tabla entera: filtra por
-- estado y ordena por corre_en, que es exactamente lo que hace la consulta.
CREATE INDEX IF NOT EXISTS jobs_listos ON jobs (estado, corre_en) WHERE estado = 'pendiente';

CREATE TABLE IF NOT EXISTS ranking_optin (
  user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  alias     TEXT NOT NULL UNIQUE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_audit (
  id        SERIAL PRIMARY KEY,
  actor_id  INTEGER NOT NULL,
  user_id   INTEGER NOT NULL,
  from_role TEXT NOT NULL,
  to_role   TEXT NOT NULL,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
`);
}
