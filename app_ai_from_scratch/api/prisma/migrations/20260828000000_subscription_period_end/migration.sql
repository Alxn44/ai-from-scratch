-- Monthly subscriptions.
--
-- Entitlement was already event-sourced per (source, external_id), so a
-- revocation was always expressible. What was missing is LAPSE: an event with
-- active = true never stopped being true, so a single monthly charge granted
-- access forever if the provider never sent a revocation.
--
-- NULLABLE ON PURPOSE, and this is the whole compatibility story. Every row
-- written before this migration gets NULL, and the derivation in
-- `auth.entitlement_apply` reads NULL as "no expiry". Anyone who bought the
-- course under the one-time model keeps the access they paid for; only rows
-- that carry a period stop being honoured once it passes.
ALTER TABLE "entitlement_events" ADD COLUMN "period_end" TIMESTAMPTZ;

-- The derivation filters on period_end for the rows DISTINCT ON already picked,
-- so this index serves the lapse sweep, which is the query that scans: find the
-- users whose newest entitlement has expired. Partial, because a row with no
-- period can never lapse and does not belong in it.
CREATE INDEX "entitlement_events_period_end" ON "entitlement_events" ("period_end")
  WHERE "period_end" IS NOT NULL;
