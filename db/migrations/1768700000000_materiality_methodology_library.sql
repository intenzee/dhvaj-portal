-- ─────────────────────────────────────────────────────────────────────────
-- 03.3 Materiality Methodology Library + Partner Attention feed
--   (DHVAJ 03.3 §8, §19, §20, §23, §25)
--
-- §8 — The materiality guidance used to be twelve global Audit Rules Library
-- rows (area 'materiality', MAT_*): one range per fixed benchmark, PM / CTT
-- ranges, three attention parameters and a rounding step. §8 asks for more
-- than a range per criterion, so the methodology becomes its own versioned
-- library, maintained by the Methodology Admin (service.manage):
--   • applicability — an industry profile (03.2) and / or an entity
--     circumstance (02.1 special entity type, or 'initial_audit'); the most
--     specific rule in force wins for a file;
--   • the possible benchmark — one of the built-in candidates or a 03.2
--     canonical metric (`metric:<metric_key>`, e.g. the NBFC loan book), which
--     becomes a methodology-defined 03.3.2 candidate;
--   • optional percentage guidance (never in code or UI), considerations,
--     source / technical basis and a provisional flag;
--   • the override rule — selecting outside the guidance is permitted with a
--     rationale and raises Partner Attention; `immediate_partner` makes it an
--     Immediate Partner Attention prompt (§19 "Manager overrides an Immediate
--     Partner Attention methodology prompt").
-- Insert-only and effective-dated like the 03.2 analytics library; a
-- determination keeps the rule codes + versions it used (methodology_version).
-- The v1 seed copies the latest MAT_* audit-rule values (still PROVISIONAL)
-- and adds three examples of applicability; the MAT_* rows stay as history.
--
-- §19 — materiality Partner Attention triggers join the 03.1 Partner Planning
-- View queue (audit_planning_attention) as a third target, one row per
-- trigger per determination version (so the EP is told once per version).
--
-- §25 — '03.3' authority reference links (resolved centrally, not in UI code).
--
-- SECURITY — library: readable by any authenticated role, appendable only
-- firm-wide, never updated / deleted; FORCE RLS after the seed. The attention
-- columns inherit audit_planning_attention's engagement-member policies.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.materiality_methodology_rule (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code               text NOT NULL CHECK (rule_code ~ '^MMR-[0-9]{3}$'),
  version                 integer NOT NULL CHECK (version >= 1),
  -- What the rule governs; never changes across versions of a rule code.
  kind                    text NOT NULL CHECK (kind IN ('om_benchmark','pm','ctt','attention','rounding')),
  name                    text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  benchmark_key           text CHECK (benchmark_key IS NULL OR benchmark_key ~
                            '^(pbt|normalised_pbt|revenue|total_assets|net_assets|expenditure|metric:[a-z][a-z0-9_]{1,59})$'),
  benchmark_label         text CHECK (benchmark_label IS NULL OR length(trim(benchmark_label)) BETWEEN 1 AND 200),
  attention_criterion     text CHECK (attention_criterion IS NULL OR attention_criterion IN
                            ('py_change','volatility','near_breakeven')),
  low_pct                 numeric(9,4) CHECK (low_pct IS NULL OR (low_pct > 0 AND low_pct <= 100)),
  high_pct                numeric(9,4) CHECK (high_pct IS NULL OR (high_pct > 0 AND high_pct <= 100)),
  parameter_value         numeric(20,4) CHECK (parameter_value IS NULL OR parameter_value > 0),
  -- Applicability: empty = every file.
  industry_profiles       text[] NOT NULL DEFAULT '{}' CHECK (array_position(industry_profiles, NULL) IS NULL),
  circumstances           text[] NOT NULL DEFAULT '{}' CHECK (array_position(circumstances, NULL) IS NULL),
  considerations          text[] NOT NULL DEFAULT '{}' CHECK (array_position(considerations, NULL) IS NULL),
  source_basis            text NOT NULL CHECK (length(trim(source_basis)) BETWEEN 1 AND 500),
  provisional             boolean NOT NULL DEFAULT true,
  override_attention      text NOT NULL DEFAULT 'partner_attention'
                            CHECK (override_attention IN ('partner_attention','immediate_partner')),
  effective_from          date NOT NULL DEFAULT DATE '2000-01-01',
  effective_to            date,
  active                  boolean NOT NULL DEFAULT true,
  methodology_version     text NOT NULL CHECK (length(trim(methodology_version)) BETWEEN 1 AND 60),
  change_note             text CHECK (change_note IS NULL OR length(change_note) <= 2000),
  created_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_code, version),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (high_pct IS NULL OR (low_pct IS NOT NULL AND high_pct >= low_pct)),
  CONSTRAINT materiality_methodology_rule_shape CHECK (
    CASE kind
      WHEN 'om_benchmark' THEN benchmark_key IS NOT NULL AND attention_criterion IS NULL
                               AND parameter_value IS NULL
                               AND (benchmark_key NOT LIKE 'metric:%' OR benchmark_label IS NOT NULL)
      WHEN 'attention'    THEN attention_criterion IS NOT NULL AND parameter_value IS NOT NULL
                               AND benchmark_key IS NULL AND low_pct IS NULL
      WHEN 'rounding'     THEN parameter_value IS NOT NULL AND benchmark_key IS NULL
                               AND attention_criterion IS NULL AND low_pct IS NULL
      ELSE benchmark_key IS NULL AND attention_criterion IS NULL AND parameter_value IS NULL
    END
  )
);

