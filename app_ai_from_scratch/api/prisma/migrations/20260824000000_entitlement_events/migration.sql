CREATE TABLE "entitlement_events" (
  "id" BIGSERIAL PRIMARY KEY,
  "event_key" TEXT NOT NULL UNIQUE,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "active" BOOLEAN NOT NULL,
  "source" TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL,
  "received_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "entitlement_events_user_latest"
  ON "entitlement_events" ("user_id", "source", "external_id", "occurred_at" DESC);
