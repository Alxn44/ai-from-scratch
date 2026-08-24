-- BASELINE. Generated from the live database with:
--   prisma migrate diff --from-empty --to-config-datasource --script
--
-- Then hand-edited, and this is the part that matters: Prisma's diff runs through
-- its own datamodel, which CANNOT express a CHECK constraint. The database had
-- three; the generated 222-line script had zero. Adopting Prisma without noticing
-- that would have silently dropped every value constraint on role, level and
-- estado the next time anyone regenerated the schema.
--
-- The three are re-added at the end of this file, and src/db.js asserts at startup
-- that they still exist — so a future generated migration that drops them fails
-- loudly instead of letting `role = 'superadmin'` become insertable.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."achievements" (
    "user_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lesson_n" INTEGER,
    "earned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("user_id","code")
);

-- CreateTable
CREATE TABLE "public"."attempts" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "lab_id" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "correct" SMALLINT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."jobs" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "datos" JSONB NOT NULL DEFAULT '{}',
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "intentos" SMALLINT NOT NULL DEFAULT 0,
    "error" TEXT,
    "corre_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tomado_en" TIMESTAMPTZ(6),
    "acabado_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."labs" (
    "id" TEXT NOT NULL,
    "lesson_n" INTEGER NOT NULL,
    "idx" SMALLINT NOT NULL,
    "level" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "solution" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "draft" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "labs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."league_week" (
    "user_id" INTEGER NOT NULL,
    "week" DATE NOT NULL,
    "metal" TEXT NOT NULL,
    "caudal" INTEGER NOT NULL DEFAULT 0,
    "puesto" INTEGER,
    "estado" TEXT NOT NULL DEFAULT 'activo',
    "cerrada" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "league_week_pkey" PRIMARY KEY ("user_id","week")
);

-- CreateTable
CREATE TABLE "public"."lesson_text" (
    "lesson_n" INTEGER NOT NULL,
    "lang" TEXT NOT NULL,
    "technical" TEXT NOT NULL,
    "analogy" TEXT NOT NULL,
    "examples" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "lesson_text_pkey" PRIMARY KEY ("lesson_n","lang")
);

-- CreateTable
CREATE TABLE "public"."lessons" (
    "n" INTEGER NOT NULL,
    "eyebrow" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "math" TEXT NOT NULL,
    "math_cap" TEXT NOT NULL,
    "technical" TEXT NOT NULL DEFAULT '',
    "analogy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("n")
);

-- CreateTable
CREATE TABLE "public"."payments" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "provider" TEXT NOT NULL DEFAULT 'mercadopago',
    "ext_id" TEXT,
    "status" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "raw" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ranking_optin" (
    "user_id" INTEGER NOT NULL,
    "alias" TEXT NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranking_optin_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "public"."reset_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."role_audit" (
    "id" SERIAL NOT NULL,
    "actor_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "from_role" TEXT NOT NULL,
    "to_role" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pass_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'student',
    "lang" TEXT NOT NULL DEFAULT 'auto',
    "theme" TEXT NOT NULL DEFAULT 'auto',
    "paid" SMALLINT NOT NULL DEFAULT 0,
    "cohort" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failed" SMALLINT NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "token_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "logro_user" ON "public"."achievements"("user_id" ASC, "earned_at" DESC);

-- CreateIndex
CREATE INDEX "attempts_user" ON "public"."attempts"("user_id" ASC, "lab_id" ASC);

-- CreateIndex
CREATE INDEX "jobs_listos" ON "public"."jobs"("estado" ASC, "corre_en" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_tipo_clave_key" ON "public"."jobs"("tipo" ASC, "clave" ASC);

-- CreateIndex
CREATE INDEX "liga_semana" ON "public"."league_week"("week" ASC, "metal" ASC, "caudal" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "payments_ext_id_key" ON "public"."payments"("ext_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ranking_optin_alias_key" ON "public"."ranking_optin"("alias" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "reset_tokens_token_hash_key" ON "public"."reset_tokens"("token_hash" ASC);

-- CreateIndex
CREATE INDEX "reset_user" ON "public"."reset_tokens"("user_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email" ASC);

-- AddForeignKey
ALTER TABLE "public"."achievements" ADD CONSTRAINT "achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."attempts" ADD CONSTRAINT "attempts_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."attempts" ADD CONSTRAINT "attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."labs" ADD CONSTRAINT "labs_lesson_n_fkey" FOREIGN KEY ("lesson_n") REFERENCES "public"."lessons"("n") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."league_week" ADD CONSTRAINT "league_week_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."lesson_text" ADD CONSTRAINT "lesson_text_lesson_n_fkey" FOREIGN KEY ("lesson_n") REFERENCES "public"."lessons"("n") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."ranking_optin" ADD CONSTRAINT "ranking_optin_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."reset_tokens" ADD CONSTRAINT "reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;



-- ---------------------------------------------------------------------------
-- CHECK constraints. Prisma does not model these: they live here and only here.
-- Any migration that touches these tables must carry them forward.
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ADD CONSTRAINT "users_role_check"
  CHECK (role = ANY (ARRAY['student'::text, 'tutor'::text, 'admin'::text]));

ALTER TABLE "labs" ADD CONSTRAINT "labs_level_check"
  CHECK (level = ANY (ARRAY['facil'::text, 'medio'::text, 'dificil'::text]));

ALTER TABLE "jobs" ADD CONSTRAINT "jobs_estado_check"
  CHECK (estado = ANY (ARRAY['pendiente'::text, 'curso'::text, 'hecho'::text, 'muerto'::text]));
