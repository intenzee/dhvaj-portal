-- ─────────────────────────────────────────────────────────────────────────
-- 0005 · Optimistic concurrency for employees
--
-- Adds a monotonically-increasing `version` to employees so concurrent writers
-- can detect lost updates. The application increments it on every update and,
-- when a caller supplies an expected version, updates only if it still matches
-- (otherwise 409). This establishes the concurrency convention that mutating
-- domains from here on (engagements, reviews, …) will follow.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.employees
  ADD COLUMN version integer NOT NULL DEFAULT 1;

-- Down Migration

ALTER TABLE hsdg.employees DROP COLUMN IF EXISTS version;
