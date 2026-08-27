-- ─────────────────────────────────────────────────────────────────────────
-- 0025 · Engagement Type & commercial/governance fields  (spec §3, §7)
--
-- Adds the engagement-level taxonomy and descriptive fields the spec's creation
-- flow calls for: an engagement TYPE, plus Priority, Confidentiality, Currency,
-- Billing Model and the mandate/engagement-letter reference. All ADDITIVE with
-- safe defaults, so the ~169 existing engagements need no backfill and RLS is
-- untouched (they inherit the engagements policies).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.engagements
  ADD COLUMN engagement_type text NOT NULL DEFAULT 'recurring_compliance'
    CHECK (engagement_type IN
      ('recurring_compliance','one_time_assignment','project','retainer',
       'advisory','audit','certification','litigation')),
  ADD COLUMN priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  ADD COLUMN confidentiality text NOT NULL DEFAULT 'normal'
    CHECK (confidentiality IN ('normal','confidential','restricted')),
  ADD COLUMN currency text NOT NULL DEFAULT 'INR'
    CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN billing_model text
    CHECK (billing_model IS NULL OR billing_model IN
      ('fixed_fee','time_and_material','retainer','milestone','pro_bono','not_billed')),
  ADD COLUMN mandate_letter_reference text
    CHECK (mandate_letter_reference IS NULL OR length(trim(mandate_letter_reference)) > 0),
  ADD COLUMN mandate_letter_date date;

-- Priority is a common filter/sort in list views; index it lightly.
CREATE INDEX engagements_priority_idx ON hsdg.engagements (priority);
CREATE INDEX engagements_type_idx ON hsdg.engagements (engagement_type);

-- Down Migration

DROP INDEX IF EXISTS hsdg.engagements_type_idx;
DROP INDEX IF EXISTS hsdg.engagements_priority_idx;
ALTER TABLE hsdg.engagements
  DROP COLUMN IF EXISTS mandate_letter_date,
  DROP COLUMN IF EXISTS mandate_letter_reference,
  DROP COLUMN IF EXISTS billing_model,
  DROP COLUMN IF EXISTS currency,
  DROP COLUMN IF EXISTS confidentiality,
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS engagement_type;
