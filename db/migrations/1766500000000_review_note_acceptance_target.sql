-- Up Migration

-- Review notes on a Section 01 segment (DHVAJ Section 01 spec §13 context
-- panel): the reviewer comments on Engagement & Acceptance where it is done.
ALTER TABLE hsdg.audit_review_notes
  DROP CONSTRAINT audit_review_notes_target_type_check,
  ADD CONSTRAINT audit_review_notes_target_type_check
    CHECK (target_type IN ('procedure','work_area','evidence','acceptance_segment'));

-- Down Migration

DELETE FROM hsdg.audit_review_notes WHERE target_type = 'acceptance_segment';
ALTER TABLE hsdg.audit_review_notes
  DROP CONSTRAINT audit_review_notes_target_type_check,
  ADD CONSTRAINT audit_review_notes_target_type_check
    CHECK (target_type IN ('procedure','work_area','evidence'));
