-- ─────────────────────────────────────────────────────────────────────────
-- 0012 · Review & Sign-off Engine
--
-- Concept C from ADR-0011 (review state), deliberately separate from the
-- engagement lifecycle (governance) and the service workflow (how work is
-- performed). The engine records the professional review trail and gates
-- COMPLETION on a valid sign-off with zero open review points.
--
-- THE CENTRAL RULE (§2.1, §2.4, §7 of the brief):
--   Each service declares a MINIMUM required review model (Phase 4). The EP may
--   ESCALATE it per engagement (never weaken it) — the "review plan". The
--   resulting EFFECTIVE review model decides who may sign off:
--     • manager_review    → any engagement lead (manager or EP) may sign off
--                            ⇒ manager-level completion is permitted.
--     • key_matter_review }→ requires_ep_signoff = true ⇒ ONLY the accountable
--     • full_ep_review    }  Engagement Partner may sign off. A manager cannot
--                            complete such an engagement without EP sign-off.
--   "The system must never allow a lower review model where the service requires
--    Full EP Review" is enforced structurally (escalate-only trigger) and at
--   sign-off (authority check in EngagementReviewsService).
--
-- Configuration over hard-coding: `requires_ep_signoff` is a column on
-- review_models (reference config), NOT a hard-coded slug list in application
-- code. Adding a review model, or changing whether one needs EP sign-off, is a
-- data change.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. review_models: the config that drives the completion gate ──────────
-- review_models runs FORCE RLS (Phase 4); the migrator carries no hsdg.role
-- context, so drop FORCE to add the column + backfill, then restore (the same
-- reference-data pattern used in migrations 0009/0011).
ALTER TABLE hsdg.review_models NO FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.review_models
  ADD COLUMN requires_ep_signoff boolean NOT NULL DEFAULT false;

-- Models at/above key-matter require the accountable EP's personal sign-off.
UPDATE hsdg.review_models SET requires_ep_signoff = true
  WHERE slug IN ('key_matter_review', 'full_ep_review');

ALTER TABLE hsdg.review_models FORCE ROW LEVEL SECURITY;

-- ── 2. Engagement review plan (escalate-only effective review model) ──────
-- NULL ⇒ inherit the service's required model. When set, must be at least as
-- rigorous (rank) as the service requires — the EP raises rigour, never lowers.
ALTER TABLE hsdg.engagements
  ADD COLUMN review_model_id uuid REFERENCES hsdg.review_models (id) ON DELETE RESTRICT;
CREATE INDEX engagements_review_model_idx ON hsdg.engagements (review_model_id);

-- Integrity guard (same posture as enforce_engagement_workflow_state, a plain
-- trigger): services + review_models are firm-wide readable to any authenticated
-- context, so no cross-office visibility gap to bridge — no SECURITY DEFINER
-- needed. Fires only when review_model_id (or the service) actually changes.
CREATE OR REPLACE FUNCTION hsdg.enforce_engagement_review_plan() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  required_rank integer;
  plan_rank     integer;
BEGIN
  IF NEW.review_model_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.review_model_id IS DISTINCT FROM OLD.review_model_id
          OR NEW.service_id IS DISTINCT FROM OLD.service_id) THEN
    SELECT rm.rank INTO required_rank
      FROM hsdg.services s
      JOIN hsdg.review_models rm ON rm.id = s.required_review_model_id
      WHERE s.id = NEW.service_id;
    SELECT rank INTO plan_rank FROM hsdg.review_models WHERE id = NEW.review_model_id;
    IF plan_rank IS NULL OR required_rank IS NULL THEN
      RAISE EXCEPTION 'Cannot resolve review models for the engagement review plan.';
    END IF;
    IF plan_rank < required_rank THEN
      RAISE EXCEPTION 'Engagement review plan (rank %) may not be weaker than the service''s required review model (rank %).',
        plan_rank, required_rank;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagements_enforce_review_plan
  BEFORE INSERT OR UPDATE ON hsdg.engagements
  FOR EACH ROW EXECUTE FUNCTION hsdg.enforce_engagement_review_plan();

-- ── 3. Review records (manager review, EP review, and the sign-off) ───────
-- One row per review event. Professional evidence: append-only + controlled
-- invalidation (supersede), never hard-deleted or silently rewritten (§12).
CREATE TABLE hsdg.engagement_reviews (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id        uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  review_type          text NOT NULL CHECK (review_type IN ('manager_review', 'ep_review', 'sign_off')),
  reviewer_employee_id uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE RESTRICT,
  reviewer_role        text,
  outcome              text NOT NULL CHECK (outcome IN ('cleared', 'returned', 'signed_off')),
  notes                text,
  -- Non-null once the record is invalidated (e.g. its engagement was reopened).
  superseded_at        timestamptz,
  superseded_reason    text,
  correlation_id       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- Review type and outcome must agree.
  CONSTRAINT engagement_reviews_type_outcome CHECK (
    (review_type = 'sign_off' AND outcome = 'signed_off')
    OR (review_type IN ('manager_review', 'ep_review') AND outcome IN ('cleared', 'returned'))
  )
);
CREATE INDEX engagement_reviews_engagement_idx
  ON hsdg.engagement_reviews (engagement_id, created_at DESC);
