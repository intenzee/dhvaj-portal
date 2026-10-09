-- Up Migration
-- Per-question evidence on a Section 02 sub-assessment (02.2 spec §6, §7, §18):
-- a file may be filed under a checklist question (FRF-02 prior Ind AS evidence,
-- FRF-03 voluntary adoption evidence) instead of the sub-assessment as a whole.
-- The same document may sit under the sub-assessment and under a question.

ALTER TABLE hsdg.audit_framework_files
  ADD COLUMN question_key text
    CHECK (question_key IS NULL OR question_key ~ '^[a-z0-9_]{2,40}$');

DROP INDEX hsdg.audit_framework_files_live_unique;
CREATE UNIQUE INDEX audit_framework_files_live_unique
  ON hsdg.audit_framework_files (subassessment_id, COALESCE(question_key, ''), document_id)
  WHERE removed_at IS NULL;

-- Down Migration
-- Question links fold back into the sub-assessment's list; duplicates are retired.
UPDATE hsdg.audit_framework_files f
   SET removed_at = now()
 WHERE f.removed_at IS NULL AND f.question_key IS NOT NULL
   AND EXISTS (SELECT 1 FROM hsdg.audit_framework_files g
                WHERE g.subassessment_id = f.subassessment_id AND g.document_id = f.document_id
                  AND g.removed_at IS NULL AND g.id <> f.id
                  AND (g.question_key IS NULL OR g.id < f.id));
DROP INDEX hsdg.audit_framework_files_live_unique;
CREATE UNIQUE INDEX audit_framework_files_live_unique
  ON hsdg.audit_framework_files (subassessment_id, document_id) WHERE removed_at IS NULL;
ALTER TABLE hsdg.audit_framework_files DROP COLUMN question_key;
