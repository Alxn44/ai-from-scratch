-- Quick quizzes (one pack per lesson) and three block exams.
-- `questions.solution` is the grader's secret: never selected for the agent.

CREATE TABLE "questions" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "pack" TEXT NOT NULL,
  "idx" SMALLINT NOT NULL,
  "lesson_n" INTEGER NOT NULL,
  "prompt_es" TEXT NOT NULL,
  "prompt_en" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "solution" TEXT NOT NULL,
  "explanation_es" TEXT NOT NULL,
  "explanation_en" TEXT NOT NULL,

  CONSTRAINT "questions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "questions_kind" CHECK ("kind" IN ('quiz', 'exam')),
  CONSTRAINT "questions_lesson_n_fkey" FOREIGN KEY ("lesson_n") REFERENCES "lessons"("n") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX "questions_pack" ON "questions" ("pack", "idx");
CREATE UNIQUE INDEX "questions_pack_idx" ON "questions" ("pack", "idx");

CREATE TABLE "question_attempts" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "question_id" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "correct" SMALLINT NOT NULL,
  "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "question_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qattempts_correct" CHECK ("correct" IN (0, 1)),
  CONSTRAINT "question_attempts_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "question_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "qattempts_user" ON "question_attempts" ("user_id", "question_id");
