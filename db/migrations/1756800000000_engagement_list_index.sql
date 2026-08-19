-- ─────────────────────────────────────────────────────────────────────────
-- 0014 · Engagement list ordering index
--
-- The engagement list (and every sub-resource list that reuses ENGAGEMENT_BASE)
-- orders by created_at DESC then pages. For assignment-scoped callers RLS
-- filters to a small set first, so the sort is trivial; for a firm-wide caller
-- (Managing Partner) the whole table is sorted. This btree matches that ORDER BY
-- so the firm-wide list is an index scan rather than a full sort.
--
-- The Phase 7 sign-off LATERAL in ENGAGEMENT_BASE was reviewed at the same time
-- and needs no new index: engagement_reviews_one_active_signoff (the partial
-- unique index on engagement_id WHERE review_type='sign_off' AND superseded_at
-- IS NULL) already makes it a single probe.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE INDEX engagements_created_at_idx ON hsdg.engagements (created_at DESC);

-- Down Migration

DROP INDEX IF EXISTS hsdg.engagements_created_at_idx;
