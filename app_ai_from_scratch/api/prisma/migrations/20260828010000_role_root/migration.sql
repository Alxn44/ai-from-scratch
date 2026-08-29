-- Cuarto rol: root, por encima de admin.
--
-- Prisma no modela CHECK, asi que esta restriccion vive escrita a mano en el
-- baseline y hay que moverla a mano tambien. Sin este cambio, un UPDATE a
-- role='root' revienta con 23514 (users_role_check) y el rol no existe mas alla
-- del TypeScript.
--
-- El orden importa: primero se quita la vieja, luego se pone la nueva. Un
-- ADD CONSTRAINT con el mismo nombre falla si la anterior sigue puesta.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_check";

ALTER TABLE "users" ADD CONSTRAINT "users_role_check"
  CHECK (role = ANY (ARRAY['student'::text, 'tutor'::text, 'admin'::text, 'root'::text]));
