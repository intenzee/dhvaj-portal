-- Up Migration

-- Acceptance Matters register fields (DHVAJ Section 01 spec §11): a
-- description the team can edit (the generated title stays as the source
-- line, refreshed from the answer) and the action / safeguard taken.
ALTER TABLE hsdg.audit_matter
  ADD COLUMN description text,
  ADD COLUMN action text;

-- Open acceptance matters raised before owners were defaulted: the
-- Engagement Manager (else the Partner) owns them, due in a week.
UPDATE hsdg.audit_matter m
   SET owner_employee_id = COALESCE(m.owner_employee_id, e.engagement_manager_id,
                                    e.engagement_partner_id),
       due_date = COALESCE(m.due_date, current_date + 7)
  FROM hsdg.engagements e
 WHERE e.id = m.engagement_id
   AND m.section = 'acceptance'
   AND m.status IN ('open','under_review','blocking');

-- Down Migration

ALTER TABLE hsdg.audit_matter
  DROP COLUMN IF EXISTS action,
  DROP COLUMN IF EXISTS description;
