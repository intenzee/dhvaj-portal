-- ─────────────────────────────────────────────────────────────────────────
-- 03.1 Planning Signal Library — the 02.8 approval facts (DHVAJ 03.1 §5, §8)
--
-- §5 lists 02.8 as "framework changes, overrides, conditions and approved
-- framework baseline". Changes were already a rule (PSR-025); this seeds the
-- other two as library rules so the engine evaluates them like any other
-- Section 02 fact:
--   • PSR-027 — a professional overrode a system framework conclusion (§12 of
--     02.8). Standard attention: the override is a judgment the strategy
--     should be aware of, not a problem in itself.
--   • PSR-028 — the framework was approved subject to conditions that are
--     still open. Enhanced attention: Planning proceeds on a conditional basis.
-- Rules are versioned rows; later edits go through the admin library.
--
-- SECURITY — planning_signal_rule is FORCE RLS; the seed runs between
-- NO FORCE … FORCE so the migrator may insert.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.planning_signal_rule NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.planning_signal_rule
  (rule_code, version, rule_key, name, trigger_source, trigger_section, trigger_condition,
   observation_template, why_may_matter, potential_implications, guidance_anchors,
   destinations, suggested_attention, source_link, change_note)
VALUES
  ('PSR-027', 1, 'framework_overrides', 'Framework conclusion overridden', 'section_02', '02.8',
   '{"fact":"framework_overrides","op":"gt","value":0}',
   'A system framework conclusion was overridden by professional judgment: {{framework_override_labels}}.',
   'An override records a judgment that departs from the system result; the strategy should be built on the conclusion actually approved, and the basis should hold through the audit (SA 300, SA 220).',
   'Consistency of the overridden conclusion in scope, reporting and the audit programme; whether the basis needs corroborating evidence.',
   '{sa_300,sa_220}', '{03.4,03.5}', 'standard', 'framework:02.8',
   '02.8 overrides become a library rule (03.1 §5).'),
  ('PSR-028', 1, 'framework_open_conditions', 'Framework approved subject to open conditions', 'section_02', '02.8',
   '{"fact":"framework_open_conditions","op":"gt","value":0}',
   'The Audit Framework was approved subject to conditions that are still open: {{framework_open_condition_labels}}.',
   'Planning is proceeding on a conditional framework; an unresolved condition can change the reporting requirements the plan is built on (SA 300, SA 220).',
   'Track each condition to resolution; timing of dependent planning work; Partner visibility until resolved.',
   '{sa_300,sa_220}', '{03.4,03.11}', 'enhanced', 'framework:02.8',
   '02.8 approval conditions become a library rule (03.1 §5).');

ALTER TABLE hsdg.planning_signal_rule FORCE ROW LEVEL SECURITY;

-- Down Migration

-- Signals already raised under these rules keep their text (rule_code is a
-- plain label on the signal); only the library rows go.
ALTER TABLE hsdg.planning_signal_rule NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.planning_signal_rule WHERE rule_code IN ('PSR-027','PSR-028');
ALTER TABLE hsdg.planning_signal_rule FORCE ROW LEVEL SECURITY;
