CREATE TABLE "auth_throttles" (
  "user_id" INTEGER PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "reason" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "auth_throttles_expiry" ON "auth_throttles" ("expires_at");