DO $$
DECLARE t text := 'materiality_methodology_rule';
BEGIN
  EXECUTE format('REVOKE UPDATE, DELETE ON hsdg.%I FROM hsdg_app', t);
  EXECUTE format('ALTER TABLE hsdg.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR SELECT USING (hsdg.ctx_role() IS NOT NULL)',
                 t || '_read', t);
  EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.ctx_is_firmwide())',
                 t || '_insert', t);
END $$;

-- ── v1 seed: the latest MAT_* audit-rule values, now with §8 metadata ─────
ALTER TABLE hsdg.audit_rule         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.materiality_methodology_rule
  (rule_code, version, kind, name, benchmark_key, attention_criterion, low_pct, high_pct,
   parameter_value, considerations, source_basis, provisional, methodology_version, change_note)
SELECT s.rule_code, 1, s.kind, s.name, s.benchmark_key, s.attention_criterion,
       CASE WHEN s.kind IN ('om_benchmark','pm','ctt') THEN COALESCE(v.threshold, s.lo) END,
       CASE WHEN s.kind IN ('om_benchmark','pm','ctt') THEN COALESCE(v.threshold_high, s.hi) END,
       CASE WHEN s.kind IN ('attention','rounding') THEN COALESCE(v.threshold, s.lo) END,
       s.considerations,
       'ICAI Implementation Guide to Materiality — DHVAJ methodology pending formal approval',
       COALESCE(v.guidance_reference ~* 'provisional', true),
       'dhvaj-materiality-2026.1',
       'v1 — moved from the Audit Rules Library (' || s.audit_rule || ').'
