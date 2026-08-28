-- ─────────────────────────────────────────────────────────────────────────
-- 0031 · Commercial Scope & Billing  (spec §31)
--
-- Closes the deliberately-deferred commercial module. Adds, all engagement-
-- scoped (members read, leads write — the same floor as components/reviews):
--
--   • engagement_commercial   — the 1:1 commercial configuration for an
--                               engagement (billing frequency, effective/end
--                               dates, retainer amount, scope notes). billing
--                               MODEL + currency already live on engagements
--                               (0026); this is the rest of §31's commercial
--                               scope.
--   • invoices                — engagement invoices with a generated number and
--                               a draft → issued → paid / void lifecycle. Totals
--                               are derived from the line items by trigger, so
--                               the app never has to keep them in step by hand.
--   • invoice_line_items      — the billed lines, each optionally tied to a
--                               configured component (the §31 "included
--                               components" grain).
--   • tasks.is_out_of_scope / is_billable / approval  — the §31 "out-of-scope
--                               request → approved billable Task" path, WITHOUT
--                               changing the original historical scope.
--
-- STRICTLY ADDITIVE. No existing table's identity, policy or data changes;
-- everything hangs off the existing engagement via its RLS helpers.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. Per-engagement commercial configuration (1:1, lazily upserted) ──────
CREATE TABLE hsdg.engagement_commercial (
  engagement_id     uuid PRIMARY KEY REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  billing_frequency text NOT NULL DEFAULT 'monthly' CHECK (billing_frequency IN
                      ('monthly','quarterly','annual','milestone','on_completion','one_time','event')),
  effective_date    date,
  end_date          date,
  retainer_amount   numeric(14,2) CHECK (retainer_amount IS NULL OR retainer_amount >= 0),
  scope_notes       text,
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_commercial_date_range
    CHECK (end_date IS NULL OR effective_date IS NULL OR end_date >= effective_date)
);
CREATE TRIGGER engagement_commercial_set_updated_at BEFORE UPDATE ON hsdg.engagement_commercial
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── 2. Invoices ───────────────────────────────────────────────────────────
CREATE SEQUENCE hsdg.invoice_number_seq;

CREATE TABLE hsdg.invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Firm-wide unique human number, e.g. INV-2026-00042. Generated once.
  invoice_number text NOT NULL UNIQUE DEFAULT
                   ('INV-' || to_char(now(), 'YYYY') || '-' ||
                    lpad(nextval('hsdg.invoice_number_seq')::text, 5, '0')),
  status         text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','issued','paid','void')),
  currency       text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  issue_date     date,
  due_date       date,
  -- Kept authoritative by triggers (subtotal from lines; total = subtotal + tax).
  subtotal       numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount     numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total          numeric(14,2) NOT NULL DEFAULT 0,
  notes          text,
  created_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- An issued/paid invoice must carry an issue date.
  CONSTRAINT invoices_issued_has_date CHECK (status = 'draft' OR status = 'void' OR issue_date IS NOT NULL),
  CONSTRAINT invoices_due_after_issue CHECK (due_date IS NULL OR issue_date IS NULL OR due_date >= issue_date)
);
CREATE INDEX invoices_engagement_idx ON hsdg.invoices (engagement_id);
CREATE INDEX invoices_status_idx     ON hsdg.invoices (status);
CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON hsdg.invoices
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- total is always subtotal + tax; compute it in a BEFORE trigger so both a
-- direct tax change and a line-driven subtotal change keep it correct.
CREATE OR REPLACE FUNCTION hsdg.invoice_set_total() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.total := NEW.subtotal + NEW.tax_amount;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoices_set_total BEFORE INSERT OR UPDATE ON hsdg.invoices
  FOR EACH ROW EXECUTE FUNCTION hsdg.invoice_set_total();

