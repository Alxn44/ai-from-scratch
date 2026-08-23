# API · IA desde cero

Fastify 5 sobre Node 22. Sin ORM: `pg` contra Postgres 17,
`node:crypto` (scrypt + HMAC) para contraseñas y sesión.

```bash
pnpm install
cp .env.example .env      # pon JWT_SECRET
pnpm seed              # 12 lecciones, 36 labs, 3 usuarios de prueba
pnpm dev               # http://127.0.0.1:8787
```

## Lo que hay que saber antes de tocar esto

- **La corrección de los labs vive en el servidor** (`src/grade.js`). La columna
  `labs.solution` no sale nunca en una respuesta: `publicLab()` filtra. Si mueves la
  corrección al cliente, las respuestas quedan en el bundle de JS.
- **Borrado de cuenta = soft delete.** La fila se conserva (los intentos siguen contando
  para la cohorte), `deleted_at` se marca, el nombre se anonimiza y el correo se rota a
  `borrado+{id}@alpadev.local` para liberarlo. Todas las consultas de usuario filtran
  `deleted_at IS NULL`.
- **Nunca queda la plataforma sin admins**: bajar de rol o borrar al último admin
  devuelve 409.
- **Pagos**: sin `MP_ACCESS_TOKEN` las rutas devuelven 501 a propósito. El webhook
  verifica la firma `x-signature` con `MP_WEBHOOK_SECRET` antes de creer nada, y solo
  marca `paid = 1` cuando Mercado Pago confirma `approved`.
- **El agente tiene 37 herramientas y ninguna acepta un identificador de persona**
  (`src/agent-tools.js`). El `userId` sale de la cookie, en el servidor, y `ejecutar()`
  descarta cualquier clave que no esté declarada — queda anotada en `_ignorado`. Si
  añades una herramienta: declara su familia, si es pública o propia, y qué argumentos
  acepta; nada de un parámetro de usuario, y nada de leer `labs.solution`.
- **La pila y la cola del agente viven en memoria** (`src/agent-bus.js`), indexadas por
  sesión. La cola es el plan de estudio (una herramienta encola, otra consume), la pila es
  el foco de la conversación y el memo evita repetir la misma consulta dentro del turno.
  Un reinicio borra todo eso a propósito: no es un dato del que haya que responder, así
  que no hay tabla. Lo propio se cachea **solo dentro del turno**, porque entre dos
  mensajes la persona puede haber resuelto un lab en otra pestaña.
- **El precio vive en `src/producto.js`**, y de ahí lo leen el checkout y la herramienta
  `precio_y_compra`. Si cambia en un sitio y no en el otro, el chat miente.
- **Las ligas se calculan en `src/ligas.js`**, no en la ruta: lo usan `/api/ligas` y el
  agente, y con dos copias el chat y la pantalla contarían la semana distinto.
- Los 36 labs están escritos (`draft = 0`). Si alguno vuelve a `draft = 1`, responderlo
  devuelve 409 y el agente lo marca como borrador en vez de inventarle enunciado.

## Usuarios sembrados (solo desarrollo)

| Correo | Rol | Clave |
|---|---|---|
| ricardo@velez.co | student | `Curso2026*` |
| paula@correo.com | tutor | `Curso2026*` |
| founder.alpadev@gmail.com | admin | `Curso2026*` |

## Endpoints

| Método | Ruta | Quién |
|---|---|---|
| POST | `/api/auth/register` | público |
| POST | `/api/auth/login` | público (5 fallos → 15 min de bloqueo) |
| POST | `/api/auth/logout` | sesión |
| GET | `/api/me` | sesión |
| PATCH | `/api/settings` | sesión (`lang`, `theme`) |
| POST | `/api/account/delete` | sesión (pide contraseña) |
| GET | `/api/lessons` · `/api/lessons/:n` | sesión |
| POST | `/api/labs/:id/attempt` | sesión |
| GET | `/api/progress` | sesión |
| GET | `/api/pdf/:lang` | sesión con compra (402 si no) |
| GET | `/api/tutor/cohort` | tutor, admin |
| GET/PATCH | `/api/admin/users…` · `/api/admin/payments` | admin |
| POST | `/api/payments/mercadopago/preference` · `/webhook` | ver arriba |
| POST | `/api/chat` · GET `/api/chat/estado` | sesión (501 sin llave de proveedor) |

## Pruebas

```bash
pnpm test                  # las cuatro, en orden
pnpm test:aislamiento      # 74 · que no se pueda sacar nada de otra persona
pnpm test:bus              # 31 · FIFO, LIFO, topes y caché por turno (sin base)
pnpm test:herramientas     # 42 · que las 37 respondan y que la cola se consuma
pnpm test:harness          # 21 · el bucle contra un proveedor falso, sin gastar créditos
```

Necesitan Postgres arriba y la siembra hecha (`pnpm db && pnpm seed` desde la raíz).