FROM (VALUES
  ('MMR-001', 'om_benchmark', 'Overall materiality — profit before tax', 'pbt', NULL, 5::numeric, 10::numeric, 'MAT_OM_PCT_PBT',
   ARRAY['Profit is the measure users of a stable, profit-oriented entity usually focus on.',
         'Consider whether the result is stable, near break-even or distorted by unusual items.']),
  ('MMR-002', 'om_benchmark', 'Overall materiality — normalised profit before tax', 'normalised_pbt', NULL, 5, 10, 'MAT_OM_PCT_NORMALISED_PBT',
   ARRAY['Normalise only for supported, non-recurring items; every adjustment needs evidence.',
         'A normalised benchmark is always brought to the Engagement Partner''s attention.']),
  ('MMR-003', 'om_benchmark', 'Overall materiality — revenue', 'revenue', NULL, 0.5, 1, 'MAT_OM_PCT_REVENUE',
   ARRAY['Useful where profit is volatile, near break-even or not the users'' focus (start-up, growth, not-for-profit).']),
  ('MMR-004', 'om_benchmark', 'Overall materiality — total assets', 'total_assets', NULL, 1, 2, 'MAT_OM_PCT_TOTAL_ASSETS',
   ARRAY['Asset-based entities (investment, property, financing) where users focus on the balance sheet.']),
  ('MMR-005', 'om_benchmark', 'Overall materiality — net assets / equity', 'net_assets', NULL, 1, 5, 'MAT_OM_PCT_NET_ASSETS',
   ARRAY['Holding / investment entities and entities where capital or solvency is the users'' focus.',
         'Not meaningful where net worth is negative or nil.']),
  ('MMR-006', 'om_benchmark', 'Overall materiality — total expenditure', 'expenditure', NULL, 0.5, 2, 'MAT_OM_PCT_EXPENDITURE',
   ARRAY['Not-for-profit and cost-centre entities where users focus on how resources were spent.']),
  ('MMR-007', 'pm', 'Performance materiality — % of overall materiality', NULL, NULL, 50, 75, 'MAT_PM_PCT_OM',
   ARRAY['Lower where misstatements were frequent, controls are weak or the audit is initial.',
         'Higher only with a history of few misstatements and a stable control environment.']),
  ('MMR-008', 'ctt', 'Clearly trivial threshold — % of overall materiality', NULL, NULL, 3, 5, 'MAT_CTT_PCT_OM',
   ARRAY['Clearly trivial is not "not material"; uncertain matters are accumulated (SA 450).']),
  ('MMR-009', 'attention', 'Prior-year change attention parameter', NULL, 'py_change', 25, NULL, 'MAT_PY_CHANGE_ATTENTION',
   ARRAY['A large change from prior-year materiality is brought to the Engagement Partner''s attention.']),
  ('MMR-010', 'attention', 'Benchmark volatility attention parameter', NULL, 'volatility', 30, NULL, 'MAT_VOLATILITY_ATTENTION',
   ARRAY['A benchmark that moved this much year on year may not be a stable measure for users.']),
  ('MMR-011', 'attention', 'Near break-even margin', NULL, 'near_breakeven', 2, NULL, 'MAT_NEAR_BREAKEVEN_MARGIN',
   ARRAY['PBT within this % of revenue is treated as near break-even.']),
  ('MMR-012', 'rounding', 'Methodology rounding step (₹)', NULL, NULL, 1000, NULL, 'MAT_ROUNDING_STEP',
   ARRAY['Display rounding only — the unrounded calculation is stored.'])
) AS s(rule_code, kind, name, benchmark_key, attention_criterion, lo, hi, audit_rule, considerations)
LEFT JOIN LATERAL (
  SELECT rv.threshold, rv.threshold_high, rv.guidance_reference
    FROM hsdg.audit_rule r
    JOIN hsdg.audit_rule_version rv ON rv.audit_rule_id = r.id
   WHERE r.code = s.audit_rule
   ORDER BY rv.version DESC LIMIT 1
) v ON true;

ALTER TABLE hsdg.audit_rule         FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;

-- Applicability examples (no new percentages — DHVAJ has not approved any).
INSERT INTO hsdg.materiality_methodology_rule
  (rule_code, version, kind, name, benchmark_key, benchmark_label, low_pct, high_pct,
   industry_profiles, circumstances, considerations, source_basis, provisional,
   override_attention, methodology_version, change_note)