-- ── 3. Invoice line items ─────────────────────────────────────────────────
CREATE TABLE hsdg.invoice_line_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    uuid NOT NULL REFERENCES hsdg.invoices (id) ON DELETE CASCADE,
  -- Denormalised from the invoice (synced by trigger) for a single-predicate RLS
  -- policy and a fast per-engagement index — mirrors engagement_services.
  engagement_id uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Optional link to the configured component this line bills (§31 included components).
  engagement_component_id uuid REFERENCES hsdg.engagement_components (id) ON DELETE SET NULL,
  description   text NOT NULL CHECK (length(trim(description)) > 0),
  quantity      numeric(12,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_amount   numeric(14,2) NOT NULL DEFAULT 0,
  amount        numeric(14,2) NOT NULL GENERATED ALWAYS AS (round(quantity * unit_amount, 2)) STORED,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoice_line_items_invoice_idx   ON hsdg.invoice_line_items (invoice_id);
CREATE INDEX invoice_line_items_component_idx ON hsdg.invoice_line_items (engagement_component_id);

-- Keep a line's engagement_id in step with its invoice (never set by hand).
CREATE OR REPLACE FUNCTION hsdg.invoice_line_sync_engagement() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  SELECT i.engagement_id INTO NEW.engagement_id FROM hsdg.invoices i WHERE i.id = NEW.invoice_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoice_line_items_sync BEFORE INSERT OR UPDATE OF invoice_id
  ON hsdg.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION hsdg.invoice_line_sync_engagement();

-- Recompute the invoice subtotal from its lines whenever they change; the
-- invoices BEFORE trigger then re-derives total = subtotal + tax.
CREATE OR REPLACE FUNCTION hsdg.invoice_recompute_subtotal() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE inv uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
BEGIN
  UPDATE hsdg.invoices i
     SET subtotal = COALESCE(
           (SELECT sum(amount) FROM hsdg.invoice_line_items li WHERE li.invoice_id = inv), 0)
   WHERE i.id = inv;
  RETURN NULL;
END;
$$;
CREATE TRIGGER invoice_line_items_totals
  AFTER INSERT OR UPDATE OR DELETE ON hsdg.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION hsdg.invoice_recompute_subtotal();

-- ── 4. §31 out-of-scope path on tasks ─────────────────────────────────────
-- An out-of-scope request is captured as a Task flagged out_of_scope; a lead
-- APPROVES it (governance + audit) and optionally marks it billable. This lets
-- unpredictable professional work be handled without changing the original
-- historical scope (or touching the catalogue).
ALTER TABLE hsdg.tasks
  ADD COLUMN is_out_of_scope boolean NOT NULL DEFAULT false,
  ADD COLUMN is_billable     boolean NOT NULL DEFAULT false,
  ADD COLUMN out_of_scope_approved_at timestamptz,
  ADD COLUMN out_of_scope_approved_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL;

-- ── 5. Row Level Security (engagement-scoped) ─────────────────────────────
-- Commercial config and invoices are firm records: history is preserved, so the
-- app role may not hard-delete them (void an invoice instead). Draft line items
-- ARE deletable so a draft invoice can be edited freely before issue.
REVOKE DELETE ON hsdg.engagement_commercial FROM hsdg_app;
REVOKE DELETE ON hsdg.invoices              FROM hsdg_app;

ALTER TABLE hsdg.engagement_commercial ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_commercial FORCE  ROW LEVEL SECURITY;
CREATE POLICY engagement_commercial_select ON hsdg.engagement_commercial
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY engagement_commercial_insert ON hsdg.engagement_commercial
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY engagement_commercial_update ON hsdg.engagement_commercial
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.invoices FORCE  ROW LEVEL SECURITY;
CREATE POLICY invoices_select ON hsdg.invoices
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY invoices_insert ON hsdg.invoices
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY invoices_update ON hsdg.invoices
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.invoice_line_items FORCE  ROW LEVEL SECURITY;
CREATE POLICY invoice_line_items_select ON hsdg.invoice_line_items
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY invoice_line_items_insert ON hsdg.invoice_line_items
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY invoice_line_items_update ON hsdg.invoice_line_items
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY invoice_line_items_delete ON hsdg.invoice_line_items
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP POLICY IF EXISTS invoice_line_items_delete ON hsdg.invoice_line_items;
DROP POLICY IF EXISTS invoice_line_items_update ON hsdg.invoice_line_items;
DROP POLICY IF EXISTS invoice_line_items_insert ON hsdg.invoice_line_items;
DROP POLICY IF EXISTS invoice_line_items_select ON hsdg.invoice_line_items;
DROP POLICY IF EXISTS invoices_update ON hsdg.invoices;
DROP POLICY IF EXISTS invoices_insert ON hsdg.invoices;
DROP POLICY IF EXISTS invoices_select ON hsdg.invoices;
DROP POLICY IF EXISTS engagement_commercial_update ON hsdg.engagement_commercial;
DROP POLICY IF EXISTS engagement_commercial_insert ON hsdg.engagement_commercial;
DROP POLICY IF EXISTS engagement_commercial_select ON hsdg.engagement_commercial;

ALTER TABLE hsdg.tasks
  DROP COLUMN IF EXISTS out_of_scope_approved_by_employee_id,
  DROP COLUMN IF EXISTS out_of_scope_approved_at,
  DROP COLUMN IF EXISTS is_billable,
  DROP COLUMN IF EXISTS is_out_of_scope;

DROP TABLE IF EXISTS hsdg.invoice_line_items CASCADE;
DROP FUNCTION IF EXISTS hsdg.invoice_recompute_subtotal();
DROP FUNCTION IF EXISTS hsdg.invoice_line_sync_engagement();
DROP TABLE IF EXISTS hsdg.invoices CASCADE;
DROP FUNCTION IF EXISTS hsdg.invoice_set_total();
DROP SEQUENCE IF EXISTS hsdg.invoice_number_seq;
DROP TABLE IF EXISTS hsdg.engagement_commercial CASCADE;