-- At most one active (non-superseded) sign-off per engagement. Reopening
-- supersedes the current one, freeing a fresh sign-off.
CREATE UNIQUE INDEX engagement_reviews_one_active_signoff
  ON hsdg.engagement_reviews (engagement_id)
  WHERE review_type = 'sign_off' AND superseded_at IS NULL;

-- ── 4. Review points (matters raised in a review; must be resolved) ───────
CREATE TABLE hsdg.engagement_review_points (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalised engagement_id so RLS + open-point counts scope directly to the
  -- engagement without joining through the review row.
  engagement_id           uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  review_id               uuid NOT NULL REFERENCES hsdg.engagement_reviews (id) ON DELETE CASCADE,
  raised_by_employee_id   uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE RESTRICT,
  matter                  text NOT NULL CHECK (length(trim(matter)) > 0),
  -- A key/high-risk matter (the "key-matter review" concept, §2.4-B).
  is_key_matter           boolean NOT NULL DEFAULT false,
  status                  text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  resolution              text,
  resolved_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_review_points_resolution CHECK (
    status = 'open' OR (resolved_by_employee_id IS NOT NULL AND resolved_at IS NOT NULL)
  )
);
-- Open points block completion; the partial index makes "are any open?" cheap.
CREATE INDEX engagement_review_points_open_idx
  ON hsdg.engagement_review_points (engagement_id) WHERE status = 'open';
CREATE INDEX engagement_review_points_review_idx
  ON hsdg.engagement_review_points (review_id);

-- ── 5. Privileges: professional evidence is never hard-deleted at runtime ──
-- (default privileges granted SELECT/INSERT/UPDATE/DELETE from bootstrap; we
--  keep INSERT/UPDATE for recording + resolution/supersede, revoke DELETE.)
REVOKE DELETE ON hsdg.engagement_reviews       FROM hsdg_app;
REVOKE DELETE ON hsdg.engagement_review_points FROM hsdg_app;

-- ── 6. Row Level Security ──────────────────────────────────────────────────
-- Engagement-scoped (like engagement_lifecycle_history): any engagement member
-- reads the review trail; only an engagement lead (EP/manager, or business
-- firm-wide) may write. The finer authority — "an EP review / EP-required
-- sign-off must be the accountable EP, not merely any lead" — is layered on top
-- in EngagementReviewsService, exactly as reopen layers managingPartnerOnlyGuard
-- over the same RLS floor.
ALTER TABLE hsdg.engagement_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_reviews FORCE  ROW LEVEL SECURITY;
CREATE POLICY engagement_reviews_select ON hsdg.engagement_reviews
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY engagement_reviews_insert ON hsdg.engagement_reviews
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY engagement_reviews_update ON hsdg.engagement_reviews
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.engagement_review_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_review_points FORCE  ROW LEVEL SECURITY;
CREATE POLICY engagement_review_points_select ON hsdg.engagement_review_points
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY engagement_review_points_insert ON hsdg.engagement_review_points
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY engagement_review_points_update ON hsdg.engagement_review_points
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP POLICY IF EXISTS engagement_review_points_update ON hsdg.engagement_review_points;
DROP POLICY IF EXISTS engagement_review_points_insert ON hsdg.engagement_review_points;
DROP POLICY IF EXISTS engagement_review_points_select ON hsdg.engagement_review_points;
DROP POLICY IF EXISTS engagement_reviews_update ON hsdg.engagement_reviews;
DROP POLICY IF EXISTS engagement_reviews_insert ON hsdg.engagement_reviews;
DROP POLICY IF EXISTS engagement_reviews_select ON hsdg.engagement_reviews;

DROP TABLE IF EXISTS hsdg.engagement_review_points CASCADE;
DROP TABLE IF EXISTS hsdg.engagement_reviews CASCADE;

DROP TRIGGER IF EXISTS engagements_enforce_review_plan ON hsdg.engagements;
DROP FUNCTION IF EXISTS hsdg.enforce_engagement_review_plan();

DROP INDEX IF EXISTS hsdg.engagements_review_model_idx;
ALTER TABLE hsdg.engagements DROP COLUMN IF EXISTS review_model_id;

ALTER TABLE hsdg.review_models NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.review_models DROP COLUMN IF EXISTS requires_ep_signoff;
ALTER TABLE hsdg.review_models FORCE ROW LEVEL SECURITY;