VALUES
  ('MMR-013', 1, 'om_benchmark', 'Overall materiality — loan book (NBFC)', 'metric:loan_book',
   'Loans & advances (loan book)', NULL, NULL, ARRAY['nbfc'], ARRAY[]::text[],
   ARRAY['For a lending entity, users (RBI, lenders, depositors) often focus on the loan book and capital rather than profit.',
         'No percentage guidance is configured — document the basis for the percentage chosen.'],
   'DHVAJ methodology — sector consideration pending formal approval', true,
   'partner_attention', 'dhvaj-materiality-2026.1', 'v1 — methodology-defined NBFC benchmark.'),
  ('MMR-014', 1, 'om_benchmark', 'Overall materiality — total expenditure (Section 8 / not-for-profit)', 'expenditure',
   NULL, 0.5, 2, ARRAY['section8'], ARRAY[]::text[],
   ARRAY['Members, donors and regulators of a not-for-profit focus on how funds were applied to its objects.',
         'Programme expenditure and grant utilisation are often qualitatively material at lower amounts.'],
   'ICAI Implementation Guide to Materiality — DHVAJ methodology pending formal approval', true,
   'partner_attention', 'dhvaj-materiality-2026.1', 'v1 — not-for-profit applicability.'),
  ('MMR-015', 1, 'pm', 'Performance materiality — initial audit', NULL,
   NULL, 50, 75, ARRAY[]::text[], ARRAY['initial_audit'],
   ARRAY['Initial audit: no history of misstatements with this firm and opening balances are unaudited by it — consider the lower end of the range.',
         'Setting PM outside this range on an initial audit is an Immediate Partner Attention matter.'],
   'ICAI Implementation Guide to Materiality — DHVAJ methodology pending formal approval', true,
   'immediate_partner', 'dhvaj-materiality-2026.1', 'v1 — initial-audit applicability.');

ALTER TABLE hsdg.materiality_methodology_rule FORCE ROW LEVEL SECURITY;

-- ── Methodology-defined candidate benchmarks (`metric:<metric_key>`) ─────
ALTER TABLE hsdg.audit_materiality_determination
  DROP CONSTRAINT audit_materiality_determination_selected_benchmark_check;
ALTER TABLE hsdg.audit_materiality_determination
  ADD CONSTRAINT audit_materiality_determination_selected_benchmark_check
  CHECK (selected_benchmark IS NULL OR selected_benchmark ~
    '^(pbt|normalised_pbt|revenue|total_assets|net_assets|expenditure|other|metric:[a-z][a-z0-9_]{1,59})$');
ALTER TABLE hsdg.audit_materiality_benchmark
  DROP CONSTRAINT audit_materiality_benchmark_candidate_key_check;
ALTER TABLE hsdg.audit_materiality_benchmark
  ADD CONSTRAINT audit_materiality_benchmark_candidate_key_check
  CHECK (candidate_key ~
    '^(pbt|normalised_pbt|revenue|total_assets|net_assets|expenditure|metric:[a-z][a-z0-9_]{1,59})$');

-- ── §19 materiality triggers in the Partner Planning View queue ──────────
ALTER TABLE hsdg.audit_planning_attention
  ADD COLUMN materiality_determination_id uuid
    REFERENCES hsdg.audit_materiality_determination (id) ON DELETE CASCADE,
  ADD COLUMN materiality_trigger_key text
    CHECK (materiality_trigger_key IS NULL OR materiality_trigger_key ~ '^[a-z][a-z0-9_]{1,59}$'),
  ADD COLUMN materiality_seq integer,
  -- Snapshot of the trigger as last computed (triggers are derived, not stored).
  ADD COLUMN materiality_label text,
  ADD COLUMN materiality_detail text,
  ADD COLUMN materiality_attention text
    CHECK (materiality_attention IS NULL OR materiality_attention IN ('partner_attention','immediate_partner')),
  -- The EP was told about this item (once per trigger per determination version).
  ADD COLUMN partner_notified_at timestamptz;
