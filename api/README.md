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
- 29 de los 36 labs están en `draft = 1`: mecánica asignada, enunciado por escribir.
  Responder uno devuelve 409.

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
