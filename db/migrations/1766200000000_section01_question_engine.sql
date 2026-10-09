-- ─────────────────────────────────────────────────────────────────────────
-- Section 01 — the question engine (spec §3–§9).
--
-- The Section 01 questions now use the controls the spec asks for — option
-- buttons beyond Yes/No/N/A (Information Pending, Review Required …),
-- dropdowns, dates, From → To periods, checklists and small forms. So:
--
--   • audit_acceptance_answers.answer holds the chosen option's value or an
--     ISO date (no longer only yes/no/na), and `details` holds the detail
--     fields recorded with it (explanations, dates, the previous-auditor form).
--     `question_key` may carry a sub-key (`ind_03:<service id>`).
--   • answered_by_employee_id records who answered.
--   • Segment status gains Attention Required, plus Locked / Ready for
--     Approval for 01.8 (spec §3).
--   • Acceptance matter categories move to the spec's set (§11).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.audit_acceptance_answers
  DROP CONSTRAINT audit_acceptance_answers_answer_check,
  ADD CONSTRAINT audit_acceptance_answers_answer_check
    CHECK (answer IS NULL OR answer ~ '^[a-z0-9_:-]{1,60}$'),
  DROP CONSTRAINT audit_acceptance_answers_question_key_check,
  ADD CONSTRAINT audit_acceptance_answers_question_key_check
    CHECK (question_key ~ '^[a-z0-9_]{2,60}(:[a-z0-9-]{1,60})?$'),
  ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(details) = 'object'),
  ADD COLUMN answered_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL;

ALTER TABLE hsdg.audit_acceptance_segments
  DROP CONSTRAINT audit_acceptance_segments_state_check,
  ADD CONSTRAINT audit_acceptance_segments_state_check CHECK (state IN
    ('not_started','in_progress','attention_required','complete','not_applicable',
     'locked','ready_for_approval'));

-- Acceptance matter categories → the spec's set (§11).
UPDATE hsdg.audit_matter SET category = 'other'
 WHERE section = 'acceptance' AND category IN ('profile','acceptance','engagement_letter');

-- Down Migration

UPDATE hsdg.audit_acceptance_segments SET state = 'in_progress'
 WHERE state IN ('attention_required','locked','ready_for_approval');
ALTER TABLE hsdg.audit_acceptance_segments
  DROP CONSTRAINT audit_acceptance_segments_state_check,
  ADD CONSTRAINT audit_acceptance_segments_state_check CHECK (state IN
    ('not_started','in_progress','complete','not_applicable'));

DELETE FROM hsdg.audit_acceptance_answers
 WHERE answer NOT IN ('yes','no','na') OR question_key LIKE '%:%';
ALTER TABLE hsdg.audit_acceptance_answers
  DROP COLUMN answered_by_employee_id,
  DROP COLUMN details,
  DROP CONSTRAINT audit_acceptance_answers_question_key_check,
  ADD CONSTRAINT audit_acceptance_answers_question_key_check
    CHECK (question_key ~ '^[a-z0-9_]{2,60}$'),
  DROP CONSTRAINT audit_acceptance_answers_answer_check,
  ADD CONSTRAINT audit_acceptance_answers_answer_check
    CHECK (answer IS NULL OR answer IN ('yes','no','na'));
