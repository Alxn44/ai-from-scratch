# Auth

Único dueño del login, registro, recuperación, sesiones, preferencias de cuenta,
borrado y aplicación de entitlements. La API sólo monta este módulo y usa sus
guardas; no mantiene una segunda implementación de autenticación.

Las señales de seguridad no incluyen correo ni contraseña: los intentos sin una
cuenta conocida usan un hash corto y los usuarios conocidos usan su id interno.