ALTER TABLE hsdg.audit_planning_attention
  ADD CONSTRAINT audit_planning_attention_materiality_trigger
    UNIQUE (materiality_determination_id, materiality_trigger_key),
  ADD CONSTRAINT audit_planning_attention_materiality_shape CHECK (
    (materiality_determination_id IS NULL) = (materiality_trigger_key IS NULL)
    AND (materiality_determination_id IS NULL) = (materiality_seq IS NULL)
    AND (materiality_determination_id IS NULL) = (materiality_label IS NULL)
  ),
  DROP CONSTRAINT audit_planning_attention_one_target,
  ADD CONSTRAINT audit_planning_attention_one_target CHECK (
    (signal_id IS NOT NULL)::int + (focus_id IS NOT NULL)::int
      + (materiality_determination_id IS NOT NULL)::int = 1
  );

-- ── §25 authority references ─────────────────────────────────────────────
ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.authority_reference_link (context_key, anchor, label, provision_code, sort_order) VALUES
  ('03.3', 'view_sa_320',          'View SA 320',                          'SA_320',         10),
  ('03.3', 'view_sa_450',          'View SA 450',                          'SA_450',         20),
  ('03.3', 'view_ig_materiality',  'View Materiality Implementation Guide','IG_MATERIALITY', 30),
  ('03.3', 'view_sa_300',          'View SA 300',                          'SA_300',         40)
ON CONFLICT (context_key, anchor) DO NOTHING;
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.authority_reference_link WHERE context_key = '03.3';
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

DELETE FROM hsdg.audit_planning_attention WHERE materiality_determination_id IS NOT NULL;
ALTER TABLE hsdg.audit_planning_attention
  DROP CONSTRAINT audit_planning_attention_one_target,
  ADD CONSTRAINT audit_planning_attention_one_target CHECK (
    (signal_id IS NOT NULL)::int + (focus_id IS NOT NULL)::int = 1
  ),
  DROP CONSTRAINT IF EXISTS audit_planning_attention_materiality_shape,
  DROP CONSTRAINT IF EXISTS audit_planning_attention_materiality_trigger,
  DROP COLUMN IF EXISTS partner_notified_at,
  DROP COLUMN IF EXISTS materiality_attention,
  DROP COLUMN IF EXISTS materiality_detail,
  DROP COLUMN IF EXISTS materiality_label,
  DROP COLUMN IF EXISTS materiality_seq,
  DROP COLUMN IF EXISTS materiality_trigger_key,
  DROP COLUMN IF EXISTS materiality_determination_id;

-- A metric benchmark has no pre-library equivalent: clear it (the selection
-- falls back to "not selected"; amounts and rationale are kept).
ALTER TABLE hsdg.audit_materiality_determination
  DISABLE TRIGGER audit_materiality_determination_set_updated_at;
UPDATE hsdg.audit_materiality_determination SET selected_benchmark = NULL
 WHERE selected_benchmark LIKE 'metric:%';
ALTER TABLE hsdg.audit_materiality_determination
  ENABLE TRIGGER audit_materiality_determination_set_updated_at;
DELETE FROM hsdg.audit_materiality_benchmark WHERE candidate_key LIKE 'metric:%';
ALTER TABLE hsdg.audit_materiality_benchmark
  DROP CONSTRAINT audit_materiality_benchmark_candidate_key_check;
ALTER TABLE hsdg.audit_materiality_benchmark
  ADD CONSTRAINT audit_materiality_benchmark_candidate_key_check CHECK (candidate_key IN
    ('pbt','normalised_pbt','revenue','total_assets','net_assets','expenditure'));
ALTER TABLE hsdg.audit_materiality_determination
  DROP CONSTRAINT audit_materiality_determination_selected_benchmark_check;
ALTER TABLE hsdg.audit_materiality_determination
  ADD CONSTRAINT audit_materiality_determination_selected_benchmark_check
  CHECK (selected_benchmark IS NULL OR selected_benchmark IN
    ('pbt','normalised_pbt','revenue','total_assets','net_assets','expenditure','other'));

DROP TABLE IF EXISTS hsdg.materiality_methodology_rule;
